import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../monteur.html', import.meta.url), 'utf8');
const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n;\n');

test('inline script of monteur.html compiles', () => {
  assert.doesNotThrow(() => new vm.Script(inline, { filename: 'monteur-inline.js' }));
});

test('no Firebase, Realtime Database or EmailJS in the monteur app', () => {
  assert.equal(/firebase/i.test(html), false, 'firebase reference');
  assert.equal(/emailjs/i.test(html), false, 'emailjs reference');
  assert.equal(/dbRef|signInAnonymously|\.ref\(/.test(html), false, 'database access');
});

test('monteur app loads only its own worker client, no other remote scripts', () => {
  const srcs = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(srcs, ['monteur-api.js']);
});

test('no whole-state persistence and no PIN storage', () => {
  assert.equal(/setItem\(\s*['"]lagertool['"]/.test(html), false, 'whole state written to storage');
  assert.equal(/localStorage\.setItem|sessionStorage\.setItem/.test(html), false, 'browser storage write');
  assert.equal(/\.pin\b/.test(inline), false, 'pin field accessed in browser');
  assert.equal(/setItem\([^)]*webauthn/i.test(html), false, 'biometric PIN storage written');
});

test('login sends name and PIN to the worker only, no employee list in the browser', () => {
  assert.match(inline, /MonteurApi\.login\(name, pin\)/);
  assert.equal(/state\.mitarbeiter\.find/.test(inline), false, 'local PIN lookup');
  assert.equal(/m\.pin\s*!==?\s*pin/.test(inline), false, 'local PIN comparison');
});

test('save() no longer persists the whole state', () => {
  const i = inline.indexOf('function save() {');
  assert.ok(i >= 0);
  const body = inline.slice(i, inline.indexOf('\n}', i));
  assert.equal(/set(Item)?\(|\.set\(|fetch/.test(body), false);
  assert.match(body, /noch nicht angebunden/);
});
