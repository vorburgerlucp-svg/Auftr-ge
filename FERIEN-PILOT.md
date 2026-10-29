# Ferienanträge – isolierter Pilot

Zusammen mit dem Backend-Featurebranch feat/monteur-ferienantraege-20261029 testen.
Serverflag MONTEUR_VACATION_ENABLED ist standardmässig aus. Nur lokale Testadapter und
Firebase-Emulatorprojekt demo-lagertool sind für die Testläufe vorgesehen.

Im Assistenten: Ferien beantragen → Daten mit Jahr → Vorschau → verbindlich absenden.
Im Büro: Anfragen → Ferienantrag (Prio 1) → Konflikte prüfen. Vorhandene Einsätze immer
in der bestehenden Wochenplanung bereinigen. Genehmigen prüft erneut atomar.
"Speicherprüfung offen" ist ausdrücklich keine Genehmigung; Genehmigung erneut ausführen.
Persönliche Entscheidungs-Pop-ups bleiben bis Verstanden bzw. Quittierung gespeichert.

Tests: node --test test/*.test.mjs. Browserworkflow im Backend: node e2e/vacation-local.mjs.
Keine Produktivbereitstellung, kein Merge. Die bisherige Staging-Freigabe umfasst diese
neue Funktion nicht; neue CI-Abnahme und Source-Pins sind erforderlich.
