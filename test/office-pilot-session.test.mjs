import { stubEntityOutbox } from './helpers/entity-outbox-stub.mjs';
// Sitzungssicherheit der Pilotseite office-pilot.html und des Büro-Logins in office-comms.js.
// Echter Code aus den Dateien, in vm-Umgebungen mit gefaelschter Uhr. Keine Netzwerkzugriffe, keine Produktivdaten.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const CORE = readFileSync(new URL('../office-session.js', import.meta.url), 'utf8');
const PILOT = readFileSync(new URL('../office-pilot.html', import.meta.url), 'utf8');
const COMMS = readFileSync(new URL('../office-comms.js', import.meta.url), 'utf8');
const INDEX = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const MONTEUR = readFileSync(new URL('../monteur.html', import.meta.url), 'utf8');

const pa = PILOT.indexOf('const BZ_WORKER=String');
const PILOT_SRC = PILOT.slice(pa, PILOT.indexOf('</script>', pa));
// doLogout() samt seiner Hilfsvariable aus index.html (Funktionsende = erste Zeile mit "}" in Spalte 0)
const la = INDEX.indexOf('let pendingSavePromise = null;');
const dl = INDEX.indexOf('async function doLogout()');
const DOLOGOUT_SRC = INDEX.slice(la, INDEX.indexOf('\n}', dl) + 2);

const T0 = Date.UTC(2026, 10, 14, 8, 0, 0);
const HOUR = 3600_000;
const EXP = T0 / 1000 + 8 * 3600;
const b64u = s => Buffer.from(s).toString('base64url');
// Backend-Format: base64url(Claims).base64url(HMAC). Die Signatur ist synthetisch, nur das Format zaehlt.
const tokenMit = (exp, sub = '9001') => `${b64u(JSON.stringify({ exp, sub }))}.${b64u('synthetic-hmac')}`;
const flush = () => new Promise(r => setImmediate(r));

// Minimales DOM für office-comms.js
class El {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.style = {}; this.value = ''; this.textContent = '';
    this.hidden = false; this.events = {}; this.classList = { contains: () => false, add() {}, remove() {} };
  }
  append(...xs) { this.children.push(...xs); }
  replaceChildren(...xs) { this.children = xs; }
  addEventListener(k, f) { (this.events[k] ||= []).push(f); }
  setAttribute(k, v) { this[k] = v; }
  remove() {}
  focus() {}
}
function findAll(el, pred, out = []) {
  if (el && typeof el === 'object') {
    if (pred(el)) out.push(el);
    for (const c of el.children || []) findAll(c, pred, out);
  }
  return out;
}

