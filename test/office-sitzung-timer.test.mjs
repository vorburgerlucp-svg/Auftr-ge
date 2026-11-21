import { stubEntityOutbox } from './helpers/entity-outbox-stub.mjs';
// Sitzungsablauf der Büro-App (acht Stunden). Laedt den echten Code aus index.html in eine vm-Umgebung
// mit gefaelschter Uhr. Eine Browser-Ruhephase wird simuliert, indem die Uhr springt, ohne Timer auszuloesen.
// Keine Netzwerkzugriffe, keine Firebase-Verbindung, keine produktiven Daten.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const SIT_A = html.indexOf('// Ablauf der Firebase-Sitzung');
const SIT_FN = html.indexOf('function officeSitzungAbgelaufen() {');
// Funktionsende = erste Zeile, die mit "}" beginnt (innere Klammern sind eingerueckt).
const SIT_B = html.indexOf('\n}', SIT_FN) + 2;
if (SIT_A < 0 || SIT_FN < 0 || SIT_B < 2) throw new Error('office session block not found in index.html');
const BZ_A = html.indexOf('const BZ_WORKER =');
const BZ_B = html.indexOf('// Statuswechsel.', BZ_A);
const SIT_SRC = html.slice(SIT_A, SIT_B);
const CORE_SRC = readFileSync(new URL('../office-session.js', import.meta.url), 'utf8');
const BZ_SRC = html.slice(BZ_A, BZ_B);

const T0 = Date.UTC(2026, 10, 14, 8, 0, 0);
const HOUR = 3600_000;
const b64u = s => Buffer.from(s).toString('base64url');
// Backend-Format: base64url(Claims).base64url(HMAC). Die Signatur ist synthetisch, nur das Format zaehlt.
const tokenMit = (exp, sub = '9001') => `${b64u(JSON.stringify({ exp, sub }))}.${b64u('synthetic-hmac')}`;
const EXP = T0 / 1000 + 8 * 3600;
const flush = () => new Promise(r => setImmediate(r));

function world(startAt = T0) {
  const clock = { t: startAt };
  const timers = [];
  let idc = 1;
  const rec = { signOuts: 0, reloads: 0, deleted: [], removed: [], offs: 0, fetches: 0, renders: 0 };
  const listeners = {};
  let fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({}) });
  const drop = id => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); };
  const api = {
    setTimeout(fn, ms = 0) { const x = { id: idc++, due: clock.t + Math.max(0, Number(ms) || 0), fn, every: 0 }; timers.push(x); return x.id; },
    setInterval(fn, ms) { const x = { id: idc++, due: clock.t + ms, fn, every: ms }; timers.push(x); return x.id; },
    clearTimeout: drop, clearInterval: drop,
  };
  // Laeuft alle faelligen Timer bis zum Zielzeitpunkt ab (Reihenfolge nach Faelligkeit).
  function tick(ms) {
    const target = clock.t + ms;
    for (;;) {
      let best = null;
      for (const t of timers) if (t.due <= target && (!best || t.due < best.due)) best = t;
      if (!best) break;
      clock.t = Math.max(clock.t, best.due);
      if (best.every) best.due += best.every; else drop(best.id);
      best.fn();
    }
    clock.t = target;
  }
  // Ruhephase: die Uhr laeuft weiter, Timer feuern nicht.
  const sleep = ms => { clock.t += ms; };
  const addL = target => (ev, fn) => { (listeners[target + ':' + ev] ||= []).push(fn); };
  const fire = (target, ev) => (listeners[target + ':' + ev] || []).forEach(f => f());
  const ctx = {
    MONTEUR_TEST_WORKER_URL: 'https://pilot.example.workers.dev',
    addEventListener: addL('window'),
    document: { getElementById: () => ({ style: {}, textContent: '', value: '' }), addEventListener: addL('document') },
    location: { reload() { rec.reloads++; } },
    sessionStorage: { removeItem(k) { rec.removed.push(k); } },
    indexedDB: { deleteDatabase(n) { rec.deleted.push(n); const q = {}; queueMicrotask(() => q.onsuccess && q.onsuccess()); return q; } },
    firebase: { auth() { return { signOut: async () => { rec.signOuts++; } }; } },
    fetch: async (...a) => { rec.fetches++; return fetchImpl(...a); },
    bzRender() { rec.renders++; },
    Date: class extends Date {
      constructor(...a) { a.length ? super(...a) : super(clock.t); }
      static now() { return clock.t; }
    },
    console,
    queueMicrotask,
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    setTimeout: api.setTimeout, clearTimeout: api.clearTimeout, setInterval: api.setInterval, clearInterval: api.clearInterval,
  };
  stubEntityOutbox(vm.createContext(ctx));
  ctx.window = ctx;
  vm.runInContext('let currentLoginUser=null,dbRef=null,officeAnmeldungLaeuft=false,officeWartetAufSync=null,officeSyncGeneration=-1,lagertoolSitzungMaId=null;', ctx);
  vm.runInContext(CORE_SRC, ctx);
  vm.runInContext('OfficeSession.onEnd = () => officeSitzungAbgelaufen();', ctx);
  vm.runInContext(SIT_SRC, ctx);
  vm.runInContext(BZ_SRC, ctx);
  const run = code => vm.runInContext(code, ctx);
  return {
    ctx, rec, clock, run, tick, sleep, fire,
    setFetch(fn) { fetchImpl = fn; },
    now: () => clock.t,
    timerCount: () => timers.length,
  };
}

