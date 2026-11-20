// Phase 13, Ziel B: Tab-Synchronisation pro Mitarbeiter. Echter Core (office-session.js) in vm-Kontexten, die einen
// gemeinsamen BroadcastChannel-Bus teilen (wie Tabs im selben Browserprofil). Keine Netzwerkzugriffe.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const CORE = readFileSync(new URL('../office-session.js', import.meta.url), 'utf8');
const b64u = s => Buffer.from(s).toString('base64url');
// Token-Format wie im Backend: Claims mit exp und sub (Mitarbeiterkennung), Signatur synthetisch.
const tokenFuer = (sub, exp = Math.floor(Date.now() / 1000) + 8 * 3600) => JSON.stringify(`${b64u(JSON.stringify({ exp, sub }))}.${b64u('synthetic-hmac')}`);
const flush = () => new Promise(r => setImmediate(r));
const pause = ms => new Promise(r => setTimeout(r, ms));

function bus() { return { subs: [], log: [], serverCalls: 0 }; }

// Ein Tab = eigener Kontext mit eigenem Sitzungsspeicher, aber gemeinsamem Bus.
function tab(b, name) {
  const store = new Map();
  const rec = { ended: [], name };
  const ctx = {
    sessionStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    document: { readyState: 'complete', hidden: false, addEventListener() {}, getElementById: () => ({ style: {}, value: '', textContent: '' }) },
    window: null, addEventListener() {}, location: { reload() {} },
    console, Date, atob: s => Buffer.from(s, 'base64').toString('binary'),
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    fetch: async () => { b.serverCalls++; return { status: 200, json: async () => ({ ok: true, firebaseSync: 'ok' }) }; },
    __ended: rec.ended,
  };
  ctx.window = ctx;
  ctx.BroadcastChannel = class {
    constructor() { this.onmessage = null; b.subs.push(this); }
    postMessage(data) {
      const copy = JSON.parse(JSON.stringify(data));
      b.log.push({ from: name, data: copy });
      for (const s of b.subs) if (s !== this) setImmediate(() => { if (s.onmessage) s.onmessage({ data: JSON.parse(JSON.stringify(copy)) }); });
    }
  };
  vm.createContext(ctx);
  vm.runInContext(CORE, ctx);
  vm.runInContext('OfficeSession.onEnd = g => __ended.push(g);', ctx);
  return { ctx, rec, run: c => vm.runInContext(c, ctx), b, name };
}
const start = (t, sub) => t.run(`OfficeSession.start(${tokenFuer(sub)}, 28800)`);
// Sendet ein Ereignis als fremder Absender an alle anderen Tabs (ohne Logout-Logik des Absenders).
function sende(b, daten) { for (const s of b.subs) setImmediate(() => { if (s.onmessage) s.onmessage({ data: daten }); }); }
// Liefert die echte Kennung eines Mitarbeiters: ein Hilfs-Tab desselben Mitarbeiters meldet sich ab.
async function kennung(b, sub) {
  const h = tab(b, 'HILFE-' + sub);
  start(h, sub);
  const vorher = b.log.length;
  h.run('OfficeSession.logout()');
  await flush();
  return b.log.slice(vorher).find(m => m.data.t === 'logout').data.k;
}

test('T1 two employees on one profile: A logs out, B stays signed in', async () => {
  const b = bus();
  const a = tab(b, 'A'), bb = tab(b, 'B');
  assert.equal(start(a, '9001'), true);
  assert.equal(start(bb, '9002'), true);
  await flush();
  a.run('OfficeSession.logout()');
  await flush(); await flush();
  assert.equal(bb.run('OfficeSession.aktiv()'), true, "B is not ended by A's logout");
  assert.deepEqual(bb.rec.ended, []);
});

