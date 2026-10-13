import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const saveSource = html.slice(html.indexOf('function save(opts) {'), html.indexOf('// ── IndexedDB für grosse Dokumente'));
function setup(overrides = {}) {
  const cached = new Map();
  const ctx = vm.createContext({
    state: {baustellen:[{id:123,name:'Gemeinsame Baustelle'}]},
    lagertoolDarfSchreiben: () => true, lagertoolSchreibsperre: () => ({ok:false}),
    stripLargeData: x => x, safeStorage: {setItem:(k,v)=>cached.set(k,v)}, saveDocsToIDB:()=>{},
    dbRef:null, hasReceivedFirebaseSync:false, pendingSaveBeforeSync:false,
    saveKette:Promise.resolve(), pendingSavePromise:null, suppressListener:false,
    showSyncIndicator:()=>{}, setTimeout:fn=>fn(), console, ...overrides
  });
  vm.runInContext(saveSource, ctx);
  return {ctx,cached};
}
test('offline saving retains a local draft but never reports a central save', async () => {
  const {ctx,cached} = setup();
  const result = await ctx.save({verify:true});
  assert.equal(result.ok, false);
  assert.equal(result.verified, false);
  assert.equal(result.localOnly, true);
  assert.equal(JSON.parse(cached.get('lagertool')).baustellen[0].id,123);
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
  vm.runInContext(html.slice(html.indexOf('async function saveBsModal() {'),html.indexOf('\nfunction deleteBs()')),ctx);
  await ctx.saveBsModal();
  const firstId=ctx.state.baustellen[0].id;
  await ctx.saveBsModal();
  assert.equal(ctx.state.baustellen.length,1);
  assert.equal(ctx.state.baustellen[0].id,firstId);
  assert.equal(closed,0);
});
