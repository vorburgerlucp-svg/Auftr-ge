# Pilot: Frontend-Testbasis reparieren und vollständig in CI prüfen

**Vorgesehene Basis:** `pilot/monteur-chatbot-test-20261023` im Repository `vorburgerlucp-svg/Auftr-ge`.
**Lokaler Entwicklungsbranch:** `test/pilot-frontend-baseline-20261028`.

Sieben Frontendtests erreichen ihre eigentlichen Prüfungen nicht mehr: zwei suchen den früheren Berichtbutton, einer kennt die zusätzliche lokale Pilotkonfiguration nicht, vier scheitern an einer entfernten Kommentargrenze im HTML-Testloader. Der Loader prüft jetzt vorhandene Funktionsgrenzen. Der Offlinetest berücksichtigt zudem den bereits bestehenden Sicherheitsentscheid gegen persistenten Gesamtzustandscache und prüft ausdrücklich den Sitzungsspeicher und ausbleibende Browserstorage-Schreibzugriffe.

Die Prüfungen für Bestätigung, Vorschautoken, Retry, ehrlichen Speicherstatus und stabile Baustellen-ID bleiben erhalten. GitHub Actions führt auf PRs, Pushes und manuell alle Frontendtests unter Node 22 mit ausschliesslichen Leserechten aus. Keine Änderung der Anwendungslogik oder Abhängigkeiten; keine Tests entfernt oder übersprungen.

Validierung: vollständige Suite unter Node 22.23.4 und 24.19.0 jeweils **29/29 bestanden**, keine Fehler oder übersprungenen Tests. Sechs isolierte Mutationsprüfungen bestätigen, dass Sicherheits- und Speicherregressionen weiterhin auffallen. YAML-Prüfung und `git diff --check` bestanden. Einzelursachen und Nachweisgrenzen: [Ergebnisbericht](frontend-testbasis-2026-10-28.md).

GitHub Actions selbst wurde noch nicht ausgeführt. Dieser lokale PR-Entwurf umfasst keinen Push, Merge oder Deployment und keine Backend-/Firebase-/Browser-E2E-Abnahme. PIN-Erstwechsel und Berechtigungsabsicherung folgen separat.
