// PHASE 50N: Abmeldebestaetigung fuer die Dokument-Outbox.
//
// Regeln:
//  - Die Bestaetigung ist eine Entscheidung des Nutzers. Sie loescht NICHTS. Lokale verschluesselte Eintraege
//    bleiben in der Outbox, auch nach einer Abmeldung.
//  - Nicht gesicherte Eintraege (nicht endgueltig zugeordnet) fuehren zur Rueckfrage.
//  - Ist der Zustand nicht lesbar, wird ebenfalls gefragt (fail-safe): nie stillschweigend bestaetigen.
//  - Nur die manuelle Abmeldung ruft dies auf. Sitzungsablauf und serverseitiger Widerruf verwenden es nicht,
//    damit ein Widerruf niemals durch diese Rueckfrage verhindert wird.
//
// Zustaende, die als NICHT gesichert gelten: alles ausser 'final' und 'discarded'.
(function (global) {
  'use strict';

  const GESICHERT = ['final', 'discarded'];

  // Anzahl der nicht gesicherten Eintraege einer Outbox-Liste.
  function zaehleOffen(liste) {
    if (!Array.isArray(liste)) return 0;
    return liste.filter(x => x && !GESICHERT.includes(x.state)).length;
  }

  // Liefert true, wenn die Abmeldung fortgesetzt werden darf.
  //  liste:   Array der Outbox des angemeldeten Nutzers, oder null bei Lesefehler
  //  fehler:  true bei Lesefehler (fail-safe: Rueckfrage)
  //  online:  Netzstatus; beeinflusst nur den Hinweistext
  //  frage:   function(text) -> boolean (Bestaetigung des Nutzers)
  function bestaetigen({ liste, fehler, online, frage }) {
    if (typeof frage !== 'function') return false;
    if (fehler || !Array.isArray(liste)) {
      return frage('Der Zustand der lokalen Dokumentablage konnte nicht gelesen werden. Es kann sein, dass Dokumente noch nicht auf dem Server gesichert sind. Trotzdem abmelden? Lokale Kopien werden nicht gelöscht.') === true;
    }
    const offen = zaehleOffen(liste);
    if (offen === 0) return true;
    const netz = online === false ? ' Derzeit besteht keine Netzwerkverbindung; die Dokumente werden nach der nächsten Anmeldung hochgeladen.' : '';
    const text = offen === 1
      ? 'Ein Dokument ist noch nicht endgültig auf dem Server gespeichert. Es bleibt verschlüsselt auf diesem Gerät erhalten und wird bei der nächsten Anmeldung weiter verarbeitet.'
      : offen + ' Dokumente sind noch nicht endgültig auf dem Server gespeichert. Sie bleiben verschlüsselt auf diesem Gerät erhalten und werden bei der nächsten Anmeldung weiter verarbeitet.';
    return frage(text + netz + ' Trotzdem abmelden?') === true;
  }

  global.EntityLogoutGuard = { bestaetigen, zaehleOffen, GESICHERT };
})(typeof window !== 'undefined' ? window : globalThis);
