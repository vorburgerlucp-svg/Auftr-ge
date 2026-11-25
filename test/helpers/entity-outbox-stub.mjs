// PHASE 49P: Attrappen fuer die Dokument-Outbox in Tests, die nur Abmelde- und Sitzungsablauf pruefen.
// Die Outbox selbst wird in test/dokument-outbox-49p.test.mjs vollstaendig geprueft.
// PHASE 50N: Die echte entityAbmeldungBestaetigen() (aus index.html) nutzt DocOutbox.liste und den
// Abmelde-Guard. Ohne offene Eintraege ist die Abmeldung ohne Rueckfrage erlaubt: dieser Stub bildet genau das ab.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const GUARD_SRC = readFileSync(new URL('../../entity-abmeldung.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function guardModul() { const c = {}; c.window = c; c.globalThis = c; vm.createContext(c); vm.runInContext(GUARD_SRC, c); return c.EntityLogoutGuard; }

export function stubEntityOutbox(ctx) {
  ctx.entityOutbox = [];
  ctx.entityAbmeldungBestaetigen = () => true;
  ctx.entityOutboxAnzeigen = () => {};
  ctx.DocOutbox = ctx.DocOutbox || { liste: async () => [] };
  ctx.EntityLogoutGuard = guardModul();
  return ctx;
}
