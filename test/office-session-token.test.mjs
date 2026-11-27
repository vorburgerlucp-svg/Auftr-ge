// Token-Parser der Büro-Sitzung. Format des Backends: base64url(Claims).base64url(HMAC), genau zwei Teile.
// Getestet wird der echte Code aus office-session.js in einer vm-Umgebung mit steuerbarer Uhr.
// Hinweis: Die Signatur wird vom Frontend nicht geprüft (nur das Backend kann das). Die Tests prüfen das Lesen
// und das Fail-closed-Verhalten.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const CORE = readFileSync(new URL('../office-session.js', import.meta.url), 'utf8');
const MONTEUR = readFileSync(new URL('../monteur.html', import.meta.url), 'utf8');
const INDEX = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const PILOT = readFileSync(new URL('../office-pilot.html', import.meta.url), 'utf8');

const NOW = Date.UTC(2026, 10, 14, 8, 0, 0);     // ganze Sekunde
const HOUR = 3600_000;
const SEK = s => Math.floor(s);
const b64u = s => Buffer.from(s).toString('base64url');
// Backend-Format: zwei Teile. Die Signatur ist synthetisch, nur die Form zählt.
const tok = (claims, sig = 'synthetic-hmac') => `${b64u(JSON.stringify(claims))}.${b64u(sig)}`;
const expIn = ms => SEK(ms / 1000) ;

