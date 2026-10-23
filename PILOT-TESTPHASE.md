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