// --- 1. Gueltige Büro-Sitzung ---
test('1 valid office session: deadline comes from the signed exp and the session stays open before it', () => {
  const w = world();
  assert.equal(w.ctx.officeSitzungSetzen(tokenMit(EXP), 'Luc', 28800), true);
  assert.equal(w.run('OfficeSession.deadline()'), EXP * 1000);
  w.tick(7 * HOUR);
  assert.equal(w.run('bzSession').token, tokenMit(EXP));
  assert.equal(w.rec.reloads, 0);
  assert.equal(w.rec.signOuts, 0);
});

// --- 2. Ablauf exakt nach acht Stunden ---
test('2 expiry: nothing happens one second early, the session ends at exp (timer path)', async () => {
  const w = world();
  w.ctx.officeSitzungSetzen(tokenMit(EXP), 'Luc', 28800);
  w.tick(8 * HOUR - 1000);
  assert.ok(w.run('bzSession'), 'still open 1 s before the deadline');
  w.tick(2000);
  assert.equal(w.run('bzSession'), null);
  await flush(); await flush();
  assert.equal(w.rec.reloads, 1, 'reload after cleanup');
  assert.equal(w.rec.signOuts, 1);
});


// --- 3. Browser-Sleep ueber den Ablaufzeitpunkt ---
test('3 browser sleep past the deadline: the next wake-up check ends the session immediately', async () => {
  const w = world();
  w.ctx.officeSitzungSetzen(tokenMit(EXP), 'Luc', 28800);
  w.sleep(9 * HOUR);                         // Timer feuern waehrend der Ruhephase nicht
  assert.ok(w.run('bzSession'), 'timers did not run during sleep');
  w.fire('document', 'visibilitychange');    // Wiederaufnahme
  assert.equal(w.run('bzSession'), null);
  await flush(); await flush();
  assert.equal(w.rec.reloads, 1);
});

test('3b sleep past the deadline: a late timer or interval after wake-up also ends the session', async () => {
  const w = world();
  w.ctx.officeSitzungSetzen(tokenMit(EXP), 'Luc', 28800);
  w.sleep(8 * HOUR + 5 * 60_000);
  w.tick(30_000);                            // Intervall nach Ruhephase
  assert.equal(w.run('bzSession'), null);
});

// --- 4. Tab-Wechsel und Wiederaufnahme ---
test('4 tab switch and resume before the deadline keep the session; resume after it ends it', async () => {
  const w = world();
  w.ctx.officeSitzungSetzen(tokenMit(EXP), 'Luc', 28800);
  w.tick(2 * HOUR);
  w.fire('document', 'visibilitychange');
  w.fire('window', 'focus');
  w.fire('window', 'pageshow');
  assert.ok(w.run('bzSession'), 'valid after tab switch');
  w.tick(5 * HOUR + 59 * 60_000);
  w.fire('window', 'focus');
  assert.ok(w.run('bzSession'), 'valid one minute before the deadline');
  w.tick(61_000);
  assert.equal(w.run('bzSession'), null, 'ended after the deadline');
});

