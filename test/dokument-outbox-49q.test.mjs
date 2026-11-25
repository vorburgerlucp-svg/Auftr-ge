// PHASE 49Q/49R: Glue-Logik der Dokumentenübernahme in index.html (Speicherreihenfolge, Platzhalter, Zuordnung,
// Entfernen vor dem Speichern, Benutzer- und Sitzungsgrenzen). Die Verschlüsselung, die Persistenz und die
// Zustandsmaschine prüfen die Browser-Tests (be-integ/e2e/outbox) gegen Chromium und den lokalen R2-Adapter.
// Hier wird DocOutbox durch eine Attrappe mit derselben Schnittstelle ersetzt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const MARK_A = '// PHASE 49Q/49R: Fahrzeug- und Mitarbeiterdokumente. Neue Dokumente';
const MARK_B = 'function saveMaModal() { return entitySpeichernMit';
function block() {
  const a = src.indexOf(MARK_A);
  const b = src.indexOf(MARK_B, a);
  if (a < 0 || b < 0) throw new Error('Block nicht gefunden');
  return src.slice(a, src.indexOf('\n', b) + 1);
}
function fn(name) {
  const a = src.indexOf(`function ${name}(`);
  if (a < 0) throw new Error('Funktion fehlt: ' + name);
  return src.slice(a, src.indexOf('\n}\n', a) + 3);
}
const GLUE = block();
const STRIP = fn('stripLargeData');
const MAID = fn('maIdValue');
const SITZUNG = fn('officeSitzungBeenden');
const SETZEN = fn('officeSitzungSetzen');

