// Nur Pilot-Testphase. Standard: kein Server, kein Login.
// Die E2E-Tests dürfen vor dem Laden der Seite eine ausschliesslich lokal
// abgefangene Test-Worker-URL einspeisen. Sonst bleibt die URL leer.
// Nach Bereitstellung eines separaten Test-Workers dessen URL eintragen.
window.MONTEUR_TEST_WORKER_URL = window.MONTEUR_TEST_WORKER_URL || '';
