import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('const BZ_WORKER ='),end=html.indexOf('// Statuswechsel.',start);
function load(fetch){
 const ctx=vm.createContext({window:{MONTEUR_TEST_WORKER_URL:'https://pilot.example.workers.dev'},fetch,
  document:{getElementById:()=>({value:'Test',style:{}})},bzRender(){},officeSitzungAbgelaufen(){ctx.revoked++;},revoked:0});
 vm.runInContext(html.slice(start,end),ctx);return ctx;
}
const json=(status,body)=>({status,ok:status===200,json:async()=>body});
test('office data arriving after logout cannot repopulate private reports',async()=>{
 const pending=[];const ctx=load(()=>new Promise(r=>pending.push(r)));
 vm.runInContext("bzSession={token:'old'}",ctx);const request=vm.runInContext('bzLaden()',ctx);
 vm.runInContext('bzAbmelden()',ctx);pending.forEach(r=>r(json(200,{meldungen:[],rapporte:[{id:'private'}]})));await request;
 assert.equal(vm.runInContext('bzDaten.rapporte.length',ctx),0);
});
test('revoked office session clears all data and ends the main office login',async()=>{
 const ctx=load(async()=>json(401,{error:'unauthorized'}));
 vm.runInContext("bzSession={token:'old'};bzDaten.rapporte=[{id:'private'}]",ctx);
 await assert.rejects(vm.runInContext("bzCall('GET','/app/admin/rapporte')",ctx));
 assert.equal(vm.runInContext('bzSession',ctx),null);assert.equal(vm.runInContext('bzDaten.rapporte.length',ctx),0);assert.equal(ctx.revoked,1);
});
