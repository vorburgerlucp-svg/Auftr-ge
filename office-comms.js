// LagerTool Pilot: private office inbox, no unauthenticated data and no unsafe HTML insertion.
(function(){
'use strict';
const kinds={vehicle_service:'Fahrzeug-Service',vehicle_repair:'Fahrzeug-Reparatur',
  tool_repair:'Werkzeug-Reparatur',material_request:'Materialanfrage',
  site_issue:'Baustellenproblem',general:'Nachricht',document_upload:'Dokument zur Prüfung'};
const statusValues=['neu','in_bearbeitung','terminiert','bereit','erledigt','abgelehnt'];
let requests=[],seen=new Set(),ready=false,loading=false,loginError='',viewVersion=0;
const node=(tag,text)=>{const e=document.createElement(tag);if(text!=null)e.textContent=String(text);return e;};
function field(parent,label,tag='input'){
  const box=node('label'),caption=node('span',label),ctrl=node(tag);
  box.style.display='block';box.style.marginTop='8px';box.append(caption,ctrl);
  if(tag==='textarea'){ctrl.rows=2;ctrl.maxLength=900;}
  parent.append(box);return ctrl;
}
function btn(text,action){const b=node('button',text);b.type='button';b.className='btn btn-sm';b.onclick=action;return b;}
function section(){return document.getElementById('bz-anfragen-section');}
function active(){return Boolean(typeof bzSession!=='undefined'&&bzSession);}
function notify(text){
  if(typeof toast==='function')toast('📬 Monteur-Anfrage',text,'📬');
}
function row(label,value){const p=node('p');const b=node('strong',label+': ');p.append(b,node('span',value||'—'));return p;}
function render(){
  const root=section();if(!root)return;
  const badge=document.getElementById('bz-anfragen-count');
  const neu=requests.filter(r=>r.status==='neu').length;
  if(badge)badge.textContent=neu?'('+neu+')':'';
  root.replaceChildren();
  if(!active()){
    root.append(node('h3','Büro-Anmeldung'));
    root.append(node('p','Nur berechtigte Büromitarbeitende können Monteur-Anfragen lesen und beantworten.'));
    const name=field(root,'Name'),pin=field(root,'PIN');
    name.autocomplete='username';pin.type='password';pin.maxLength=4;pin.inputMode='numeric';
    if(loginError)root.append(node('p',loginError));
    root.append(btn('Anmelden',async()=>{
      if(!name.value.trim()||!/^\d{4}$/.test(pin.value)){loginError='Bitte Namen und vierstellige PIN eingeben.';render();return;}
      try{
        const auth=await bzCall('POST','/app/office/anmelden',{name:name.value.trim(),pin:pin.value});
        if(!auth.officeSession)throw Error('login_failed');
        bzSession={token:auth.officeSession,name:name.value.trim()};
        loginError='';seen.clear();ready=false;
        pin.value='';
        await bzLaden();await load(false);
      }catch{loginError='Anmeldung fehlgeschlagen.';render();}
    }));
    return;
  }
  const heading=node('div');heading.style.display='flex';heading.style.justifyContent='space-between';
  heading.style.alignItems='center';heading.style.flexWrap='wrap';heading.style.gap='8px';
  heading.append(node('strong',requests.length+' Anfragen · '+neu+' neu'),btn('↻ Aktualisieren',()=>load(false)));
  root.append(heading);
  if(!requests.length){root.append(node('p','Keine Anfragen vorhanden.'));return;}
  for(const item of requests){
    const card=node('article');card.style.border='1px solid var(--border)';card.style.borderRadius='12px';
    card.style.padding='12px';card.style.marginTop='12px';
    card.append(node('h3',(kinds[item.kind]||item.kind)+' · '+(item.targetLabel||'Allgemein')));
    const meta=node('small','Von: '+(item.authorName||item.employeeId)+' · '+item.createdAt+' · '+item.status);
    card.append(meta,row('Anfrage',item.message));
    if(item.kind==='document_upload'&&item.attachment){
      const attachment=btn('📎 '+(item.attachment.fileName||'Datei')+' herunterladen',async()=>{
        try{
          if(!active())throw Error('not_authorized');
          const response=await fetch(BZ_WORKER+'/app/admin/upload/'+encodeURIComponent(item.id),{
            method:'GET',headers:{Authorization:'Bearer '+bzSession.token},
            credentials:'omit',cache:'no-store'});
          if(!response.ok)throw Error('download_failed');
          const data=await response.blob(),url=URL.createObjectURL(data);
          const a=node('a');a.href=url;a.download=String(item.attachment.fileName||'Dokument')
            .replace(/[\\/<>:"|?*]/g,'_');
          document.body.append(a);a.click();a.remove();
          setTimeout(()=>URL.revokeObjectURL(url),120000);
        }catch{if(typeof toast==='function')toast('Download fehlgeschlagen','Büro-Berechtigung und Datei prüfen','⚠️');}
      });
      card.append(attachment);
    }
    if(item.reply)card.append(row('Letzte Rückmeldung',item.reply));
    if(['erledigt','abgelehnt'].includes(item.status)){
      card.append(node('p','Abgeschlossen – Original bleibt gespeichert.'));root.append(card);continue;
    }
    const select=field(card,'Status','select');
    for(const v of statusValues){const opt=node('option',v.replace('_',' '));opt.value=v;select.append(opt);}
    select.value=item.status;
    const date=field(card,'Servicetermin (Datum)');date.type='date';date.value=item.appointmentDate||'';
    const time=field(card,'Uhrzeit');time.type='time';time.value=item.appointmentTime||'';
    const location=field(card,'Abholort / Fach');location.maxLength=100;
    location.value=item.pickupLocation||'';location.placeholder='z. B. Fach 3';
    const reply=field(card,'Nachricht an Monteur','textarea');
    reply.value=item.reply||'';reply.placeholder='Kurze Antwort';
    card.append(btn('Antwort bestätigen',async()=>{
      const payload={status:select.value,appointmentDate:date.value,appointmentTime:time.value,
        pickupLocation:location.value,reply:reply.value};
      try{
        await bzCall('POST','/app/admin/requests/'+encodeURIComponent(item.id)+'/reply',payload);
        if(typeof toast==='function')toast('Antwort gesendet','Im Monteur-Postfach sichtbar','✅');
        await load(false);
      }catch(e){
        if(typeof toast==='function')toast('Antwort nicht gespeichert',
          e?.code==='appointment_required'?'Bitte Servicedatum ergänzen.':
          e?.code==='pickup_required'?'Bitte Fach / Abholort oder Antwort angeben.':
          'Bitte Eingaben prüfen und erneut senden.','⚠️');
      }
    }));
    root.append(card);
  }
}
async function load(silent=true){
  if(!active()){if(!silent)render();return;}
  if(loading)return;loading=true;
  try{
    const data=await bzCall('GET','/app/admin/requests');
    const items=data.requests||[];
    const fresh=ready?items.filter(i=>i.status==='neu'&&!seen.has(i.id)):[];
    items.forEach(i=>seen.add(i.id));
    ready=true;requests=items;
    if(fresh.length)notify((kinds[fresh[0].kind]||fresh[0].kind)+' – '+(fresh[0].targetLabel||'')+' von '+fresh[0].authorName);
    const visible=document.getElementById('page-anfragen')?.classList.contains('active');
    if(visible||!silent)render();
    else{const badge=document.getElementById('bz-anfragen-count');if(badge){const count=requests.filter(x=>x.status==='neu').length;badge.textContent=count?'('+count+')':'';}}
  }catch(e){if(!silent&&typeof toast==='function')toast('Keine Verbindung zum Postfach','Bitte später aktualisieren','⚠️');}
  finally{loading=false;}
}
function init(){
  render();
  const nav=document.getElementById('nav-anfragen');
  nav?.addEventListener('click',()=>load(false));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&active())load(true);});
  window.setInterval(()=>{if(active())load(true);},60000);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
else init();
})();
