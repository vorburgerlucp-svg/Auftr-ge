// Serverseitiger Büro-Logout im Frontend (Phase 7). Echter Code aus office-session.js, office-pilot.html und index.html
// in vm-Umgebungen mit gefälschter Uhr und gestubbtem fetch. Keine Netzwerkzugriffe, keine Produktivdaten.
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
const BASE = 'https://pilot.example.workers.dev';
const T0 = Date.UTC(2026, 10, 15, 8, 0, 0);
const HOUR = 3600_000;
const EXP = T0 / 1000 + 8 * 3600;
const b64u = s => Buffer.from(s).toString('base64url');
const tokenMit = (exp, sub = '9001') => `${b64u(JSON.stringify({ exp, sub }))}.${b64u('synthetic-hmac')}`;
const flush = () => new Promise(r => setImmediate(r));
const EMPTY = () => JSON.stringify({ meldungen: [], rapporte: [] });

function storage() {
  const m = new Map();
  return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}

// Ein Tab mit Pilotseite. `server` bestimmt die Antwort auf den Logout-Aufruf.
function makeChannel(bus, id) {
  return class {
    constructor(name) { this.name = name; this.onmessage = null; bus.subs.push({ name, self: this, tab: id }); }
    postMessage(data) {
      const copy = JSON.parse(JSON.stringify(data));
      bus.log.push({ from: id, data: copy });
      for (const s of bus.subs) if (s.name === this.name && s.tab !== id) setImmediate(() => { if (s.self.onmessage) s.self.onmessage({ data: JSON.parse(JSON.stringify(copy)) }); });
    }
  };
}
// Ein Tab mit Pilotseite. `server` bestimmt die Antwort auf den Logout-Aufruf.
function tab({ id = 'A', store = storage(), server = 'ok', exp = EXP, bus = null, startAt = T0 } = {}) {
  const g = { clock: { t: startAt }, timers: [], ids: 1, sent: [], reloads: 0, docsReset: 0 };
  const dropT = tid => { const i = g.timers.findIndex(t => t.id === tid); if (i >= 0) g.timers.splice(i, 1); };
  const api = {
    setTimeout(fn, ms = 0) { const x = { id: g.ids++, due: g.clock.t + Math.max(0, Number(ms) || 0), fn, every: 0 }; g.timers.push(x); return x.id; },
    setInterval(fn, ms) { const x = { id: g.ids++, due: g.clock.t + ms, fn, every: ms }; g.timers.push(x); return x.id; },
    clearTimeout: dropT, clearInterval: dropT,
  };
  function tick(ms) {
    const target = g.clock.t + ms;
    for (;;) {
      let best = null;
      for (const t of g.timers) if (t.due <= target && (!best || t.due < best.due)) best = t;
      if (!best) break;
      g.clock.t = Math.max(g.clock.t, best.due);
      if (best.every) best.due += best.every; else dropT(best.id);
      best.fn();
    }
    g.clock.t = target;
  }
  let fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({}) });
  const logoutAnswer = () => {
    if (server === 'ok') return { ok: true, status: 200, json: async () => ({ ok: true, sessionVersion: 2, firebaseSync: 'ok' }) };
    if (server === 'unauth') return { ok: false, status: 401, json: async () => ({ ok: false, error: 'unauthorized' }) };
    if (server === 'server-500') return { ok: false, status: 500, json: async () => ({}) };
    if (server === 'spiegel-offen') return { ok: true, status: 200, json: async () => ({ ok: true, sessionVersion: 2, firebaseSync: 'pending' }) };
    if (server === 'ok-without-body') return { ok: true, status: 200, json: async () => ({}) };
    return null;   // 'hang' oder 'netzwerk'
  };
  const els = {
    'bz-rapport-login-name': { value: 'Luc', style: {}, textContent: '' },
    'bz-rapport-login-pin': { value: '1234', style: {}, textContent: '' },
  };
  const listeners = {};
  const addL = target => (ev, fn) => { (listeners[target + ':' + ev] ||= []).push(fn); };
  const ctx = {
    document: { readyState: 'complete', hidden: false, getElementById: x => els[x] || (els[x] = { style: {}, value: '', textContent: '' }), createElement: () => ({ style: {} }), querySelector: () => null, addEventListener: addL('document') },
    location: { reload() { g.reloads++; } },
    sessionStorage: store,
    fetch: async (url, init) => {
      if (String(url).includes('/app/office/logout')) {
        g.sent.push({ url: String(url), auth: init && init.headers ? init.headers.Authorization : null, keepalive: init && init.keepalive === true });
        if (server === 'netzwerk') throw new TypeError('Failed to fetch');
        if (server === 'hang') return new Promise(() => {});
        return logoutAnswer();
      }
      g.sent.push({ url: String(url) });
      return fetchImpl(url, init);
    },
    Date: class extends Date { constructor(...a) { a.length ? super(...a) : super(g.clock.t); } static now() { return g.clock.t; } },
    console, queueMicrotask, AbortController,
    setTimeout: api.setTimeout, clearTimeout: api.clearTimeout, setInterval: api.setInterval, clearInterval: api.clearInterval,
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    MONTEUR_TEST_WORKER_URL: BASE,
    lagertoolPilotWorkerAllowed: () => true,
    addEventListener: addL('window'),
    PilotPin: { open() {}, close() {} },
    PilotDocuments: { resetSession() { g.docsReset++; } },
    bzRenderRapporte() {}, bzRender() {},
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext('var bzSession = null;', ctx);
  if (bus) ctx.BroadcastChannel = makeChannel(bus, id);
  vm.runInContext(CORE, ctx);
  vm.runInContext(PILOT_SRC, ctx);
  vm.runInContext('OfficeSession.onEnd = (x) => bzSitzungEnde(x);', ctx);
  const t = {
    id, ctx, store, g, tick: n => tick(n), fire: (target, ev) => (listeners[target + ':' + ev] || []).forEach(f => f()),
    run: code => vm.runInContext(code, ctx),
    setFetch(fn) { fetchImpl = fn; },
    get session() { return vm.runInContext('bzSession', ctx); },
    get meldung() { return vm.runInContext('bzMeldung', ctx); },
  };
  return t;
}
function answerLogin(exp) {
  return async url => (String(url).includes('/app/office/anmelden')
    ? { ok: true, status: 200, json: async () => ({ officeSession: tokenMit(exp), expiresIn: 28800 }) }
    : { ok: true, status: 200, json: async () => ({ rapporte: [] }) });
}
async function login(t, exp = EXP) { t.setFetch(answerLogin(exp)); await t.ctx.bzAnmelden(); assert.ok(t.session, 'logged in'); }
const logoutCalls = t => t.g.sent.filter(x => x.url && x.url.endsWith('/app/office/logout'));