function world({ withCore = true, withComms = false, startAt = T0 } = {}) {
  const clock = { t: startAt };
  const timers = [];
  let idc = 1;
  const rec = { reloads: 0, docsReset: 0, fetches: 0, sent: [] };
  const listeners = {};
  let fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({}) });
  const drop = id => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); };
  const api = {
    setTimeout(fn, ms = 0) { const x = { id: idc++, due: clock.t + Math.max(0, Number(ms) || 0), fn, every: 0 }; timers.push(x); return x.id; },
    setInterval(fn, ms) { const x = { id: idc++, due: clock.t + ms, fn, every: ms }; timers.push(x); return x.id; },
    clearTimeout: drop, clearInterval: drop,
  };
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
  const sleep = ms => { clock.t += ms; };
  const addL = target => (ev, fn) => { (listeners[target + ':' + ev] ||= []).push(fn); };
  const fire = (target, ev) => (listeners[target + ':' + ev] || []).forEach(f => f());
  const els = {
    'bz-rapport-login-name': { value: 'Luc', style: {}, textContent: '' },
    'bz-rapport-login-pin': { value: '1234', style: {}, textContent: '' },
    'bz-anfragen-section': new El('div'),
    'bz-anfragen-count': new El('span'),
    'page-anfragen': new El('div'),
    'nav-anfragen': new El('button'),
  };
  const ctx = {
    document: {
      readyState: 'complete', hidden: false,
      getElementById: id => els[id] || (els[id] = new El('div')),
      createElement: t => new El(t),
      querySelector: () => new El('div'),
      addEventListener: addL('document'),
    },
    location: { reload() { rec.reloads++; } },
    fetch: async (...a) => { rec.fetches++; rec.sent.push(String(a[0])); return fetchImpl(...a); },
    Date: class extends Date {
      constructor(...a) { a.length ? super(...a) : super(clock.t); }
      static now() { return clock.t; }
    },
    console,
    queueMicrotask,
    setTimeout: api.setTimeout, clearTimeout: api.clearTimeout, setInterval: api.setInterval, clearInterval: api.clearInterval,
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    MONTEUR_TEST_WORKER_URL: 'https://pilot.example.workers.dev',
    lagertoolPilotWorkerAllowed: () => true,
    addEventListener: addL('window'),
    PilotPin: { open() {}, close() {} },
    PilotDocuments: { resetSession() { rec.docsReset++; } },
    bzRenderRapporte() {},
    bzRender() {},
  };
  ctx.window = ctx;
  stubEntityOutbox(vm.createContext(ctx));
  vm.runInContext('var bzSession = null;', ctx);
  if (withCore) vm.runInContext(CORE, ctx);
  // Ohne Zeitsteuerung wird die Pilotseite nicht geladen: ihr Skript setzt OfficeSession.onEnd voraus.
  if (withCore) vm.runInContext(PILOT_SRC, ctx);
  if (withCore) vm.runInContext('OfficeSession.onEnd = () => bzSitzungEnde();', ctx);
  if (withComms) vm.runInContext(COMMS, ctx);
  return {
    ctx, rec, clock, tick, sleep, fire, els,
    run: code => vm.runInContext(code, ctx),
    setFetch(fn) { fetchImpl = fn; },
  };
}

// Antwortfunktion für die Pilotseite: Anmeldung und Rapporte.
function answer(exp, extra = {}) {
  return async url => {
    if (url.includes('/app/office/anmelden')) return { ok: true, status: 200, json: async () => ({ officeSession: tokenMit(exp), expiresIn: 28800, ...extra }) };
    return { ok: true, status: 200, json: async () => ({ rapporte: [] }) };
  };
}

// --- 1. Büro-Login in office-pilot.html ---
test('1 pilot login: the session gets the signed deadline', async () => {
  const w = world();
  w.setFetch(answer(EXP));
  await w.ctx.bzAnmelden();
  assert.equal(w.run('bzSession').token, tokenMit(EXP));
  assert.equal(w.run('OfficeSession.deadline()'), EXP * 1000);
  assert.equal(w.run('bzSession').name, 'Luc');
});

// --- 2. Ablauf nach acht Stunden ---
test('2 pilot expiry after eight hours: state cleared, reload, no earlier end', async () => {
  const w = world();
  w.setFetch(answer(EXP));
  await w.ctx.bzAnmelden();
  w.tick(8 * HOUR - 1000);
  assert.ok(w.run('bzSession'), 'still open one second before the deadline');
  w.tick(2000);
  assert.equal(w.run('bzSession'), null);
  assert.equal(w.rec.reloads, 1);
  assert.equal(w.rec.docsReset, 1, 'embedded document module reset');
});

// --- 3. Wiederaufnahme nach Browser-Ruhephase ---
test('3 pilot resume after browser sleep past the deadline ends the session at once', async () => {
  const w = world();
  w.setFetch(answer(EXP));
  await w.ctx.bzAnmelden();
  w.sleep(9 * HOUR);
  assert.ok(w.run('bzSession'), 'timers did not run during sleep');
  w.fire('document', 'visibilitychange');
  assert.equal(w.run('bzSession'), null);
  assert.equal(w.rec.reloads, 1);
});

test('3b pilot resume: focus before the deadline keeps the session', async () => {
  const w = world();
  w.setFetch(answer(EXP));
  await w.ctx.bzAnmelden();
  w.tick(7 * HOUR);
  w.fire('window', 'focus');
  w.fire('window', 'pageshow');
  assert.ok(w.run('bzSession'));
  assert.equal(w.rec.reloads, 0);
});

