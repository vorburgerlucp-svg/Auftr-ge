// Isolierte Bedienoberflaeche des vorhandenen Wochenplans (state.plan).
// Keine Firebase-Konfiguration, kein Zweitspeicher; Quelle bleibt die bestehende Einzelzelle.
(function(global){
'use strict';
let panel=null,launcher=null,epoch=0,data=null,selection={},returnTo=null;
const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);return n;};
const button=(text,fn)=>{const b=el('button',text);b.type='button';b.className='btn btn-sm';b.onclick=fn;return b;};
const logged=()=>typeof bzSession!=='undefined'&&Boolean(bzSession);
function live(version,session){return version===epoch&&logged()&&bzSession===session;}
function reset(){epoch++;data=null;selection={};returnTo=null;if(panel){panel.replaceChildren();panel.hidden=true;}if(launcher)launcher.hidden=true;}
function mount(){if(panel)return;panel=el('section');panel.id='office-planning-panel';panel.className='card';panel.hidden=true;(document.querySelector('main')||document.body).append(panel);
 launcher=button('Wochenplan öffnen',()=>open({}));launcher.id='office-planning-launch';launcher.hidden=true;(document.querySelector('header nav')||document.body).append(launcher);}
function field(parent,label,type='text',value=''){const l=el('label',label),input=el('input');input.type=type;input.value=value;l.append(input);parent.append(l);return input;}
function select(parent,label,items,value){const l=el('label',label),input=el('select');for(const i of items){const o=el('option',i.name);o.value=String(i.id);input.append(o);}input.value=String(value);l.append(input);parent.append(l);return input;}
function showError(error){panel.append(el('p',({source_changed:'Dieser Einsatz wurde inzwischen geändert. Bitte Planung neu laden.',destination_occupied:'Das Ziel ist bereits belegt. Es wurde nichts überschrieben.',dependent_slots:'Dieser Tag hat weitere Einsätze. Bitte zusätzliche Einsätze zuerst ausdrücklich bearbeiten.',slot_without_base:'Für einen Zusatzeinsatz fehlt der erste Einsatz am Ziel.',plan_save_unconfirmed:'Speicherung nicht bestätigt. Bitte neu laden und den Plan kontrollieren.'})[error?.code]||'Änderung nicht bestätigt. Bitte neu laden und prüfen.'));}
function requestId(){const bytes=new Uint8Array(12);global.crypto.getRandomValues(bytes);return 'req-'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
function dates(from){const d=new Date((from||new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Zurich'}).format(new Date()))+'T12:00:00Z');const first=d.toISOString().slice(0,10);d.setUTCDate(d.getUTCDate()+6);return [first,d.toISOString().slice(0,10)];}
async function open(options={}){
 mount();if(!logged())return;epoch++;selection={...options};returnTo=options.onReturn||null;
 const [from,to]=dates(options.from);selection.from=options.from||from;selection.to=options.to||to;
 panel.hidden=false;panel.replaceChildren(el('h2','Wochenplanung'),el('p','Planung wird geladen …'));
 const version=epoch,session=bzSession;
 try{const result=await bzCall('GET','/app/admin/planning?from='+encodeURIComponent(selection.from)+'&to='+encodeURIComponent(selection.to));if(!live(version,session))return;data=result;render();}
 catch(e){if(live(version,session))showError(e);}
}
function back(){const callback=returnTo;panel.hidden=true;panel.replaceChildren();epoch++;data=null;returnTo=null;if(callback)callback();}
function render(){
 panel.replaceChildren(el('h2','Wochenplanung'),el('p','Bestehende Einsätze gezielt bearbeiten. Andere Einsätze werden nicht automatisch entfernt.'),button(returnTo?'Zurück zum Ferienantrag':'Schliessen',back));
 const range=el('div'),from=field(range,'Von','date',selection.from),to=field(range,'Bis','date',selection.to);
 const filter=select(range,'Mitarbeiter',[{id:'',name:'Alle Mitarbeiter'},...(data.employees||[])],selection.employeeId||'');filter.id='office-plan-filter-employee';
 range.append(button('Planung laden',()=>open({...selection,from:from.value,to:to.value,employeeId:filter.value,onReturn:returnTo})));panel.append(range);
 const rows=(data.entries||[]).filter(r=>!selection.employeeId||String(r.entry?.maId)===String(selection.employeeId));
 if(!rows.length)panel.append(el('p','Keine Einsätze im gewählten Zeitraum.'));
 for(const row of rows){const card=el('article'),entry=row.entry||{},employee=(data.employees||[]).find(e=>e.id===String(entry.maId)),site=(data.sites||[]).find(s=>s.id===String(entry.bsId));
  card.append(el('h3',row.date+' · '+(employee?.name||entry.maId)),el('p',site?.name||entry.status||'Eintrag'),el('p',entry.notiz||''),button('Einsatz bearbeiten',()=>edit(row)));panel.append(card);}
 const journal=el('details');journal.append(el('summary','Änderungsprotokoll'));
 for(const item of data.history||[])journal.append(el('p',item.at+' · '+item.by+' · '+(item.action||item.source)));panel.append(journal);
}
function edit(row){
 const entry=row.entry||{};panel.replaceChildren(el('h2','Einsatz bearbeiten'),el('p',row.date+' · Mitarbeiter '+entry.maId),button('Zurück zur Planung',render));
 const target=field(panel,'Neues Datum','date',row.date);target.id='office-plan-date';
 const employee=select(panel,'Mitarbeiter',data.employees||[],entry.maId);employee.id='office-plan-employee';
 const site=select(panel,'Baustelle',data.sites||[],entry.bsId);site.id='office-plan-site';
 const note=field(panel,'Notiz','text',entry.notiz||'');note.id='office-plan-note';note.maxLength=500;
 const slot=field(panel,'Ziel-Einsatznummer (1 = erster Einsatz)','number','1');slot.id='office-plan-slot';slot.min='1';slot.max='9';
 function preview(action){
  const payload={requestId:requestId(),action,date:row.date,key:row.key,expectedEntry:JSON.parse(JSON.stringify(entry)),confirmation:true};
  if(action!=='remove'){payload.siteId=site.value;payload.note=note.value;}
  if(action==='move'){payload.targetDate=target.value;payload.targetEmployeeId=employee.value;payload.targetSlot=Number(slot.value);}
  panel.replaceChildren(el('h2','Änderung prüfen'),el('p','Quelle: '+row.date+' · Mitarbeiter '+entry.maId),el('p',action==='remove'?'Diesen Eintrag ausdrücklich entfernen.':'Ziel: '+(payload.targetDate||row.date)+' · Mitarbeiter '+(payload.targetEmployeeId||entry.maId)+' · Baustelle '+payload.siteId),el('p','Beim Speichern werden Quelle und Belegung erneut geprüft.'));
  panel.append(button('Abbrechen',render));const status=el('p');status.setAttribute('role','status');panel.append(status);
  const commit=button('Änderung verbindlich speichern',async()=>{
   const version=epoch,session=bzSession;commit.disabled=true;
   try{await bzCall('POST','/app/admin/planning/edit',payload);if(!live(version,session))return;await open({...selection,onReturn:returnTo});panel.append(el('p','Planungsänderung gespeichert und protokolliert.'));}
   catch(e){if(live(version,session)){showError(e);commit.disabled=false;}}
  });panel.append(commit);
 }
 if(entry.bsId!=null)panel.append(button('Einsatz umplanen',()=>preview('update')),button('Einsatz verschieben',()=>preview('move')));
 panel.append(button('Einsatz ausdrücklich entfernen',()=>preview('remove')));
}
async function refreshFeature(){mount();if(!logged()){launcher.hidden=true;return;}const version=epoch,session=bzSession;
 try{const f=await bzCall('GET','/app/admin/features');if(live(version,session))launcher.hidden=f.planningEnabled!==true;}catch{if(version===epoch)launcher.hidden=true;}
}
function init(){mount();if(typeof bzAbmelden==='function'){const previous=bzAbmelden;global.bzAbmelden=function(...args){reset();return previous(...args);};}
 if(typeof bzLaden==='function'){const previous=bzLaden;global.bzLaden=async function(...args){const result=await previous(...args);await refreshFeature();return result;};}
}
global.OfficePlanning={open,reset};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})(typeof window!=='undefined'?window:globalThis);
