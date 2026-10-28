# Frontend-Testbasis: Ergebnis vom 28.10.2026

Branch: `test/pilot-frontend-baseline-20261028`.
Basis und vorgesehener PR-Zielbranch: `pilot/monteur-chatbot-test-20261023`, Commit `db8aeb21a1394123157cf66976314601ad87e8f6`.
Keine Änderungen an Anwendungsdateien, Backend, Abhängigkeiten oder produktiven Daten. Kein Push, Merge oder Deployment.

## Reproduktion und tatsächliche Ursachen

Unverändert ausgeführt: `node --test test/*.test.mjs` mit Node 24.19.0. Ergebnis: 29 Tests, 22 bestanden, sieben fehlgeschlagen, null übersprungen; Exitcode 1.

| Fehlgeschlagener Test | Tatsächliche Ursache | Korrektur und erhaltene Schutzprüfung |
|---|---|---|
| `assistant previews report and writes only after the explicit confirmation click` | Test sucht „Bericht verbindlich speichern“; seit Pilotcommit `5d79cc7` heisst der sichtbare Button „Rapport verbindlich speichern“. Die Vorschau wird korrekt erzeugt. | Aktuellen Button verwenden. Vorher nur ein Vorschauaufruf ohne confirmation; erst Klick sendet confirmation:true mit demselben Vorschautoken. |
| `storage failure stays visible and retains the same confirmation token` | Derselbe veraltete Buttontext; daher Zugriff auf `undefined.click`, bevor das Fehler-/Retry-Verhalten geprüft wird. | Aktuellen Button ausdrücklich auf Existenz prüfen; Speicherfehler bleibt sichtbar, Retry nutzt weiterhin denselben Token. |
| `monteur app loads only its own worker client, no other remote scripts` | Seit Pilotcommit `6afaf46` wird zusätzlich die lokale `pilot-config.js` geladen. Der Test erwartet noch genau zwei Skripte. | Exakte lokale Allowlist um genau diese Datei ergänzen; zusätzliche oder entfernte Skripte werden weiterhin abgewiesen. |
| `offline saving retains a local draft but never reports a central save` | Gemeinsamer Testloader sucht den entfernten Kommentar „IndexedDB für grosse Dokumente“; `indexOf` liefert -1, das Slice enthält HTML und VM meldet `Unexpected token '<'`. Danach wäre noch eine zweite veraltete Annahme sichtbar: persistenter Gesamtzustandscache wurde mit `27e79ce` bewusst deaktiviert. | Extraktion mit vorhandenen Funktionsgrenzen und ausdrücklichen Grenzprüfungen. Echte `lagertoolKeinCache`-Funktion ausführen. Entwurf bleibt mit ID und Inhalt im Sitzungsspeicher; ok:false, verified:false, localOnly:true; keinerlei Browserstorage-Schreibzugriff. Testname entsprechend präzisiert. |
| `first sync still pending does not report success` | Derselbe gemeinsame Extraktionsfehler; das eigentliche Verhalten wurde gar nicht erreicht. | Loader reparieren; ok bleibt false und pendingSaveBeforeSync wird gesetzt. |
| `verified central saving still succeeds` | Derselbe gemeinsame Extraktionsfehler; kein Fehler im geprüften zentralen Erfolgszweig nachgewiesen. | Loader reparieren; bestätigtes Ergebnis des simulierten Syncdienstes wird als ok:true und verified:true weitergegeben. |
| `retrying a new site offline keeps one draft and its original identity` | Derselbe gemeinsame Extraktionsfehler in `setup`, noch vor dem Aufruf des echten Formularspeicherns. | Beide Funktionsauszüge erhalten geprüfte Grenzen. Zweimaliges Speichern erzeugt genau eine Baustelle mit derselben ID; das Formular bleibt offen. |

Die Umstellung auf den nichtpersistenten Sitzungsspeicher folgt dem vorhandenen Sicherheitsentscheid in `27e79ce17e4f9a1a25c23fb00740d00da650dddb`; sie ist keine Änderung der Anwendung in diesem Branch. Ein speichernder Mock hätte die tatsächliche Implementierung verdeckt. Die frühere Cache-Assertion wurde deshalb durch Zustands- und ausdrückliche Nichtpersistenzprüfungen ersetzt. Keine Tests oder Testdateien wurden entfernt, übersprungen oder deaktiviert.