// --- 4. Abmeldung und Datenbereinigung ---
test('4 pilot logout: data cleared, document module reset, deadline removed, page reloads', async () => {
  const w = world();
  w.setFetch(answer(EXP));
  await w.ctx.bzAnmelden();
  w.run("bzDaten.rapporte=[{id:'private'}];bzMeldung='x';");
  w.ctx.bzSitzungEnde();
  assert.equal(w.run('bzSession'), null);
  assert.equal(JSON.stringify(w.run('bzDaten')), JSON.stringify({ meldungen: [], rapporte: [] }));
  assert.equal(w.run('OfficeSession.deadline()'), 0);
  assert.equal(w.rec.docsReset, 1);
  assert.equal(w.rec.reloads, 1);
});

// --- 5. Erneute Anmeldung ---
test('5 pilot re-login after expiry works and gets its own deadline', async () => {
  const w = world();
  w.setFetch(answer(EXP));
  await w.ctx.bzAnmelden();
  w.tick(8 * HOUR + 2000);
  const exp2 = EXP + 8 * 3600;
  w.setFetch(answer(exp2));
  await w.ctx.bzAnmelden();
  assert.equal(w.run('bzSession').token, tokenMit(exp2));
  assert.equal(w.run('OfficeSession.deadline()'), exp2 * 1000);
  w.tick(7 * HOUR);
  assert.ok(w.run('bzSession'), 'new session still open after 7 h');
});

// --- 6. Verspätete asynchrone Antworten ---
test('6 pilot late answer after logout is discarded and repopulates nothing', async () => {
  const w = world();
  w.setFetch(answer(EXP));
  await w.ctx.bzAnmelden();
  let release;
  w.setFetch(() => new Promise(r => { release = r; }).then(() => ({ ok: true, status: 200, json: async () => ({ rapporte: [{ id: 'private' }] }) })));
  const pending = w.run('bzLaden()');
  await flush();
  w.run('bzAbmelden()');                     // Abmeldung, während die Antwort aussteht
  release();
  await pending;
  assert.equal(JSON.stringify(w.run('bzDaten')), JSON.stringify({ meldungen: [], rapporte: [] }));
});

// --- 7. Keine Verwendung abgelaufener Tokens ---
test('7 pilot request after expiry is never sent with the old token', async () => {
  const w = world();
  w.setFetch(answer(EXP));
  await w.ctx.bzAnmelden();
  w.sleep(8 * HOUR + 1000);
  const before = w.rec.fetches;
  await assert.rejects(w.run("bzCall('GET','/app/admin/rapporte')"), e => e.code === 'session_expired');
  assert.equal(w.rec.fetches, before, 'no request sent after expiry');
});

// --- 8. Ungültige Sitzungsdaten werden abgelehnt ---
test('8 pilot login with an unusable token and no lifetime is refused', async () => {
  const w = world();
  w.setFetch(async () => ({ ok: true, status: 200, json: async () => ({ officeSession: 'opaque' }) }));
  await w.ctx.bzAnmelden();
  assert.equal(w.run('bzSession'), null);
  assert.equal(w.run('OfficeSession.deadline()'), 0);
});

// --- 9. Büro-Anmeldung über office-comms.js ---
async function runCommsLogin(w) {
  const section = w.els['bz-anfragen-section'];
  // office-comms.js rendert beim Start das Anmeldeformular (init), es gibt keinen globalen Aufruf von render().
  const inputs = findAll(section, e => e.tagName === 'input');
  inputs[0].value = 'Luc';
  inputs[1].value = '1234';
  const button = findAll(section, e => e.textContent === 'Anmelden')[0];
  assert.ok(button, 'login button rendered');
  await button.onclick();
  await flush();
}

test('9 office-comms login sets the deadline through the shared core', async () => {
  const w = world({ withComms: true });
  w.ctx.bzCall = async (method, path) => (path === '/app/office/anmelden' ? { officeSession: tokenMit(EXP), expiresIn: 28800 } : { requests: [] });
  w.ctx.bzLaden = async () => {};
  await runCommsLogin(w);
  assert.equal(w.run('bzSession').token, tokenMit(EXP));
  assert.equal(w.run('OfficeSession.deadline()'), EXP * 1000);
});