// --- 1. Manueller Logout mit erfolgreichem Server-Widerruf ---
test('1 manual logout with confirmed server revocation: one call with the session token, no notice, reload', async () => {
  const t = tab();
  await login(t);
  const token = t.session.token;
  const p = t.ctx.bzManuellAbmelden();
  await flush(); await p;
  assert.equal(logoutCalls(t).length, 1, 'exactly one logout request');
  assert.equal(logoutCalls(t)[0].auth, 'Bearer ' + token, 'current session token sent');
  assert.equal(logoutCalls(t)[0].keepalive, true, 'keepalive so the request survives the reload');
  assert.equal(t.session, null, 'local session cleared');
  assert.equal(t.store.getItem('lagertool_hinweis'), null, 'no notice after a confirmed logout');
  assert.equal(t.g.reloads, 1);
});

// --- 2. Logout bei Netzwerkfehler ---
test('2 network failure: local cleanup still happens, the notice says the server did not confirm, no revocation is claimed', async () => {
  const t = tab({ server: 'netzwerk' });
  await login(t);
  const p = t.ctx.bzManuellAbmelden();
  await flush(); await p;
  assert.equal(t.session, null, 'local session cleared at once');
  assert.equal(t.g.reloads, 1, 'page reloads after local cleanup');
  assert.equal(t.store.getItem('lagertool_hinweis'), 'logout-unbestaetigt', 'honest notice, not a confirmed revocation');
});

