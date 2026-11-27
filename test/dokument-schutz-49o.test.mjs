// PHASE 49O: Schutz lokaler Dokumente. Keine Datenlöschung beim Start, beim Abmelden oder bei unbekanntem Sync-Status.
// Synthetische Daten, keine Netzwerkzugriffe, keine echten Dokumente. Die Funktionen werden aus index.html gelesen
// und in einer leeren vm-Umgebung mit Attrappen (Stubs) für indexedDB, localStorage und safeStorage ausgeführt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// index.html liegt mit CRLF-Zeilenenden vor; für die Suche auf LF normalisieren.
const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// Liest eine Top-Level-Funktion aus dem Quelltext (bis zur schließenden Klammer in eigener Zeile).
function funktion(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Funktion fehlt: ${name}`);
  const ende = src.indexOf('\n}\n', start);
  return src.slice(start, ende + 3);
}

function attrappen({ dbListe = [] } = {}) {
  const aufrufe = { deleteDatabase: [], open: [], removeItem: [], warn: [] };
  const idb = {
    deleteDatabase: (n) => { aufrufe.deleteDatabase.push(n); return {}; },
    open: (n) => { aufrufe.open.push(n); return {}; },
    databases: async () => dbListe,
  };
  const ctx = {
    indexedDB: idb,
    WEBAUTHN_PIN_PREFIX: 'webauthn_pin_',
    safeStorage: {
      keys: () => ['webauthn_pin_test-a'],
      removeItem: (k) => aufrufe.removeItem.push(['safe', k]),
    },
    localStorage: { removeItem: (k) => aufrufe.removeItem.push(['local', k]) },
    console: { warn: (m) => aufrufe.warn.push(m), log: () => {} },
    Promise,
  };
  vm.createContext(ctx);
  return { ctx, aufrufe };
}

const bereinige = funktion('bereinigeAltbestaende') + funktion('legacyDokumenteHinweis');

test('Start: lokaler Dokument-Altbestand wird nicht geloescht (auch bei mehrfachem Start)', async () => {
  const { ctx, aufrufe } = attrappen({ dbListe: [{ name: 'lagertool_docs', version: 3 }] });
  vm.runInContext(bereinige + '\nbereinigeAltbestaende(); bereinigeAltbestaende();', ctx);
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(aufrufe.deleteDatabase, [], 'lagertool_docs wurde beim Start geloescht');
  assert.deepEqual(aufrufe.open, [], 'Datenbank wurde geoeffnet');
});

test('Start: Hinweis erscheint, wenn der Altbestand existiert (nur Meldung)', async () => {
  const { ctx, aufrufe } = attrappen({ dbListe: [{ name: 'lagertool_docs' }] });
  vm.runInContext(bereinige + '\nbereinigeAltbestaende();', ctx);
  await new Promise(r => setTimeout(r, 0));
  assert.equal(aufrufe.warn.length, 1);
  assert.match(aufrufe.warn[0], /nicht geloescht/);
});

test('Unbekannter Sync-Status: Start loescht auch ohne Datenbankliste nichts', async () => {
  const { ctx, aufrufe } = attrappen({ dbListe: [] });
  vm.runInContext(bereinige + '\nbereinigeAltbestaende();', ctx);
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(aufrufe.deleteDatabase, []);
  assert.equal(aufrufe.warn.length, 0);
});

test('Sicherheitsbereinigung bleibt erhalten: PIN-Speicher und Claude-Schluessel werden weiter entfernt', () => {
  const { ctx, aufrufe } = attrappen();
  vm.runInContext(bereinige + '\nbereinigeAltbestaende();', ctx);
  assert.deepEqual(aufrufe.removeItem, [['safe', 'webauthn_pin_test-a'], ['local', 'lagertool_claude_key']]);
});

test('Dokument nur lokal vorhanden: keine Datei-Datenbank wird angelegt oder befuellt', () => {
  assert.match(src, /function saveDocsToIDB\(s\) \{ \/\* bewusst leer/);
  assert.match(src, /function loadDocsFromIDB\(s\) \{ return Promise\.resolve\(\); \}/);
  assert.equal([...src.matchAll(/indexedDB\.open\(/g)].length, 0, 'indexedDB.open gefunden');
});

test('Dokument bereits serverseitig gespeichert: Baustellen-Server-Dokumente bleiben vollständig erhalten', () => {
  const strip = funktion('stripLargeData');
  const ctx = { Date, JSON };
  vm.createContext(ctx);
  vm.runInContext(strip, ctx);
  const serverDoc = { name: 'Plan.pdf', type: 'application/pdf', storage: 'site-document', id: 'd1', kategorie: 'Pläne', groesse: 1234 };
  const lokalDoc = { name: 'Foto.jpg', type: 'image/jpeg', data: 'data:image/jpeg;base64,AAAA' };
  const ergebnis = vm.runInContext('stripLargeData(s)', Object.assign(ctx, {
    s: { baustellen: [{ id: 'b1', docs: [serverDoc, lokalDoc] }], fahrzeuge: [], mitarbeiter: [] },
  }));
  // JSON-Umweg: Objekte aus der vm-Umgebung haben einen anderen Prototyp.
  const json = (x) => JSON.parse(JSON.stringify(x));
  assert.deepEqual(json(ergebnis.baustellen[0].docs[0]), serverDoc, 'Server-Dokument wurde veraendert');
  assert.deepEqual(json(ergebnis.baustellen[0].docs[1]), { name: 'Foto.jpg', type: 'image/jpeg', _localOnly: true });
});

test('Abmelden (unterschiedliche Benutzer): keine Dokument-Löschung beim Sitzungsende', () => {
  const block = funktion('officeSitzungAufraeumen');
  assert.equal(/deleteDatabase/.test(block), false, 'Sitzungsende loescht Dokumente');
  assert.equal(/lagertool_docs/.test(block), false);
  assert.match(block, /Promise\.all\(\[signOut\]\)/);
});

test('Gesamter Quelltext: kein Löschaufruf für Dokumentdatenbanken', () => {
  assert.equal([...src.matchAll(/deleteDatabase\(/g)].length, 0, 'deleteDatabase gefunden');
});

test('Start ruft die Bereinigung auf, ohne Dokumente zu entfernen', () => {
  const start = src.indexOf('function load() {');
  assert.ok(start > 0);
  const block = src.slice(start, src.indexOf('\n}\n', start));
  assert.match(block, /bereinigeAltbestaende\(\);/);
  assert.equal(/deleteDatabase|lagertool_docs/.test(block), false);
});

test('Netzwerk unterbrochen: lokale Speicherung meldet lokalOnly statt zu verwerfen', () => {
  const block = funktion('save');
  assert.match(block, /localOnly:true/);
  assert.equal(/deleteDatabase|removeItem\(\s*'lagertool_docs'/.test(block), false);
});

test('Berechtigung zum Dokumentenzugriff: Speichern ist an die Anmeldung gebunden', () => {
  assert.match(funktion('save'), /lagertoolDarfSchreiben\(\)/);
  assert.match(src, /async function bsUploadDocumentToServer\(file\) \{\s*if \(!lagertoolDarfSchreiben\(\)\)/);
});

test('Upload fehlgeschlagen: Fehlerpfad des Baustellen-Uploads verwirft lokale Vorlage nicht automatisch', () => {
  const start = src.indexOf('async function bsUploadDocumentToServer(file) {');
  const block = src.slice(start, src.indexOf('\n}\n', start));
  assert.equal(/deleteDatabase|tempBsDocs\s*=\s*\[\]/.test(block), false, 'Fehlerpfad leert lokale Vorlage');
});
