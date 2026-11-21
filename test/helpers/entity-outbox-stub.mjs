// PHASE 49P: Attrappen fuer die Dokument-Outbox in Tests, die nur Abmelde- und Sitzungsablauf pruefen.
// Die Outbox selbst wird in test/dokument-outbox-49p.test.mjs vollstaendig geprueft.
export function stubEntityOutbox(ctx) {
  ctx.entityOutbox = [];
  ctx.entityAbmeldungBestaetigen = () => true;
  ctx.entityOutboxAnzeigen = () => {};
  return ctx;
}