function attrappeOutbox() {
  const items = [];
  let zaehler = 0;
  const steuer = { putReason: null, persist: 'dauerhaft', persistFail: false, blobOffen: false };
  const api = { failNetwork: false, status: null, stored: [], finalized: [] };
  const DocOutbox = {
    calls: [],
    async persistenzStatus() { return { status: steuer.persist, dauerhaft: steuer.persist === 'dauerhaft', unterstuetzt: steuer.persist !== 'nicht_unterstuetzt' }; },
    async persistenzAnfordern() { if (steuer.persistFail) return { status: 'nicht_dauerhaft', dauerhaft: false }; return { status: steuer.persist, dauerhaft: steuer.persist === 'dauerhaft' }; },
    async hinzufuegen({ employeeId, kind, entityId, name, type, bytes }) {
      this.calls.push(['hinzufuegen', employeeId]);
      if (steuer.putReason) return { ok: false, reason: steuer.putReason };
      const sha = createHash('sha256').update(Buffer.from(bytes)).digest('hex');
      const dup = items.find(i => i.owner === employeeId && i.kind === kind && i.entityId === String(entityId) && i.sha === sha && i.state !== 'discarded');
      if (dup) return { ok: true, status: 'duplicate', uploadId: dup.uploadId };
      const uploadId = 'up-' + String(++zaehler).padStart(32, '0');
      items.push({ uploadId, owner: employeeId, kind, entityId: String(entityId), name, type, bytes: Buffer.from(bytes), sha, state: 'queued' });
      return { ok: true, status: 'queued', uploadId };
    },
    async liste(owner) {
      return items.filter(i => i.owner === owner).map(i => ({ uploadId: i.uploadId, kind: i.kind, entityId: i.entityId, state: i.state, name: i.name }));
    },
    async hochladen({ employeeId, api: call, onErfolg }) {
      this.calls.push(['hochladen', employeeId]);
      let wartet = false;
      for (const it of items.filter(i => i.owner === employeeId && i.state === 'queued')) {
        try {
          const r = await call('POST', '/app/admin/entity-docs/upload?uploadId=' + it.uploadId, { raw: { type: it.type, bytes: it.bytes } });
          it.state = 'stored';
          it.serverDocId = r.doc.id;
          it.serverMeta = { mime: r.doc.mime, size: r.doc.size, sha256: r.doc.sha256, createdAt: r.doc.createdAt };
          api.stored.push(it.uploadId);
          onErfolg({ uploadId: it.uploadId, kind: it.kind, entityId: it.entityId }, r.doc, { nur: 'neu' });
        } catch (e) {
          wartet = true;
          if (e.status === 401) break;
        }
      }
      return { wartet };
    },
    async finalisiere({ employeeId, api: call, uploadIds }) {
      this.calls.push(['finalisiere', employeeId]);
      const out = [];
      for (const it of items.filter(i => i.owner === employeeId && i.state === 'stored' && (!uploadIds || uploadIds.includes(i.uploadId)))) {
        it.state = 'final';
        api.finalized.push(it.uploadId);
        out.push({ uploadId: it.uploadId, kind: it.kind, entityId: it.entityId, status: 'final', serverDocId: it.serverDocId, serverMeta: it.serverMeta });
      }
      return out;
    },
    async pruefeUnbekannt({ employeeId, uploadId }) {
      this.calls.push(['pruefeUnbekannt', employeeId]);
      const it = items.find(i => i.uploadId === uploadId && i.owner === employeeId);
      if (!it) return { ok: false, reason: 'nicht_gefunden' };
      return { ok: true, state: it.state };
    },
    async verwerfen({ employeeId, uploadId, bestaetigt }) {
      this.calls.push(['verwerfen', employeeId]);
      if (bestaetigt !== true) return { ok: false, reason: 'nicht_bestaetigt' };
      const idx = items.findIndex(i => i.uploadId === uploadId && i.owner === employeeId);
      if (idx < 0) return { ok: false, reason: 'nicht_gefunden' };
      if (['queued', 'uploading', 'unknown', 'final'].includes(items[idx].state)) return { ok: false, reason: 'nicht_verwerfbar', state: items[idx].state };
      items.splice(idx, 1);
      return { ok: true, reason: 'lokal_entfernt' };
    },
    async verwerfenVorSpeichern({ employeeId, uploadId, bestaetigt }) {
      this.calls.push(['verwerfenVorSpeichern', employeeId]);
      if (bestaetigt !== true) return { ok: false, reason: 'nicht_bestaetigt' };
      if (steuer.blobOffen) return { ok: false, reason: 'blob_offen' };
      const idx = items.findIndex(i => i.uploadId === uploadId && i.owner === employeeId);
      if (idx < 0) return { ok: false, reason: 'nicht_gefunden' };
      if (['uploading', 'unknown', 'final'].includes(items[idx].state)) return { ok: false, reason: 'nicht_verwerfbar', state: items[idx].state };
      items.splice(idx, 1);
      return { ok: true, reason: 'lokal_entfernt' };
    }
  };
  return { DocOutbox, items, steuer, api };
}