function make(clockMs = NOW) {
  const clock = { t: clockMs };
  const ctx = {
    document: { addEventListener() {} }, addEventListener() {}, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    atob: x => Buffer.from(x, 'base64').toString('binary'), console,
    Date: class extends Date { constructor(...a) { a.length ? super(...a) : super(clock.t); } static now() { return clock.t; } },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(CORE, ctx);
  return { ctx, clock, S: ctx.OfficeSession };
}

// --- Gültiger Token und exakte Übernahme von exp ---
test('P1 a valid two-part backend token is accepted and its exp becomes the deadline', () => {
  const { S } = make();
  const exp = expIn(NOW) + 8 * 3600;
  assert.equal(S.start(tok({ exp, sub: 'emp-1', role: 'admin', tid: 'montagewelt' }), 28800), true);
  assert.equal(S.deadline(), exp * 1000);
});

test('P2 an arbitrary exp (not a round hour) is taken exactly', () => {
  const { S } = make();
  const exp = expIn(NOW) + 3 * 3600 + 7;
  assert.equal(S.start(tok({ exp }), 4 * 3600), true);
  assert.equal(S.deadline(), exp * 1000);
});

// --- Fehlende und fehlerhafte Claims ---
test('P3 missing or non-object claims are refused', () => {
  const { S } = make();
  assert.equal(S.start(`.${b64u('sig')}`, 28800), false, 'empty claims part');
  assert.equal(S.start(`${b64u('{}')}.${b64u('sig')}`, 28800), false, 'empty object, no exp');
  assert.equal(S.start(`${b64u('[]')}.${b64u('sig')}`, 28800), false, 'array');
  assert.equal(S.start(`${b64u('"x"')}.${b64u('sig')}`, 28800), false, 'string');
  assert.equal(S.start(`${b64u('null')}.${b64u('sig')}`, 28800), false, 'null');
  assert.equal(S.deadline(), 0);
});

test('P4 a missing exp is refused even with a valid expiresIn', () => {
  const { S } = make();
  assert.equal(S.start(tok({ sub: 'x' }), 28800), false);
});

test('P5 an invalid exp is refused', () => {
  const { S } = make();
  for (const bad of ['abc', 1.5, -1, 0, '1794700800', 2 ** 60, true, null]) {
    assert.equal(S.start(tok({ exp: bad }), 28800), false, `exp ${JSON.stringify(bad)}`);
  }
  assert.equal(S.deadline(), 0);
});

// --- Abgelaufen ---
test('P6 an expired token is refused, including exp exactly at now', () => {
  const { S } = make();
  assert.equal(S.start(tok({ exp: expIn(NOW) - 1 }), 28800), false, 'expired one second ago');
  assert.equal(S.start(tok({ exp: expIn(NOW) }), 28800), false, 'exp equal to now');
});

// --- Manipulierter Claims-Teil ---
test('P7a manipulated claims are refused: bad base64, bad JSON, missing signature part', () => {
  const { S } = make();
  const exp = expIn(NOW) + 3600;
  assert.equal(S.start(`!!!.${b64u('sig')}`, 28800), false, 'invalid base64 characters');
  assert.equal(S.start(`${b64u('{"exp":')}.${b64u('sig')}`, 28800), false, 'truncated JSON');
  assert.equal(S.start(`${b64u(JSON.stringify({ exp }))}.`, 28800), false, 'empty signature');
  assert.equal(S.start(`${b64u(JSON.stringify({ exp }))}`, 28800), false, 'signature part missing');
});

test('P7b an exp far in the future (manipulated) is refused: fail-closed upper bound', () => {
  const { S } = make();
  assert.equal(S.start(tok({ exp: expIn(NOW) + 9 * 3600 }), 28800), false, 'nine hours');
  assert.equal(S.start(tok({ exp: expIn(NOW) + 8 * 3600 + 10 * 60 + 2 }), 28800), false, 'beyond the 10-minute tolerance');
});

test('P7c the tolerance edge is accepted: exp = now + 8 h + 10 min', () => {
  const { S } = make();
  const exp = expIn(NOW) + 8 * 3600 + 10 * 60;
  assert.equal(S.start(tok({ exp }), 8 * 3600), true);
  assert.equal(S.deadline(), NOW + 8 * HOUR, 'expiresIn is the earlier boundary here');
});

test('P7d a changed signature does not change the claims reading (documented: the frontend does not verify HMAC)', () => {
  const { S } = make();
  const exp = expIn(NOW) + 3600;
  assert.equal(S.start(tok({ exp }, 'other-signature'), 3600), true, 'accepted by the frontend, rejected by the Worker');
});

// --- Widerspruch zwischen exp und expiresIn ---
test('P8a contradiction: the earlier boundary wins (exp earlier than expiresIn)', () => {
  const { S } = make();
  const exp = expIn(NOW) + HOUR / 1000;          // 1 h
  S.start(tok({ exp }), 8 * 3600);
  assert.equal(S.deadline(), exp * 1000);
});

test('P8b contradiction: the earlier boundary wins (expiresIn earlier than exp)', () => {
  const { S } = make();
  const exp = expIn(NOW) + 8 * 3600;
  S.start(tok({ exp }), 3600);
  assert.equal(S.deadline(), NOW + HOUR, 'expiresIn caps the deadline, nothing is extended');
});

test('P8c a client clock behind the server cannot extend the session beyond exp', () => {
  const { S } = make(NOW - 5 * 60_000);          // Geraeteuhr 5 Minuten zurueck
  const exp = expIn(NOW) + 8 * 3600;             // Serverzeit
  S.start(tok({ exp }), 8 * 3600);
  assert.ok(S.deadline() <= exp * 1000, 'deadline never later than the signed exp');
});

test('P8d an invalid expiresIn is refused (fail-closed)', () => {
  const { S } = make();
  const exp = expIn(NOW) + 3600;
  for (const bad of ['abc', 0, -5, 99 * 3600, true, NaN, Infinity]) {
    assert.equal(S.start(tok({ exp }), bad), false, `expiresIn ${String(bad)}`);
  }
});

// --- Kein Fallback, kein Dreiteiler ---
test('P9 no fallback: an unreadable token is refused even with a valid expiresIn', () => {
  const { S } = make();
  assert.equal(S.start('opaque-token', 28800), false);
  assert.equal(S.start('opaque.token', 28800), false, 'two parts but not base64url JSON');
});

test('P10 no JWT assumption: a three-part token is refused even if its middle part is valid claims', () => {
  const { S } = make();
  const exp = expIn(NOW) + 3600;
  const jwt = `${b64u('{"alg":"RS256"}')}.${b64u(JSON.stringify({ exp }))}.${b64u('sig')}`;
  assert.equal(S.start(jwt, 3600), false);
});

test('P10b a single part is refused', () => {
  const { S } = make();
  assert.equal(S.start(b64u(JSON.stringify({ exp: expIn(NOW) + 3600 })), 3600), false);
});

// --- Firebase-Refresh ---
test('P11 a Firebase token refresh does not move the deadline (no start call, time passes)', () => {
  const { S, clock } = make();
  const exp = expIn(NOW) + 8 * 3600;
  S.start(tok({ exp }), 8 * 3600);
  clock.t = NOW + 7 * HOUR;                      // Refresh-Zyklus, kein neues Token in die Sitzung
  assert.equal(S.deadline(), exp * 1000);
  assert.equal(S.aktiv(), true, 'still active at 7 h');
  clock.t = exp * 1000;
  assert.equal(S.expired(), true, 'expired exactly at exp');
});

// --- Erneute Anmeldung ---
test('P12 a new login after expiry replaces the deadline with the new exp', () => {
  const { S, clock } = make();
  const exp1 = expIn(NOW) + 8 * 3600;
  S.start(tok({ exp: exp1 }), 8 * 3600);
  clock.t = exp1 * 1000 + 2000;
  assert.equal(S.expired(), true);
  const exp2 = expIn(clock.t) + 8 * 3600;
  assert.equal(S.start(tok({ exp: exp2 }), 8 * 3600), true);
  assert.equal(S.deadline(), exp2 * 1000);
});

// --- Mehrere Browser-Tabs (je eigener Kontext) ---
test('P13 two tabs with different logins keep their own exp', () => {
  const a = make(NOW); const b = make(NOW + HOUR);
  const expA = expIn(NOW) + 8 * 3600;
  const expB = expIn(NOW + HOUR) + 8 * 3600;
  a.S.start(tok({ exp: expA }), 8 * 3600);
  b.S.start(tok({ exp: expB }), 8 * 3600);
  assert.equal(a.S.deadline(), expA * 1000);
  assert.equal(b.S.deadline(), expB * 1000);
  assert.notEqual(a.S.deadline(), b.S.deadline());
});

// --- Grenzen des Fehlerfalls und Monteur ---
test('P14 monteur page does not load the office session parser and the parser knows no monteur logic', () => {
  assert.ok(!MONTEUR.includes('office-session.js'));
  assert.ok(!/monteur/i.test(CORE));
});

test('P15 the pages use the parser through the same start() call (no second parser)', () => {
  assert.ok(INDEX.includes('OfficeSession.start('));
  assert.ok(PILOT.includes('OfficeSession.start('));
  assert.ok(!/split\('\.'\)\[1\]/.test(CORE), 'the signature segment is never read as claims');
  assert.ok(/split\('\.'\)/.test(CORE), 'the parser splits the token');
});