test('9b office-comms login is refused without the shared session core (fail closed)', async () => {
  const w = world({ withComms: true, withCore: false });
  w.ctx.bzCall = async (method, path) => (path === '/app/office/anmelden' ? { officeSession: tokenMit(EXP), expiresIn: 28800 } : { requests: [] });
  w.ctx.bzLaden = async () => {};
  await runCommsLogin(w);
  assert.equal(w.run('bzSession'), null, 'no session without the timer');
});

test('9c office-comms session ends at the deadline through the same expiry path', async () => {
  const w = world({ withComms: true });
  w.ctx.bzCall = async (method, path) => (path === '/app/office/anmelden' ? { officeSession: tokenMit(EXP), expiresIn: 28800 } : { requests: [] });
  w.ctx.bzLaden = async () => {};
  await runCommsLogin(w);
  w.tick(8 * HOUR + 2000);
  assert.equal(w.run('bzSession'), null);
  assert.equal(w.rec.reloads, 1);
});

// --- 10. Gemeinsame Logik statt drei Kopien ---
test('10 one implementation: index.html, office-pilot.html and office-comms.js all use the shared core', () => {
  assert.ok(INDEX.includes('<script src="office-session.js"></script>'), 'index.html loads the core');
  assert.ok(PILOT.includes('<script src="office-session.js"></script>'), 'office-pilot.html loads the core');
  assert.ok(COMMS.includes('OfficeSession.start('), 'office-comms.js starts sessions through the core');
  assert.ok(!INDEX.includes('function officeSitzungTimerStarten'), 'no second timer copy in index.html');
  assert.ok(!INDEX.includes('function officeSitzungEndeAusToken'), 'no second deadline copy in index.html');
});

// --- 11. Monteur-Sitzungen bleiben unberührt ---
test('11 monteur page has no office session code and the core does not reference monteur', () => {
  assert.ok(!/office-session\.js|office-comms\.js|bzSession|OfficeSession/.test(MONTEUR), 'monteur.html loads no office login code');
  assert.ok(!/monteur/i.test(CORE), 'core references no monteur identifiers');
  assert.ok(!/localStorage|indexedDB/.test(CORE), 'core touches no localStorage or IndexedDB');
});

// --- 12. doLogout() im Haupt-Frontend ---
test('12 index.html doLogout: shared cleanup, sign-out awaited, local documents kept (Phase 49O), then reload', async () => {
  const w = world();
  const rec = { signOuts: 0, deleted: [], removed: [], offs: 0 };
  w.ctx.firebase = { auth() { return { signOut: async () => { rec.signOuts++; } }; } };
  w.ctx.indexedDB = { deleteDatabase(n) { rec.deleted.push(n); const q = {}; queueMicrotask(() => q.onsuccess && q.onsuccess()); return q; } };
  w.ctx.sessionStorage = { removeItem(k) { rec.removed.push(k); } };
  w.ctx.dbRef = { off() { rec.offs++; } };
  w.run('var officeWartetAufSync=null; var officeSyncGeneration=0; var officeAnmeldungLaeuft=false; var currentLoginUser={id:1}; var lagertoolSitzungMaId=1;');
  // Bereinigungsfunktion der Haupt-App, unverändert aus index.html
  const ca = INDEX.indexOf('function officeSitzungAufraeumen() {');
  const cb = INDEX.indexOf('\n}', ca) + 2;
  w.run(INDEX.slice(ca, cb));
  w.run('bzSession={token:"x",name:"Luc"}; OfficeSession.start(' + JSON.stringify(tokenMit(EXP)) + ', 28800);');
  w.run(DOLOGOUT_SRC);
  await w.run('doLogout()');
  await flush();
  assert.equal(rec.signOuts, 1, 'Firebase sign-out awaited');
  assert.ok(!rec.deleted.includes('lagertool_docs'), 'Phase 49O: keine Dokumentlöschung beim Abmelden');
  assert.ok(rec.removed.includes('lagertool_login'));
  assert.equal(rec.offs, 1, 'listener detached');
  assert.equal(w.run('OfficeSession.deadline()'), 0);
  assert.equal(w.rec.reloads, 1, 'reload after cleanup');
});
