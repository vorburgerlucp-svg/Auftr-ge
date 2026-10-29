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

test('late Firebase sign-in after logout never starts a private database listener',async()=>{
 const a=html.indexOf('function officeFirebaseAnmelden(token) {'),b=html.indexOf('function officeAnmeldungFehlgeschlagen(',a);
 let finish;let started=0,signedOut=0;
 const ctx=vm.createContext({bzGeneration:0,bzSession:{token:'old'},
  firebase:{auth:()=>({signInWithCustomToken:()=>new Promise(r=>finish=r),signOut:async()=>signedOut++})},
  startFirebaseListener(){started++;},officeAnmeldungFehlgeschlagen(){},officeSitzungAbgelaufen(){},console});
 vm.runInContext(html.slice(a,b),ctx);ctx.officeFirebaseAnmelden('synthetic');ctx.bzGeneration++;ctx.bzSession=null;
 finish();await new Promise(r=>setImmediate(r));
 assert.equal(started,0);assert.equal(signedOut,1);
});

test('obsolete first sync cannot finish a new office login',()=>{
 const a=html.indexOf('function officeAnmeldungNachSync() {'),b=html.indexOf('// Ablauf der Firebase-Sitzung',a);
 let finished=0;
 const ctx=vm.createContext({officeWartetAufSync:'o1',officeSyncGeneration:0,bzGeneration:1,bzSession:{token:'new'},
  state:{mitarbeiter:[{id:'o1',admin:true}]},istAdminUser:()=>true,
  finishLogin:()=>finished++,officeAnmeldungFehlgeschlagen(){},firebase:{auth:()=>({signOut:async()=>{}})}});
 vm.runInContext(html.slice(a,b),ctx);ctx.officeAnmeldungNachSync();assert.equal(finished,0);
});

test('office attachment bytes arriving after logout are discarded',async()=>{
 let release;const ctx=load(async()=>({ok:true,status:200,blob:()=>new Promise(r=>release=r),json:async()=>({})}));
 vm.runInContext("bzSession={token:'old'}",ctx);
 const pending=vm.runInContext("bzCall('GET','/app/admin/upload/file',undefined,{binary:true})",ctx);
 await new Promise(r=>setImmediate(r));
 vm.runInContext('bzAbmelden()',ctx);if(release)release({private:true});
 await assert.rejects(pending,e=>e.code==='session_changed');
});
