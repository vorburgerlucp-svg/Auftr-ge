import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('existing weekly planner journals changed dates with office ID only when vacation workflow is present',()=>{
 const source=html.match(/\/\/ BEGIN VACATION PLAN AUDIT\n([\s\S]*?)\/\/ END VACATION PLAN AUDIT/);assert.ok(source);
 const ctx=vm.createContext({});vm.runInContext(source[1],ctx);
 const before={'2026-11-30':{x:{maId:'m1',bsId:'a'}}};
 const state={ferienAntraege:[{id:'ferien_a'}],plan:{'2026-11-30':{}}};
 ctx.vacationPlanAudit(state,before,'o1','2026-10-29T10:00:00Z');
 assert.equal(state.planAenderungen.length,1);assert.equal(state.planAenderungen[0].by,'o1');assert.equal(state.planAenderungen[0].changes[0].date,'2026-11-30');assert.equal(state.planAenderungen[0].changes[0].before.x.bsId,'a');
 ctx.vacationPlanAudit(state,state.plan,'o1','now');assert.equal(state.planAenderungen.length,1);
 const off={plan:{}};ctx.vacationPlanAudit(off,before,'o1','now');assert.equal(off.planAenderungen,undefined);
});
test('repeated Firebase updater never mutates captured local snapshot or duplicates an uncommitted planning journal',async()=>{
 const audit=html.match(/\/\/ BEGIN VACATION PLAN AUDIT\n([\s\S]*?)\/\/ END VACATION PLAN AUDIT/)[1];
 const source=html.slice(html.indexOf('async function syncMergeSpeichern('),html.indexOf('function save(opts) {'));
 const remote={ferienAntraege:[{id:'f1'}],plan:{'2026-11-30':{x:{maId:'m1',bsId:'s'}}},_ts:1};
 const local=structuredClone(remote);local.plan['2026-11-30']={};const attempts=[];
 const copy=x=>JSON.parse(JSON.stringify(x));
 const ctx=vm.createContext({state:local,syncBase:copy(remote),currentLoginUser:{id:'o1'},stripLargeData:copy,syncKopie:copy,
  syncKanon:x=>JSON.stringify(x),syncMergeStand:(_,l)=>({merged:l,konflikte:[],geaendert:true}),syncStandUebernehmen(){},renderAll(){},console,
  dbRef:{transaction:async updater=>{updater(JSON.stringify(remote));const last=updater(JSON.stringify(remote));attempts.push(JSON.parse(last));return {committed:true,snapshot:{val:()=>last}};}}
 });
 vm.runInContext(audit+'\n'+source,ctx);await ctx.syncMergeSpeichern(false);
 assert.equal(attempts[0].planAenderungen.length,1);assert.equal(local.planAenderungen,undefined);
});
