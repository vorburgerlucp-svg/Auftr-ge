# Frontend-Testbasis: Umsetzungsplan

> **For agentic workers:** Umsetzung mit superpowers:executing-plans; keine Anwendungsänderungen.

**Goal:** Bestehende Frontendtests auf dem Pilot wieder ausführbar machen und vollständig in CI prüfen.
**Architecture:** Bestehende Node-/VM-Tests behalten; nur überholte Testannahmen und Extraktionsgrenzen korrigieren. GitHub Actions führt alle `test/*.test.mjs` mit Node 22 aus, ohne Deployment oder Secrets.
**Tech Stack:** Node Test Runner, node:vm, GitHub Actions; keine neuen Paketabhängigkeiten.
**Spec:** Entwicklungsauftrag „Entwicklungsphase 1: Testbasis stabilisieren“ vom 28.10.2026; Analysebericht `/workspace/analyse-lagertool-monteur-2026-10-28.md`, Abschnitte 5 und 8.

## Global Constraints

- Neuer Branch `test/pilot-frontend-baseline-20261028`, Basis `db8aeb21a1394123157cf66976314601ad87e8f6`.
- Keine Änderungen an main, Anwendungslogik oder produktiven Daten. Kein Push, Merge oder Deployment.
- Kein Entfernen, Überspringen oder Abschwächen bestehender Schutzprüfungen.
- Bestehender Cloudcheckout genügt; kein zusätzlicher Worktree.

## Review Focus

- Der Sicherheitsfix zum fehlenden persistenten Officecache darf im Test nicht durch einen speichernden Mock rückgängig gemacht werden.
- Bestätigung und Retry müssen denselben Vorschautoken verwenden, keine automatische Rapportabgabe.
- Fehlende Extraktionsgrenzen müssen verständlich fehlschlagen statt HTML auszuführen.
- CI muss alle Testdateien auch bei künftigen PRs ausführen, ohne Schreibrechte oder Deployment.
- Ein grüner Node-Lauf belegt keine Browser-E2E- oder Produktivbereitschaft.

## Aufgaben

- [x] Unveränderte Suite reproduzieren: 29 Tests, 22 bestanden, 7 fehlgeschlagen; Ursachen im Code und Gitverlauf prüfen.
- [x] `test/monteur-assistant.test.mjs`: aktuellen Rapportbutton ansprechen; Bestätigung, Vorschautoken und Retry weiterhin vollständig prüfen.
- [x] `test/monteur-security.test.mjs`: nur lokale `pilot-config.js` zusätzlich zulassen, exakte Skriptliste erhalten.
- [x] `test/shared-save-status.test.mjs`: begrenzte Funktionsauszüge mit expliziten Grenzprüfungen; echtes `lagertoolKeinCache` ausführen; Zustand im Sitzungsspeicher und keine persistenten Schreibzugriffe prüfen. Unverifizierten Erfolg und ID-Duplikate weiterhin abweisen.
- [x] `.github/workflows/frontend-tests.yml`: PR, Push und manuell; Node 22, contents:read, alle vorhandenen Tests, kein Deployment.
- [x] Gesamte Suite auf Node 22 ausführen; Diff auf erlaubte Dateien und unveränderte Testanzahl prüfen.
- [x] Ursachen und Nachweise in `docs/frontend-testbasis-2026-10-28.md`, lokale PR-Beschreibung in `docs/pull-request-frontend-testbasis.md` dokumentieren; getrennte Anwendungsthemen benennen.
- [x] Abschliessendes unabhängiges Review; lokal committen, nicht pushen.

## Entscheidungen / Fortschritt

Der Nutzer hat die Umsetzung bereits beauftragt; keine weitere Planfreigabe erforderlich. Bestehende sieben rote Tests liefern den Ausgangsnachweis. Die Offlineannahme wird entsprechend Commit `27e79ce` auf den Sitzungsspeicher präzisiert: keine Wiederherstellung des absichtlich entfernten Browsercaches im Testdouble. Schutz vor persistentem Schreiben wird ausdrücklich geprüft.

Abschluss: Alle 29 Tests unter Node 22.23.4 und 24.19.0 bestanden; sechs isolierte Mutationen erkannt. Unabhängiges Review ohne handlungsbedürftigen Befund. Keine Anwendungsdateien geändert. Ein lokaler Commit hält den geprüften Stand fest; Branch bleibt ohne Push bestehen.