// --- 3. Wiederholter Logout / Mehrfachklick ---
test('3 repeated clicks start only one logout: one request, one reload', async () => {
  const t = tab();
  await login(t);
  const a = t.ctx.bzManuellAbmelden();
  const b = t.ctx.bzManuellAbmelden();
  const c = t.ctx.bzManuellAbmelden();
  await flush(); await Promise.all([a, b, c]);
  assert.equal(logoutCalls(t).length, 1, 'only the first click calls the server');
  assert.equal(t.g.reloads, 1);
});

// --- 4. Logout in zwei Browser-Tabs ---
test('4 logout in tab A ends the session in tab B, the token never crosses the channel', async () => {
  const bus = { subs: [], log: [] };
  const A = tab({ id: 'A', bus });
  const B = tab({ id: 'B', bus, startAt: T0 });
  await login(A); await login(B);
  A.tick(HOUR);
  const p = A.ctx.bzManuellAbmelden();
  await flush(); await p; await flush();
  assert.equal(B.session, null, 'tab B ended');
  assert.equal(B.store.getItem('lagertool_hinweis'), 'anderer-tab', 'neutral notice in B');
  for (const m of bus.log) {
    assert.deepEqual(Object.keys(m.data).sort(), ['at', 'k', 't'], 'only type, time and opaque key');
    const raw = JSON.stringify(m.data);
    assert.ok(!raw.includes('eyJ') && !raw.includes('synthetic'), 'no token in ' + raw);
  }
});

// --- 5. Bereits widerrufener Token ---
test('5 an already revoked token: the server answers 401, the local logout is clean and shows no error', async () => {
  const t = tab({ server: 'unauth' });
  await login(t);
  const p = t.ctx.bzManuellAbmelden();
  await flush(); await p;
  assert.equal(t.session, null);
  assert.equal(t.g.reloads, 1);
  assert.equal(t.store.getItem('lagertool_hinweis'), null, 'no misleading notice for an already revoked session');
});

// --- 6. Admin-PIN-Reset ---
test('6 after an administrator PIN reset the next protected call returns 401: session ends with the revoked notice, not an expiry notice', async () => {
  const t = tab();
  await login(t);
  t.setFetch(async () => ({ ok: false, status: 401, json: async () => ({ ok: false, error: 'unauthorized' }) }));
  await assert.rejects(t.run("bzCall('GET','/app/admin/rapporte')"), e => e.status === 401);
  await flush();
  assert.equal(t.session, null);
  assert.equal(t.store.getItem('lagertool_hinweis'), 'ungueltig', 'clock did not confirm expiry, so the notice is the neutral one');
});

// --- 7. Mitarbeitersperrung ---
test('7 an account lock (server refuses the session with 401) ends the session the same way', async () => {
  const t = tab();
  await login(t);
  t.setFetch(async () => ({ ok: false, status: 401, json: async () => ({}) }));
  await assert.rejects(t.run("bzCall('GET','/app/admin/rapporte')"), e => e.status === 401);
  await flush();
  assert.equal(t.store.getItem('lagertool_hinweis'), 'ungueltig');
});

// --- 8. Rollenentzug ---
test('8 a withdrawn office role (server 401 on the next call) ends the session without any expiry claim', async () => {
  const t = tab();
  await login(t);
  t.setFetch(async () => ({ ok: false, status: 401, json: async () => ({}) }));
  await assert.rejects(t.run("bzCall('GET','/app/admin/planning?from=x&to=y')"), e => e.status === 401);
  await flush();
  assert.equal(t.session, null);
  assert.notEqual(t.store.getItem('lagertool_hinweis'), 'abgelaufen');
});

// --- 9. Firebase-Berechtigungsfehler (index.html, officeSitzungAbgelaufen) ---
test('9 a Firebase permission error ends the index session as revoked when the clock does not confirm expiry', () => {
  const a = INDEX.indexOf('function officeSitzungBeenden(grund) {');
  const b = INDEX.indexOf('function finishLogin() {', a);
  const hints = [];
  let reloads = 0;
  const ctx = vm.createContext({
    OfficeSession: null, console,
    officeSitzungAufraeumen: () => Promise.resolve(),
    document: { getElementById: () => ({ style: {} }) },
    location: { reload() { reloads++; } },
    setTimeout,
  });
  ctx.window = ctx;
  vm.runInContext(CORE, ctx);
  vm.runInContext(INDEX.slice(a, b), ctx);
  ctx.OfficeSession.start(tokenMit(EXP), 28800);
  ctx.OfficeSession.hinweisSetzen = code => hints.push(code);
  vm.runInContext('officeSitzungAbgelaufen()', ctx);
  assert.deepEqual(hints, ['ungueltig'], 'not claimed as expired while the clock is inside the deadline');
});

