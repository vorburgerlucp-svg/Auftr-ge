import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function setup(responses){
  const ids=new Map();
  class El{
    constructor(tag){this.tagName=tag;this.children=[];this.events={};this.hidden=false;this.value='';this.textContent='';this.style={};}
    set id(v){this._id=v;ids.set(v,this);}get id(){return this._id;}
    append(...nodes){this.children.push(...nodes);}appendChild(n){this.append(n);return n;}
    replaceChildren(...nodes){this.children=[...nodes];}addEventListener(k,fn){this.events[k]=fn;}
    setAttribute(k,v){this[k]=v;}focus(){}remove(){}click(){return this.events.click?.({preventDefault(){}});}
    all(){return [this,...this.children.filter(c=>c instanceof El).flatMap(c=>c.all())];}
  }
  const body=new El('body'),calls=[],downloads=[];
  const doc={body,readyState:'complete',createElement:t=>new El(t),getElementById:id=>ids.get(id)||null,addEventListener(){}};
  const ctx={document:doc,console,Blob,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},setTimeout:fn=>fn(),
    open:()=>{},addEventListener(){},MonteurApi:{hasSession:()=>true,messageFor:e=>e.message,
      post:async(path,data)=>{calls.push({path,data});const r=responses.shift();if(r instanceof Error)throw r;return r;},
      downloadDocument:async(sid,did)=>{downloads.push([sid,did]);return new Blob(['PDF']);}}};
  ctx.window=ctx;
  vm.createContext(ctx);
  const path=new URL('../monteur-assistant.js',import.meta.url);
  if(fs.existsSync(path))vm.runInContext(fs.readFileSync(path,'utf8'),ctx);
  return {ctx,body,calls,downloads,ids};
}
test('assistant previews report and writes only after the explicit confirmation click',async()=>{
  const x=setup([{ok:true,kind:'report_preview',siteId:'a',report:{siteName:'Nord',workPerformed:'Türen montiert'},draftToken:'signed-preview',reply:'Prüfen'}, {ok:true,kind:'report_saved',reply:'Gespeichert'}]);
  assert.ok(x.ctx.MonteurAssistant,'assistant is installed');
  await x.ctx.MonteurAssistant.ask({tool:'report_draft',args:{siteId:'a'}});
  assert.equal(x.calls.length,1);assert.ok(!x.calls[0].data.confirmation);
  const confirm=x.body.all().find(e=>e.textContent==='Bericht verbindlich speichern');assert.ok(confirm);
  await confirm.click();assert.equal(x.calls.length,2);assert.equal(x.calls[1].data.draftToken,'signed-preview');assert.equal(x.calls[1].data.confirmation,true);
});
test('storage failure stays visible and retains the same confirmation token',async()=>{
  const x=setup([{ok:true,kind:'report_preview',report:{siteName:'Nord',workPerformed:'Text'},draftToken:'same',reply:'Prüfen'},new Error('Speichern fehlgeschlagen'),{ok:true,kind:'report_saved',reply:'Gespeichert'}]);
  assert.ok(x.ctx.MonteurAssistant);await x.ctx.MonteurAssistant.ask({tool:'report_draft'});
  const b=x.body.all().find(e=>e.textContent==='Bericht verbindlich speichern');await b.click();
  assert.ok(x.body.all().some(e=>e.textContent==='Speichern fehlgeschlagen'));await b.click();assert.equal(x.calls[2].data.draftToken,'same');
});
test('ambiguous site choice resends the original function with exactly the selected id',async()=>{
  const x=setup([{ok:true,kind:'choose_site',tool:'site_documents',args:{},choices:[{id:'a',name:'Nord'},{id:'c',name:'Nord 2'}],reply:'Welche?'},{ok:true,kind:'documents',siteId:'a',documents:[],reply:'Keine Dokumente'}]);
  assert.ok(x.ctx.MonteurAssistant);await x.ctx.MonteurAssistant.ask({message:'Zeige mir die Pläne'});
  await x.body.all().find(e=>e.textContent==='Nord').click();assert.equal(x.calls[1].data.tool,'site_documents');assert.equal(x.calls[1].data.args.siteId,'a');
});
test('document names are text and opening uses an authenticated document id',async()=>{
  const x=setup([{ok:true,kind:'documents',siteId:'a',documents:[{id:'d',fileName:'<img onerror=attack>.pdf',documentDate:'2026-10-16',version:2}],reply:'Pläne'}]);
  assert.ok(x.ctx.MonteurAssistant);await x.ctx.MonteurAssistant.ask({message:'Zeige mir die Pläne'});
  const b=x.body.all().find(e=>e.textContent==='Öffnen');await b.click();assert.deepEqual(x.downloads,[['a','d']]);
  assert.ok(x.body.all().some(e=>e.textContent.includes('<img onerror=attack>.pdf')));
});
test('logout reset removes report previews and stale replies cannot restore them',async()=>{
  let resolve;const x=setup([]);assert.ok(x.ctx.MonteurAssistant);
  x.ctx.MonteurApi.post=()=>new Promise(r=>resolve=r);
  const pending=x.ctx.MonteurAssistant.ask({message:'Wo bin ich morgen?'});x.ctx.MonteurAssistant.reset();resolve({ok:true,kind:'help',reply:'STALE'});await pending;
  assert.ok(!x.body.all().some(e=>e.textContent==='STALE'));
});
