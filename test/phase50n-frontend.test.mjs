// PHASE 50N: Frontend-Pruefungen fuer Abmeldebestaetigung, Dokumentmodus und Pfadzuordnung (lokal).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(ROOT, f), 'utf8');

function laden() {
  const ctx = { window: {}, globalThis: null };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('entity-abmeldung.js'), ctx);
  return ctx.EntityLogoutGuard;
}
const G = laden();

// --- Abmeldebestaetigung ---
test('L1 Abmeldung ohne offene Eintraege: ohne Rueckfrage erlaubt', () => {
  let gefragt = false;
  const ok = G.bestaetigen({ liste: [{ state: 'final' }, { state: 'discarded' }], fehler: false, online: true, frage: () => { gefragt = true; return false; } });
  assert.equal(ok, true);
  assert.equal(gefragt, false);
});

test('L2 offene Eintraege: Rueckfrage; Bestaetigung erlaubt Abmeldung', () => {
  let text = '';
  const ok = G.bestaetigen({ liste: [{ state: 'queued' }, { state: 'stored' }], fehler: false, online: true, frage: t => { text = t; return true; } });
  assert.equal(ok, true);
  assert.match(text, /2 Dokumente/);
  assert.match(text, /bleib(t|en) verschlüsselt/);   // Singular "bleibt" bzw. Plural "bleiben"
});

test('L3 Abbruch der Rueckfrage: Abmeldung findet nicht statt', () => {
  const ok = G.bestaetigen({ liste: [{ state: 'unknown' }], fehler: false, online: true, frage: () => false });
  assert.equal(ok, false);
});

test('L4 fehlgeschlagene Synchronisation (rejected/corrupt/key_missing) zaehlt als nicht gesichert', () => {
  for (const state of ['rejected', 'corrupt', 'key_missing', 'discard_pending', 'uploading']) {
    assert.equal(G.zaehleOffen([{ state }]), 1, state);
  }
});

test('L5 Zustand nicht lesbar: Rueckfrage (fail-safe), nie stille Bestaetigung', () => {
  let gefragt = 0;
  const ok = G.bestaetigen({ liste: null, fehler: true, online: true, frage: () => { gefragt++; return false; } });
  assert.equal(ok, false);
  assert.equal(gefragt, 1);
});

test('L6 kein Frage-Mechanismus vorhanden: Abmeldung wird verweigert, nicht bestaetigt', () => {
  assert.equal(G.bestaetigen({ liste: [], fehler: false, online: true, frage: undefined }), false);
  assert.equal(G.bestaetigen({ liste: [{ state: 'queued' }], fehler: false, online: true, frage: null }), false);
});

test('L7 Keine Loeschung: Bestaetigung veraendert die Liste nicht', () => {
  const liste = [{ state: 'queued', uploadId: 'up-1' }, { state: 'stored', uploadId: 'up-2' }];
  const vorher = JSON.stringify(liste);
  G.bestaetigen({ liste, fehler: false, online: false, frage: () => true });
  assert.equal(JSON.stringify(liste), vorher);
});

test('L8 Hinweistext bei fehlender Verbindung nennt den Netzstatus', () => {
  let text = '';
  G.bestaetigen({ liste: [{ state: 'queued' }], fehler: false, online: false, frage: t => { text = t; return true; } });
  assert.match(text, /keine Netzwerkverbindung/);
});

test('L9 Eintrag ohne Zustand oder Nicht-Objekt zaehlt nicht als offen, verfaelscht die Zaehlung nicht', () => {
  assert.equal(G.zaehleOffen([null, undefined, { state: 'final' }]), 0);
  assert.equal(G.zaehleOffen(null), 0);
});

// --- Index-Verdrahtung (statisch, da index.html eine Einzeldatei ist) ---
const html = read('index.html');
const outbox = read('docs-outbox.js');

test('V1 doLogout wartet auf die Abmeldebestaetigung; die Attrappe ist entfernt', () => {
  assert.match(html, /if \(!\(await entityAbmeldungBestaetigen\(\)\)\) \{ officeLogoutLaeuft = false; return; \}/);
  // Reihenfolge: Flag wird VOR der Rueckfrage gesetzt (Doppelklick-Schutz).
  const flag = html.indexOf('officeLogoutLaeuft = true;', html.indexOf('async function doLogout()'));
  const frage = html.indexOf('await entityAbmeldungBestaetigen()', html.indexOf('async function doLogout()'));
  assert.ok(flag > 0 && frage > flag, 'Flag muss vor der Rueckfrage gesetzt werden');
  assert.doesNotMatch(html, /function entityAbmeldungBestaetigen\(\) \{ return true; \}/);
  assert.match(html, /async function entityAbmeldungBestaetigen\(\)/);
});