test('9b the index listener error handler still ends the session through officeSitzungAbgelaufen (existing regression guard)', () => {
  assert.ok(/\}, \(err\) => \{\s*console\.error\('\[Firebase\] listener error'\);\s*if \(currentLoginUser\) officeSitzungAbgelaufen\(\);/.test(INDEX));
  assert.ok(INDEX.includes("function officeSitzungAbgelaufen() { officeSitzungBeenden(OfficeSession.expired() ? 'expired' : 'revoked'); }"));
});

// --- 10. Verspätete API-Antwort nach Logout ---
test('10 a late protected answer after a confirmed logout cannot restore data or a session', async () => {
  const t = tab();
  await login(t);
  let release;
  t.setFetch(() => new Promise(r => { release = r; }).then(() => ({ ok: true, status: 200, json: async () => ({ rapporte: [{ id: 'late' }] }) })));
  const pending = t.run("bzLaden()");
  await flush();
  const p = t.ctx.bzManuellAbmelden();
  await flush(); await p;
  release();
  await pending; await flush();
  assert.equal(t.run('JSON.stringify(bzDaten)'), EMPTY());
  assert.equal(t.session, null);
});

// --- 11. Neue Anmeldung nach Widerruf ---
test('11 a new login after a revoked logout works and gets its own deadline', async () => {
  const t = tab();
  await login(t);
  const p = t.ctx.bzManuellAbmelden();
  await flush(); await p;
  const store = t.store;
  const again = tab({ id: 'A2', store, startAt: T0 + HOUR });
  await flush();
  const neuExp = EXP + 3600;  // neue Anmeldung eine Stunde spaeter: acht Stunden ab jetzt
  await login(again, neuExp);
  assert.equal(again.run('OfficeSession.deadline()'), neuExp * 1000);
});

// --- Zeitlimit: ein hängender Server-Aufruf verzögert die lokale Bereinigung nicht unbegrenzt ---
test('Z1 a hanging logout request: the page cleans up after the 3 s limit and never claims a revocation', { timeout: 5000 }, async () => {
  const t = tab({ server: 'hang' });
  await login(t);
  const p = t.ctx.bzManuellAbmelden();
  await flush();
  assert.equal(t.g.reloads, 0, 'still waiting, but only up to the limit');
  t.tick(3000);
  await flush(); await p; await flush();
  assert.equal(t.g.reloads, 1, 'reloaded after the limit');
  assert.equal(t.store.getItem('lagertool_hinweis'), 'logout-unbestaetigt');
});

// --- Serverantwort ohne bestätigtes ok ist kein Widerruf ---
test('Z2 a 200 without ok:true is treated as unconfirmed, not as a revocation', async () => {
  const t = tab({ server: 'ok-without-body' });
  await login(t);
  const p = t.ctx.bzManuellAbmelden();
  await flush(); await p;
  assert.equal(t.store.getItem('lagertool_hinweis'), 'logout-unbestaetigt');
});

test('Z3 a 500 answer is unconfirmed too', async () => {
  const t = tab({ server: 'server-500' });
  await login(t);
  const p = t.ctx.bzManuellAbmelden();
  await flush(); await p;
  assert.equal(t.store.getItem('lagertool_hinweis'), 'logout-unbestaetigt');
});

