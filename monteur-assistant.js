(function(global){
  'use strict';
  const labels={siteName:'Baustelle',adresse:'Adresse',address:'Adresse',kunde:'Kunde',auftragsnummer:'Auftrag',kommission:'Kommission',von:'Von',bis:'Bis',startzeit:'Baustellenbeginn',siteStart:'Baustellenbeginn',montagebeschreibung:'Montagearbeiten',montageArt:'Montageart',rapportDate:'Berichtsdatum',timeStart:'Arbeitsbeginn',timeEnd:'Arbeitsende',breakMinutes:'Pause in Minuten',totalHours:'Arbeitsstunden',workPerformed:'Ausgeführte Arbeiten',materialUsed:'Verwendetes Material',issues:'Probleme',extraWork:'Zusatzarbeiten',notes:'Berichtnotizen'};
  let panel,result,errorBox,input,launcher,busy=false,epoch=0;
  const controls=new Set();
  const el=(tag,content)=>{const n=document.createElement(tag);if(content!==undefined)n.textContent=String(content);return n;};
  function button(label,action){const b=el('button',label);b.type='button';b.addEventListener('click',action);controls.add(b);return b;}
  function line(parent,label,value){if(value!==null&&value!==undefined&&value!=='')parent.append(el('p',label+': '+value));}
  function fields(parent,data,keys){for(const k of keys)line(parent,labels[k]||k,data[k]);}
  function point(parent,p){line(parent,'Treffpunkt',p?.place||'nicht hinterlegt');line(parent,'Treffpunktzeit',p?.time||'nicht hinterlegt');}
  function contacts(parent,list){for(const c of list||[])line(parent,'Ansprechpartner',[c.name,c.telefon].filter(Boolean).join(' · '));}
  function failure(e){errorBox.replaceChildren(el('p',global.MonteurApi.messageFor(e)));}
  function setBusy(value){busy=value;for(const b of controls){if(b.isConnected===false)controls.delete(b);else b.disabled=value;}input.disabled=value;}
  function reportForm(data){
    const values={};
    line(result,'Baustelle',data.report.siteName);
    const keys=['rapportDate','timeStart','timeEnd','breakMinutes','workPerformed','materialUsed','issues','extraWork','notes'];
    for(const k of keys){
      const label=el('label',labels[k]);const n=el(['workPerformed','materialUsed','issues','extraWork','notes'].includes(k)?'textarea':'input');
      n.id='assistant-report-'+k;n.value=data.report[k]??'';
      if(['materialUsed','issues','extraWork','notes'].includes(k))n.maxLength=3000;
      if(k==='workPerformed')n.maxLength=5000;
      if(k==='rapportDate')n.type='date';if(k==='timeStart'||k==='timeEnd')n.type='time';if(k==='breakMinutes'){n.type='number';n.min='0';n.max='600';}
      label.append(n);result.append(label);values[k]=n;
    }
    if(data.missingFields?.length)result.append(el('p','Noch erforderlich: '+data.missingFields.map(k=>labels[k]||k).join(', ')));
    if(data.errors?.length){
      const long=data.errors.filter(e=>e.endsWith('_too_long')).map(e=>labels[e.slice(0,-9)]||e.slice(0,-9));
      result.append(el('p',long.length?'Text zu lang (höchstens 3000 Zeichen): '+long.join(', '):'Bitte Datum, Zeiten und Pausen prüfen.'));
    }
    result.append(button('Bericht prüfen',()=>{
      const report={};for(const k of keys)report[k]=values[k].value;
      return ask({tool:'report_draft',args:{siteId:data.siteId,report}});
    }));
  }
  async function openDocument(d){
    const generation=epoch;
    try{
      const blob=await global.MonteurApi.downloadDocument(d.siteId,d.id);
      if(generation!==epoch)return;
      const url=URL.createObjectURL(blob);
      if(blob.type==='application/pdf'||/^image\/(png|jpeg|gif|webp)$/.test(blob.type)){
        global.open(url,'_blank','noopener,noreferrer');
        // A download link remains available when the browser blocks a new window.
        const link=el('a','Datei herunterladen');link.href=url;link.download=String(d.fileName||'Dokument').replace(/[\\/]/g,'_');result.append(link);
      }else{
        const link=el('a');link.href=url;link.download=String(d.fileName||'Dokument').replace(/[\\/]/g,'_');result.append(link);link.click();link.remove();
      }
      global.setTimeout(()=>URL.revokeObjectURL(url),120000);
    }catch(e){if(generation===epoch)failure(e);}
  }
  function render(data){
    result.replaceChildren(el('p',data.reply||''));
    if(data.kind==='assignments')for(const a of data.assignments){
      const card=el('article');card.append(el('h3',a.siteName||'Baustelle'));
      fields(card,a,['address','siteStart']);if(!a.siteStart)line(card,'Baustellenbeginn','nicht hinterlegt');point(card,a.meetingPoint);line(card,'Abfahrt Allschwil',a.departure);contacts(card,a.contacts);
      for(const w of a.warnings||[])card.append(el('p',w));
      card.append(button('Baustelleninformationen',()=>ask({tool:'site_info',args:{siteId:a.siteId}})),button('Pläne',()=>ask({tool:'site_documents',args:{siteId:a.siteId}})));
      result.append(card);
    }
    if(data.kind==='site'){
      result.append(el('h3',data.site.name||'Baustelle'));
      fields(result,data.site,['adresse','kunde','auftragsnummer','kommission','von','bis','startzeit','montagebeschreibung']);point(result,data.meetingPoint);contacts(result,data.site.ansprechpartner);
      result.append(button('Pläne',()=>ask({tool:'site_documents',args:{siteId:data.siteId}})));
    }
    if(data.kind==='ride')for(const ride of data.carpools||[]){
      const card=el('article');line(card,'Fahrer',ride.driver||'nicht hinterlegt');
      line(card,'Mitfahrer',(ride.companions||[]).map(c=>c.name).join(', ')||'keine weiteren Teilnehmer hinterlegt');
      line(card,'Fahrzeug',[ride.vehicle?.name,ride.vehicle?.plate].filter(Boolean).join(' · ')||'nicht hinterlegt');point(card,ride.meetingPoint);
      for(const w of ride.warnings||[])card.append(el('p',w));result.append(card);
    }
    if(data.kind==='choose_site')for(const s of data.choices)result.append(button(s.name,()=>ask({tool:data.tool,args:{...data.args,siteId:s.id}})));
    if(data.kind==='documents')for(const d of data.documents){
      const card=el('article');card.append(el('h3',d.fileName||'Dokument'));line(card,'Dokumentdatum',d.documentDate||'nicht hinterlegt');line(card,'Version',d.version??'nicht hinterlegt');line(card,'Abgelegt',d.createdAt);
      card.append(button('Öffnen',()=>openDocument({...d,siteId:data.siteId})));result.append(card);
    }
    if(data.kind==='report_form')reportForm(data);
    if(data.kind==='report_preview'){
      fields(result,data.report,['siteName','rapportDate','timeStart','timeEnd','breakMinutes','totalHours','workPerformed','materialUsed','issues','extraWork','notes']);
      result.append(button('Bericht verbindlich speichern',()=>ask({confirmation:true,draftToken:data.draftToken})),button('Bearbeiten',()=>render({...data,kind:'report_form',missingFields:[],errors:[]})));
    }
  }
  async function ask(body){
    if(busy)return;
    if(!global.MonteurApi.hasSession()){failure(new Error('Bitte zuerst in der Monteur-App anmelden.'));return;}
    const generation=epoch;errorBox.replaceChildren();setBusy(true);panel.hidden=false;
    try{
      const data=await global.MonteurApi.post('/app/monteur/assistant',body);
      if(generation!==epoch)return;
      if(!data||data.ok!==true)throw new Error('Keine bestätigte Antwort vom Server.');
      render(data);
    }catch(e){if(generation===epoch)failure(e);}
    finally{if(generation===epoch)setBusy(false);}
  }
  function mount(){
    if(panel)return;
    const style=el('style',`#monteur-assistant-launch{position:fixed;right:16px;bottom:85px;z-index:2000;padding:12px 18px;border-radius:24px;background:#155e4b;color:white;border:0;font-weight:700}#monteur-assistant{position:fixed;right:12px;bottom:85px;z-index:2100;width:min(430px,calc(100vw - 24px));max-height:78vh;overflow:auto;background:#fff;color:#152820;border:1px solid #cad7d0;border-radius:16px;box-shadow:0 12px 48px #0003;padding:18px;font:14px system-ui}#monteur-assistant[hidden],#monteur-assistant-launch[hidden]{display:none}#monteur-assistant button{padding:10px;margin:4px;border:1px solid #b4c8bc;border-radius:8px;background:#eef5ef;color:#183b2b;cursor:pointer}#monteur-assistant button:disabled{opacity:.5;cursor:wait}#monteur-assistant textarea,#monteur-assistant input{display:block;width:100%;box-sizing:border-box;margin:6px 0 12px;padding:10px;border:1px solid #a4b9ae;border-radius:7px}#monteur-assistant label{display:block;margin-top:10px}#monteur-assistant article{border-top:1px solid #dce5df;margin-top:12px;padding-top:8px}#monteur-assistant p{white-space:pre-wrap;overflow-wrap:anywhere;margin:9px 0}#assistant-errors{color:#a22525}`);
    document.body.append(style);
    launcher=button('Assistent',()=>{panel.hidden=!panel.hidden;if(!panel.hidden)input.focus();});launcher.id='monteur-assistant-launch';launcher.hidden=true;
    panel=el('section');panel.id='monteur-assistant';panel.hidden=true;panel.setAttribute('aria-label','Monteur-Assistent');
    panel.append(el('h2','Dein Assistent'),button('Schliessen',()=>{panel.hidden=true;}));
    panel.append(el('p','Deine Einsätze, Pläne und Berichte.'));
    const shortcuts=el('div');shortcuts.style.display='grid';shortcuts.style.gridTemplateColumns='repeat(2,minmax(0,1fr))';
    for(const [label,command] of [['Wo bin ich morgen?',{tool:'my_assignments',args:{date:'morgen'}}],['Baustelleninformationen',{tool:'site_info',args:{}}],['Zeige mir die Pläne',{tool:'site_documents',args:{}}],['Mit wem fahre ich morgen?',{tool:'my_ride',args:{date:'morgen'}}],['Bericht ablegen',{tool:'report_draft',args:{}}]])shortcuts.append(button(label,()=>ask(command)));
    panel.append(shortcuts);
    const label=el('label','Deine Anfrage');input=el('textarea');input.id='assistant-message';input.maxLength=4000;label.append(input);panel.append(label);
    panel.append(button('Senden',()=>{const message=input.value.trim();if(message)return ask({message});}));
    errorBox=el('div');errorBox.id='assistant-errors';errorBox.setAttribute('role','alert');result=el('div');result.id='assistant-result';result.setAttribute('aria-live','polite');panel.append(errorBox,result);
    document.body.append(launcher,panel);
  }
  function reset(){epoch++;busy=false;if(!panel)return;result.replaceChildren();errorBox.replaceChildren();input.value='';panel.hidden=true;launcher.hidden=true;setBusy(false);}
  global.MonteurAssistant={ask,mount,show(){mount();launcher.hidden=false;},reset};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})(typeof window!=='undefined'?window:globalThis);
