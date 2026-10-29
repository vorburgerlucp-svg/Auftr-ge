import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const source=readFileSync(new URL('../monteur-documents.js',import.meta.url),'utf8');
test('upload queue preserves order and identifiers across pause and resume, never silently skips failures',async()=>{
 const context={window:{},setInterval:()=>0,document:{readyState:'loading',addEventListener(){}},console};vm.runInNewContext(source,context);
 const {UploadQueue}=context.window.PilotDocuments;const calls=[];let broken=true;
 const api={newRequestId:()=> 'req-'+ 'f'.repeat(24),post:async(p,b)=>p.endsWith('/create')?{batch:{id:'req_test',files:b.files}}:{batch:{id:b.id,status:'ZUORDNUNG_OFFEN'}},uploadBatchFile:async(id,index)=>{calls.push([id,index]);if(index===1&&broken)throw Error('network');return {ok:true};}};
 const queue=new UploadQueue(api);queue.setFiles(Array.from({length:30},(_,i)=>({name:i+'.jpg',size:100,type:'image/jpeg'})));
 await assert.rejects(()=>queue.run(),/network/);assert.equal(queue.index,1);broken=false;await queue.run();assert.equal(queue.index,30);
 assert.deepEqual(calls.slice(0,3).map(x=>x[1]),[0,1,1]);assert.equal(new Set(calls.map(x=>x[0])).size,1);
});
test('unsupported HEIC, excessive quantity and size fail visibly',()=>{
 const c={window:{},setInterval:()=>0,document:{readyState:'loading',addEventListener(){}}};vm.runInNewContext(source,c);const Q=c.window.PilotDocuments.UploadQueue;
 assert.throws(()=>new Q({}).setFiles([{type:'image/heic',size:1}]),/HEIC/);
 assert.throws(()=>new Q({}).setFiles(Array(41).fill({type:'image/png',size:1})),/40/);
 assert.throws(()=>new Q({}).setFiles([{type:'image/png',size:9*1024*1024}]),/8 MB/);
});
test('both protected surfaces load shared inbox, without introducing cloud scripts',()=>{
 for(const f of ['monteur.html','office-pilot.html'])assert.match(readFileSync(new URL('../'+f,import.meta.url),'utf8'),/src="monteur-documents.js"/);
 assert.doesNotMatch(source,/innerHTML|mailto:|localStorage|https:\/\//);
});