// --- Direkter Vertrag des gemeinsamen Helfers ---
test('H1 serverLogout maps answers exactly: ok, ungueltig, fehler', async () => {
  const t = tab();
  const call = (status, body) => t.run(`OfficeSession.serverLogout('${BASE}', 'tok', { fetchImpl: async () => ({ status: ${status}, json: async () => (${JSON.stringify(body)}) }) })`);
  assert.equal(await call(200, { ok: true, firebaseSync: 'ok' }), 'ok');
  assert.equal(await call(401, {}), 'ungueltig');
  assert.equal(await call(200, { ok: false }), 'fehler');
  assert.equal(await call(404, {}), 'fehler');
  assert.equal(await t.run("OfficeSession.serverLogout('', 'tok')"), 'fehler', 'no base URL, no request');
});

// --- Server bestätigt den Widerruf, Firebase-Spiegel steht aus: nicht als vollständig melden ---
test('S1 pilot: server confirmed but mirror pending shows the honest notice, not a silent success', async () => {
  const t = tab({ server: 'spiegel-offen' });
  await login(t);
  const p = t.ctx.bzManuellAbmelden();
  await flush(); await p;
  assert.equal(t.session, null);
  assert.equal(t.store.getItem('lagertool_hinweis'), 'logout-spiegel-offen');
  assert.equal(t.g.reloads, 1);
});
test('S2 index: server confirmed but mirror pending shows the honest notice', async () => {
  const w = indexLogoutWorld({ server: 'spiegel-offen' });
  vm.runInContext(`bzSession={token:'${tokenMit(EXP)}',name:'Luc'}; OfficeSession.start('${tokenMit(EXP)}', 28800);`, w.ctx);
  await w.ctx.doLogout(); await flush();
  assert.equal(w.sessionStore.getItem('lagertool_hinweis'), 'logout-spiegel-offen');
});
test('H2 serverLogout: ok only with firebaseSync ok; pending mirror is its own result; no ok:true is a failure', async () => {
  const t = tab();
  const call = body => t.run(`OfficeSession.serverLogout('${BASE}', 'tok', { fetchImpl: async () => ({ status: 200, json: async () => (${JSON.stringify(body)}) }) })`);
  assert.equal(await call({ ok: true, firebaseSync: 'ok' }), 'ok');
  assert.equal(await call({ ok: true, firebaseSync: 'pending' }), 'ok-spiegel-offen');
  assert.equal(await call({ ok: true }), 'ok-spiegel-offen', 'missing firebaseSync is not claimed as complete');
  assert.equal(await call({ ok: false, firebaseSync: 'ok' }), 'fehler');
  assert.equal(t.run("OfficeSession.logoutHinweis('ok-spiegel-offen')"), 'logout-spiegel-offen');
  assert.equal(t.run("OfficeSession.logoutHinweis('ok')"), null);
});

// --- Monteur-Funktionen unberührt ---
test('M1 the monteur page neither loads the office session core nor calls the office logout', () => {
  assert.ok(!MONTEUR.includes('office-session.js'));
  assert.ok(!MONTEUR.includes('/app/office/logout'));
});