test('V2 Sitzungsablauf und Widerruf rufen die Rueckfrage nicht auf', () => {
  const expired = html.slice(html.indexOf('function officeSitzungAbgelaufen'), html.indexOf('function officeSitzungAbgelaufen') + 900);
  assert.doesNotMatch(expired, /entityAbmeldungBestaetigen/);
  const revoke = html.match(/'remote-logout'[\s\S]{0,200}/);
  assert.ok(revoke === null || !/entityAbmeldungBestaetigen/.test(revoke[0]));
});

test('V3 entity-abmeldung.js ist eingebunden und die Funktion nutzt das Modul', () => {
  assert.match(html, /<script src="entity-abmeldung.js"><\/script>/);
  assert.match(html, /EntityLogoutGuard\.bestaetigen\(/);
});

test('V4 Download-Pfad: Authority nur mit uploadId, Legacy nur mit docId, kein Mischbetrieb', () => {
  const block = html.slice(html.indexOf('async function entityBlobVon'), html.indexOf('async function entityBlobVon') + 700);
  assert.match(block, /entity-docs2\/download/);
  assert.match(block, /entity-docs\/download/);
  assert.match(block, /'&uploadId=' : '&docId='/);
});

test('V5 Modus wird vom Server geholt; Fehler oder unbekannter Wert ergeben keinen Pfad', () => {
  const block = html.slice(html.indexOf('async function entityModusSicherstellen'), html.indexOf('async function entityModusSicherstellen') + 800);
  assert.match(block, /bzCall\('GET', '\/app\/admin\/doc-mode'\)/);
  assert.match(block, /modus !== 'off' && modus !== 'legacy' && modus !== 'authority'/);
  assert.match(block, /throw Object\.assign\(new Error\('modus_unbekannt'\)/);
});

test('V6 Outbox: jeder Dokumentaufruf laeuft ueber pfad(); fest verdrahtete Pfade nur in der Zuordnungstabelle', () => {
  const literale = outbox.match(/'\/app\/admin\/entity-docs[^']*'/g) || [];
  assert.deepEqual(literale.sort(), ["'/app/admin/entity-docs'", "'/app/admin/entity-docs2'"].sort());
  assert.equal((outbox.match(/pfad\(/g) || []).length >= 4, true);
});

test('V7 Outbox ohne gesetzten Modus wirft, statt einen Standardpfad zu verwenden', () => {
  const m = outbox.match(/function pfad\(suffix\) \{[\s\S]*?\n  \}/);
  assert.ok(m, 'pfad() fehlt');
  assert.match(m[0], /if \(!basis\)/);
  assert.match(m[0], /modus_unbekannt/);
});

test('V8 Upload-Antwort der Authority wird nur fuer die eigene uploadId uebernommen', () => {
  const m = outbox.match(/function docAusUpload[\s\S]*?\n  \}/);
  assert.ok(m, 'docAusUpload fehlt');
  assert.match(m[0], /r\.uploadId === rec\.uploadId/);
  assert.match(m[0], /duplicate/);
  assert.match(m[0], /if \(modus === 'legacy'\) return r\.doc/);
});

// PHASE 50N.1: Verhaltenspruefung der Pfadzuordnung (nicht nur Textpruefung). Ausschnitt aus docs-outbox.js
// wird unveraendert in einer Sandbox ausgefuehrt. Ohne gesetzten Modus darf kein Pfad entstehen.
const pfadAusschnitt = (() => {
  const txt = read('docs-outbox.js');
  const a = txt.indexOf('  const BASIS_MODUS');
  const b = txt.indexOf('  // Upload-Ergebnis in die Form');
  if (a < 0 || b < 0 || b <= a) throw new Error('Ausschnitt pfad()/setzeModus() nicht gefunden');
  return txt.slice(a, b);
})();
function pfadSandbox() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(pfadAusschnitt + '\n;globalThis.__api = { pfad, setzeModus, basisWert: () => basis };', ctx);
  return ctx.__api;
}
test('P1 pfad() ohne gesetzten Modus wirft modus_unbekannt und liefert keinen Standardpfad', () => {
  const api = pfadSandbox();
  let code = null;
  try { api.pfad('/status'); } catch (e) { code = e.code; }
  assert.equal(code, 'modus_unbekannt');
  assert.equal(api.basisWert(), null);
});
test('P2 pfad() nach setzeModus: nur der gesetzte Modus, kein Wechsel ohne neue Setzung', () => {
  const api = pfadSandbox();
  api.setzeModus('authority');
  assert.equal(api.pfad('/upload'), '/app/admin/entity-docs2/upload');
  api.setzeModus('legacy');
  assert.equal(api.pfad('/upload'), '/app/admin/entity-docs/upload');
});
