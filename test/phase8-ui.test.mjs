import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
function dom(){const ids=new Map();class El{constructor(tag){this.tagName=tag;this.children=[];this.style={};this.events={};this.dataset={};this.value='';this.textContent='';this.hidden=false;}set id(v){this._id=v;ids.set(v,this);}get id(){return this._id;}append(...xs){this.children.push(...xs);}replaceChildren(...xs){this.children=[...xs];}setAttribute(k,v){this[k]=v;}addEventListener(k,f){this.events[k]=f;}all(){return[this,...this.children.filter(x=>x instanceof El).flatMap(x=>x.all())];}click(){return(this.onclick||this.events.click)?.({preventDefault(){}});}focus(){}remove(){this.replaceChildren();}}
 const body=new El('body');return{body,ids,document:{body,readyState:'complete',createElement:t=>new El(t),getElementById:id=>ids.get(id),querySelector:()=>body,addEventListener(){}},el:t=>new El(t)};}
function montage(responses){const d=dom(),calls=[];const ctx={...d,console,URL,Blob,setTimeout:()=>1,clearTimeout(){},MonteurApi:{hasSession:()=>true,messageFor:e=>e.code||e.message,get:async(path,q)=>{calls.push({path,q});return responses.shift();},downloadMontageDocument:async()=>new Blob(['test'])}};ctx.window=ctx;vm.createContext(ctx);const p=new URL('../monteur-montage.js',import.meta.url);if(fs.existsSync(p))vm.runInContext(fs.readFileSync(p,'utf8'),ctx);return{d,ctx,calls};}
test('montage search shows explicit choices and released fields; phone/navigation URLs are fixed safe schemes',async()=>{
 const x=montage([{ok:true,choices:[{id:'a',name:'Jäggi Arlesheim'},{id:'b',name:'Jäggi Zweitauftrag'}]}, {ok:true,kind:'montage',site:{id:'a',name:'Jäggi Arlesheim',adresse:'Testweg Zürich',ansprechpartner:[{name:'Test',telefon:'0610000000'}]},documents:[]}]);
 assert.ok(x.ctx.MonteurMontage);x.ctx.MonteurMontage.open(x.d.body);x.d.ids.get('monteur-montage-search').value='Jägi';await x.d.body.all().find(e=>e.textContent==='Suchen').click();
 assert.equal(x.calls.length,1);await x.d.body.all().find(e=>e.textContent==='Jäggi Arlesheim').click();assert.equal(x.calls[1].q.siteId,'a');
 const links=x.d.body.all().filter(e=>e.tagName==='a');assert.ok(links.some(l=>l.href==='tel:0610000000'));assert.ok(links.some(l=>l.href.startsWith('https://www.google.com/maps/search/?api=1&query=')));
});
test('late montage results after logout/reset do not restore private details or suggestions',async()=>{
 const x=montage([]);assert.ok(x.ctx.MonteurMontage);x.ctx.MonteurMontage.open(x.d.body);let finish;x.ctx.MonteurApi.get=()=>new Promise(r=>finish=r);
 x.d.ids.get('monteur-montage-search').value='Test';const pending=x.d.body.all().find(e=>e.textContent==='Suchen').click();x.ctx.MonteurMontage.reset();finish({ok:true,choices:[{id:'a',name:'STALE PRIVATE'}]});await pending;
 assert.ok(!x.d.body.all().some(e=>e.textContent==='STALE PRIVATE'));
});
function planning(){const d=dom(),calls=[];const entry={maId:'m1',bsId:'s1',notiz:'Original',startzeit:'07:00'};
 const ctx={...d,console,Date,bzSession:{token:'test'},bzGeneration:0,bzLaden:async()=>{},bzAbmelden(){ctx.bzSession=null;},bzCall:async(method,path,body)=>{calls.push({method,path,body});if(path==='/app/admin/features')return{planningEnabled:true};if(method==='GET')return {ok:true,employees:[{id:'m1',name:'Test Eins'}],sites:[{id:'s1',name:'Nord'}],entries:[{date:'2026-11-02',key:'mam1_2026-11-02',entry}],history:[]};return {ok:true};},crypto:{getRandomValues:a=>a.fill(10)}};
 ctx.window=ctx;vm.createContext(ctx);const p=new URL('../office-planning.js',import.meta.url);if(fs.existsSync(p))vm.runInContext(fs.readFileSync(p,'utf8'),ctx);return {d,ctx,calls,entry};}
test('office editor preserves server entry snapshot and requires a second explicit confirmation before removal',async()=>{
 const x=planning();assert.ok(x.ctx.OfficePlanning);await x.ctx.OfficePlanning.open({from:'2026-11-02',to:'2026-11-08',employeeId:'m1'});
 await x.d.body.all().find(e=>e.textContent==='Einsatz bearbeiten').click();await x.d.body.all().find(e=>e.textContent==='Einsatz ausdrücklich entfernen').click();assert.equal(x.calls.filter(c=>c.method==='POST').length,0);
 await x.d.body.all().find(e=>e.textContent==='Änderung verbindlich speichern').click();const save=x.calls.find(c=>c.method==='POST');assert.equal(save.path,'/app/admin/planning/edit');assert.equal(save.body.action,'remove');assert.equal(save.body.confirmation,true);assert.equal(JSON.stringify(save.body.expectedEntry),JSON.stringify(x.entry));
});
test('office logout discards a late planning response',async()=>{
 const x=planning();assert.ok(x.ctx.OfficePlanning);let finish;x.ctx.bzCall=()=>new Promise(r=>finish=r);const pending=x.ctx.OfficePlanning.open({from:'2026-11-02',to:'2026-11-08'});x.ctx.OfficePlanning.reset();finish({ok:true,entries:[{date:'2026-11-02',key:'x',entry:{maId:'m1',bsId:'SECRET'}}],employees:[],sites:[]});await pending;
 assert.ok(!x.d.body.all().some(e=>e.textContent.includes('SECRET')));
});