// PHASE 50N: echter Abmelde-Guard aus entity-abmeldung.js in den Sandbox-Kontext laden.
const GUARD_SRC = readFileSync(new URL('../entity-abmeldung.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function guardModul() { const c = {}; c.window = c; c.globalThis = c; vm.createContext(c); vm.runInContext(GUARD_SRC, c); return c.EntityLogoutGuard; }

function welt({ owner = 'EMP-A' } = {}) {
  const ob = attrappeOutbox();
  ob.DocOutbox.setzeModus = () => {};   // PHASE 50N: Pfadbasis ist im Glue-Test ohne Wirkung (Legacy-Modus)
  const rec = { saves: 0, renders: 0, toasts: [], reloads: 0, speichernAufrufe: [], bzCalls: [], confirms: [], confirmAnswer: true };
  const felder = { 'fzg-modal-id': { value: '' }, 'ma-modal-id': { value: '' }, 'login-screen': { style: {} } };
  const ctx = {
    console: { warn() {}, log() {} },
    DocOutbox: ob.DocOutbox,
    state: { fahrzeuge: [], mitarbeiter: [] },
    bzSession: { token: 'tok', name: 'Luc', employeeId: owner },
    bzGeneration: 0,
    tempDocs: [],
    tempMaDocs: [],
    entityOutbox: [],
    fetch: async () => ({ arrayBuffer: async () => new Uint8Array([37, 80, 68, 70, 45]).buffer }),
    bzCall: async (method, path, body, opts) => {
      rec.bzCalls.push([method, path]);
      if (path === '/app/admin/doc-mode') return { ok: true, mode: 'legacy' };
      if (ob.api.failNetwork) { throw new TypeError('network'); }
      if (ob.api.status) { const e = new Error(ob.api.status); e.status = ob.api.status; e.code = ob.api.status; throw e; }
      const uid = (opts && opts.raw) ? path.match(/uploadId=([^&]+)/)[1] : '';
      return { ok: true, status: 'stored', doc: { id: 'edoc-' + 'a'.repeat(32), name: 'x', mime: 'application/pdf', size: 5, sha256: 'b'.repeat(64), createdAt: 'x', uploadId: uid, status: 'pending' } };
    },
    EntityLogoutGuard: guardModul(),
    save: () => { rec.saves++; return Promise.resolve({ ok: true }); },
    renderAll: () => { rec.renders++; },
    renderDocPreview: () => {},
    renderMaDocPreview: () => {},
    toast: (t, m) => { rec.toasts.push([t, m]); },
    confirm: m => { rec.confirms.push(m); return rec.confirmAnswer; },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0,
    window: { addEventListener() {} },
    document: {
      getElementById: id => felder[id] || null,
      createElement: () => ({ style: {}, setAttribute() {}, remove() {}, appendChild() {}, replaceChildren() {}, addEventListener() {}, textContent: '' }),
      body: { appendChild() {} }
    },
    OfficeSession: { hinweisSetzen() {} },
    officeSitzungAufraeumen: () => Promise.resolve(),
    location: { reload: () => { rec.reloads++; } },
    saveFzgModalIntern: () => { rec.speichernAufrufe.push('fzg'); },
    saveMaModalIntern: () => { rec.speichernAufrufe.push('ma'); },
    Date, JSON, Promise, Object, Array, Map, Buffer, Uint8Array, Error, DOMException: Error,
    FileReader: class { readAsDataURL() {} }
  };
  vm.createContext(ctx);
  vm.runInContext([GLUE, MAID, STRIP, SITZUNG, SETZEN].join('\n'), ctx);
  return { ctx, rec, ob, run: c => vm.runInContext(c, ctx), felder };
}

const bytesDataUrl = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n% glue\n').toString('base64');
const DOK = (name = 'P.pdf') => ({ name, type: 'application/pdf', data: bytesDataUrl });

test('Speichern: neue Dokumente werden vor dem Datensatz sicher abgelegt', async () => {
  const w = welt();
  w.ctx.tempDocs = [DOK()];
  await w.run('entitySpeichernMit("fahrzeug", "fzg-modal-id", saveFzgModalIntern, () => tempDocs)');
  assert.equal(w.ob.items.length, 1);
  assert.equal(w.rec.speichernAufrufe.length, 1);
  assert.equal(w.ctx.tempDocs[0].uploadId, w.ob.items[0].uploadId);
});

test('Reihenfolge: Ablage vor dem Speichern des Datensatzes', async () => {
  const w = welt();
  w.ctx.tempDocs = [DOK()];
  const reihenfolge = [];
  w.ctx.saveFzgModalIntern = () => { reihenfolge.push(w.ob.items.length ? 'speichern-nach-ablage' : 'speichern-ohne-ablage'); };
  await w.run('entitySpeichernMit("fahrzeug", "fzg-modal-id", saveFzgModalIntern, () => tempDocs)');
  assert.deepEqual(reihenfolge, ['speichern-nach-ablage']);
});

test('Ablage schlägt fehl (Speicher voll / gesperrt / Zurücklesen): Datensatz wird nicht gespeichert, Hinweis', async () => {
  for (const reason of ['speicher_voll', 'persistenz_nicht_verfuegbar', 'readback_fehlgeschlagen']) {
    const w = welt();
    w.ob.steuer.putReason = reason;
    w.ctx.tempDocs = [DOK()];
    await w.run('entitySpeichernMit("fahrzeug", "fzg-modal-id", saveFzgModalIntern, () => tempDocs)');
    assert.deepEqual(w.rec.speichernAufrufe, [], 'Datensatz trotz fehlender Ablage gespeichert (' + reason + ')');
    assert.equal(w.rec.toasts[0][0], 'Dokument nicht gespeichert');
  }
});

test('Datensatz erhält nur Platzhalter ohne Dateiinhalt', async () => {
  const w = welt();
  w.ctx.tempDocs = [DOK()];
  await w.run('entitySpeichernMit("fahrzeug", "fzg-modal-id", saveFzgModalIntern, () => tempDocs)');
  const platz = w.run('entityAusFormular("fahrzeug", "7", tempDocs)');
  assert.equal(platz.length, 1);
  assert.equal(platz[0].data, undefined);
  assert.equal(platz[0].pending, true);
  assert.match(platz[0].uploadId, /^up-/);
});

test('Hochladen, dann Zuordnung: Platzhalter wird nach Finalisierung durch Server-Metadaten ersetzt', async () => {
  const w = welt();
  w.ctx.state.fahrzeuge = [{ id: 7, docs: [] }];
  w.ctx.tempDocs = [DOK()];
  await w.run('entityDokumenteVorSpeichern("fahrzeug", 7, tempDocs)');
  w.ctx.state.fahrzeuge[0].docs = w.run('entityAusFormular("fahrzeug", 7, tempDocs)');
  await w.run('entityOutboxAbarbeiten()');
  const d = w.ctx.state.fahrzeuge[0].docs[0];
  assert.equal(d.storage, 'entity-doc');
  assert.match(d.id, /^edoc-/);
  assert.equal(d.data, undefined);
  assert.ok(w.rec.saves >= 1);
  assert.equal(w.ob.api.finalized.length, 1);
});

test('Hochladen vor Formularspeicherung: Zuordnung erst beim Speichern des Datensatzes', async () => {
  const w = welt();
  w.ctx.state.fahrzeuge = [{ id: 7, docs: [] }];
  w.ctx.tempDocs = [DOK()];
  await w.run('entityDokumenteVorSpeichern("fahrzeug", 7, tempDocs)');
  await w.run('entityOutboxAbarbeiten()');            // Upload vor Formularspeicherung
  assert.equal(w.ob.api.finalized.length, 0, 'Zuordnung ohne gespeicherten Datensatz');
  w.ctx.state.fahrzeuge[0].docs = w.run('entityAusFormular("fahrzeug", 7, tempDocs)');
  await w.run('entityFinalisiereBereite()');
  assert.equal(w.ctx.state.fahrzeuge[0].docs[0].storage, 'entity-doc');
});

test('Wiederholung nach Netzfehler: Eintrag bleibt wartend, zweiter Lauf lädt hoch', async () => {
  const w = welt();
  w.ctx.state.mitarbeiter = [{ id: 3, docs: [] }];
  w.ctx.tempMaDocs = [DOK()];
  await w.run('entityDokumenteVorSpeichern("mitarbeiter", 3, tempMaDocs)');
  w.ctx.state.mitarbeiter[0].docs = w.run('entityAusFormular("mitarbeiter", 3, tempMaDocs)');
  w.ob.api.failNetwork = true;
  await w.run('entityOutboxAbarbeiten()');
  assert.equal(w.ob.items[0].state, 'queued', 'Netzfehler hat den Eintrag verändert');
  w.ob.api.failNetwork = false;
  await w.run('entityOutboxAbarbeiten()');
  assert.equal(w.ob.api.stored.length, 1, 'mehrfacher Upload');
});

test('Doppelte Finalisierung im Datensatz: keine doppelte Zuordnung', async () => {
  const w = welt();
  w.ctx.state.fahrzeuge = [{ id: 7, docs: [] }];
  w.ctx.tempDocs = [DOK()];
  await w.run('entityDokumenteVorSpeichern("fahrzeug", 7, tempDocs)');
  await w.run('entityOutboxAbarbeiten()');
  w.ctx.state.fahrzeuge[0].docs = w.run('entityAusFormular("fahrzeug", 7, tempDocs)');
  await w.run('entityFinalisiereBereite()');
  await w.run('entityFinalisiereBereite()');
  assert.equal(w.ctx.state.fahrzeuge[0].docs.length, 1);
  assert.equal(w.ctx.state.fahrzeuge[0].docs[0].storage, 'entity-doc');
});

test('Duplikat: gleiches Dokument zweimal abgelegt liefert dieselbe uploadId', async () => {
  const w = welt();
  w.ctx.tempA = [{ ...DOK() }];
  await w.run('entityDokumenteVorSpeichern("fahrzeug", 7, tempA)');
  w.ctx.tempB = [{ ...DOK() }];
  await w.run('entityDokumenteVorSpeichern("fahrzeug", 7, tempB)');
  assert.equal(w.ob.items.length, 1);
  assert.equal(w.ctx.tempB[0].uploadId, w.ctx.tempA[0].uploadId);
});

test('Benutzerwechsel: Einträge eines anderen Benutzers werden nicht hochgeladen oder angezeigt', async () => {
  const w = welt({ owner: 'EMP-A' });
  w.ctx.tempDocs = [DOK()];
  await w.run('entityDokumenteVorSpeichern("fahrzeug", 7, tempDocs)');
  w.ctx.bzSession = { token: 'tok2', name: 'Anna', employeeId: 'EMP-B' };
  assert.equal((await w.ob.DocOutbox.liste('EMP-B')).length, 0);
  await w.run('entityOutboxAbarbeiten()');
  assert.equal(w.ob.api.stored.length, 0, 'Benutzer B hat Dokumente von A hochgeladen');
  assert.equal(w.ob.items[0].state, 'queued');
});

test('Logout verwirft nichts', async () => {
  const w = welt();
  w.ctx.tempDocs = [DOK()];
  await w.run('entityDokumenteVorSpeichern("fahrzeug", 7, tempDocs)');
  // PHASE 50N: Die Attrappe (immer true, ohne Rueckfrage) ist ersetzt. Ein offener Eintrag fuehrt zur Rueckfrage;
  // der Nutzer bestaetigt hier; geloescht wird trotzdem nichts.
  assert.equal(await w.run('entityAbmeldungBestaetigen()'), true);
  assert.equal(w.ob.items.length, 1);
  assert.equal(w.ob.DocOutbox.calls.some(c => c[0] === 'verwerfen' || c[0] === 'verwerfenVorSpeichern'), false);
  assert.equal(w.rec.confirms.length, 1, 'Rueckfrage bei offenem Dokument fehlt');
});

test('Ablauf/Widerruf lädt neu; Dokumente bleiben in der persistenten Ablage', async () => {
  const w = welt();
  w.ctx.tempDocs = [DOK()];
  await w.run('entityDokumenteVorSpeichern("fahrzeug", 7, tempDocs)');
  w.run("officeSitzungBeenden('expired')");
  await new Promise(r => setImmediate(r));
  assert.equal(w.rec.reloads, 1);
  assert.equal(w.ob.items.length, 1);
});

test('Widerruf während des Uploads (401): Eintrag bleibt queued', async () => {
  const w = welt();
  w.ctx.state.fahrzeuge = [{ id: 7, docs: [] }];
  w.ctx.tempDocs = [DOK()];
  await w.run('entityDokumenteVorSpeichern("fahrzeug", 7, tempDocs)');
  w.ob.api.status = 401;
  await w.run('entityOutboxAbarbeiten()');
  assert.equal(w.ob.items[0].state, 'queued');
});

test('Entfernen vor Speichern (noch nicht hochgeladen): Eintrag entfernt, nichts hochgeladen', async () => {
  const w = welt();
  w.ctx.tempDocs = [DOK()];
  await w.run('entityDokumenteVorSpeichern("fahrzeug", 7, tempDocs)');
  await w.run('entityDokumentEntfernen(tempDocs, 0)');
  assert.equal(w.ctx.tempDocs.length, 0);
  assert.equal(w.ob.items.length, 0);
  assert.equal(w.rec.confirms.length, 1, 'Bestätigung fehlte');
});

test('Entfernen mit blobFehler: Formularzeile bleibt, Hinweis, nichts zugeordnet', async () => {
  const w = welt();
  w.ctx.tempDocs = [DOK()];
  await w.run('entityDokumenteVorSpeichern("fahrzeug", 7, tempDocs)');
  w.ob.steuer.blobOffen = true;
  await w.run('entityDokumentEntfernen(tempDocs, 0)');
  assert.equal(w.ctx.tempDocs.length, 1, 'Formularzeile trotz offenem Entfernen gelöscht');
  assert.equal(w.rec.toasts.at(-1)[0], 'Nicht entfernt');
});

test('Entfernen abgebrochen: nichts wird verändert', async () => {
  const w = welt();
  w.ctx.tempDocs = [DOK()];
  await w.run('entityDokumenteVorSpeichern("fahrzeug", 7, tempDocs)');
  w.rec.confirmAnswer = false;
  await w.run('entityDokumentEntfernen(tempDocs, 0)');
  assert.equal(w.ctx.tempDocs.length, 1);
  assert.equal(w.ob.items.length, 1);
});

test('Entfernen gespeicherter Server-Dokumente: abgelehnt, nichts gelöscht', async () => {
  const w = welt();
  w.ctx.tempDocs = [{ id: 'edoc-' + 'c'.repeat(32), name: 'S.pdf', type: 'application/pdf', storage: 'entity-doc' }];
  await w.run('entityDokumentEntfernen(tempDocs, 0)');
  assert.equal(w.ctx.tempDocs.length, 1);
  assert.equal(w.rec.confirms.length, 0);
});

test('Entfernen während des Uploads: abgelehnt', async () => {
  const w = welt();
  w.ctx.tempDocs = [DOK()];
  await w.run('entityDokumenteVorSpeichern("fahrzeug", 7, tempDocs)');
  w.ob.items[0].state = 'uploading';
  w.ctx.entityOutbox = [{ uploadId: w.ob.items[0].uploadId, state: 'uploading' }];
  w.run('entityOutbox = ' + JSON.stringify([{ uploadId: w.ob.items[0].uploadId, state: 'uploading' }]));
  await w.run('entityDokumentEntfernen(tempDocs, 0)');
  assert.equal(w.ctx.tempDocs.length, 1);
  assert.equal(w.rec.toasts.at(-1)[0], 'Bitte warten');
});

test('Entfernen bereits zugeordneter Dokumente über den Formularpfad: abgelehnt', async () => {
  const w = welt();
  w.ctx.tempDocs = [DOK()];
  await w.run('entityDokumenteVorSpeichern("fahrzeug", 7, tempDocs)');
  w.ob.items[0].state = 'final';
  await w.run('entityDokumentEntfernen(tempDocs, 0)');
  assert.equal(w.ctx.tempDocs.length, 1, 'bereits zugeordnetes Dokument wurde aus dem Formular entfernt');
});

test('Formularspeicherung schlägt fehl: wartendes Dokument bleibt, nichts wird zugeordnet', async () => {
  const w = welt();
  w.ctx.state.fahrzeuge = [{ id: 7, docs: [] }];
  w.ctx.tempDocs = [DOK()];
  await w.run('entityDokumenteVorSpeichern("fahrzeug", 7, tempDocs)');
  await w.run('entityOutboxAbarbeiten()');
  // Der Datensatz wird nicht gespeichert (kein Platzhalter im Datensatz) -> keine Zuordnung.
  await w.run('entityFinalisiereBereite()');
  assert.equal(w.ob.api.finalized.length, 0);
  assert.equal(w.ob.items[0].state, 'stored');
});

test('Persistenz verweigert: Hinweis-Status gesetzt, Annahme bleibt erlaubt', async () => {
  const w = welt();
  w.ob.steuer.persist = 'nicht_dauerhaft';
  w.ob.steuer.persistFail = true;
  await w.run('entityPersistenzPruefen(true)');
  assert.equal(w.run('entityPersistenz.status'), 'nicht_dauerhaft');
  w.ctx.tempDocs = [DOK()];
  await w.run('entitySpeichernMit("fahrzeug", "fzg-modal-id", saveFzgModalIntern, () => tempDocs)');
  assert.equal(w.rec.speichernAufrufe.length, 1);
});

test('Unbekannter Status wird nie automatisch verworfen (Glue-Pfad ruft kein Verwerfen auf)', () => {
  const laufpfad = GLUE.slice(GLUE.indexOf('async function entityOutboxAbarbeiten'), GLUE.indexOf('// Speicherstatus'));
  assert.equal(/verwerfen/.test(laufpfad), false, 'automatisches Verwerfen im Lauf');
  assert.match(GLUE, /pruefeUnbekannt/);
});

test('Sicherheitsvertrag: Glue-Code nutzt keinen Browser-Speicher für Dokumente', () => {
  assert.equal(/localStorage\.setItem|sessionStorage\.setItem|indexedDB\./.test(GLUE), false);
  assert.equal(/deleteDatabase/.test(GLUE), false);
});

test('Sicherheitsvertrag: Büro-Sitzung trägt die Mitarbeiter-ID für die Benutzerzuordnung', () => {
  assert.match(SETZEN, /employeeId: employeeId != null/);
  assert.match(src, /officeSitzungSetzen\(data\.officeSession, name, data\.expiresIn, data\.employeeId\)/);
  assert.match(src, /officeSitzungSetzen\(r\.officeSession, name, r\.expiresIn, r\.employeeId\)/);
});

test('Sicherheitsvertrag: Abgleich über uploadId, Platzhalter nur mit gleicher uploadId ersetzt', () => {
  assert.match(GLUE, /findIndex\(d => d\.uploadId === item\.uploadId\)/);
});

test('Strip: Server-Dokumente und Platzhalter bleiben, Altbestand wird markiert', () => {
  const w = welt();
  w.ctx.__s = JSON.parse(JSON.stringify({
    fahrzeuge: [{ id: 1, docs: [
      { id: 'edoc-' + 'd'.repeat(32), name: 'S.pdf', type: 'application/pdf', storage: 'entity-doc' },
      { name: 'P.pdf', type: 'application/pdf', uploadId: 'up-' + 'e'.repeat(32), pending: true, _localOnly: true },
      { name: 'alt.jpg', type: 'image/jpeg', data: 'data:...' }
    ] }],
    mitarbeiter: [{ id: 2, foto: 'data:x', docs: [] }],
    baustellen: []
  }));
  const r = JSON.parse(JSON.stringify(w.run('stripLargeData(__s)')));
  assert.equal(r.fahrzeuge[0].docs[0].storage, 'entity-doc');
  assert.equal(r.fahrzeuge[0].docs[1].pending, true);
  assert.deepEqual(r.fahrzeuge[0].docs[2], { name: 'alt.jpg', type: 'image/jpeg', _localOnly: true });
  assert.equal(r.mitarbeiter[0].foto, '_localOnly');
});
