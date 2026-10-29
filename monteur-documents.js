// Shared private inbox and resumable upload queue. Credentials remain in the existing session adapters.
(function(global){
'use strict';
const MAX=8*1024*1024,TOTAL=16*1024*1024;
class UploadQueue{
 constructor(api,changed=()=>{}){this.api=api;this.changed=changed;this.files=[];this.index=0;this.paused=false;this.batch=null;this.requestId=null;this.running=false;}
 setFiles(files,batch=null){
  if(this.running)throw Error('Upload läuft. Zuerst unterbrechen.');
  files=Array.from(files);if(!files.length||files.length>40)throw Error('Bitte 1 bis 40 Dateien auswählen.');
  for(const f of files){if(!['image/jpeg','image/png','application/pdf'].includes(f.type))throw Error('JPG, PNG oder PDF wählen. HEIC wird derzeit nicht sicher unterstützt.');if(f.size<1||f.size>MAX)throw Error('Maximal 8 MB pro Datei.');}
  if(files.reduce((s,f)=>s+f.size,0)>TOTAL)throw Error('Maximal 16 MB pro Sitzung.');
  if(batch&&(batch.files.length!==files.length||batch.files.some((f,i)=>f.name!==String(files[i].name||'Dokument').replace(/[\\/\x00-\x1f<>:"|?*]/g,'_').slice(0,120)||f.size!==files[i].size||f.mime!==files[i].type)))throw Error('Für Wiederaufnahme dieselben Dateien in derselben Reihenfolge auswählen.');
  this.files=files;this.batch=batch;this.index=0;this.requestId=null;this.paused=false;
 }
 pause(){this.paused=true;}
 async run(){
  if(this.running)return;this.running=true;this.paused=false;
  try{
   if(!this.batch){this.requestId=this.requestId||this.api.newRequestId();this.batch=(await this.api.post('/app/monteur/batches/create',{requestId:this.requestId,files:this.files.map(f=>({name:f.name,size:f.size,mime:f.type}))})).batch;}
   while(this.index<this.files.length&&!this.paused){
    await this.api.uploadBatchFile(this.batch.id,this.index,this.files[this.index]);this.index++;this.changed(this.index,this.files.length);
   }
   if(this.paused)return {paused:true,batch:this.batch};
   const result=await this.api.post('/app/monteur/batches/process',{id:this.batch.id});this.batch=result.batch;return result;
  }finally{this.running=false;}
 }
}
let generation=0,sessionKey=null,root=null,launcher=null,enabled=false,queue=null;
const node=(tag,text)=>{const e=document.createElement(tag);if(text!=null)e.textContent=String(text);return e;};
const btn=(text,fn)=>{const b=node('button',text);b.type='button';b.onclick=fn;return b;};
function adapter(){
 const office=typeof bzSession!=='undefined'&&bzSession;
 if(office)return {key:office,prefix:'/app/admin',get:(p,q)=>bzCall('GET',p+(q?'?'+new URLSearchParams(q):'')),post:(p,b)=>bzCall('POST',p,b),download:p=>bzCall('GET',p,undefined,{binary:true}),newRequestId:()=>global.MonteurApi?.newRequestId()||'req-'+Array.from(crypto.getRandomValues(new Uint8Array(12)),b=>b.toString(16).padStart(2,'0')).join('')};
 const api=global.MonteurApi;if(api?.hasSession())return {...api,key:api.sessionVersion(),prefix:'/app/monteur',download:p=>api.getBinary(p)};return null;
}
const current=(a,v)=>generation===v&&adapter()?.key===a.key;
function error(e){if(root)root.append(node('p','Fehler: '+(global.MonteurApi?.messageFor(e)||e.message)));}
function field(parent,label,type='text'){const l=node('label',label),i=node(type==='textarea'?'textarea':'input');if(type!=='textarea')i.type=type;l.append(i);parent.append(l);return i;}
async function download(a,path,fileName){const v=generation;try{const blob=await a.download(path);if(!current(a,v))return;const url=URL.createObjectURL(blob),link=node('a');link.href=url;link.download=fileName||'Dokument';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){if(current(a,v))error(e);}}
async function showInbox(){
 const a=adapter();if(!a||!enabled)return;const v=++generation;queue?.pause();root.hidden=false;root.replaceChildren(node('h2','Interne Nachrichten'));
 root.append(btn('Schliessen',()=>{generation++;root.hidden=true;}),btn('Neue Nachricht',compose),btn('Aktualisieren',showInbox));
 const filters=node('div');const query=field(filters,'Suche'),siteId=field(filters,'Baustellen-ID'),employeeId=field(filters,'Monteur-ID'),from=field(filters,'Von','date'),to=field(filters,'Bis','date');
 const folder=node('select');for(const [value,label] of [['','Posteingang'],['sent','Gesendet'],['unread','Ungelesen']]){const o=node('option',label);o.value=value;folder.append(o);}filters.append(folder);
 const type=node('select');for(const [value,label] of [['','Alle Typen'],['document_batch','Dokumentationen'],['internal_message','Nachrichten']]){const o=node('option',label);o.value=value;type.append(o);}filters.append(type);
 const status=field(filters,'Status');const rows=node('div');root.append(filters,rows);
 const load=async()=>{
  try{const data=await a.get(a.prefix+'/messages',{query:query.value,siteId:siteId.value,employeeId:employeeId.value,from:from.value,to:to.value,type:type.value,status:status.value,...(folder.value==='unread'?{unread:'true'}:{folder:folder.value})});
   if(!current(a,v))return;rows.replaceChildren();for(const r of data.messages||[]){const card=node('article');card.append(node('h3',(r.unread?'● ':'')+(r.subject||r.targetLabel||r.kind)),node('p',(r.authorName||r.senderId||'')+' · '+r.createdAt+' · '+r.status),node('p',r.message||''));
    for(const e of r.events||[])card.append(node('p',e.by+' · '+e.at+'\n'+e.text));
    card.append(btn('Als gelesen markieren',async()=>{try{await a.post(a.prefix+'/messages/read',{id:r.id,version:r.version});if(current(a,v))load();}catch(e){if(current(a,v))error(e);}}));
    const reply=field(card,'Antwort','textarea');reply.maxLength=3000;let requestId=null;
    card.append(btn('Antwort senden',async()=>{requestId=requestId||a.newRequestId();try{await a.post(a.prefix+'/messages/reply',{id:r.id,message:reply.value,requestId});if(current(a,v))showInbox();}catch(e){if(current(a,v))error(e);}}));
    if(r.kind==='document_batch')renderBatch(card,r,a,v);
    for(const f of [...(r.attachments||[]),...(r.events||[]).flatMap(e=>e.attachments||[])])card.append(btn('Anhang: '+f.fileName,()=>download(a,a.prefix+'/messages/download?'+new URLSearchParams({id:r.id,batchId:f.batchId,index:f.index}),f.fileName)));
    rows.append(card);
   }
  }catch(e){if(current(a,v))error(e);}
 };
 filters.append(btn('Filtern',load));await load();
}
async function compose(){
 const a=adapter();if(!a||!enabled)return;const v=++generation;root.hidden=false;root.replaceChildren(node('h2','Neue interne Nachricht'));
 const subject=field(root,'Betreff'),message=field(root,'Nachricht','textarea'),site=field(root,'Baustellen-ID (optional)');subject.maxLength=160;message.maxLength=3000;
 const recipient=a.prefix==='/app/admin'?field(root,'Empfänger-Monteur-ID'):null;root.append(node('p',recipient?'Empfänger muss ein aktiver Testmonteur dieses Mandanten sein.':'Empfänger: zuständige Büro-Administration im eigenen Mandanten.'));
 const label=node('label','Dokumentation anhängen (optional)'),select=node('select');select.multiple=true;label.append(select);root.append(label);
 try{const list=await a.get(a.prefix+'/batches');if(!current(a,v))return;for(const r of list.batches.filter(r=>r.status==='FERTIG')){const option=node('option',r.pdf.fileName+' · '+r.authorName);option.value=r.id;select.append(option);}}catch(e){if(!current(a,v))return;error(e);}
 let requestId=null;const send=btn('Intern senden',async()=>{send.disabled=true;requestId=requestId||a.newRequestId();try{await a.post(a.prefix+'/messages/send',{requestId,subject:subject.value,message:message.value,siteId:site.value,...(recipient?{employeeId:recipient.value}:{}),attachments:Array.from(select.selectedOptions,o=>({batchId:o.value,index:'pdf'}))});if(current(a,v))await showInbox();}catch(e){if(current(a,v))error(e);}finally{if(current(a,v))send.disabled=false;}});
 root.append(send,btn('Zurück',showInbox));
}
function renderBatch(parent,r,a,v){
 if(r.summary){const labels={foto:'Fotos',plan:'Pläne',deckblatt:'Deckblätter',abnahme:'Abnahmeprotokolle',rapport:'Rapporte',weitere:'Weitere Dokumente'};parent.append(node('p',Object.entries(r.summary).map(([kind,count])=>count+' '+(labels[kind]||kind)).join(' · ')));}
 parent.append(node('p','Batch: '+r.id+' · '+r.files.filter(f=>f.checksum).length+'/'+r.files.length+' Dateien'));
 for(const f of r.files)if(f.checksum)parent.append(btn('Original: '+f.name,()=>download(a,a.prefix+'/batches/download?'+new URLSearchParams({id:r.id,index:f.index}),f.name)));
 if(r.status==='FERTIG')parent.append(btn('PDF: '+r.pdf.fileName,()=>download(a,a.prefix+'/batches/download?'+new URLSearchParams({id:r.id,index:'pdf'}),r.pdf.fileName)));
 else if(r.files.some(f=>!f.checksum)&&a.prefix==='/app/monteur')parent.append(btn('Upload wiederaufnehmen',()=>showUpload(r)));
 else{
  if(r.suggestion?.siteId){parent.append(node('p','Gehören die Dateien zur vorgeschlagenen Baustelle '+r.suggestion.siteId+'?'));
   parent.append(btn('JA',async()=>{try{const result=await a.post(a.prefix+'/batches/confirm',{id:r.id,siteId:r.suggestion.siteId});if(current(a,v)){if(result.batch.status==='FEHLER')error(Error(result.batch.error));await showInbox();}}catch(e){if(current(a,v))error(e);}}),btn('NEIN – Baustelle suchen',()=>chooseSite(parent,r,a,v)));
  }else parent.append(btn('Baustelle zuordnen',()=>chooseSite(parent,r,a,v)));
  parent.append(btn('Erneut verarbeiten',async()=>{try{await a.post(a.prefix+'/batches/process',{id:r.id});if(current(a,v))showInbox();}catch(e){if(current(a,v))error(e);}}));
 }
}
function chooseSite(parent,r,a,v){
 const box=node('div'),q=field(box,'Auftrag, Kunde, Projekt oder Ort'),results=node('div');parent.append(box);box.append(btn('Suchen',async()=>{
  try{const data=await a.get(a.prefix+'/batches/sites',{query:q.value});if(!current(a,v))return;results.replaceChildren();if(!data.sites.length)results.append(node('p','Keine berechtigte Baustelle gefunden. Zuordnung bleibt offen; Disposition kontaktieren.'));
   for(const s of data.sites)results.append(btn(s.name+' · '+s.orderNumber,async()=>{try{await a.post(a.prefix+'/batches/confirm',{id:r.id,siteId:s.id});if(current(a,v))showInbox();}catch(e){if(current(a,v))error(e);}}));
  }catch(e){if(current(a,v))error(e);}
 }),results);
}
async function showUpload(batch=null){
 const a=adapter();if(!enabled||a?.prefix!=='/app/monteur')return;queue?.pause();const v=++generation;root.hidden=false;root.replaceChildren(node('h2','Dokumente hochladen'));
 root.append(node('p','Bis 40 JPG/PNG/PDF, je 8 MB, insgesamt 16 MB. Mindestens 30 kleine Fotos sind möglich. HEIC vorher auf dem Gerät sicher als JPEG exportieren. Originale bleiben privat; bei unklarer Baustelle folgt eine Rückfrage.'));
 const files=field(root,'Fotos oder PDFs auswählen','file');files.multiple=true;files.accept='.jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf';const progress=node('progress');progress.max=1;progress.value=0;const label=node('p','Bereit');root.append(progress,label);
 queue=new UploadQueue(a,(done,total)=>{if(current(a,v)){progress.max=total;progress.value=done;label.textContent=done+' / '+total+' gespeichert';}});
 files.onchange=()=>{try{queue.setFiles(files.files,batch);label.textContent=queue.files.length+' Dateien ausgewählt';}catch(e){error(e);}};
 const start=btn('Hochladen / Fortsetzen',async()=>{start.disabled=true;try{if(!queue.files.length)throw Error('Dateien auswählen.');const result=await queue.run();if(!current(a,v))return;if(result.paused){label.textContent='Unterbrochen. Fortsetzen möglich.';return;}label.textContent=result.batch.status;if(result.batch.status==='FEHLER')error(Error(result.batch.error));renderBatch(root,result.batch,a,v);}catch(e){if(current(a,v))error(e);}finally{if(current(a,v))start.disabled=false;}});
 root.append(start,btn('Unterbrechen',()=>queue.pause()),btn('Posteingang',showInbox));
}
function resetSession(){generation++;queue?.pause();queue=null;sessionKey=null;enabled=false;root?.replaceChildren();if(root)root.hidden=true;if(launcher)launcher.hidden=true;}
async function refresh(){
 const a=adapter();if(!a){if(sessionKey!==null){generation++;queue?.pause();queue=null;root?.replaceChildren();if(root)root.hidden=true;}sessionKey=null;enabled=false;if(launcher)launcher.hidden=true;return;}
 if(a.key!==sessionKey){generation++;queue?.pause();root?.replaceChildren();if(root)root.hidden=true;sessionKey=a.key;enabled=false;}
 const v=generation;
 try{const f=await a.get(a.prefix+'/features');if(!current(a,v))return;enabled=f.documentsEnabled===true;launcher.hidden=!enabled;if(!enabled)return;
  const data=await a.get(a.prefix+'/messages',{unread:'true'});if(current(a,v))launcher.textContent='✉ Nachrichten'+(data.messages.length?' ('+data.messages.length+')':'');
 }catch{if(current(a,v)){enabled=false;launcher.hidden=true;}}
}
function mount(){
 root=node('section');root.id='pilot-messages';root.hidden=true;root.style.cssText='position:fixed;inset:5%;z-index:3500;overflow:auto;background:white;color:#17372b;padding:18px;border:2px solid #337e61;border-radius:12px';
 launcher=btn('✉ Nachrichten',showInbox);launcher.id='pilot-messages-launch';launcher.hidden=true;launcher.style.cssText='position:fixed;left:12px;bottom:12px;z-index:2200;padding:12px';document.body.append(root,launcher);setInterval(refresh,10000);refresh();
}
global.PilotDocuments={UploadQueue,openUpload:showUpload,openInbox:showInbox,refresh,resetSession};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})(window);
