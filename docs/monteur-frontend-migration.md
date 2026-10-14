# Frontend-Umstellung: index.html und monteur.html auf Worker-Anmeldung

Status: **Plan, keine Code-Änderung.** Die Umstellung braucht zuerst die Entscheidung unter
„Zu entscheiden“. Der Worker-Teil liegt im Backend-PR `security/worker-app-auth`
(`/app/office/login`, `/app/monteur/*`).

## Ist-Zustand (belegt, Commit bc9b4e8)

- `index.html`: `initFirebase()` ruft `signInAnonymously()` direkt beim Laden auf
  (Zeile ~11527). Danach liest `startFirebaseListener()` den gesamten Datenbestand unter
  `/lagertool`. Der PIN-Login (`doLogin`, Zeile ~2750) vergleicht im Browser mit
  `state.mitarbeiter`, also mit Daten aus Firebase.
- `monteur.html`: `initFirebase()` meldet anonym an, `startFirebaseListener()` liest
  `/lagertool`, `save()` schreibt mit `dbRef.set(slimJson)` den gesamten Bestand. Der
  PIN-Login prüft gegen `state.mitarbeiter` aus demselben Bestand.
- `monteur.html` greift über 100-mal auf `state.*` zu. Die Bereiche sind: Bestellung
  (`orders`, `artikel`, `kategorien`), Werkzeug (`werkzeug`), Wochenplan (`plan`),
  Meldungen (`monteurMeldungen`), Baustatus (`baustellen`), Profil.

## Ziel

| Bereich | Monteur heute | Ziel |
| --- | --- | --- |
| Anmeldung | PIN gegen Gesamtdaten | `POST /app/monteur/login`, Sitzungs-Token |
| Baustatus / Baustellen | voller Datenbestand | `GET /app/monteur/sites` (nur freigegebene Felder) |
| Wochenplan | voller Plan | nur freigegebene Auszüge, **zu entscheiden** |
| Meldungen / Rapporte | Schreiben in `/lagertool` | `POST /app/monteur/meldung` bzw. `/rapport` |
| Bestellung (Artikel, Warenkorb) | Schreiben in `orders` | **zu entscheiden** |
| Werkzeug | Schreiben in `werkzeug` | **zu entscheiden** |
| Profil | eigene Daten | nur eigene Daten über Sitzung |

Office (`index.html`):

1. Vor dem Laden des Datenbestands: PIN-Login gegen `POST /app/office/login`.
2. Antwort enthält `firebaseToken` (Claim `role=office`). Anmeldung mit
   `firebase.auth().signInWithCustomToken(token)` statt `signInAnonymously()`.
3. Erst danach `startFirebaseListener()`.
4. `state.mitarbeiter` enthält keine PIN-Werte mehr. PIN-Prüfung nur serverseitig.

## Technische Schritte (nach Entscheidung)

1. Worker-URL als Konstante in beiden Dateien. Der Worker erlaubt bereits
   `https://vorburgerlucp-svg.github.io` als Origin.
2. `index.html`: Login-Reihenfolge umbauen, `signInWithCustomToken`, PIN-Prüfung
   entfernen. Der vorhandene Dirty-Check beim Speichern bleibt.
3. `monteur.html`: `firebase`-Aufrufe entfernen, Datenabruf über `/app/monteur/*`.
   Schreibvorgänge nur über die Endpunkte für Rapporte und Meldungen.
4. Service Worker `sw.js`: Cache-Version erhöhen, damit Clients die neue Version laden.
5. Negativtests: Zugriff ohne Sitzung, falsche Rolle, Monteur versucht Schreiben in
   `/lagertool`. Die Rules-Tests (PR #22) decken den Firebase-Teil ab.

## Zu entscheiden (blockiert die Umsetzung)

1. **Bestellung und Werkzeug**: Dürfen Monteure weiter Artikel bestellen und Werkzeug
   ausgeben/zurücknehmen? Die Vorgabe „keine Stammdaten ändern“ betrifft diese Bereiche
   nicht eindeutig. Bei „ja“ braucht es eigene Endpunkte mit Validierung. Bei „nein“ werden
   die Bereiche aus der Monteur-App entfernt.
2. **Wochenplan**: Welche Felder darf ein Monteur sehen (nur eigene Einsätze, oder das
   Team)?
3. **Verrechnungen und Retouren** (werden in `monteur.html` geschrieben): Sind sie
   Monteur-Funktionen, oder gehören sie ins Büro?

## Rollback

- Frontend: vorherige Version aus Git ausliefern, Service-Worker-Cache erneuern.
- Die alten Firebase-Zugriffe funktionieren nur, solange die alten Regeln aktiv sind.
  Deshalb die Regeln erst nach Abschluss dieses Schritts deployen (siehe
  `docs/firebase-migration.md`, PR #22).
