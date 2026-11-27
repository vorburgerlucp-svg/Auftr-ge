// Read-only mobile view for explicitly released montage information.
(function(global){
'use strict';
let root=null,epoch=0,timer=null;
const node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=String(text);return el;};
const button=(label,fn)=>{const el=node('button',label);el.type='button';el.onclick=fn;return el;};
function reset(){epoch++;if(timer)global.clearTimeout(timer);timer=null;if(root)root.replaceChildren();root=null;}
function active(version){return version===epoch&&root&&global.MonteurApi.hasSession();}
function error(el,e){el.replaceChildren(node('p',global.MonteurApi.messageFor(e)));}
function render(data,parent){
 reset();root=parent;const generation=epoch;
 root.replaceChildren(node('h3',data.site?.name||'Montageaufgebot'));
 if(data.kind==='montage_choices'){choices(root,data.choices||[],data.reply);return;}
 const site=data.site||{};
 root.append(node('p','Freigegebene Montageinformationen · keine persönliche Einsatzbestätigung'));
 const labels={auftragsnummer:'Auftragsnummer',kommission:'Kommission',kunde:'Kunde',adresse:'Adresse',anfahrt:'Anfahrt',startzeit:'Arbeitsbeginn',montagezeit:'Montagezeit',anlieferung:'Anlieferung',montagebeschreibung:'Montagearbeiten',montagehinweise:'Montagehinweise',von:'Von',bis:'Bis'};
 for(const [key,label] of Object.entries(labels))if(site[key]!==undefined)root.append(node('p',label+': '+site[key]));
 if(site.treffpunkt)root.append(node('p','Treffpunkt: '+[site.treffpunkt.ort,site.treffpunkt.adresse,site.treffpunkt.zeit].filter(Boolean).join(' · ')));
 if(site.planningStart)root.append(node('p','Wochenplanung '+site.planningStart.date+': '+(site.planningStart.times||[]).join(', ')+' · '+site.planningStart.notice));
 for(const contact of site.ansprechpartner||[]){
  const row=node('p',[contact.name,contact.rolle].filter(Boolean).join(' · '));
  if(/^[+\d\s()./-]{3,40}$/.test(contact.telefon||'')){const link=node('a',contact.telefon);link.href='tel:'+contact.telefon.replace(/[^+\d]/g,'');row.append(link);}
  root.append(row);
 }
 if(typeof site.adresse==='string'&&site.adresse.trim()){
  const link=node('a','Navigation öffnen');link.href='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(site.adresse);link.target='_blank';link.rel='noopener noreferrer';root.append(link);
 }
 const messages=node('div');messages.setAttribute('role','alert');
 for(const doc of data.documents||[]){root.append(button('Dokument: '+doc.fileName,async()=>{
  try{const blob=await global.MonteurApi.downloadMontageDocument(site.id,doc.id);if(!active(generation))return;
   const url=URL.createObjectURL(blob),link=node('a','Datei herunterladen');link.href=url;link.download=String(doc.fileName||'Dokument').replace(/[\\/]/g,'_');root.append(link);link.click();global.setTimeout(()=>URL.revokeObjectURL(url),120000);
  }catch(e){if(active(generation))error(messages,e);}
 }));}
 root.append(messages,button('Montageaufgebot suchen',()=>open(parent)));
}
async function select(id){const generation=++epoch,target=root;
 try{const data=await global.MonteurApi.get('/app/monteur/montage/site',{siteId:id});if(!active(generation))return;render(data,target);}
 catch(e){if(active(generation))error(root,e);}
}
function choices(parent,list,message){
 parent.replaceChildren();if(message)parent.append(node('p',message));
 if(!list.length)parent.append(node('p','Keine passende freigegebene Baustelle gefunden.'));
 for(const site of list)parent.append(button(site.name,()=>select(site.id)));
}
function open(parent){
 reset();root=parent;root.replaceChildren(node('h3','Montageaufgebot suchen'));
 const label=node('label','Baustelle, Kunde, Ort oder Auftragsnummer'),input=node('input');input.id='monteur-montage-search';input.type='search';input.maxLength=160;input.autocomplete='off';label.append(input);
 const suggestions=node('div');suggestions.setAttribute('aria-live','polite');
 async function search(){
  const query=input.value.trim();if(query.length<2){suggestions.replaceChildren(node('p','Bitte mindestens zwei Zeichen eingeben.'));return;}
  const generation=++epoch;
  try{const data=await global.MonteurApi.get('/app/monteur/montage',{query});if(!active(generation))return;choices(suggestions,data.choices||[],data.moreMatches?'Bitte Suche genauer eingrenzen.':'Bitte Baustelle auswählen.');}
  catch(e){if(active(generation))error(suggestions,e);}
 }
 input.addEventListener('input',()=>{if(timer)global.clearTimeout(timer);epoch++;timer=global.setTimeout(search,250);});
 input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();search();}});
 root.append(label,button('Suchen',search),suggestions);input.focus();
}
global.MonteurMontage={open,render,reset};
})(typeof window!=='undefined'?window:globalThis);
