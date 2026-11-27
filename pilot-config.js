// Nur Pilot-Testphase. Nur isolierter Test-Worker; niemals produktiven Worker verwenden.
// Nur in diesem GitHub-Pilotbranch. Niemals in den produktiven main-Branch uebernehmen.
window.MONTEUR_TEST_WORKER_URL = window.MONTEUR_TEST_WORKER_URL || 'https://auftragstool-ai-monteur-pilot.vorburgerluc-p.workers.dev';

// Local HTTP is allowed only when the page itself is served from loopback.
window.lagertoolPilotWorkerAllowed = function(value) {
  try {
    const u = new URL(value);
    if (u.origin === 'https://auftragstool-ai.vorburgerluc-p.workers.dev') return false;
    return (u.protocol === 'https:' && /^[a-z0-9.-]+\.workers\.dev$/i.test(u.hostname)) ||
      (u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname) &&
       ['127.0.0.1', 'localhost'].includes(window.location.hostname));
  } catch { return false; }
};