## CI

`.github/workflows/frontend-tests.yml` läuft auf Pull Requests, Pushes und manuell. Node 22, `ubuntu-latest`, fünf Minuten Timeout, nur `contents: read`, Checkout ohne persistierte Zugangsdaten. Vollständiger Aufruf: `node --test test/*.test.mjs`. Die Shell nimmt sämtliche vorhandenen fünf Testdateien auf; es gibt keine Namensfilter, Pfadfilter, `continue-on-error`, Secrets oder Deploymentjobs. Derzeit sind keine Paketabhängigkeiten erforderlich.

Die Workflowdatei wurde lokal als YAML gelesen und auf Trigger, Berechtigungen, Nodeversion und vollständigen Testaufruf geprüft. Ein echter GitHub-Actions-Lauf ist erst nach separat freigegebenem Push möglich; er wird hier nicht als erfolgreich behauptet. Ein erforderlicher Statuscheck im Branchschutz ist eine separate Repositoryeinstellung.

## Verifikation nach der Korrektur

| Prüfung | Ergebnis |
|---|---|
| Node 24.19.0: `node --test test/*.test.mjs` | 29 bestanden, 0 fehlgeschlagen, 0 übersprungen; Exitcode 0 |
| Node 22.23.4: identischer Testaufruf | 29 bestanden, 0 fehlgeschlagen, 0 übersprungen; Exitcode 0 |
| Workflow-YAML und `git diff --check` | bestanden |

Node 22 wurde ausserhalb des Repositorys über den npm-Cache bereitgestellt; keine package.json oder Lockdatei angelegt. Reproduzierbarer Lauf mit dem bereitgestellten Tool: `npm exec --offline --yes --package=node@22.23.4 -- node --test test/*.test.mjs`. In CI genügt der direkte Nodeaufruf, da `actions/setup-node` die Laufzeit bereitstellt.

Zusätzlich wurden in sechs temporären Dateikopien absichtlich Regressionen eingefügt und die jeweils betroffenen Tests mit Node 22 ausgeführt. Alle sechs wurden durch Assertions erkannt (Exitcode 1): persistenter Gesamtzustand, falscher zentraler Offline-Erfolg, doppelte Baustelle beim Retry, fehlende ausdrückliche Bestätigung, falscher Vorschautoken, zusätzliches Fremdskript. Die temporären Kopien wurden entfernt; keine Anwendungsdatei im Checkout wurde dafür verändert.

## Verbleibende Fehler und Grenzen

In dieser vollständigen Frontend-Node-Suite verbleiben keine Fehler. Aus den sieben Fehlern ergibt sich kein neuer nachgewiesener Anwendungsfehler; ihre Ursachen liegen in Testloader und überholten Annahmen.

Separat bestehen die bereits dokumentierten Anwendungsthemen weiter: PIN-Erstwechsel im Monteur-Frontend, aktuelle Büroidentität/Sitzungswiderruf, zeitliche Baustellenrechte und einheitliche Dokument-/Uploadberechtigungen. Offlineentwürfe überleben derzeit keinen Seitenneustart; dieser PR verspricht keine persistente Offline-Synchronisierung. Diese Punkte wurden nicht repariert oder umgangen.

Keine Backend-, Firebase-Emulator-, Cloud- oder Browser-E2E-Läufe in dieser Phase. Der früher übermittelte rote Sprach-/Login-E2E-Lauf bleibt ein gesondertes offenes Thema. Node-/VM-Tests ersetzen keinen realen Browserlauf und keine Produktionsfreigabe. Es wurden keine produktiven Netzwerkzugriffe ausgeführt.

Ein unabhängiges abschliessendes Review von Testdiff, Workflow und Nachweisen ergab keine handlungsbedürftigen Befunde. Bestätigt wurden insbesondere der echte No-Cache-Pfad, Bestätigung/Token/Retry, stabile Entwurfs-ID und die vollständige CI-Ausführung.
