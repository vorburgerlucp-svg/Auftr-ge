# Monteur-App – separate Chatbot-Testphase

Diese Branch enthält die Frontend-Version des Chatbots, die mit dem
Backend-Branch `pilot/monteur-chatbot-test-20261023` zusammenpasst.

**Nicht produktiv veröffentlicht.** Die öffentliche Stamm-Seite über GitHub Pages bleibt auf dem bisherigen Stand.
Die Pilot-App verlangt ausdrücklich eine eigene HTTPS-`workers.dev`-Adresse in
`pilot-config.js` und verweigert den Login, solange dieser Wert leer ist oder
auf den produktiven Worker zeigt.

Nur mit einem separaten Test-Worker und Test-Firebase-Projekt bereitstellen.
GitHub Pages des bestehenden `Auftr-ge`-Repos NICHT auf diese Branch als
Publishing Source umstellen – sonst würde der laufende Dienst überschrieben.
Verwende separate Preview-/Staging-Hosting-Konfiguration mit eigenem Link.

Funktionen: Antworten aus eigenen LagerTool-Baustellen, IDs und
`excelAliases` (Adresse, Montage, Startzeit, explizit freigegebene
Projektkontakte), eigener Wochenplan und Kollegen, Dokumentfreigabe,
Berichte mit prüfbarer Vorschau. Es gibt keinen externen KI-Modellaufruf
für diese gewöhnlichen Fragen.

**Pilot-Abnahme:** echtes Login mit TEST-PIN, zwei berechtigte Aufträge,
gleichnamige fremde Baustelle, Datumsgrenzen, telefonische Freigaben,
unfreigegebene Dokumente, Logout, eindeutige Auftrags-IDs,
kein Schreiben in Produktion. Nach jeder Änderung CI erneut laufen lassen.

## Ergänzung 28.10.2026: Rapporte als eigene Büro-Rubrik

- Eigener Menüpunkt **📋 Rapporte** im Büro-Frontend; Baustellenmeldungen verbleiben getrennt unter **Meldungen**.
- Alle Rapporte können nach Baustelle oder Verfasser gefiltert werden. Pro Rapport: Baustelle, Arbeitstag, Arbeitszeit, Tätigkeiten, optionale Material-/Problemfelder, **Einreicher mit Mitarbeiter-ID**, **Abgabezeitpunkt** und **Rapport-ID**.
- Der Name wird bei der Einreichung serverseitig aus dem authentifizierten Mitarbeiterdatensatz übernommen und als unveränderliche Momentaufnahme gespeichert. So bleibt der Einreicher nach späteren Namens-/Personalstammänderungen erkennbar. Für Altberichte ohne Namens-Snapshot wird die Mitarbeiter-ID gegen den aktuellen Mitarbeiterstamm aufgelöst (sonst ID als Kennzeichnung).
- Berichte liegen bereits unabhängig von Baustellenmeldungen unter `monteurReports` in R2; kein Schreiben in den gemeinsamen Firebase-Wochenplan. Die Büroansicht ist nur mit gültiger Büro-Sitzung abrufbar.
- Rückfragen gehen an den eindeutig angezeigten Monteur; kein automatischer Versand von Nachrichten oder private Telefonnummern in dieser Erweiterung.
- Bis zum Cloud-Pilot und dessen Abnahme nur im Branch `pilot/monteur-chatbot-test-20261023`; die laufende Produktion bleibt unverändert.