// --- Index-Logout: doLogout gegen den echten Code ---
function indexLogoutWorld({ server = 'ok' } = {}) {
  const calls = [];
  const rec = { signOuts: 0, reloads: 0, removed: [], deleted: [] };
  const sessionStore = storage();
  let fetchAnswer = async () => ({ status: 200, json: async () => ({ ok: true }) });
  const ctx = {
    document: { getElementById: () => ({ style: {}, value: '', textContent: '' }), addEventListener() {} },
    window: null, addEventListener() {}, location: { reload() { rec.reloads++; } },
    sessionStorage: sessionStore, console, queueMicrotask, AbortController,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    Date, atob: s => Buffer.from(s, 'base64').toString('binary'),
    fetch: async (url, init) => { calls.push({ url: String(url), auth: init && init.headers ? init.headers.Authorization : null }); return fetchAnswer(url, init); },
    firebase: { auth() { return { signOut: async () => { rec.signOuts++; } }; } },
    indexedDB: { deleteDatabase(n) { rec.deleted.push(n); const q = {}; queueMicrotask(() => q.onsuccess && q.onsuccess()); return q; } },
    bzRender() {}, dbRef: null, pendingSavePromise: null,
    MONTEUR_TEST_WORKER_URL: BASE,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const bz = INDEX.indexOf('const BZ_WORKER =');
  const bzEnd = INDEX.indexOf('// Statuswechsel.', bz);
  vm.runInContext(CORE, ctx);
  vm.runInContext('var bzSession = null; var officeWartetAufSync=null; var officeSyncGeneration=0; var officeAnmeldungLaeuft=false; var currentLoginUser={id:1}; var lagertoolSitzungMaId=1; var lagertoolOAuthToken=null; var bzGeneration=0; var bzDaten={meldungen:[],rapporte:[]}; var bzMeldung=null; var BZ_PILOT_WORKER_OK=true;', ctx);
  vm.runInContext(INDEX.slice(bz, bzEnd), ctx);
  const ca = INDEX.indexOf('function officeSitzungAufraeumen() {');
  vm.runInContext(INDEX.slice(ca, INDEX.indexOf('\n}', ca) + 2), ctx);
  const la = INDEX.indexOf('let officeLogoutLaeuft = false;');
  vm.runInContext(INDEX.slice(la, INDEX.indexOf('\n}', INDEX.indexOf('async function doLogout()', la)) + 2), ctx);
  fetchAnswer = server === 'netzwerk' ? async () => { throw new TypeError('Failed to fetch'); } :
    server === 'unauth' ? async () => ({ status: 401, json: async () => ({}) }) :
    async () => ({ status: 200, json: async () => ({ ok: true, sessionVersion: 3, firebaseSync: server === 'spiegel-offen' ? 'pending' : 'ok' }) });
  return { ctx, calls, rec, sessionStore };
}
test('I1 index manual logout: confirmed revocation, token sent, Firebase signed out, no notice, reload', async () => {
  const w = indexLogoutWorld({ server: 'ok' });
  vm.runInContext(`bzSession={token:'${tokenMit(EXP)}',name:'Luc'}; OfficeSession.start('${tokenMit(EXP)}', 28800);`, w.ctx);
  const p = w.ctx.doLogout();
  await p; await flush();
  const logout = w.calls.filter(c => c.url.endsWith('/app/office/logout'));
  assert.equal(logout.length, 1);
  assert.equal(logout[0].auth, 'Bearer ' + tokenMit(EXP));
  assert.equal(w.rec.signOuts, 1, 'Firebase signed out');
  assert.ok(w.rec.deleted.includes('lagertool_docs'), 'documents removed');
  assert.equal(w.sessionStore.getItem('lagertool_hinweis'), null);
  assert.equal(w.rec.reloads, 1);
});
test('I2 index manual logout with a network failure: local cleanup, notice that the server did not confirm', async () => {
  const w = indexLogoutWorld({ server: 'netzwerk' });
  vm.runInContext(`bzSession={token:'${tokenMit(EXP)}',name:'Luc'}; OfficeSession.start('${tokenMit(EXP)}', 28800);`, w.ctx);
  await w.ctx.doLogout(); await flush();
  assert.equal(w.rec.signOuts, 1);
  assert.equal(w.sessionStore.getItem('lagertool_hinweis'), 'logout-unbestaetigt');
  assert.equal(w.rec.reloads, 1);
});
test('I3 index double click: one server request', async () => {
  const w = indexLogoutWorld({ server: 'ok' });
  vm.runInContext(`bzSession={token:'${tokenMit(EXP)}',name:'Luc'}; OfficeSession.start('${tokenMit(EXP)}', 28800);`, w.ctx);
  await Promise.all([w.ctx.doLogout(), w.ctx.doLogout()]);
  assert.equal(w.calls.filter(c => c.url.endsWith('/app/office/logout')).length, 1);
  await flush();
  assert.equal(w.rec.signOuts, 1, 'Firebase sign-out only once');
  assert.equal(w.rec.reloads, 1, 'page reloads only once');
});
test('I4 index logout with a revoked token: 401, no notice, reload', async () => {
  const w = indexLogoutWorld({ server: 'unauth' });
  vm.runInContext(`bzSession={token:'${tokenMit(EXP)}',name:'Luc'}; OfficeSession.start('${tokenMit(EXP)}', 28800);`, w.ctx);
  await w.ctx.doLogout(); await flush();
  assert.equal(w.sessionStore.getItem('lagertool_hinweis'), null);
  assert.equal(w.rec.reloads, 1);
});
