import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../monteur-api.js', import.meta.url), 'utf8');

// Laedt die Datei wie im Browser: window ist das Kontext-Objekt. Storage wirft, damit jede
// Nutzung auffaellt.
function load(fetchImpl) {
  const storageTrap = () => { throw new Error('storage_used'); };
  const ctx = {
    fetch: fetchImpl,
    crypto: globalThis.crypto,
    localStorage: { setItem: storageTrap, getItem: storageTrap, removeItem: storageTrap },
    sessionStorage: { setItem: storageTrap, getItem: storageTrap, removeItem: storageTrap },
    console,
    URLSearchParams,
    JSON,
    Uint8Array,
    Array,
    Error,
    Promise
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx.MonteurApi;
}

function jsonRes(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('document download uses the existing session and returns binary data', async () => {
  let seen;
  const api=load(async(url,init)=>{
    if(url.endsWith('/anmelden'))return jsonRes(200,{sessionToken:'document-session'});
    seen={url,init};return new Response('PDF bytes',{headers:{'Content-Type':'application/pdf'}});
  });
  api.configure({baseUrl:'https://w.test'});await api.login('x','1234');
  assert.equal(typeof api.downloadDocument,'function');
  const blob=await api.downloadDocument('site a','doc/1');
  assert.equal(await blob.text(),'PDF bytes');assert.equal(seen.init.headers.Authorization,'Bearer document-session');
  assert.equal(seen.url,'https://w.test/app/monteur/dokument?siteId=site+a&documentId=doc%2F1');
});

test('denied document download never produces a blob',async()=>{
  const api=load(async url=>url.endsWith('/anmelden')?jsonRes(200,{sessionToken:'t'}):jsonRes(404,{error:'document_not_found'}));
  await api.login('x','1234');assert.equal(typeof api.downloadDocument,'function');
  await assert.rejects(api.downloadDocument('a','private'),e=>e.code==='document_not_found');
});

test('login keeps the session only in memory and never touches browser storage', async () => {
  const api = load(async () => jsonRes(200, { ok: true, sessionToken: 'tok-1', expiresIn: 28800 }));
  const r = await api.login('Patrick Härter', '4821');
  assert.equal(r.expiresIn, 28800);
  assert.equal(api.hasSession(), true);
});

test('wrong credentials give the generic message and do not end an existing session', async () => {
  let ended = 0;
  const api = load(async () => jsonRes(401, { ok: false, error: 'invalid_credentials' }));
  api.configure({ baseUrl: 'https://w.test', onSessionEnd: () => ended++ });
  await assert.rejects(api.login('Unbekannt', '0000'), err => {
    assert.equal(err.code, 'invalid_credentials');
    assert.equal(api.messageFor(err), 'Name oder PIN ist ungültig.');
    return true;
  });
  assert.equal(ended, 0);
  assert.equal(api.hasSession(), false);
});

test('bearer token is sent with authenticated requests', async () => {
  const seen = [];
  const api = load(async (url, init) => {
    seen.push({ url, init });
    if (url.endsWith('/anmelden')) return jsonRes(200, { ok: true, sessionToken: 'tok-2' });
    return jsonRes(200, { ok: true, sites: [] });
  });
  api.configure({ baseUrl: 'https://w.test/' });
  await api.login('x', '1234');
  await api.get('/app/monteur/sites');
  assert.equal(seen[1].init.headers.Authorization, 'Bearer tok-2');
  assert.equal(seen[1].url, 'https://w.test/app/monteur/sites');
});

test('expired session ends the local session once and reports it', async () => {
  let ended = 0;
  const api = load(async (url) => {
    if (url.endsWith('/anmelden')) return jsonRes(200, { ok: true, sessionToken: 'tok-3' });
    return jsonRes(401, { ok: false, error: 'unauthorized' });
  });
  api.configure({ baseUrl: 'https://w.test', onSessionEnd: () => ended++ });
  await api.login('x', '1234');
  await assert.rejects(api.get('/app/monteur/profil'), err => err.status === 401);
  assert.equal(ended, 1);
  assert.equal(api.hasSession(), false);
});

test('network failure on a write is retried once with the same request id', async () => {
  const bodies = [];
  let calls = 0;
  const api = load(async (url, init) => {
    if (url.endsWith('/anmelden')) return jsonRes(200, { ok: true, sessionToken: 'tok-4' });
    calls++;
    bodies.push(JSON.parse(init.body));
    if (calls === 1) throw new TypeError('network down');
    return jsonRes(201, { ok: true, duplicate: false });
  });
  api.configure({ baseUrl: 'https://w.test' });
  await api.login('x', '1234');
  const body = { items: [{ artikelId: 'a1', menge: 1 }], requestId: api.newRequestId() };
  const r = await api.post('/app/monteur/bestellung', body);
  assert.equal(r.ok, true);
  assert.equal(calls, 2);
  assert.equal(bodies[0].requestId, bodies[1].requestId);
});

test('a second network failure is reported, not retried forever', async () => {
  let calls = 0;
  const api = load(async (url) => {
    if (url.endsWith('/anmelden')) return jsonRes(200, { ok: true, sessionToken: 'tok-5' });
    calls++;
    throw new TypeError('down');
  });
  api.configure({ baseUrl: 'https://w.test' });
  await api.login('x', '1234');
  await assert.rejects(api.post('/app/monteur/meldung', { requestId: 'req-x-0000001' }), err => {
    assert.equal(err.code, 'network');
    assert.equal(api.messageFor(err), 'Keine Verbindung zum Server. Bitte Verbindung prüfen und erneut versuchen.');
    return true;
  });
  assert.equal(calls, 2);
});

test('client error is not retried and maps to a German message', async () => {
  let calls = 0;
  const api = load(async (url) => {
    if (url.endsWith('/anmelden')) return jsonRes(200, { ok: true, sessionToken: 'tok-6' });
    calls++;
    return jsonRes(409, { ok: false, error: 'insufficient_stock', verfuegbar: 0 });
  });
  api.configure({ baseUrl: 'https://w.test' });
  await api.login('x', '1234');
  await assert.rejects(api.post('/app/monteur/materialentnahme', { requestId: 'req-y-0000001' }), err => {
    assert.equal(api.messageFor(err), 'Nicht genug Bestand vorhanden.');
    return true;
  });
  assert.equal(calls, 1);
});

test('request ids are unique and well formed', () => {
  const api = load(async () => jsonRes(200, {}));
  const ids = new Set(Array.from({ length: 50 }, () => api.newRequestId()));
  assert.equal(ids.size, 50);
  for (const id of ids) assert.match(id, /^req-[0-9a-f]{24}$/);
});

test('first login exposes PIN requirement, change ends session and requires a new login',async()=>{
 const seen=[];
 const api=load(async(url,init)=>{seen.push({url,init});return jsonRes(200,url.endsWith('/anmelden')?{sessionToken:'restricted',pinWechselPflicht:true}:{ok:true});});
 assert.equal((await api.login('Test','1234')).pinWechselPflicht,true);
 await api.changePin('1234','5678');
 assert.equal(api.hasSession(),false);
 assert.equal(seen[1].url,'/app/pin-wechsel');
 assert.equal(seen[1].init.headers.Authorization,'Bearer restricted');
});
test('late login after logout cannot restore a session',async()=>{
 let release;const api=load(()=>new Promise(r=>release=r));
 const pending=api.login('Test','1234');api.endSession();release(jsonRes(200,{sessionToken:'late'}));
 await assert.rejects(pending,e=>e.code==='session_changed');assert.equal(api.hasSession(),false);
});
test('late data after logout is discarded',async()=>{
 let release;const api=load(async url=>url.endsWith('/anmelden')?jsonRes(200,{sessionToken:'t'}):new Promise(r=>release=r));
 await api.login('Test','1234');const pending=api.get('/app/monteur/sites');api.endSession();release(jsonRes(200,{sites:[{id:'private'}]}));
 await assert.rejects(pending,e=>e.code==='session_changed');
});
test('late 401 cannot terminate a newer login',async()=>{
 let release;const api=load(async url=>url.endsWith('/anmelden')?jsonRes(200,{sessionToken:'new'}):new Promise(r=>release=r));
 await api.login('Test','1234');const pending=api.get('/app/monteur/sites');await api.login('Test','5678');release(jsonRes(401,{error:'unauthorized'}));
 await assert.rejects(pending,e=>e.code==='session_changed');assert.equal(api.hasSession(),true);
});
test('network failure after logout is not retried with a new identity',async()=>{
 let reject,requests=0;const api=load(async url=>{if(url.endsWith('/anmelden'))return jsonRes(200,{sessionToken:'t'});requests++;return new Promise((_,r)=>reject=r);});
 await api.login('Test','1234');const pending=api.post('/save',{requestId:'same'});api.endSession();reject(Error('offline'));
 await assert.rejects(pending,e=>e.code==='session_changed');assert.equal(requests,1);
});