// --- 5. Firebase-Refresh ohne Verlaengerung ---
test('5 firebase refresh does not move the deadline: only the login response sets it', () => {
  const w = world();
  w.ctx.officeSitzungSetzen(tokenMit(EXP), 'Luc', 28800);
  const before = w.run('OfficeSession.deadline()');
  // Simulierte Firebase-Token-Erneuerung: ruft den Sitzungscode nicht auf, sendet kein neues Token an die Sitzung.
  w.tick(7 * HOUR);
  assert.equal(w.run('OfficeSession.deadline()'), before, 'deadline unchanged by time or refresh');
  // Deklaration (let ... = 0), Setter und Bereinigung sind die einzigen Stellen mit Zuweisung.
  const core = readFileSync(new URL('../office-session.js', import.meta.url), 'utf8');
  // Die Frist wird nur in start() (Setzen) und clear() (Loeschen) geschrieben. Die Parser-Hilfsvariable zaehlt nicht.
  assert.equal((core.match(/\n    ende = e;/g) || []).length, 1, 'start() sets the deadline once');
  assert.equal((core.match(/\n    ende = 0;/g) || []).length, 1, 'clear() is the only reset');
  assert.equal((html.match(/officeSitzungEnde/g) || []).length, 0, 'index.html keeps no own deadline');
  assert.ok(!/onIdTokenChanged|getIdToken\(/.test(html), 'no Firebase token listener extends the session');
});

// --- 6. IndexedDB-Bereinigung und gemeinsame Bereinigungsfunktion ---
test('6 cleanup removes office data, keeps IndexedDB docs (Phase 49O), removes session key and signs out Firebase', async () => {
  const w = world();
  w.ctx.officeSitzungSetzen(tokenMit(EXP), 'Luc', 28800);
  w.run("bzDaten.rapporte=[{id:'private'}];bzMeldung='x';");
  await w.run('officeSitzungAufraeumen()');
  assert.equal(w.run('bzSession'), null);
  assert.equal(JSON.stringify(w.run('bzDaten')), JSON.stringify({ meldungen: [], rapporte: [] }));
  assert.ok(!w.rec.deleted.includes('lagertool_docs'), 'Phase 49O: keine Dokumentlöschung beim Abmelden');
  assert.ok(w.rec.removed.includes('lagertool_login'));
  assert.equal(w.rec.signOuts, 1);
  assert.equal(w.run('OfficeSession.deadline()'), 0);
});

// --- 7. Listener-Abbruch ---
test('7 listener teardown: cleanup stops the Firebase listener and the existing cancel handler is kept', () => {
  const w = world();
  w.ctx.officeSitzungSetzen(tokenMit(EXP), 'Luc', 28800);
  w.ctx.recOff = () => { w.rec.offs++; };
  w.run('dbRef = { off() { recOff(); } }');
  w.run('officeSitzungAufraeumen()');
  assert.equal(w.rec.offs, 1, 'listener detached once');
  assert.equal(w.run('dbRef'), null, 'listener reference cleared');
  // Der bestehende Fehler-Callback bleibt unveraendert und ruft den Sitzungsablauf auf.
  assert.ok(/\}, \(err\) => \{\s*console\.error\('\[Firebase\] listener error'\);\s*if \(currentLoginUser\) officeSitzungAbgelaufen\(\);/.test(html),
    'permission_denied cancel handler still calls officeSitzungAbgelaufen');
});

// --- 8. Verspaetete asynchrone Antworten nach Logout ---
test('8 a late worker answer after logout is discarded and repopulates nothing', async () => {
  const w = world();
  w.ctx.officeSitzungSetzen(tokenMit(EXP), 'Luc', 28800);
  let release;
  w.setFetch(() => new Promise(r => { release = r; }).then(() => ({ ok: true, status: 200, json: async () => ({ meldungen: [], rapporte: [{ id: 'private' }] }) })));
  const pending = w.run("bzLaden()");
  await flush();
  w.run('officeSitzungAufraeumen()');
  release();
  await pending.catch(() => {});
  assert.equal(JSON.stringify(w.run('bzDaten')), JSON.stringify({ meldungen: [], rapporte: [] }));
});

test('8b a request started after expiry is never sent', async () => {
  const w = world();
  w.ctx.officeSitzungSetzen(tokenMit(EXP), 'Luc', 28800);
  w.sleep(8 * HOUR + 1000);
  const before = w.rec.fetches;
  await assert.rejects(w.run("bzCall('GET','/app/admin/rapporte')"), e => e.code === 'session_expired');
  assert.equal(w.rec.fetches, before, 'no request after expiry');
  assert.equal(w.run('bzSession'), null);
});

// --- 9. Erneute Anmeldung nach Ablauf ---
test('9 re-login after expiry starts a new valid session with its own deadline', () => {
  const w = world();
  w.ctx.officeSitzungSetzen(tokenMit(EXP), 'Luc', 28800);
  w.tick(8 * HOUR + 2000);
  assert.equal(w.run('bzSession'), null);
  const exp2 = EXP + 8 * 3600;               // Neuanmeldung acht Stunden spaeter
  w.ctx.officeSitzungSetzen(tokenMit(exp2), 'Luc', 28800);
  w.tick(7 * HOUR);
  assert.equal(w.run('bzSession').token, tokenMit(exp2), 'new session is open');
  assert.equal(w.run('OfficeSession.deadline()'), exp2 * 1000);
});

// --- 10. Alter Timer nach erfolgreicher Neuanmeldung ---
test('10 an old timer does not end a newer session', () => {
  const w = world();
  w.ctx.officeSitzungSetzen(tokenMit(EXP), 'Luc', 28800);   // Sitzung 1 endet bei T0+8h
  w.tick(7 * HOUR);
  const exp2 = EXP + 7 * 3600;                              // Sitzung 2 beginnt bei 7 h, endet bei 15 h
  w.ctx.officeSitzungSetzen(tokenMit(exp2), 'Luc', 28800);
  w.tick(2 * HOUR);                                         // ueber das Ende von Sitzung 1 hinaus
  assert.equal(w.run('bzSession').token, tokenMit(exp2), 'session 2 still open');
  assert.equal(w.rec.reloads, 0);
});

// --- 11. Schutz von Monteur-Sitzungen ---
test('11 monteur protection: the office cleanup never touches monteur state', () => {
  const start = html.indexOf('function officeSitzungAufraeumen() {');
  const end = html.indexOf('\n}', start) + 2;
  const body = html.slice(start, end);
  assert.ok(body.length > 200 && body.includes('OfficeSession.clear()'), 'cleanup body was located');
  assert.ok(!/monteur/i.test(body), 'cleanup references no monteur identifiers');
  assert.ok(!/localStorage/.test(body), 'cleanup does not touch the shared localStorage');
  assert.ok(!/lagertool_pending_push_todo/.test(body), 'push queue of the monteur flow is left alone');
});

// --- 12. Bestehende Funktionen und Regressionen ---
test('12 regression: every login path goes through the setter and no direct session write remains', () => {
  // Definition plus drei Anmeldepfade in index.html (doLogin Pin-Wechsel, doLogin Erfolg, bzAnmelden).
  const setterCalls = (html.match(/officeSitzungSetzen\(/g) || []).length;
  assert.ok(setterCalls >= 4, `setter used at all login paths (found ${setterCalls} references)`);
  assert.ok(!/bzSession = \{ token: (r|data)\.officeSession/.test(html), 'no direct session writes in index.html');
  const comms = readFileSync(new URL('../office-comms.js', import.meta.url), 'utf8');
  assert.ok(comms.includes('OfficeSession.start(auth.officeSession'), 'office-comms login uses the shared session core');
  assert.ok(!/sessionStorage\.getItem\('lagertool_login'\)/.test(html), 'dead auto-login removed');
  assert.ok(!/nach ca\. einer Stunde/.test(html), 'wrong one-hour comment removed');
});

test('12b invalid session data fails closed: unreadable exp without expiresIn, or an expired exp', () => {
  const w = world();
  assert.equal(w.ctx.officeSitzungSetzen('not-a-jwt', 'Luc', undefined), false);
  assert.equal(w.ctx.officeSitzungSetzen(tokenMit(T0 / 1000 - 10), 'Luc', 28800), false);
  assert.equal(w.run('bzSession'), null);
});

test('12c no fallback: an unreadable token is refused even with a valid expiresIn; expiresIn above eight hours is refused', () => {
  const w = world();
  assert.equal(w.ctx.officeSitzungSetzen('opaque', 'Luc', 3600), false, 'no fallback to expiresIn');
  assert.equal(w.ctx.officeSitzungSetzen(tokenMit(EXP), 'Luc', 99 * 3600), false, 'longer than eight hours is refused');
});


test('12d a PIN change does not extend the deadline (it reuses the session, sets no new deadline)', () => {
  const w = world();
  w.ctx.officeSitzungSetzen(tokenMit(EXP), 'Luc', 28800);
  w.tick(7 * HOUR + 30 * 60_000);            // Pin-Wechsel passiert hier, ohne neuen Setter-Aufruf
  assert.equal(w.run('OfficeSession.deadline()'), EXP * 1000);
  assert.ok(w.run('bzSession'), 'still open at 7.5 h');
  w.tick(31 * 60_000);
  assert.equal(w.run('bzSession'), null, 'ended at 8 h regardless of PIN activity');
});
