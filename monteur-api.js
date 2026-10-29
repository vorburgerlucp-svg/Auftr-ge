// Anbindung der Monteur-App an den Worker (/app/monteur/*).
// Sicherheitsregeln dieser Datei:
// - Die Sitzung liegt nur im Speicher dieser Seite. Kein localStorage, kein sessionStorage, kein Cookie.
// - Passwoerter und PINs werden nie gespeichert. Ein Neustart der Seite verlangt eine neue Anmeldung.
// - Schreibvorgaenge tragen eine requestId. Ein Netzwerkfehler wird genau einmal mit derselben
//   requestId wiederholt, damit der Server keine Doppelbuchung erzeugt.
(function (global) {
  'use strict';

  const ERR = {
    invalid_credentials: 'Name oder PIN ist ungültig.',
    locked: 'Die Anmeldung ist vorübergehend gesperrt. Bitte später erneut versuchen.',
    unauthorized: 'Die Sitzung ist abgelaufen. Bitte erneut anmelden.',
    forbidden: 'Dafür fehlt die Berechtigung.',
    network: 'Keine Verbindung zum Server. Bitte Verbindung prüfen und erneut versuchen.',
    service_account_required: 'Der Server ist für diese Funktion noch nicht eingerichtet.',
    session_not_configured: 'Der Server ist für diese Funktion noch nicht eingerichtet.',
    insufficient_stock: 'Nicht genug Bestand vorhanden.',
    werkzeug_in_use: 'Dieses Werkzeug ist bereits ausgegeben.',
    werkzeug_not_available: 'Dieses Werkzeug ist derzeit nicht verfügbar.',
    werkzeug_not_checked_out: 'Dieses Werkzeug ist nicht ausgegeben.',
    wrong_site: 'Die Baustelle ist nicht bekannt.',
    not_found: 'Nicht gefunden.',
    conflict: 'Dieser Vorgang wurde bereits mit anderen Daten gesendet.',
    incomplete: 'Bitte alle Pflichtfelder ausfüllen.',
    assistant_unavailable: 'Der Assistent ist vorübergehend nicht erreichbar. Bitte erneut versuchen.',
    invalid_preview: 'Die Berichtvorschau ist abgelaufen oder ungültig. Bitte erneut prüfen.',
    save_failed: 'Der Bericht wurde nicht als gespeichert bestätigt. Bitte erneut versuchen.',
    verification_failed: 'Die Speicherung konnte nicht bestätigt werden. Bitte den Bericht prüfen.',
    document_not_found: 'Das Dokument fehlt oder ist nicht mehr freigegeben.',
    invalid_date: 'Bitte ein gültiges Datum angeben.'
  };

  class ApiError extends Error {
    constructor(status, code, data) {
      super(ERR[code] || 'Der Vorgang konnte nicht abgeschlossen werden.');
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
      this.data = data;
    }
  }

  let baseUrl = '';
  let token = null;
  let generation = 0;
  function assertCurrent(version) { if (version !== generation) throw new ApiError(401, 'session_changed', null); }
  let onSessionEnd = null;

  function configure(opts) {
    baseUrl = String((opts && opts.baseUrl) || '').replace(/\/+$/, '');
    onSessionEnd = (opts && opts.onSessionEnd) || null;
  }

  function newRequestId() {
    const bytes = new Uint8Array(12);
    global.crypto.getRandomValues(bytes);
    return 'req-' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }

  async function send(path, method, body, query, { retryNetwork = false, keepSessionOn401 = false, binary = false, version = generation } = {}) {
    assertCurrent(version);
    const url = baseUrl + path + (query ? '?' + new URLSearchParams(query).toString() : '');
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = 'Bearer ' + token;
    const init = { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'omit' };
    let res;
    try {
      res = await global.fetch(url, init);
    } catch (e) {
      assertCurrent(version);
      if (retryNetwork) return send(path, method, body, query, { retryNetwork: false, keepSessionOn401, binary, version });
      throw new ApiError(0, 'network', null);
    }
    assertCurrent(version);
    if (res.ok && binary) { const blob = await res.blob(); assertCurrent(version); return blob; }
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    assertCurrent(version);
    if (res.status === 401 && !keepSessionOn401 && token) {
      api.endSession();
      if (onSessionEnd) onSessionEnd();
    }
    if (!res.ok) throw new ApiError(res.status, (data && data.error) || ('http_' + res.status), data);
    return data;
  }

  async function uploadDocument(siteId, file){
    if(!token)throw new ApiError(401,'unauthorized',null);
    if(!file||file.size<1||file.size>8*1024*1024)throw new ApiError(400,'invalid_file_size',null);
    const allowed=new Set(['application/pdf','image/jpeg','image/png','image/webp']);
    if(!allowed.has(file.type))throw new ApiError(415,'unsupported_file_type',null);
    const version=generation;
    const form=new FormData();
    form.append('siteId',String(siteId||''));
    form.append('file',file,file.name);
    form.append('requestId',newRequestId());
    let res;
    try{
      res=await global.fetch(baseUrl+'/app/monteur/upload',{
        method:'POST',headers:{Authorization:'Bearer '+token},body:form,credentials:'omit',cache:'no-store'
      });
    }catch{assertCurrent(version);throw new ApiError(0,'network',null);}
    const data=await res.json().catch(()=>null);
    assertCurrent(version);
    if(res.status===401){api.endSession();if(onSessionEnd)onSessionEnd();}
    if(!res.ok)throw new ApiError(res.status,data?.error||'upload_failed',data);
    return data;
  }

  const api = {
    configure,
    ApiError,
    messageFor(err) {
      if (err && err.code && ERR[err.code]) return ERR[err.code];
      if (err && err.status === 0) return ERR.network;
      return (err && err.message) || 'Unbekannter Fehler.';
    },
    hasSession() { return Boolean(token); },
    endSession() { generation++; token = null; },
    newRequestId,

    // Anmeldung mit Name und PIN. Das Ergebnis ist nur die Sitzung, keine Mitarbeiterdaten.
    async login(name, pin) {
      const version = ++generation;
      const data = await send('/app/monteur/anmelden', 'POST', { name: String(name || ''), pin: String(pin || '') }, null, { keepSessionOn401: true, version });
      if (!data || !data.sessionToken) throw new ApiError(500, 'invalid_response', null);
      token = data.sessionToken;
      return { expiresIn: data.expiresIn, pinWechselPflicht: data.pinWechselPflicht === true };
    },

    async changePin(altPin, neuPin) {
      const result = await send('/app/pin-wechsel', 'POST', { altPin, neuPin }, null, { keepSessionOn401: true, retryNetwork: true });
      api.endSession();
      return result;
    },

    downloadMontageDocument(siteId, documentId) { return send('/app/monteur/montage/document', 'GET', undefined, { siteId, documentId }, { binary: true }); },
    downloadDocument(siteId, documentId) { return send('/app/monteur/dokument', 'GET', undefined, { siteId, documentId }, { binary: true }); },
    uploadDocument,
    get(path, query) { return send(path, 'GET', undefined, query); },
    post(path, body) { return send(path, 'POST', body, null, { retryNetwork: true }); }
  };

  global.MonteurApi = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
