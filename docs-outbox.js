// PHASE 49Q/49R: Absturzsichere, verschlüsselte Dokument-Outbox (Fahrzeug- und Mitarbeiterdokumente).
//
// Zweck: Ein Dokument liegt verschlüsselt in IndexedDB, bis der Server es bestätigt hat, und bleibt dort über
// Absturz, Neustart und erneute Anmeldung erhalten. Es wird erst dann endgültig einem Datensatz zugeordnet,
// wenn das Formular gespeichert ist (Finalisierung auf dem Server).
//
// Schlüssel (GERÄTEGEBUNDEN, nur für den lokalen, isolierten Pilot):
//  - Je Mitarbeiter-ID ein AES-GCM-256-Schlüssel, nicht exportierbar (extractable: false), als CryptoKey in IndexedDB.
//  - Kein fest eingebauter Schlüssel, keine PIN, kein Token als Schlüsselersatz.
//  - Der Schlüssel ist an das Browserprofil gebunden, nicht an eine persönliche Authentifizierung. Für den
//    produktiven Einsatz ist die Schlüsselverwaltung ausdrücklich offen (siehe Phase-49R-Bericht).
//
// Dauerhafter Speicher: navigator.storage.persist() wird angefordert und per persisted() geprüft. Ein Erfolg ist
// KEIN vollständiger Schutz; die Oberfläche muss das Ergebnis ehrlich anzeigen.
//
// Annahme: Ein neues Dokument wird nur angenommen, wenn der verschlüsselte Datensatz geschrieben und danach
// zurückgelesen, entschlüsselt und per Prüfsumme bestätigt werden konnte.
//
// Zustände: queued | uploading | unknown | stored (Server wartend) | final (Server endgültig) |
//           rejected | corrupt | key_missing | discarded
//
// Regeln:
//  - Keine automatische Löschung. Lokale Bytes werden erst nach bestätigtem Server-Upload entfernt.
//  - Bei unknown wird zuerst der Serverstatus über uploadId abgefragt; niemals automatisch verworfen.
//  - Verwerfen nur durch ausdrückliche Bestätigung, nur eigene Einträge, nur den angegebenen uploadId.
//  - Logout löscht nichts; die Ablage bleibt verschlüsselt erhalten.
(function (global) {
  'use strict';
  const DB_NAME = 'lagertool_outbox';
  const DB_VERSION = 1;
  const SCHEMA = 1;
  const MAX_BYTES = 8 * 1024 * 1024;
  const PERMANENT = [400, 403, 404, 413, 415];
  const OFFEN = ['queued', 'uploading', 'unknown'];

  // PHASE 50N: Pfadbasis je Dokumentmodus. Wird nur über setzeModus() gesetzt, also aus der Serverantwort
  // /app/admin/doc-mode. Ohne Setzung (null) ist jede Serveranfrage gesperrt: kein stiller Rückfall auf einen Pfad.
  const BASIS_MODUS = { legacy: '/app/admin/entity-docs', authority: '/app/admin/entity-docs2' };
  let basis = null;
  let modus = null;
  function pfad(suffix) {
    if (!basis) { const e = new Error('modus_unbekannt'); e.code = 'modus_unbekannt'; throw e; }
    return basis + suffix;
  }
  function setzeModus(m) {
    if (!Object.prototype.hasOwnProperty.call(BASIS_MODUS, m)) throw new Error('modus_ungueltig');
    modus = m;
    basis = BASIS_MODUS[m];
  }
  // Upload-Ergebnis in die Form bringen, die der Ablauf erwartet. Legacy liefert doc; die Authority liefert
  // {status, uploadId} und der Client übernimmt die lokal bekannten Metadaten (Groesse, Hash, Name).
  // Ein fremdes Dokument (Duplikat unter anderer uploadId) wird nie als eigenes übernommen.
  function docAusUpload(r, rec, klar) {
    if (!r) return null;
    if (modus === 'legacy') return r.doc || null;
    if (r.status === 'duplicate') return { id: '', uploadId: r.uploadIdDuplikat || '__duplikat__' };
    if ((r.status === 'pending' || r.status === 'final') && r.uploadId === rec.uploadId) {
      return { id: rec.uploadId, uploadId: rec.uploadId, name: klar.name, mime: rec.mime, size: rec.size, sha256: rec.sha256,
        createdAt: new Date().toISOString(), status: r.status };
    }
    return null;
  }

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function hex(buf) { return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join(''); }
  async function sha256Hex(bytes) { return hex(await crypto.subtle.digest('SHA-256', bytes)); }
  function randomHex(n) { return hex(crypto.getRandomValues(new Uint8Array(n))); }
  function neueUploadId() { return 'up-' + randomHex(16); }
  async function ownerHashOf(employeeId) { return sha256Hex(enc.encode('owner:' + String(employeeId))); }
  function aadOf(rec) { return enc.encode(JSON.stringify([SCHEMA, rec.uploadId, rec.ownerHash, rec.kind, String(rec.entityId)])); }
  function gleich(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    const x = new Uint8Array(a.buffer ? a.buffer : a), y = new Uint8Array(b.buffer ? b.buffer : b);
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }

  function req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  function tx(db, stores, mode, fn) {
    return new Promise((res, rej) => {
      const t = db.transaction(stores, mode);
      let out;
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error || new Error('tx_error'));
      t.onabort = () => rej(t.error || new Error('tx_aborted'));
      try { out = fn(t); } catch (e) { try { t.abort(); } catch (_) {} rej(e); }
    });
  }

  let dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((res, rej) => {
        if (!global.indexedDB) return rej(new Error('idb_unavailable'));
        const r = global.indexedDB.open(DB_NAME, DB_VERSION);
        r.onupgradeneeded = () => {
          const d = r.result;
          if (!d.objectStoreNames.contains('keys')) d.createObjectStore('keys', { keyPath: 'ownerHash' });
          if (!d.objectStoreNames.contains('items')) {
            const s = d.createObjectStore('items', { keyPath: 'uploadId' });
            s.createIndex('owner', 'ownerHash');
          }
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error || new Error('idb_open_failed'));
        r.onblocked = () => rej(new Error('idb_blocked'));
      }).catch(e => { dbPromise = null; throw e; });
    }
    return dbPromise;
  }

  // Liefert den Schlüssel des Eigentümers. Erzeugt ihn genau einmal (Wettlauf zwischen Tabs wird in der Transaktion entschieden).
  async function schluesselFuer(ownerHash, { anlegen }) {
    const d = await db();
    const vorhanden = await tx(d, ['keys'], 'readonly', t => req(t.objectStore('keys').get(ownerHash)));
    if (vorhanden) return vorhanden.key;
    if (!anlegen) return null;
    const neu = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    return tx(d, ['keys'], 'readwrite', t => {
      const s = t.objectStore('keys');
      return req(s.get(ownerHash)).then(existing => {
        if (existing) return existing.key;
        s.put({ ownerHash, key: neu, createdAt: new Date().toISOString() });
        return neu;
      });
    });
  }

  async function verschluesseln(key, rec, bytes, meta) {
    const kopf = enc.encode(JSON.stringify({ name: meta.name, type: meta.type }));
    const laenge = new Uint8Array(4);
    new DataView(laenge.buffer).setUint32(0, kopf.length);
    const klar = new Uint8Array(4 + kopf.length + bytes.length);
    klar.set(laenge, 0); klar.set(kopf, 4); klar.set(bytes, 4 + kopf.length);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aadOf(rec) }, key, klar));
    return { iv, ct };
  }

  async function entschluesseln(key, rec) {
    const klar = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv, additionalData: aadOf(rec) }, key, rec.ct));
    const laenge = new DataView(klar.buffer, klar.byteOffset, 4).getUint32(0);
    const kopf = JSON.parse(dec.decode(klar.subarray(4, 4 + laenge)));
    const bytes = klar.slice(4 + laenge);
    return { name: kopf.name, type: kopf.type, bytes };
  }

  // ---------- Dauerhafter Speicher ----------
  // Status des Browsers. Ein 'dauerhaft' ist keine Garantie, nur die Zusage des Browsers zum Zeitpunkt der Abfrage.
  async function persistenzStatus() {
    const st = global.navigator && global.navigator.storage;
    const unterstuetzt = !!(st && typeof st.persist === 'function');
    let dauerhaft = false, quota = null, usage = null;
    if (unterstuetzt && typeof st.persisted === 'function') { try { dauerhaft = !!(await st.persisted()); } catch (_) { dauerhaft = false; } }
    if (st && typeof st.estimate === 'function') { try { const e = await st.estimate(); quota = e.quota ?? null; usage = e.usage ?? null; } catch (_) {} }
    const kapazitaetKnapp = !!(quota && usage && usage / quota > 0.9);
    const status = !unterstuetzt ? 'nicht_unterstuetzt' : (dauerhaft ? 'dauerhaft' : 'nicht_dauerhaft');
    return { unterstuetzt, dauerhaft, quota, usage, kapazitaetKnapp, status };
  }
  // Fordert dauerhaften Speicher an. Verweigerung oder fehlende API führt zu einem klaren Status, nicht zu einem Fehler.
  async function persistenzAnfordern() {
    const s = await persistenzStatus();
    if (!s.unterstuetzt || s.dauerhaft) return s;
    try { await global.navigator.storage.persist(); } catch (_) {}
    return persistenzStatus();
  }

  // Prüft, ob die verschlüsselte Ablage funktioniert (IndexedDB offen, Schlüssel anlegbar, CryptoKey nicht exportierbar).
  async function pruefen(employeeId) {
    try {
      const oh = await ownerHashOf(employeeId || 'pruefung');
      const key = await schluesselFuer(oh, { anlegen: true });
      if (!(key && typeof key === 'object' && key.type === 'secret' && key.extractable === false)) return { ok: false, reason: 'key_invalid' };
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: (e && e.name === 'QuotaExceededError') ? 'speicher_voll' : 'persistenz_nicht_verfuegbar' };
    }
  }

  // Nimmt ein neues Dokument an. ok:true nur nach geschriebenem, zurückgelesenem und entschlüsselten Datensatz.
  async function hinzufuegen({ employeeId, kind, entityId, name, type, bytes }) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > MAX_BYTES) return { ok: false, reason: 'ungueltige_groesse' };
    try {
      const ownerHash = await ownerHashOf(employeeId);
      const sha256 = await sha256Hex(bytes);
      const d = await db();
      const duplikat = await tx(d, ['items'], 'readonly', t => req(t.objectStore('items').index('owner').getAll(ownerHash)))
        .then(liste => liste.find(r => r.sha256 === sha256 && r.kind === kind && String(r.entityId) === String(entityId) && r.state !== 'rejected' && r.state !== 'discarded'));
      if (duplikat) return { ok: true, status: 'duplicate', uploadId: duplikat.uploadId };
      const key = await schluesselFuer(ownerHash, { anlegen: true });
      const jetzt = new Date().toISOString();
      const rec = { uploadId: neueUploadId(), ownerHash, kind, entityId: String(entityId), state: 'queued', attempts: 0, sha256, size: bytes.length, mime: type, createdAt: jetzt, updatedAt: jetzt, serverDocId: null, serverMeta: null, fehler: null };
      const { iv, ct } = await verschluesseln(key, rec, bytes, { name, type });
      rec.iv = iv; rec.ct = ct;
      await tx(d, ['items'], 'readwrite', t => { t.objectStore('items').put(rec); });
      // Zurücklesen und vollständig prüfen. Schlägt das fehl, bleibt nichts Unvollständiges zurück.
      const zurueck = await tx(d, ['items'], 'readonly', t => req(t.objectStore('items').get(rec.uploadId)));
      let ok = !!zurueck && gleich(zurueck.iv, rec.iv) && gleich(zurueck.ct, rec.ct);
      if (ok) { try { const k = await entschluesseln(key, zurueck); ok = (await sha256Hex(k.bytes)) === sha256 && k.name === name; } catch (_) { ok = false; } }
      if (!ok) {
        await tx(d, ['items'], 'readwrite', t => { t.objectStore('items').delete(rec.uploadId); }).catch(() => {});
        return { ok: false, reason: 'readback_fehlgeschlagen' };
      }
      return { ok: true, status: 'queued', uploadId: rec.uploadId };
    } catch (e) {
      return { ok: false, reason: (e && e.name === 'QuotaExceededError') ? 'speicher_voll' : 'persistenz_nicht_verfuegbar' };
    }
  }

  // Liste für den Eigentümer. Name nur, wenn der Schlüssel vorhanden ist und die Daten unbeschädigt sind.
  async function liste(employeeId) {
    const ownerHash = await ownerHashOf(employeeId);
    const d = await db();
    const recs = await tx(d, ['items'], 'readonly', t => req(t.objectStore('items').index('owner').getAll(ownerHash)));
    const key = await schluesselFuer(ownerHash, { anlegen: false });
    const out = [];
    for (const r of recs) {
      const eintrag = { uploadId: r.uploadId, kind: r.kind, entityId: r.entityId, state: r.state, size: r.size, mime: r.mime, sha256: r.sha256, serverDocId: r.serverDocId, fehler: r.fehler, name: null };
      if (r.ct && key) {
        try { eintrag.name = (await entschluesseln(key, r)).name; } catch (_) { eintrag.name = null; }
      }
      out.push(eintrag);
    }
    return out;
  }

  async function einzelnLesen(uploadId) {
    const d = await db();
    return tx(d, ['items'], 'readonly', t => req(t.objectStore('items').get(uploadId)));
  }

  // Serverstatus über uploadId (Aufruf über den übergebenen API-Adapter).
  async function statusPruefen(api, rec) {
    const q = `?kind=${encodeURIComponent(rec.kind)}&id=${encodeURIComponent(rec.entityId)}&uploadId=${encodeURIComponent(rec.uploadId)}`;
    return api('GET', pfad('/status') + q);
  }

  async function setzeZustand(uploadId, aenderung) {
    const d = await db();
    await tx(d, ['items'], 'readwrite', t => {
      const s = t.objectStore('items');
      return req(s.get(uploadId)).then(r => {
        if (!r) return;
        Object.assign(r, aenderung, { updatedAt: new Date().toISOString() });
        s.put(r);
      });
    });
  }

  // Serverbestätigung: lokale Bytes entfernen, Serverkennung und Metadaten behalten (bis zur Finalisierung).
  async function abschliessen(rec, doc, zustand = 'stored') {
    const meta = { mime: doc.mime, size: doc.size, sha256: doc.sha256, createdAt: doc.createdAt };
    await setzeZustand(rec.uploadId, { state: zustand, serverDocId: doc.id, serverMeta: meta, iv: null, ct: null, fehler: null });
  }

  // Arbeitet die Outbox eines Eigentümers ab. api(method, path, opts) liefert die Antwort oder wirft mit .status.
  // onErfolg(eintrag, doc) wird nach dem lokalen Abschluss aufgerufen (Datensatz aktualisieren).
  async function hochladen({ employeeId, api, onErfolg, onStatus }) {
    const ownerHash = await ownerHashOf(employeeId);
    const ausfuehren = async () => {
      const d = await db();
      const alle = await tx(d, ['items'], 'readonly', t => req(t.objectStore('items').index('owner').getAll(ownerHash)));
      const key = await schluesselFuer(ownerHash, { anlegen: false });
      let wartet = false;
      for (const rec0 of alle) {
        if (!OFFEN.includes(rec0.state)) continue;   // stored, final, rejected, corrupt, key_missing, discarded: nicht hier
        const rec = (await einzelnLesen(rec0.uploadId)) || rec0;
        // 1. Unklarer Status: zuerst Server fragen, niemals blind erneut senden.
        if (rec.state === 'uploading' || rec.state === 'unknown') {
          try {
            const st = await statusPruefen(api, rec);
            if (st && st.status === 'stored' && st.doc) {
              await abschliessen(rec, st.doc);
              if (onErfolg) await onErfolg(rec, st.doc, { nur: 'abgleich' });
              continue;
            }
          } catch (e) {
            if (e.status === 401) { wartet = true; break; }
            wartet = true; continue;
          }
        }
        // 2. Schlüssel und Daten prüfen.
        if (!key) { await setzeZustand(rec.uploadId, { state: 'key_missing', fehler: 'key_missing' }); continue; }
        let klar;
        try {
          klar = await entschluesseln(key, rec);
          if ((await sha256Hex(klar.bytes)) !== rec.sha256 || klar.bytes.length !== rec.size) throw new Error('integrity');
        } catch (_) {
          await setzeZustand(rec.uploadId, { state: 'corrupt', fehler: 'corrupt' });
          continue;
        }
        // 3. Upload mit derselben uploadId (idempotent auf dem Server).
        await setzeZustand(rec.uploadId, { state: 'uploading', attempts: rec.attempts + 1 });
        try {
          const q = `?kind=${encodeURIComponent(rec.kind)}&id=${encodeURIComponent(rec.entityId)}&uploadId=${encodeURIComponent(rec.uploadId)}&sha256=${rec.sha256}&name=${encodeURIComponent(klar.name)}`;
          const r = await api('POST', pfad('/upload') + q, { raw: { type: rec.mime, bytes: klar.bytes } });
          const doc = docAusUpload(r, rec, klar);
          if (!doc) throw new Error('no_doc');
          if (doc.uploadId && doc.uploadId !== rec.uploadId) {
            // Server meldet ein fremdes Dokument mit gleichem Inhalt: nicht übernehmen, Bytes bleiben.
            await setzeZustand(rec.uploadId, { state: 'rejected', fehler: 'duplicate_fremd' });
            continue;
          }
          await abschliessen(rec, doc);
          if (onErfolg) await onErfolg(rec, doc, { nur: 'neu' });
          if (onStatus) onStatus('stored', rec.uploadId);
        } catch (e) {
          if (e && e.status === 401) { await setzeZustand(rec.uploadId, { state: 'queued' }); wartet = true; break; }
          if (e && e.status === 409 && e.code === 'discarded') { await setzeZustand(rec.uploadId, { state: 'discarded', fehler: 'discarded' }); continue; }
          if (e && PERMANENT.includes(e.status)) {
            await setzeZustand(rec.uploadId, { state: 'rejected', fehler: e.code || ('http_' + e.status) });
            if (onStatus) onStatus('rejected', rec.uploadId);
            continue;
          }
          // Netz, Speicher, Konflikt, unbekannte Antwort: Status ist unklar, beim nächsten Lauf zuerst prüfen.
          await setzeZustand(rec.uploadId, { state: 'unknown', fehler: e && e.code ? e.code : 'network' });
          wartet = true;
        }
      }
      return { wartet };
    };
    if (global.navigator && global.navigator.locks && global.navigator.locks.request) {
      const r = await global.navigator.locks.request('lagertool-outbox-' + ownerHash, { ifAvailable: true }, lock => lock ? ausfuehren() : { wartet: true, uebersprungen: true });
      return r || { wartet: true, uebersprungen: true };
    }
    return ausfuehren();
  }

  // Unklarer Status (uploading, unknown): nur Abfrage, nichts wird verworfen oder neu gesendet, wenn der Server speichert.
  async function pruefeUnbekannt({ employeeId, uploadId, api }) {
    const ownerHash = await ownerHashOf(employeeId);
    const rec = await einzelnLesen(uploadId);
    if (!rec || rec.ownerHash !== ownerHash) return { ok: false, reason: 'nicht_gefunden' };
    if (!['uploading', 'unknown'].includes(rec.state)) return { ok: false, reason: 'nicht_unklar', state: rec.state };
    try {
      const st = await statusPruefen(api, rec);
      if (st && st.status === 'stored' && st.doc) {
        await abschliessen(rec, st.doc, st.doc.status === 'final' ? 'final' : 'stored');
        return { ok: true, state: st.doc.status === 'final' ? 'final' : 'stored' };
      }
      await setzeZustand(rec.uploadId, { state: 'queued', fehler: null });
      return { ok: true, state: 'queued' };
    } catch (e) {
      return { ok: false, reason: 'server_unbestaetigt' };
    }
  }

  // Endgültige Zuordnung wartender Dokumente nach dem Speichern des Formulars. Gruppiert je Datensatz.
  // Wiederholung ist ohne Wirkung (der Server antwortet dann mit 'final').
  async function finalisiere({ employeeId, api, uploadIds }) {
    const ownerHash = await ownerHashOf(employeeId);
    const d = await db();
    const alle = await tx(d, ['items'], 'readonly', t => req(t.objectStore('items').index('owner').getAll(ownerHash)));
    const wartend = alle.filter(r => r.state === 'stored' && (!uploadIds || uploadIds.includes(r.uploadId)));
    const gruppen = new Map();
    for (const r of wartend) {
      const k = r.kind + '/' + r.entityId;
      if (!gruppen.has(k)) gruppen.set(k, []);
      gruppen.get(k).push(r);
    }
    const ergebnisse = [];
    for (const [k, recs] of gruppen) {
      const [kind, entityId] = k.split('/');
      let antwort;
      try {
        antwort = await api('POST', pfad('/finalize') + '?kind=' + encodeURIComponent(kind) + '&id=' + encodeURIComponent(entityId), { json: { uploadIds: recs.map(r => r.uploadId) } });
      } catch (e) {
        ergebnisse.push({ kind, entityId, status: 'server_unbestaetigt', code: e.code || null });
        continue;
      }
      for (const r of antwort.results || []) {
        const rec = recs.find(x => x.uploadId === r.uploadId);
        if (!rec) continue;
        if (r.status === 'final') await setzeZustand(rec.uploadId, { state: 'final', fehler: null });
        else if (r.status === 'discarded') await setzeZustand(rec.uploadId, { state: 'discarded', fehler: 'discarded' });
        else await setzeZustand(rec.uploadId, { state: 'rejected', fehler: r.status });
        ergebnisse.push({ uploadId: rec.uploadId, kind, entityId, status: r.status, serverDocId: rec.serverDocId, serverMeta: rec.serverMeta });
      }
    }
    return ergebnisse;
  }

  // Verwerfen (Phase 49T). Nur ausdrücklich bestätigt, nur eigene Einträge, nur der angegebene uploadId.
  //  - rejected, corrupt, key_missing: lokaler Datensatz wird entfernt (kein Serverobjekt betroffen).
  //  - stored, discard_pending, discarded (Serverobjekt wartet): Zustand 'discard_pending' wird VOR dem Serveraufruf
  //    gesetzt (überlebt Absturz und verhindert Finalisierung). Lokal entfernt wird erst, wenn der Server das
  //    Entfernen des Blobs bestätigt (blobGeloescht === true) oder keinen Eintrag mehr kennt (404).
  //    Bei blobFehler bleibt der Eintrag als 'discard_pending' erhalten; eine Wiederholung prüft den Server erneut.
  //  - queued, uploading, unknown, final: nicht über diesen Pfad (queued nur über verwerfenVorSpeichern).
  //  - Der Verschlüsselungsschlüssel wird nie entfernt.
  async function serverVerwerfen(rec, api) {
    const d = await db();
    const lokalEntfernen = () => tx(d, ['items'], 'readwrite', t => { t.objectStore('items').delete(rec.uploadId); });
    try {
      const antwort = await api('POST', pfad('/discard') + '?kind=' + encodeURIComponent(rec.kind) + '&id=' + encodeURIComponent(rec.entityId) + '&uploadId=' + encodeURIComponent(rec.uploadId));
      if (antwort && antwort.status === 'discarded' && antwort.blobGeloescht === true) {
        await lokalEntfernen();
        return { ok: true, reason: 'server_verworfen', blobGeloescht: true };
      }
      const grund = (antwort && antwort.blobFehler) || 'blob_offen';
      await setzeZustand(rec.uploadId, { state: 'discard_pending', fehler: grund });
      return { ok: false, reason: 'blob_offen', blobFehler: grund };
    } catch (e) {
      if (e && e.code === 'finalized') { await setzeZustand(rec.uploadId, { state: 'final', fehler: null }); return { ok: false, reason: 'bereits_zugeordnet' }; }
      if (e && e.status === 404) { await lokalEntfernen(); return { ok: true, reason: 'server_kein_eintrag' }; }
      if (e && e.status === 401) return { ok: false, reason: 'sitzung_ungueltig' };
      await setzeZustand(rec.uploadId, { state: 'discard_pending', fehler: (e && e.code) || 'network' });
      return { ok: false, reason: 'server_unbestaetigt' };
    }
  }
  async function verwerfen({ employeeId, uploadId, bestaetigt, api }) {
    if (bestaetigt !== true) return { ok: false, reason: 'nicht_bestaetigt' };
    const ownerHash = await ownerHashOf(employeeId);
    const rec = await einzelnLesen(uploadId);
    if (!rec || rec.ownerHash !== ownerHash) return { ok: false, reason: 'nicht_gefunden' };
    if (['rejected', 'corrupt', 'key_missing'].includes(rec.state)) {
      const d = await db();
      await tx(d, ['items'], 'readwrite', t => { t.objectStore('items').delete(uploadId); });
      return { ok: true, reason: 'lokal_entfernt' };
    }
    if (['stored', 'discard_pending', 'discarded'].includes(rec.state)) {
      await setzeZustand(uploadId, { state: 'discard_pending' });
      return serverVerwerfen(Object.assign({}, rec, { state: 'discard_pending' }), api);
    }
    return { ok: false, reason: 'nicht_verwerfbar', state: rec.state };
  }

  // Entfernen aus dem Formular vor dem Speichern: zusätzlich zu verwerfen() auch noch nicht hochgeladene Einträge (queued).
  // uploading und unknown werden nie entfernt.
  async function verwerfenVorSpeichern({ employeeId, uploadId, bestaetigt, api }) {
    if (bestaetigt !== true) return { ok: false, reason: 'nicht_bestaetigt' };
    const ownerHash = await ownerHashOf(employeeId);
    const rec = await einzelnLesen(uploadId);
    if (!rec || rec.ownerHash !== ownerHash) return { ok: false, reason: 'nicht_gefunden' };
    if (rec.state === 'queued') {
      const d = await db();
      await tx(d, ['items'], 'readwrite', t => { t.objectStore('items').delete(uploadId); });
      return { ok: true, reason: 'lokal_entfernt' };
    }
    if (['uploading', 'unknown', 'final'].includes(rec.state)) return { ok: false, reason: 'nicht_verwerfbar', state: rec.state };
    return verwerfen({ employeeId, uploadId, bestaetigt, api });
  }

  global.DocOutbox = {
    pruefen, persistenzStatus, persistenzAnfordern,
    hinzufuegen, liste, hochladen, pruefeUnbekannt, finalisiere, verwerfen, verwerfenVorSpeichern,
    setzeModus, modus: () => modus, basis: () => basis,
    _intern: { ownerHashOf, entschluesseln, verschluesseln, db, dbPromise: () => dbPromise }
  };
})(typeof window !== 'undefined' ? window : globalThis);
