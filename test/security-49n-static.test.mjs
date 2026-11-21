// PHASE 49N: statische Sicherheitsregeln fuer die ausgelieferten Frontend-Dateien.
// Keine echten Zugangsdaten: die Tests suchen nur nach Mustern im Quelltext und fuehren keine Anmeldung aus.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const shipped = readdirSync(ROOT)
  .filter(f => /\.(html|js)$/.test(f) && !f.endsWith('.test.mjs'))
  .sort();
const read = f => readFileSync(new URL(f, ROOT), 'utf8');
const sources = Object.fromEntries(shipped.map(f => [f, read(f)]));
const all = Object.values(sources).join('\n');

test('A: ausgelieferte Dateien enthalten keine festen Vier-Ziffern-PINs', () => {
  for (const [f, src] of Object.entries(sources)) {
    assert.equal(/"pin"\s*:\s*"\d{4}"/.test(src), false, `${f}: JSON-PIN-Literal`);
    assert.equal(/\bpin\s*:\s*'\d{4}'/.test(src), false, `${f}: pin-Literal`);
    assert.equal(/\bPIN\s*=\s*'\d{4}'/.test(src), false, `${f}: PIN-Konstante`);
  }
});

test('A: keine bekannten Alt-PINs oder Admin-Standard-PIN im Quelltext', () => {
  // Die Werte stehen bewusst nur hier als Pruefmuster; sie werden nicht ausgegeben.
  for (const alt of ['0804', '3885', '7883', '1234']) {
    assert.equal(all.includes(`'${alt}'`), false, `Alt-PIN-Literal gefunden`);
  }
});

test('B: keine Schreibzugriffe auf PIN-, Token-, Schluessel- oder Sync-Speicher im Browser', () => {
  const setItem = /(?:localStorage|sessionStorage|safeStorage)\.setItem\(\s*([^,)]+)/g;
  const verboten = /PIN|TOKEN|API|CLAUDE|SECRET|SYNC|BACKUP|EXCEL|CRED_KEY|PASS/i;
  // Erlaubt: Hinweis-Code nach Sitzungsende, Warteschlange fuer Todo-IDs, Anzeigeeinstellung.
  const erlaubt = /^(HINWEIS_KEY|'lagertool_pending_push_todo'|'lagertool\.kwAnsicht'|'__test__'|k)$/;
  for (const [f, src] of Object.entries(sources)) {
    for (const m of src.matchAll(setItem)) {
      const arg = m[1].trim();
      if (erlaubt.test(arg)) continue;
      assert.equal(verboten.test(arg), false, `${f}: verbotener Speicherschluessel ${arg.slice(0, 40)}`);
    }
  }
});

test('B: gespeicherte Biometrie-PINs werden nicht mehr gelesen oder geschrieben', () => {
  assert.equal(all.includes('safeStorage.getItem(WEBAUTHN_PIN_PREFIX'), false, 'PIN-Lesen aus Speicher');
  assert.equal(/safeStorage\.setItem\(WEBAUTHN_PIN_PREFIX/.test(all), false, 'PIN-Schreiben in Speicher');
  const m = all.match(/function findStoredBiometricLogins\(\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(m, 'findStoredBiometricLogins fehlt');
  assert.equal(/getItem|pin/i.test(m[1]), false, 'findStoredBiometricLogins liest noch Speicher');
});

test('B: Excel-Sicherung und Sync-Export schreiben keine Daten mehr in den Browser', () => {
  assert.equal(all.includes("'lagertool_sync'"), false);
  assert.equal(all.includes("'lagertool_sync_ts'"), false);
  assert.equal(/lagertool_backup_excel/.test(all), false);
});

test('B: Dokumente werden nicht dauerhaft in IndexedDB geschrieben (Ausnahme: verschlüsselte Outbox, Phase 49Q)', () => {
  // Phase 49Q: Die einzige IndexedDB-Nutzung ist die verschlüsselte Outbox in docs-outbox.js.
  // Sie speichert Dokumentinhalt nur als AES-GCM-Chiffrat mit nicht exportierbarem Schlüssel.
  const oeffnen = Object.entries(sources).filter(([, s]) => /indexedDB\.open\(/.test(s)).map(([f]) => f);
  assert.deepEqual(oeffnen, ['docs-outbox.js'], 'indexedDB.open außerhalb der verschlüsselten Outbox');
  const outbox = sources['docs-outbox.js'];
  assert.match(outbox, /name: 'AES-GCM'/, 'Outbox ohne AES-GCM');
  assert.match(outbox, /generateKey\(\{ name: 'AES-GCM', length: 256 \}, false,/, 'Schlüssel nicht exportierbar');
  assert.equal(/localStorage\.setItem|sessionStorage\.setItem/.test(outbox), false, 'Outbox schreibt in Browser-Speicher');
  assert.match(all, /function saveDocsToIDB\([^)]*\)\s*\{[^}]*\}/, 'saveDocsToIDB fehlt');
  const save = all.match(/function saveDocsToIDB\([^)]*\)\s*\{([^}]*)\}/);
  assert.equal(/store|transaction|put\(/.test(save[1]), false, 'saveDocsToIDB schreibt noch');
});

test('B: Claude-API-Schluessel nur im Speicher der Sitzung', () => {
  assert.equal(/localStorage\.(getItem|setItem)\(\s*'lagertool_claude_key'/.test(all), false);
  assert.match(all, /let claudeApiKeySitzung/);
});

test('C/D: keine anonyme Firebase-Anmeldung in ausgelieferten Dateien', () => {
  assert.equal(all.includes('signInAnonymously'), false);
});

test('C: Firebase-Anmeldung der Buero-Sitzung nur mit Custom-Token vom Worker', () => {
  assert.match(sources['index.html'], /signInWithCustomToken\(token\)/);
  assert.match(sources['office-comms.js'], /bzCall\('POST',\s*'\/app\/office\/anmelden'/);
});

test('D: Monteur-Anmeldung nur ueber den Worker, Sitzung nicht im Browser-Speicher', () => {
  assert.match(sources['monteur-api.js'], /'\/app\/monteur\/anmelden'/);
  const storage = sources['monteur-api.js'].match(/(?:localStorage|sessionStorage)\./g) || [];
  assert.equal(storage.length, 0, 'monteur-api.js nutzt Browser-Speicher');
});

test('F/K: Sitzungsende und Tokenpruefung im Buero-Frontend vorhanden', () => {
  assert.match(sources['office-session.js'], /sitzungsEnde\(token, expiresIn/);
  assert.match(sources['office-session.js'], /HINWEIS_KEY/);
});
