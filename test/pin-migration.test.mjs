import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const migrationSource = html.slice(html.indexOf('function migrationMitarbeiterPins() {'), html.indexOf('\nlet currentLoginUser = null;'));

function runMigration(mitarbeiter = []) {
  let saved = 0;
  const ctx = vm.createContext({ state: { mitarbeiter: structuredClone(mitarbeiter) }, save: () => { saved++; }, Date, Math, console });
  vm.runInContext(migrationSource, ctx);
  ctx.migrationMitarbeiterPins();
  return { mitarbeiter: ctx.state.mitarbeiter, saved };
}

test('source contains no hardcoded four-digit PIN literals or known default PIN', () => {
  assert.equal(/"pin":"\d{4}"/.test(html), false, 'JSON seed with PIN found');
  assert.equal(/pin:\s*'\d{4}'/.test(html), false, 'pin literal found');
  assert.equal(html.includes("'0804'"), false, 'former default admin PIN still present');
  assert.equal(html.includes("'3885'") || html.includes("'7883'"), false, 'former Zollikon PIN still present');
  assert.equal(/\bf\.pin\b|info\.pin/.test(migrationSource), false, 'migration copies PINs from seed');
});

test('new employees from the seed list are created without any PIN', () => {
  const { mitarbeiter } = runMigration([]);
  const created = mitarbeiter.filter(m => m.nachname !== 'Vorburger');
  assert.ok(created.length > 0, 'seed list should create employees');
  for (const m of created) assert.equal(m.pin, '', `${m.vorname} ${m.nachname} got a PIN`);
});

test('admin Luc is created without a default PIN', () => {
  const { mitarbeiter } = runMigration([]);
  const luc = mitarbeiter.find(m => m.vorname === 'Luc' && m.nachname === 'Vorburger');
  assert.ok(luc);
  assert.equal(luc.pin, '');
  assert.equal(luc.admin, true);
});

test('existing employee without PIN stays without PIN', () => {
  const { mitarbeiter } = runMigration([{ id: 7, vorname: 'Canard', nachname: 'Jeremy', funktion: 'monteur', rolle: 'monteur' }]);
  const m = mitarbeiter.find(x => x.id === 7);
  assert.ok(!m.pin, 'PIN was filled from code');
});

test('existing PIN is never overwritten and existing ID is kept', () => {
  const { mitarbeiter } = runMigration([{ id: 42, vorname: 'Canard', nachname: 'Jeremy', funktion: 'monteur', rolle: 'monteur', pin: '5555' }]);
  const m = mitarbeiter.find(x => x.id === 42);
  assert.ok(m);
  assert.equal(m.pin, '5555');
});

test('existing Luc keeps his PIN and no default is inserted when missing', () => {
  const withPin = runMigration([{ id: 9002, vorname: 'Luc', nachname: 'Vorburger', funktion: 'Admin', pin: '1111' }]).mitarbeiter.find(m => m.id === 9002);
  assert.equal(withPin.pin, '1111');
  const withoutPin = runMigration([{ id: 9003, vorname: 'Luc', nachname: 'Vorburger', funktion: 'Admin' }]).mitarbeiter.find(m => m.id === 9003);
  assert.ok(!withoutPin.pin, 'default PIN inserted for Luc');
  assert.equal(withoutPin.admin, true);
});

test('migration never deletes employees and keeps existing roles', () => {
  const before = [
    { id: 1, vorname: 'Tobias', nachname: 'Dräyer', funktion: 'Admin', rolle: 'leiter', pin: '2222' },
    { id: 2, vorname: 'Dubs', nachname: 'Gilles', funktion: 'x', rolle: 'leiter' }
  ];
  const { mitarbeiter } = runMigration(before);
  assert.ok(mitarbeiter.length >= before.length);
  assert.equal(mitarbeiter.find(m => m.id === 1).rolle, 'leiter');
  assert.equal(mitarbeiter.find(m => m.id === 1).admin, true);
  assert.equal(mitarbeiter.find(m => m.id === 2).rolle, 'leiter');
  assert.ok(!mitarbeiter.find(m => m.id === 2).pin, 'Zollikon PIN injected');
});

test('migration persists the state exactly once per run', () => {
  assert.equal(runMigration([]).saved, 1);
});