test('T2 the same employee in two tabs: logout in tab 1 ends tab 2', async () => {
  const b = bus();
  const t1 = tab(b, 'T1'), t2 = tab(b, 'T2');
  start(t1, '9001'); start(t2, '9001');
  await flush();
  // Tab 2 hat die Sitzung vor dem Logout begonnen (eine Millisekunde Abstand, wie bei echten Tabs).
  await pause(5);
  t1.run('OfficeSession.logout()');
  await flush(); await flush();
  assert.equal(t2.run('OfficeSession.aktiv()'), false);
  assert.deepEqual(t2.rec.ended, ['remote-logout']);
});

test('T3 a forged logout with a foreign key is ignored', async () => {
  const b = bus();
  const opfer = tab(b, 'OPFER');
  start(opfer, '9002');
  await flush();
  sende(b, { t: 'logout', at: Date.now() + 1000, k: '0000000000000000' });
  await flush(); await flush();
  assert.equal(opfer.run('OfficeSession.aktiv()'), true);
});

test('T4 a logout message without any key is ignored', async () => {
  const b = bus();
  const t = tab(b, 'T');
  start(t, '9001');
  await flush();
  sende(b, { t: 'logout', at: Date.now() + 1000 });
  await flush(); await flush();
  assert.equal(t.run('OfficeSession.aktiv()'), true);
});

test('T5 a session without an identity announces no logout and cannot be ended by a broadcast', async () => {
  const b = bus();
  const ohne = tab(b, 'OHNE');
  const tok = JSON.stringify(`${b64u(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))}.${b64u('x')}`);
  ohne.run(`OfficeSession.start(${tok}, 3600)`);
  await flush();
  ohne.run('OfficeSession.logout()');
  assert.equal(b.log.filter(m => m.data.t === 'logout').length, 0);
});

test('T6 a stale logout event (older than the new session) does not end that session', async () => {
  const b = bus();
  const t = tab(b, 'T');
  const k = await kennung(b, '9001');
  start(t, '9001');
  await flush();
  sende(b, { t: 'logout', at: Date.now() - 60000, k });
  await flush(); await flush();
  assert.equal(t.run('OfficeSession.aktiv()'), true);
});

test('T7 after a logout, a new login is not ended by the old logout event', async () => {
  const b = bus();
  const a = tab(b, 'A');
  start(a, '9001');
  await flush();
  a.run('OfficeSession.logout()');
  await pause(5);
  const neu = tab(b, 'A2');
  start(neu, '9001');
  await flush(); await flush();
  assert.equal(neu.run('OfficeSession.aktiv()'), true);
});

test('T8 messages carry no token, no employee id and no name', async () => {
  const b = bus();
  const a = tab(b, 'A');
  start(a, '9001');
  a.run('OfficeSession.logout()');
  assert.ok(b.log.length >= 1);
  for (const m of b.log) {
    const text = JSON.stringify(m.data);
    assert.equal(text.includes('9001'), false);
    assert.equal(text.includes('eyJ'), false);
    assert.deepEqual(Object.keys(m.data).sort(), ['at', 'k', 't']);
  }
});

test('T9 the key is stable for one employee and different for another', async () => {
  const b = bus();
  const kA1 = await kennung(b, '9001');
  const kA2 = await kennung(b, '9001');
  const kB = await kennung(b, '9002');
  assert.match(kA1, /^[0-9a-f]{16}$/);
  assert.equal(kA1, kA2);
  assert.notEqual(kA1, kB);
});

test('T10 receiving an event never calls the server: only the server check decides revocation', async () => {
  const b = bus();
  const t = tab(b, 'T');
  const k = await kennung(b, '9001');
  start(t, '9001');
  await flush();
  const vorher = b.serverCalls;
  sende(b, { t: 'logout', at: Date.now() + 1000, k });
  await flush(); await flush();
  assert.equal(t.run('OfficeSession.aktiv()'), false, 'the same employee is ended locally');
  assert.equal(b.serverCalls, vorher, 'no server request is made by the receiver');
});
