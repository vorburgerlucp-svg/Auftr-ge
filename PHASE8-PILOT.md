# Phase 8 – lokale Erweiterung

Die geschützte Büroansicht verwendet office-planning.js für gezielte Änderungen
am bestehenden LagerTool state.plan. Keine zweite Planung und keine direkte
Firebase-Verbindung. Aus Ferienkonflikten lässt sich der betroffene Zeitraum öffnen.
Verschieben/Umplanen/Entfernen benötigen eine Vorschau und ausdrückliche Bestätigung.
Die serverseitige ETag-Prüfung entscheidet über Quelle/Ziel und protokolliert Änderungen.

Der Monteur-Assistent ergänzt monteur-montage.js: lokale Suche, explizite Auswahl,
freigegebene Montagefelder, Telefon-/Navigationslinks und separat freigegebene Dokumente.
Kein externer KI-Aufruf. Keine lokalen PIN-/Datenbestands-Caches. Reset/Logout schützt
gegen verspätete Antworten. Bestehende normale Baustellen-/Rapportrechte bleiben getrennt.

Die Backend-Flags PILOT_PLANNING_ENABLED und MONTEUR_MONTAGE_ENABLED sind standardmässig
aus. Nur isolierte Test-/Pilotkonfigurationen dürfen sie später einschalten.
Freigabeschema, Testnachweise und Staging-Sperren werden im Backend dokumentiert.
Kein Push, Merge oder Deployment aus diesem Arbeitsschritt.
