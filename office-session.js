// Gemeinsame Sitzungslogik fuer alle Büro-Anmeldewege (index.html, office-pilot.html, office-comms.js).
// Nur Zeitsteuerung und Synchronisation zwischen Tabs: keine Anmeldung, keine Daten, keine Firebase-Verbindung.
//
// Massgeblich ist der exp-Wert des vom Backend ausgestellten officeSession-Tokens (absolute Sekunden).
// Die Grenze wird nie durch Rendern, Firebase-Token-Erneuerung oder Timer-Neustarts verlaengert.
// Ohne lesbares exp gilt expiresIn (begrenzt auf acht Stunden). Ist beides unbrauchbar, wird abgelehnt.
//
// Tab-Synchronisation (BroadcastChannel): Es werden NUR Ereignisart und Zeitpunkt gesendet, nie Tokens,
// Namen oder Daten. Ein Logout in einem Tab beendet die Sitzungen aller Büro-Tabs in diesem Browserprofil,
// die VOR dem Logout begonnen haben. Eine spaetere Anmeldung wird von alten Ereignissen nicht beendet.
// Das ist keine serverseitige Token-Revokation: Das Token bleibt bis zu seinem Ablauf gueltig.
//
// Die Seite setzt OfficeSession.onEnd(grund). grund ist 'expired' (Ablauf) oder 'remote-logout'
// (Logout in einem anderen Tab). Ein manueller Logout ruft OfficeSession.logout() auf und bereinigt selbst.
(function (global) {
  'use strict';
  const MAX_S = 8 * 3600;
  const TOLERANZ_MS = 10 * 60 * 1000;          // zulaessige Abweichung der Ablaufzeit (Uhr, Rundung)
  const B64URL = /^[A-Za-z0-9_-]+$/;
  const PRUEF_MS = 30 * 1000;
  const KANAL = 'lagertool-buero-sitzung';
  let ende = 0;          // ms seit Epoche; 0 = keine Sitzung
  let begonnen = 0;      // Zeitpunkt des Sitzungsbeginns in diesem Tab
  let ident = null;
  let nr = 0;            // zaehlt Starts und Stopps; veraltete Timer erkennen sich daran
  let timer = null;
  let pruefer = null;

  // Ablaufzeitpunkt aus dem Backend-Token. Format des Backends: base64url(Claims).base64url(HMAC), genau zwei Teile.
  // Hinweis: Die Signatur wird hier NICHT geprueft. Die Claims dienen nur der Oberflaeche. Der Worker prueft jede
  // Anfrage selbst und ist fuer die Authentifizierung zustaendig.
  // Fail-closed: Jede Unklarheit ergibt 0 (keine Sitzung). Ein Fallback auf expiresIn gibt es NICHT, weil
  // expiresIn nur eine relative, ungesicherte Dauer ab der Geraeteuhr ist.
  // Liefert den Ende-Zeitpunkt in ms seit Epoche oder 0.
  function sitzungsEnde(token, expiresIn, jetzt) {
    if (typeof token !== 'string') return 0;
    const teile = token.split('.');
    if (teile.length !== 2) return 0;                       // kein Dreiteiler, keine JWT-Annahme
    if (!B64URL.test(teile[0]) || !B64URL.test(teile[1]) || teile[1].length === 0) return 0;
    let claims;
    try {
      const b64 = teile[0].replace(/-/g, '+').replace(/_/g, '/');
      claims = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
    } catch (_) { return 0; }
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return 0;
    if (!Number.isSafeInteger(claims.exp) || claims.exp <= 0) return 0;
    const expMs = claims.exp * 1000;
    if (expMs <= jetzt) return 0;                           // bereits abgelaufen
    if (expMs - jetzt > MAX_S * 1000 + TOLERANZ_MS) return 0; // unplausibel weit in der Zukunft
    let ende = expMs;
    if (expiresIn !== undefined) {
      // Widerspruch: die frueher gueltige Grenze gilt. expiresIn darf nie verlaengern.
      const s = Number(expiresIn);
      if (typeof expiresIn === 'boolean' || !Number.isFinite(s) || s <= 0 || s > MAX_S) return 0;
      ende = Math.min(ende, jetzt + s * 1000);
    }
    return ende > jetzt ? ende : 0;
  }

  function stopTimers() {
    if (timer) clearTimeout(timer);
    if (pruefer) clearInterval(pruefer);
    timer = null; pruefer = null;
  }

  // Beendet die Zeitsteuerung in diesem Tab. Veraltete Timer werden ungueltig. Ruft keine Seitenfunktion auf.
  function clear() {
    nr++;
    stopTimers();
    ende = 0;
    begonnen = 0;
  }

  function expired() {
    return ende > 0 && Date.now() >= ende;
  }

  function aktiv() {
    return ende > 0 && Date.now() < ende;
  }

  // Nicht umkehrbare Kennung des Mitarbeiters aus dem Anspruch sub des Tokens. Nur ein Hash, kein Klartext.
  // Dient ausschliesslich dazu, Ereignisse einem Mitarbeiter zuzuordnen. Sie ist kein Geheimnis und kein Berechtigungsnachweis.
  function identKey(token) {
    try {
      const teil = String(token).split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
      const sub = JSON.parse(atob(teil + '='.repeat((4 - (teil.length % 4)) % 4))).sub;
      if (typeof sub !== 'string' || sub.length === 0) return null;
      let h1 = 0x811c9dc5, h2 = 0x01000193;
      for (let i = 0; i < sub.length; i++) {
        h1 = Math.imul(h1 ^ sub.charCodeAt(i), 0x01000193) >>> 0;
        h2 = Math.imul(h2 ^ sub.charCodeAt(i), 0x5bd1e995) >>> 0;
      }
      return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
    } catch (_) { return null; }
  }

  // Sendet nur Ereignisart, Zeitpunkt und die Mitarbeiterkennung (Hash). Kein Token, kein Name, keine Daten.
  function senden(t) {
    try { if (kanal) kanal.postMessage({ t, at: Date.now(), k: ident }); } catch (_) { /* Synchronisation nicht verfuegbar */ }
  }

  function melde(grund) {
    const cb = global.OfficeSession.onEnd;
    if (typeof cb === 'function') cb(grund);
  }

  // Prueft gegen die Uhr. Ruft onEnd('expired') genau einmal pro Ablauf auf und informiert andere Tabs.
  function pruefen() {
    if (!ende || Date.now() < ende) return false;
    clear();
    senden('expired');
    melde('expired');
    return true;
  }

  // Manueller Logout: informiert andere Tabs, beendet dann die lokale Zeitsteuerung. Die Seite bereinigt selbst.
  function logout() {
    if (ident) senden('logout');
    clear();
    ident = null;
  }

  // Startet eine Sitzung. false = keine gueltige Laufzeit, die Anmeldung ist abzulehnen.
  function start(token, expiresIn) {
    const e = sitzungsEnde(token, expiresIn, Date.now());
    if (!e) return false;
    clear();
    ident = identKey(token);
    ende = e;
    begonnen = Date.now();
    const mine = nr;
    // Der Timer ist nur der fruehe Ausloeser. Massgeblich ist der Vergleich mit der Uhr in pruefen(),
    // denn Browser verzoegern Timer im Ruhezustand.
    timer = setTimeout(() => { if (mine === nr) pruefen(); }, Math.min(Math.max(0, e - Date.now()), 2147483647));
    pruefer = setInterval(() => { if (mine === nr) pruefen(); }, PRUEF_MS);
    return true;
  }

  // Nachricht aus einem anderen Tab. Nur bekannte Ereignisarten mit Zeitpunkt werden beachtet.
  function empfangen(msg) {
    if (!msg || typeof msg !== 'object' || typeof msg.at !== 'number') return;
    if (msg.t === 'expired') { pruefen(); return; }
    if (msg.t === 'logout') {
      // Nur derselbe Mitarbeiter. Ein Ereignis eines anderen Mitarbeiters im selben Profil wird ignoriert.
      if (!ident || msg.k !== ident) return;
      // Veraltetes Ereignis: nur Sitzungen, die vor dem Logout begonnen haben, werden beendet.
      if (!aktiv() || !(begonnen < msg.at)) return;
      clear();
      melde('remote-logout');
    }
  }

  let kanal = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      kanal = new BroadcastChannel(KANAL);
      kanal.onmessage = ev => empfangen(ev && ev.data);
    }
  } catch (_) { kanal = null; }

  // Wiederaufnahme nach Ruhezustand, Tab-Wechsel oder Netzwechsel: sofort gegen die Uhr pruefen.
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', () => pruefen());
  }
  if (typeof window !== 'undefined' && window.addEventListener) {
    ['focus', 'pageshow', 'online'].forEach(ev => window.addEventListener(ev, () => pruefen()));
  }

  // Serverseitiger Widerruf: POST /app/office/logout. Liefert genau einen von drei Werten:
  //   'ok'        Antwort 200 mit ok:true. Nur das gilt als bestätigter Widerruf.
  //   'ungueltig' Antwort 401. Die Sitzung war schon widerrufen oder abgelaufen. Kein Hinweis nötig.
  //   'fehler'    alle anderen Antworten, Netzwerkfehler und das Zeitlimit. Nie als Widerruf anzeigen.
  // Das Zeitlimit verhindert, dass ein hängender Aufruf die lokale Bereinigung blockiert.
  function serverLogout(baseUrl, token, opts) {
    const timeoutMs = opts && Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 3000;
    const f = (opts && opts.fetchImpl) || (typeof fetch === 'function' ? fetch : null);
    if (!baseUrl || !token || !f) return Promise.resolve('fehler');
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    let timer = null;
    const zeitlimit = new Promise(resolve => {
      timer = setTimeout(() => { if (ctrl) ctrl.abort(); resolve('fehler'); }, timeoutMs);
    });
    const antwort = Promise.resolve().then(() => f(String(baseUrl) + '/app/office/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: '{}', cache: 'no-store', credentials: 'omit', keepalive: true,
      signal: ctrl ? ctrl.signal : undefined,
    })).then(async res => {
      if (res.status === 401) return 'ungueltig';
      if (res.status !== 200) return 'fehler';
      const body = await res.json().catch(() => null);
      if (!(body && body.ok === true)) return 'fehler';
      // Der Server hat widerrufen. Der Firebase-Spiegel kann noch ausstehen: dann nicht als vollständig melden.
      return body.firebaseSync === 'ok' ? 'ok' : 'ok-spiegel-offen';
    }).catch(() => 'fehler');
    return Promise.race([antwort, zeitlimit]).then(v => { clearTimeout(timer); return v; });
  }
  // Hinweis nur bei nicht bestätigtem Server-Widerruf. Bei 'ok' und 'ungueltig' bleibt die Anzeige ruhig.
  function logoutHinweis(ergebnis) {
    if (ergebnis === 'fehler') return 'logout-unbestaetigt';
    if (ergebnis === 'ok-spiegel-offen') return 'logout-spiegel-offen';
    return null;
  }

  // Hinweis nach dem Neuladen. Nur ein fester Code wird gespeichert, nie Name, Token oder Daten.
  // Der Code wird beim Lesen sofort entfernt, damit der Hinweis nur einmal erscheint.
  const HINWEISE = Object.freeze({
    'abgelaufen': 'Deine Büro-Sitzung ist abgelaufen. Bitte melde dich erneut an.',
    'anderer-tab': 'Deine Büro-Sitzung wurde in einem anderen Tab beendet. Bitte melde dich erneut an.',
    'pin-gewechselt': 'Deine PIN wurde geändert. Bitte melde dich mit der neuen PIN erneut an.',
    'ungueltig': 'Deine Büro-Sitzung ist nicht mehr gültig. Bitte melde dich erneut an.',
    'logout-unbestaetigt': 'Du bist auf diesem Gerät abgemeldet. Die Abmeldung auf dem Server konnte nicht bestätigt werden.',
    'logout-spiegel-offen': 'Du bist abgemeldet. Der Widerruf auf dem Server ist bestätigt. Die Aktualisierung des Firebase-Zugriffs steht noch aus und endet spätestens mit der Büro-Berechtigung.',
  });
  const HINWEIS_KEY = 'lagertool_hinweis';
  function hinweisSetzen(code) {
    if (!Object.prototype.hasOwnProperty.call(HINWEISE, code)) return;
    try { sessionStorage.setItem(HINWEIS_KEY, code); } catch (_) { /* kein Speicher: kein Hinweis */ }
  }
  function hinweisLesen() {
    try {
      const code = sessionStorage.getItem(HINWEIS_KEY);
      sessionStorage.removeItem(HINWEIS_KEY);
      return Object.prototype.hasOwnProperty.call(HINWEISE, code) ? HINWEISE[code] : null;
    } catch (_) { return null; }
  }

  global.OfficeSession = {
    start, clear, pruefen, expired, aktiv, logout, hinweisSetzen, hinweisLesen, serverLogout, logoutHinweis,
    hinweise: HINWEISE,
    deadline: () => ende,
    syncAvailable: () => kanal !== null,
    onEnd: null,
    _empfangen: empfangen,          // nur fuer Tests: Nachricht ohne Kanal zustellen
  };
})(typeof window !== 'undefined' ? window : globalThis);
