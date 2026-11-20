// Mehrere Büro-Tabs, Logout- und Ablauf-Synchronisation, PIN-Wechsel, Hinweise und geschützte Aktionen.
// Echter Code aus office-session.js, office-pilot.html und index.html in vm-Umgebungen. Jeder Tab hat eigenen
// Sitzungsspeicher, alle Tabs teilen eine Uhr und einen BroadcastChannel-Bus. Keine Netzwerkzugriffe, keine Produktivdaten.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const CORE = readFileSync(new URL('../office-session.js', import.meta.url), 'utf8');
const PILOT = readFileSync(new URL('../office-pilot.html', import.meta.url), 'utf8');
const INDEX = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const MONTEUR = readFileSync(new URL('../monteur.html', import.meta.url), 'utf8');

const pa = PILOT.indexOf('const BZ_WORKER=String');
const PILOT_SRC = PILOT.slice(pa, PILOT.indexOf('</script>', pa));
const T0 = Date.UTC(2026, 10, 14, 8, 0, 0);
const HOUR = 3600_000;
const EXP = T0 / 1000 + 8 * 3600;
const b64u = s => Buffer.from(s).toString('base64url');
// Backend-Format: base64url(Claims).base64url(HMAC). Die Signatur ist synthetisch, nur das Format zaehlt.
const tokenMit = (exp, sub = '9001') => `${b64u(JSON.stringify({ exp, sub }))}.${b64u('synthetic-hmac')}`;
const flush = () => new Promise(r => setImmediate(r));
const EMPTY = () => JSON.stringify({ meldungen: [], rapporte: [] });

// Gemeinsame Uhr und Timer aller Tabs einer Gruppe.
function group(startAt = T0) {
  return { clock: { t: startAt }, timers: [], ids: 1, bus: [], subs: [] };
}
function drop(g, id) { const i = g.timers.findIndex(t => t.id === id); if (i >= 0) g.timers.splice(i, 1); }
function tick(g, ms) {
  const target = g.clock.t + ms;
  for (;;) {
    let best = null;
    for (const t of g.timers) if (t.due <= target && (!best || t.due < best.due)) best = t;
    if (!best) break;
    g.clock.t = Math.max(g.clock.t, best.due);
    if (best.every) best.due += best.every; else drop(g, best.id);
    best.fn();
  }
  g.clock.t = target;
}
// Browser im Ruhezustand: die Uhr laeuft weiter, Timer feuern nicht.
function sleep(g, ms) { g.clock.t += ms; }

// Sitzungsspeicher eines Tabs (bleibt bei Neuladen erhalten, wie sessionStorage).
function storage() {
  const m = new Map();
  return {
    m,
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
  };
}

