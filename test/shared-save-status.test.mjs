import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
// Grenzen an Funktionsdeklarationen pruefen: entfernte Kommentare duerfen nicht
// versehentlich den restlichen HTML-Inhalt an vm.runInContext weiterreichen.
function sourceBetween(start, end) {
  const begin = html.indexOf(start);
  assert.ok(begin >= 0, `Start der Testfunktion fehlt: ${start}`);
  const finish = html.indexOf(end, begin + start.length);
  assert.ok(finish > begin, `Ende der Testfunktion fehlt: ${end}`);
  return html.slice(begin, finish);
}
const saveSource = sourceBetween('function save(opts) {', 'function saveDocsToIDB(s)');
const noCacheSource = sourceBetween('function lagertoolKeinCache()', 'function bereinigeAltbestaende()');
function setup(overrides = {}) {
  const storageWrites = [];
  const storage = {setItem:(...args)=>storageWrites.push(args)};
  const ctx = vm.createContext({
    state: {baustellen:[{id:123,name:'Gemeinsame Baustelle'}]},
    lagertoolDarfSchreiben: () => true, lagertoolSchreibsperre: () => ({ok:false}),
    stripLargeData: x => x, safeStorage:storage, localStorage:storage, sessionStorage:storage,
    saveDocsToIDB:()=>{},
    dbRef:null, hasReceivedFirebaseSync:false, pendingSaveBeforeSync:false,
    saveKette:Promise.resolve(), pendingSavePromise:null, suppressListener:false,
    showSyncIndicator:()=>{}, setTimeout:fn=>fn(), console, ...overrides
  });
  // Der echte Pilot deaktiviert den persistenten Gesamtzustands-Cache. Diesen
  // Sicherheitsentscheid nicht durch einen speichernden Testdouble ersetzen.
  vm.runInContext(noCacheSource + '\n' + saveSource, ctx);
  return {ctx,storageWrites};
}
test('offline saving retains an in-memory draft without persistence or a central success', async () => {
  const {ctx,storageWrites} = setup();
  const result = await ctx.save({verify:true});
  assert.equal(result.ok, false);
  assert.equal(result.verified, false);
  assert.equal(result.localOnly, true);
  assert.equal(ctx.state.baustellen.length,1);
  assert.equal(ctx.state.baustellen[0].id,123);
  assert.equal(ctx.state.baustellen[0].name,'Gemeinsame Baustelle');
  assert.deepEqual(storageWrites,[],'kein Gesamtzustand in persistentem Browserstorage');
});
test('first sync still pending does not report success', async () => {
  const {ctx} = setup({dbRef:{}});
  assert.equal((await ctx.save({verify:true})).ok,false);
  assert.equal(ctx.pendingSaveBeforeSync,true);
});
test('verified central saving still succeeds', async () => {
  const {ctx} = setup({dbRef:{},hasReceivedFirebaseSync:true,syncMergeSpeichern:async()=>({ok:true,verified:true})});
  const result=await ctx.save({verify:true});
  assert.equal(result.ok,true);
  assert.equal(result.verified,true);
});

test('retrying a new site offline keeps one draft and its original identity', async () => {
  const fields=new Map();
  const getElementById=id=>{
    if(!fields.has(id)) fields.set(id,{value:id==='bs-name'?'Testbaustelle':'',classList:{contains:()=>false}});
    return fields.get(id);
  };
  let tick=1000, closed=0;
  const {ctx}=setup({state:{baustellen:[]},document:{getElementById},window:{},
    Date:{now:()=>++tick},maIdValue:x=>x,bsGetTeamIds:()=>[],
    selectedBsHex:'',tempBsDocs:[],tempBsTasks:[],bsPruefeHotelBedarf:async()=>{},
    bsNotizMitAufgebot:x=>x,bsUmdisponierePlan:()=>[],excelNachAbgleich:()=>({verknuepft:0}),
    toast:()=>{},closeBsModal:()=>closed++
  });
  vm.runInContext(sourceBetween('async function saveBsModal() {','function deleteBs()'),ctx);
  await ctx.saveBsModal();
  const firstId=ctx.state.baustellen[0].id;
  await ctx.saveBsModal();
  assert.equal(ctx.state.baustellen.length,1);
  assert.equal(ctx.state.baustellen[0].id,firstId);
  assert.equal(closed,0);
});