// Ein Tab: Pilotseite mit Core, eigener Speicher, Kanal auf dem gemeinsamen Bus.
function tab(g, { id, store = storage(), exp } = {}) {
  const rec = { reloads: 0, docsReset: 0, pin: null, sent: [] };
  const listeners = {};
  // Standardantworten wie das Backend: Logout bestaetigt mit 200 und ok:true.
  let fetchImpl = async url => ({ ok: true, status: 200, json: async () => (String(url).includes('/app/office/logout') ? { ok: true, sessionVersion: 1, firebaseSync: 'ok' } : {}) });
  const addL = target => (ev, fn) => { (listeners[target + ':' + ev] ||= []).push(fn); };
  const fire = (target, ev) => (listeners[target + ':' + ev] || []).forEach(f => f());
  const api = {
    setTimeout(fn, ms = 0) { const x = { id: g.ids++, due: g.clock.t + Math.max(0, Number(ms) || 0), fn, every: 0 }; g.timers.push(x); return x.id; },
    setInterval(fn, ms) { const x = { id: g.ids++, due: g.clock.t + ms, fn, every: ms }; g.timers.push(x); return x.id; },
    clearTimeout: id => drop(g, id), clearInterval: id => drop(g, id),
  };
  const els = {
    'bz-rapport-login-name': { value: 'Luc', style: {}, textContent: '' },
    'bz-rapport-login-pin': { value: '1234', style: {}, textContent: '' },
  };
  const ctx = {
    document: { readyState: 'complete', hidden: false, getElementById: x => els[x] || (els[x] = { style: {}, value: '', textContent: '' }), createElement: () => ({ style: {} }), querySelector: () => null, addEventListener: addL('document') },
    location: { reload() { rec.reloads++; } },
    sessionStorage: store,
    fetch: async (...a) => { rec.sent.push(String(a[0])); return fetchImpl(...a); },
    Date: class extends Date { constructor(...a) { a.length ? super(...a) : super(g.clock.t); } static now() { return g.clock.t; } },
    console, queueMicrotask,
    setTimeout: api.setTimeout, clearTimeout: api.clearTimeout, setInterval: api.setInterval, clearInterval: api.clearInterval,
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    MONTEUR_TEST_WORKER_URL: 'https://pilot.example.workers.dev',
    lagertoolPilotWorkerAllowed: () => true,
    addEventListener: addL('window'),
    PilotPin: { open(opts) { rec.pin = opts; }, close() {} },
    PilotDocuments: { resetSession() { rec.docsReset++; } },
    bzRenderRapporte() {}, bzRender() {},
  };
  // Kanal auf dem gemeinsamen Bus: Nachrichten gehen an alle anderen Tabs, asynchron.
  const self = { id };
  ctx.BroadcastChannel = class {
    constructor(name) { this.name = name; this.onmessage = null; g.subs.push({ name, tab: self, ch: this }); }
    postMessage(data) {
      const copy = JSON.parse(JSON.stringify(data));
      g.bus.push({ from: id, data: copy });
      for (const s of g.subs) if (s.name === this.name && s.tab !== self) setImmediate(() => { if (s.ch.onmessage) s.ch.onmessage({ data: JSON.parse(JSON.stringify(copy)) }); });
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext('var bzSession = null;', ctx);
  vm.runInContext(CORE, ctx);
  vm.runInContext(PILOT_SRC, ctx);
  vm.runInContext('OfficeSession.onEnd = (g) => bzSitzungEnde(g);', ctx);
  const t = {
    id, ctx, rec, store, fire, sent: rec.sent,
    run: code => vm.runInContext(code, ctx),
    setFetch(fn) { fetchImpl = fn; },
    get bzMeldung() { return vm.runInContext('bzMeldung', ctx); },
    get session() { return vm.runInContext('bzSession', ctx); },
    get active() { return vm.runInContext('OfficeSession.aktiv()', ctx); },
  };
  return t;
}

function answer(exp, extra = {}) {
  return async url => (url.includes('/app/office/anmelden')
    ? { ok: true, status: 200, json: async () => ({ officeSession: tokenMit(exp), expiresIn: 28800, ...extra }) }
    : url.includes('/app/office/logout')
      ? { ok: true, status: 200, json: async () => ({ ok: true, sessionVersion: 1, firebaseSync: 'ok' }) }
      : { ok: true, status: 200, json: async () => ({ rapporte: [] }) });
}
async function login(t, exp = EXP, extra = {}) {
  t.setFetch(answer(exp, extra));
  await t.ctx.bzAnmelden();
  assert.ok(t.session, `login in tab ${t.id}`);
}

// --- 1. Zwei gleichzeitig geöffnete Büro-Tabs ---
test('1 two open office tabs keep their own sessions until one of them ends', async () => {
  const g = group();
  const A = tab(g, { id: 'A' }); const B = tab(g, { id: 'B' });
  await login(A); tick(g, HOUR); await login(B, EXP + 3600);   // B meldet sich 1 h spaeter an: Frist 9 h
  tick(g, HOUR);
  await flush();
  assert.ok(A.session && B.session, 'both tabs logged in');
  assert.equal(A.active, true);
  assert.equal(B.active, true);
});

// --- 2. Logout in einem Tab ---
test('2 logout in tab A ends the office session in tab B, without an expiry notice', async () => {
  const g = group();
  const A = tab(g, { id: 'A' }); const B = tab(g, { id: 'B' });
  await login(A); await login(B);
  tick(g, HOUR);
  A.run('bzManuellAbmelden()');
  await flush();
  assert.equal(B.session, null, 'tab B session ended');
  assert.equal(B.rec.reloads, 1);
  assert.equal(B.store.getItem('lagertool_hinweis'), 'anderer-tab', 'neutral notice, not an expiry notice');
  assert.equal(A.session, null);
  assert.equal(A.store.getItem('lagertool_hinweis'), null, 'manual logout leaves no notice');
});

// --- 3. Ablauf in einem anderen Tab ---
test('3a expiry in tab A does not end tab B, whose own deadline is later', async () => {
  const g = group();
  const A = tab(g, { id: 'A' }); const B = tab(g, { id: 'B' });
  await login(A, EXP);
  tick(g, HOUR);
  await login(B, EXP + 3600);                 // B: Frist 9 h
  sleep(g, 7 * HOUR + 30 * 60_000);          // jetzt 8.5 h: Frist A ueberschritten, B noch nicht                 // beide Timer verpassen den Ablauf von A
  A.fire('document', 'visibilitychange');           // A erkennt den Ablauf
  await flush();
  assert.equal(A.session, null);
  assert.equal(A.store.getItem('lagertool_hinweis'), 'abgelaufen');
  assert.ok(B.session, 'B still valid until its own deadline');
});

test('3b expiry in tab A is detected in tab B, which slept past its own deadline', async () => {
  const g = group();
  const A = tab(g, { id: 'A' }); const B = tab(g, { id: 'B' });
  await login(A, EXP); await login(B, EXP);
  sleep(g, 9 * HOUR);                               // B schlaeft ueber seinen Ablauf
  A.fire('document', 'visibilitychange');           // A meldet "expired"
  await flush();
  assert.equal(B.session, null, 'B detects the expiry on the sync message and its own clock');
  assert.equal(B.store.getItem('lagertool_hinweis'), 'abgelaufen');
});

// --- 4. Neue Anmeldung nach einem alten Logout-Ereignis ---
test('4 a new login is not ended by an old logout event that is delivered late', async () => {
  const g = group();
  const A = tab(g, { id: 'A' }); const B = tab(g, { id: 'B' });
  await login(A); await login(B);
  tick(g, HOUR);
  A.run('bzManuellAbmelden()');
  await flush();
  const stale = g.bus.find(m => m.data.t === 'logout');
  assert.ok(stale, 'logout event was sent');
  assert.equal(B.session, null);
  // B meldet sich danach neu an (Beginn nach dem Logout-Ereignis).
  tick(g, 10 * 60_000);
  await login(B, EXP + 4200);                // B meldet sich bei 70 min an, Frist 9 h 10 min
  // Das alte Ereignis kommt verspaetet an.
  B.run('OfficeSession._empfangen(' + JSON.stringify(stale.data) + ')');
  await flush();
  assert.ok(B.session, 'new login survives the stale logout event');
  assert.equal(B.active, true);
});

// --- 5. Keine Token-Übertragung zwischen Tabs ---
test('5 nothing that crosses tabs contains a token, a name or data; storage keeps only a notice code', async () => {
  const g = group();
  const A = tab(g, { id: 'A' }); const B = tab(g, { id: 'B' });
  await login(A); await login(B);
  tick(g, HOUR);
  A.run('bzManuellAbmelden()');
  await flush();
  assert.ok(g.bus.length > 0, 'messages were sent');
  for (const m of g.bus) {
    // Erlaubt: Ereignisart, Zeitpunkt und eine nicht umkehrbare Mitarbeiterkennung (Hash, 16 Hex-Zeichen).
    assert.deepEqual(Object.keys(m.data).sort(), ['at', 'k', 't'], 'only type, time and opaque key');
    assert.ok(m.data.k === null || /^[0-9a-f]{16}$/.test(m.data.k), 'key is an opaque hash');
    assert.ok(!String(m.data.k).includes('9001'), 'key does not reveal the employee id');
    assert.ok(['logout', 'expired'].includes(m.data.t));
    const raw = JSON.stringify(m.data);
    assert.ok(!raw.includes('eyJ') && !raw.includes('synthetic') && !raw.includes('Luc'), 'no token or name in ' + raw);
  }
  for (const t of [A, B]) {
    for (const k of t.store.m.keys()) assert.equal(k, 'lagertool_hinweis', 'only the notice key is stored');
    for (const v of t.store.m.values()) assert.ok(['abgelaufen', 'anderer-tab', 'pin-gewechselt', 'ungueltig', 'logout-unbestaetigt'].includes(v), 'fixed code only');
  }
});

// --- 6. PIN-Wechsel und Datenbereinigung ---
test('6 PIN change ends the old session in every tab, clears data, shows a clear re-login notice', async () => {
  const g = group();
  const A = tab(g, { id: 'A' }); const B = tab(g, { id: 'B' });
  await login(B);
  A.setFetch(answer(EXP, { pinWechselPflicht: true }));
  await A.ctx.bzAnmelden();
  tick(g, HOUR);                                    // Zeit vergeht zwischen Login und PIN-Wechsel
  assert.ok(A.rec.pin, 'PIN change dialog opened');
  A.run("bzDaten.rapporte=[{id:'private'}]");
  // Veraltete Antwort einer Anfrage, die waehrend des PIN-Wechsels noch laeuft
  let release;
  A.setFetch(() => new Promise(r => { release = r; }).then(() => ({ ok: true, status: 200, json: async () => ({ rapporte: [{ id: 'stale' }] }) })));
  const pending = A.run('bzLaden()');
  await flush();
  A.rec.pin.complete();
  release();
  await pending; await flush();
  assert.equal(A.session, null);
  assert.equal(A.run('JSON.stringify(bzDaten)'), EMPTY(), 'no stale or private data remains');
  assert.ok(A.rec.docsReset >= 1, 'embedded document module reset');
  assert.equal(A.rec.reloads, 1);
  assert.equal(A.store.getItem('lagertool_hinweis'), 'pin-gewechselt');
  assert.equal(B.session, null, 'the other tab is ended as well');
  assert.equal(B.store.getItem('lagertool_hinweis'), 'anderer-tab');
});

// --- 7. Sichtbare Ablaufmeldung ---
test('7 after an automatic expiry the next page shows exactly the required notice', async () => {
  const g = group();
  const store = storage();
  const A = tab(g, { id: 'A', store });
  await login(A);
  tick(g, 8 * HOUR + 1000);
  assert.equal(A.session, null);
  const again = tab(g, { id: 'A2', store });            // Neuladen derselben Seite
  await flush();
  assert.equal(again.bzMeldung, 'Deine Büro-Sitzung ist abgelaufen. Bitte melde dich erneut an.');
  assert.equal(store.getItem('lagertool_hinweis'), null, 'notice is shown only once');
});

// --- 8. Manuelles Logout ohne Ablaufmeldung ---
test('8 manual logout shows no expiry notice on the next page load', async () => {
  const g = group();
  const store = storage();
  const A = tab(g, { id: 'A', store });
  await login(A);
  tick(g, HOUR);
  A.run('bzManuellAbmelden()');
  await flush();
  const again = tab(g, { id: 'A2', store });
  await flush();
  assert.equal(again.bzMeldung, null);
  assert.equal(store.getItem('lagertool_hinweis'), null);
});

// --- 9. Geschützte API-, Firebase- und Dokumentaktionen ---
test('9a protected API calls are refused after expiry and never sent', async () => {
  const g = group();
  const A = tab(g, { id: 'A' });
  await login(A);
  tick(g, 8 * HOUR + 1000);
  const before = A.sent.length;
  await assert.rejects(A.run("bzCall('GET','/app/admin/rapporte')"), e => e.code === 'session_required');
  assert.equal(A.sent.length, before, 'nothing sent after the timer ended the session');
});

test('9a2 a protected call while the clock is past the deadline but no timer ran is refused as expired', async () => {
  const g = group();
  const A = tab(g, { id: 'A' });
  await login(A);
  sleep(g, 8 * HOUR + 1000);
  const before = A.sent.length;
  await assert.rejects(A.run("bzCall('GET','/app/admin/rapporte')"), e => e.code === 'session_expired');
  assert.equal(A.sent.length, before, 'no request sent');
});

test('9a3 login itself is still allowed without a session', async () => {
  const g = group();
  const A = tab(g, { id: 'A' });
  A.setFetch(answer(EXP));
  const r = await A.run("bzCall('POST','/app/office/anmelden',{name:'x',pin:'1'})");
  assert.ok(r.officeSession);
});

// Index: Google-Anmeldung für Dokumente und Push nur innerhalb einer Büro-Sitzung.
function indexWorld(g, { session = true, token = null } = {}) {
  const ctx = {
    document: { getElementById: () => ({ value: '', style: {}, textContent: '' }), addEventListener() {} },
    window: null, addEventListener() {}, location: { reload() {} },
    console, queueMicrotask, setTimeout: (fn) => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    Date: class extends Date { constructor(...a) { a.length ? super(...a) : super(g.clock.t); } static now() { return g.clock.t; } },
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    sessionStorage: storage(),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(CORE, ctx);
  const ea = INDEX.indexOf('async function lagertoolOAuthEnsureToken() {');
  const eb = INDEX.indexOf('\n}', ea) + 2;
  vm.runInContext('var bzSession = null; var lagertoolOAuthToken = null; var dbRef = null;', ctx);
  vm.runInContext(INDEX.slice(ea, eb), ctx);
  if (session) {
    vm.runInContext("bzSession = { token: 'x', name: 'Luc' };", ctx);
    vm.runInContext('OfficeSession.start(' + JSON.stringify(tokenMit(EXP)) + ', 28800);', ctx);
  }
  if (token) vm.runInContext("lagertoolOAuthToken = 'oauth-test';", ctx);
  return ctx;
}

test('9b Google-Anmeldung for documents and push is refused without an active office session', async () => {
  const g = group();
  const ctx = indexWorld(g, { session: false, token: true });
  await assert.rejects(ctx.lagertoolOAuthEnsureToken(), /Bitte zuerst als Büro anmelden/);
});

test('9c Google-Anmeldung is refused after the office session expired, even with a stored token', async () => {
  const g = group();
  const ctx = indexWorld(g, { token: true });
  assert.equal(await ctx.lagertoolOAuthEnsureToken(), 'oauth-test', 'valid session with token');
  g.clock.t += 8 * HOUR + 1000;                          // Uhr über das Ende hinaus, ohne Timer
  await assert.rejects(ctx.lagertoolOAuthEnsureToken(), /Bitte zuerst als Büro anmelden/);
});

test('9d cleanup removes the Google token and the Firebase listener reference', () => {
  const g = group();
  const ctx = indexWorld(g, { token: true });
  const ca = INDEX.indexOf('function officeSitzungAufraeumen() {');
  vm.runInContext(INDEX.slice(ca, INDEX.indexOf('\n}', ca) + 2), ctx);
  vm.runInContext("bzGeneration = 0; var officeWartetAufSync=null; var officeSyncGeneration=0; var officeAnmeldungLaeuft=false; var currentLoginUser={id:1}; var lagertoolSitzungMaId=1; var bzDaten={}; var bzMeldung=null; var bzRender=()=>{};", ctx);
  vm.runInContext('dbRef = { off() {} }; firebase = { auth() { return { signOut: async () => {} }; } }; indexedDB = { deleteDatabase() { const q = {}; queueMicrotask(() => q.onsuccess && q.onsuccess()); return q; } };', ctx);
  vm.runInContext('officeSitzungAufraeumen();', ctx);
  assert.equal(vm.runInContext('lagertoolOAuthToken', ctx), null);
  assert.equal(vm.runInContext('dbRef', ctx), null);
});

test('9e index.html wires the Google token and push to the session guard (static)', () => {
  assert.ok(/if\(!lagertoolOAuthToken\|\|!bzSession\|\|!OfficeSession\.aktiv\(\)\) throw/.test(INDEX), 'push registration guarded');
  assert.ok(/if \(!bzSession \|\| !OfficeSession\.aktiv\(\)\) throw new Error\('Bitte zuerst als Büro anmelden\.'\);/.test(INDEX), 'token helper guarded');
});

// --- 10. Monteur-Funktionen bleiben unberührt ---
test('10 monteur page does not load the office session core and never opens the office channel', () => {
  assert.ok(!MONTEUR.includes('office-session.js'));
  assert.ok(!MONTEUR.includes('BroadcastChannel'));
  assert.ok(!MONTEUR.includes('lagertool-buero-sitzung'));
  assert.ok(!CORE.includes('monteur'), 'core has no monteur logic');
});

test('10b a logout broadcast in an office tab leaves a monteur-style tab without a session untouched', async () => {
  const g = group();
  const A = tab(g, { id: 'A' });
  await login(A);
  // Monteur-Tab: nur Nachrichten-Empfänger ohne Büro-Sitzung. Sie darf nicht reagieren.
  const M = tab(g, { id: 'M' });
  tick(g, HOUR);
  A.run('bzManuellAbmelden()');
  await flush();
  assert.equal(M.session, null);
  assert.equal(M.rec.reloads, 0, 'no reload in a tab without an office session');
});

test('11 stored notice codes are fixed texts, and the exact expiry text is defined once', async () => {
  const g = group();
  const A = tab(g, { id: 'A' });
  assert.equal(A.run("OfficeSession.hinweise.abgelaufen"), 'Deine Büro-Sitzung ist abgelaufen. Bitte melde dich erneut an.');
  assert.equal(A.run("OfficeSession.hinweise['anderer-tab']"), 'Deine Büro-Sitzung wurde in einem anderen Tab beendet. Bitte melde dich erneut an.');
  assert.equal(A.run("OfficeSession.hinweisSetzen('kein-code'), OfficeSession.hinweisLesen()"), null, 'unknown codes are ignored');
});
