(function(global){
  'use strict';
  const labels={siteName:'Baustelle',adresse:'Adresse',address:'Adresse',kunde:'Kunde',auftragsnummer:'Auftrag',kommission:'Kommission',von:'Von',bis:'Bis',startzeit:'Baustellenbeginn',siteStart:'Baustellenbeginn',montagebeschreibung:'Montagearbeiten',montageArt:'Montageart',rapportDate:'Berichtsdatum',timeStart:'Arbeitsbeginn',timeEnd:'Arbeitsende',breakMinutes:'Pause in Minuten',totalHours:'Arbeitsstunden',workPerformed:'Ausgeführte Arbeiten',materialUsed:'Verwendetes Material',issues:'Probleme',extraWork:'Zusatzarbeiten',notes:'Berichtnotizen'};
  let panel,result,errorBox,input,launcher,vacationButton,vacationAvailable=false,busy=false,epoch=0;
  let voice=null,voiceTarget=null,voiceButton=null,voiceStatus=null,voiceRun=0;
  const controls=new Set();
  const el=(tag,content)=>{const n=document.createElement(tag);if(content!==undefined)n.textContent=String(content);return n;};
  function button(label,action){const b=el('button',label);b.type='button';b.addEventListener('click',action);controls.add(b);return b;}
  function line(parent,label,value){if(value!==null&&value!==undefined&&value!=='')parent.append(el('p',label+': '+value));}
  function fields(parent,data,keys){for(const k of keys)line(parent,labels[k]||k,data[k]);}
  function point(parent,p){line(parent,'Treffpunkt',p?.place||'nicht hinterlegt');line(parent,'Treffpunktzeit',p?.time||'nicht hinterlegt');}
  function contacts(parent,list){
    for(const c of list||[]){
      const row=el('p');
      const who=[c.name,c.rolle].filter(Boolean).join(' · ');
      row.append(document.createTextNode('Ansprechpartner: '+who));
      // Nur Telefonnummern, die der Server ausdrücklich für den Monteur freigegeben hat.
      if(c.telefon){
        const number=String(c.telefon);
        const dial=el('a',' · '+number);
        dial.href='tel:'+number.replace(/[^0-9+]/g,'');
        dial.style.marginLeft='4px';
        row.append(dial);
      }
      parent.append(row);
    }
  }
  function failure(e){errorBox.replaceChildren(el('p',global.MonteurApi.messageFor(e)));}
  function setBusy(value){busy=value;for(const b of controls){if(b.isConnected===false)controls.delete(b);else b.disabled=value;}input.disabled=value;}
  // Die Web-Speech-API ist optional und wird nur nach einem ausdruecklichen Klick gestartet.
  // Je nach Browser kann die Spracherkennung einen externen Dienst des Browseranbieters verwenden.
  // Es werden keine Audiodateien im LagerTool gespeichert; erkannter Text wird NIE automatisch gesendet.
  function speechAvailable(){
    return global.isSecureContext!==false && typeof (global.SpeechRecognition||global.webkitSpeechRecognition)==='function';
  }
  function voiceMessage(message){if(voiceStatus)voiceStatus.textContent=message;}
  function stopVoice(clearMessage=true){
    voiceRun++;
    const previous=voice;
    voice=null;
    voiceTarget=null;
    if(voiceButton){
      voiceButton.textContent=voiceButton.dataset.voiceLabel||'Diktieren';
      voiceButton.setAttribute('aria-pressed','false');
    }
    voiceButton=null;
    if(previous){
      previous.onresult=null;
      previous.onerror=null;
      previous.onend=null;
      try{previous.abort();}catch{}
    }
    if(clearMessage)voiceMessage('');
  }
  function dictate(target,button){
    if(!global.MonteurApi.hasSession()){voiceMessage('Bitte zuerst anmelden.');return;}
    if(!speechAvailable()){voiceMessage('Spracherkennung ist in diesem Browser nicht verfügbar. Bitte tippen.');return;}
    if(voice&&voiceTarget===target){stopVoice();return;}
    stopVoice();
    const Speech=global.SpeechRecognition||global.webkitSpeechRecognition;
    let recognition;
    try{recognition=new Speech();}catch{voiceMessage('Spracherkennung konnte nicht gestartet werden.');return;}
    const run=++voiceRun,generation=epoch,completed=new Set();
    voice=recognition;voiceTarget=target;voiceButton=button;
    recognition.lang='de-CH';
    recognition.continuous=false;
    recognition.interimResults=false;
    recognition.maxAlternatives=1;
    button.textContent='Aufnahme stoppen';
    button.setAttribute('aria-pressed','true');
    voiceMessage('Mikrofon aktiv. Sprich jetzt. Der erkannte Text muss vor dem Senden geprüft werden.');
    recognition.onresult=event=>{
      if(run!==voiceRun||generation!==epoch||!global.MonteurApi.hasSession()||!target.isConnected)return;
      const parts=[];
      for(let i=event.resultIndex||0;i<event.results.length;i++){
        const item=event.results[i];
        if(item&&item.isFinal&&!completed.has(i)){
          completed.add(i);
          const part=String(item[0]?.transcript||'').trim();
          if(part)parts.push(part);
        }
      }
      if(parts.length){
        const joined=(target.value.trimEnd()?target.value.trimEnd()+' ':'')+parts.join(' ');
        const limit=target.maxLength>0?target.maxLength:4000;
        target.value=joined.slice(0,limit);
        target.dispatchEvent(new Event('input',{bubbles:true}));
        voiceMessage(joined.length>limit?'Text gekürzt. Bitte prüfen und manuell senden.':'Text erkannt. Bitte prüfen und manuell senden.');
      }
    };
    recognition.onerror=event=>{
      if(run!==voiceRun)return;
      const denied=event?.error==='not-allowed'||event?.error==='service-not-allowed';
      stopVoice(false);
      voiceMessage(denied?'Mikrofonzugriff abgelehnt. Du kannst weiterhin tippen.':'Spracherkennung fehlgeschlagen. Bitte Text eingeben.');
    };
    recognition.onend=()=>{
      if(run!==voiceRun)return;
      stopVoice(false);
      if(!voiceStatus?.textContent?.includes('Text erkannt'))voiceMessage('Aufnahme beendet. Bitte Text prüfen und manuell senden.');
    };
    try{recognition.start();}catch{stopVoice(false);voiceMessage('Mikrofon konnte nicht gestartet werden. Bitte tippen.');}
  }
  function addDictation(parent,target,id,label){
    if(!speechAvailable())return;
    const control=button(label,()=>dictate(target,control));
    control.id=id;control.dataset.voiceLabel=label;control.setAttribute('aria-pressed','false');
    parent.append(control);
  }
  function simpleReportForm(data){
    const r=data.report||{};
    result.append(el('h3','Tagesrapport'));
    line(result,'Datum (automatisch)',r.rapportDate);
    line(result,'Baustelle',r.siteName);
    line(result,'Monteur (aus Anmeldung)',r.authorName||'Angemeldeter Monteur');
    result.append(el('p','Notiere kurz die ausgeführten Arbeiten. Bei Problemen zusätzlich: was ist passiert, warum, wann, mit wem besprochen und was wurde vereinbart? Alles in einem Text.'));
    const label=el('label','Meine Arbeiten und Feststellungen');
    const work=el('textarea');
    work.id='assistant-report-workPerformed';
    work.rows=8;
    work.maxLength=5000;
    work.placeholder='Beispiel:\\nPaneele montiert.\\n14:10 Uhr: Beschädigung festgestellt. Ursache noch unklar.\\n14:20 Uhr mit Bauleiter XY vor Ort besprochen; Fotos gemacht.\\nVereinbart: Ersatzteil bestellen, vorerst nicht weiter montieren.';
    work.value=r.workPerformed||'';
    label.append(work);
    result.append(label);
    addDictation(result,work,'assistant-voice-report-workPerformed','Text diktieren');
    if(data.errors?.includes('description_too_long'))result.append(el('p','Text zu lang (maximal 5000 Zeichen).'));
    result.append(button('Rapport prüfen',()=>ask({
      tool:'report_draft',args:{siteId:data.siteId,report:{mode:'simple',workPerformed:work.value}}
    })));
    result.append(el('p','Es wird noch nichts gespeichert. Datum, Monteur und Einreichungszeitpunkt setzt der Server.'));
  }
  function reportForm(data){
    if(data.report?.mode==='simple')return simpleReportForm(data);
    const values={};
    line(result,'Baustelle',data.report.siteName);
    const keys=['rapportDate','timeStart','timeEnd','breakMinutes','workPerformed','materialUsed','issues','extraWork','notes'];
    for(const k of keys){
      const label=el('label',labels[k]);const n=el(['workPerformed','materialUsed','issues','extraWork','notes'].includes(k)?'textarea':'input');
      n.id='assistant-report-'+k;n.value=data.report[k]??'';
      if(['materialUsed','issues','extraWork','notes'].includes(k))n.maxLength=3000;
      if(k==='workPerformed')n.maxLength=5000;
      if(k==='rapportDate')n.type='date';if(k==='timeStart'||k==='timeEnd')n.type='time';if(k==='breakMinutes'){n.type='number';n.min='0';n.max='600';}
      label.append(n);result.append(label);
      if(k==='workPerformed'||k==='notes')addDictation(result,n,'assistant-voice-report-'+k,
        k==='workPerformed'?'Arbeiten diktieren':'Notizen diktieren');
      values[k]=n;
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
      const card=el('article');card.append(el('h3',ride.siteName||'Baustelle'));
      line(card,'Mit dir zugeordnet',(ride.companions||[]).map(c=>c.name).join(', ')||'kein weiterer Monteur zugeordnet');
      line(card,'Dein zugeordnetes Fahrzeug',[ride.vehicle?.name,ride.vehicle?.plate].filter(Boolean).join(' · ')||'nicht hinterlegt');point(card,ride.meetingPoint);
      for(const w of ride.warnings||[])card.append(el('p',w));result.append(card);
    }
    if(data.kind==='choose_site')for(const s of data.choices)result.append(button(s.name,()=>ask({tool:data.tool,args:{...data.args,siteId:s.id}})));
    if(data.kind==='documents')for(const d of data.documents){
      const card=el('article');card.append(el('h3',d.fileName||'Dokument'));line(card,'Dokumentdatum',d.documentDate||'nicht hinterlegt');line(card,'Version',d.version??'nicht hinterlegt');line(card,'Abgelegt',d.createdAt);
      card.append(button('Öffnen',()=>openDocument({...d,siteId:data.siteId})));result.append(card);
    }
    if(data.kind==='vacation_form')vacationForm(data);
    if(data.kind==='vacation_list')vacationList(data.requests||[]);
    if(data.kind==='report_form')reportForm(data);
    if(data.kind==='report_preview'){
      if(data.report?.mode==='simple'){
        result.append(el('h3','Rapportvorschau'));
        line(result,'Datum',data.report.rapportDate);
        line(result,'Baustelle',data.report.siteName);
        line(result,'Monteur',data.report.authorName||'Angemeldeter Monteur');
        const detail=el('p',data.report.workPerformed);
        detail.style.whiteSpace='pre-wrap';result.append(detail);
      }else{
        fields(result,data.report,['siteName','rapportDate','timeStart','timeEnd','breakMinutes','totalHours','workPerformed','materialUsed','issues','extraWork','notes']);
      }
      result.append(button('Rapport verbindlich speichern',()=>ask({confirmation:true,draftToken:data.draftToken})),
        button('Zurück bearbeiten',()=>render({...data,kind:'report_form',missingFields:[],errors:[]})));
    }
    if(data.kind==='report_saved'){
      line(result,'Monteur',data.authorName);
      line(result,'Gespeichert um',data.submittedAt);
      line(result,'Rapport-ID',data.reportId);
    }
  }
  function vacationList(items){
    for(const r of items){const card=el('article');card.append(el('h3','Ferien '+r.from+' bis '+r.to));
      line(card,'Status',r.status);line(card,'Bemerkung',r.note);line(card,'Begründung',r.reason);result.append(card);}
    if(!items.length)result.append(el('p','Noch keine Ferienanträge.'));
  }
  function vacationForm(data){
    const from=formField(result,'Ferienbeginn (mit Jahr)'),to=formField(result,'Ferienende (mit Jahr)'),note=formField(result,'Bemerkung (optional)','textarea');
    from.type=to.type='date';from.id='assistant-vacation-from';to.id='assistant-vacation-to';note.id='assistant-vacation-note';
    from.value=data.from||'';to.value=data.to||'';note.value=data.note||'';
    result.append(el('p','Mitarbeiter: automatisch aus deiner Anmeldung. Keine automatische Genehmigung.'));
    result.append(button('Ferienantrag prüfen',()=>{
      if(!/^\d{4}-\d{2}-\d{2}$/.test(from.value)||!/^\d{4}-\d{2}-\d{2}$/.test(to.value)||from.value>to.value){
        errorBox.replaceChildren(el('p','Bitte gültigen Zeitraum mit Jahr angeben.'));return;}
      const payload={from:from.value,to:to.value,note:note.value,confirmation:true,requestId:global.MonteurApi.newRequestId()};
      result.replaceChildren(el('h3','Ferienantrag prüfen'));line(result,'Von',payload.from);line(result,'Bis',payload.to);line(result,'Bemerkung',payload.note);
      result.append(button('Zurück bearbeiten',()=>render({...data,from:payload.from,to:payload.to,note:payload.note,kind:'vacation_form'})));
      result.append(button('Ferienantrag verbindlich absenden',async()=>{
        if(busy)return;const generation=epoch;setBusy(true);errorBox.replaceChildren();
        try{const saved=await global.MonteurApi.post('/app/monteur/ferien',payload);
          if(generation!==epoch)return;
          if(!saved.ok)throw Error('Ferienantrag wurde nicht als gespeichert bestätigt.');
          result.replaceChildren(el('h3','Ferienantrag eingereicht'),el('p','Status: '+saved.request.status));
        }catch(e){if(generation===epoch)failure(e);}finally{if(generation===epoch)setBusy(false);}
      }));
    }));
  }
  async function loadVacationFeature(){
    const generation=epoch;
    try{const data=await global.MonteurApi.get('/app/monteur/features');
      if(generation===epoch&&global.MonteurApi.hasSession()){vacationAvailable=data.vacationEnabled===true;vacationButton.hidden=!vacationAvailable;}
    }catch{if(generation===epoch)vacationButton.hidden=true;}
  }
  async function ask(body){
    if(busy)return;
    stopVoice();
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

  // Einfache Monteur-Navigation: grosse Auswahl statt Kommandos eintippen.
  const SECTIONS={
    baustellen:[['Mein Einsatz heute',()=>ask({tool:'my_assignments',args:{date:'heute'}})],
      ['Mein Einsatz morgen',()=>ask({tool:'my_assignments',args:{date:'morgen'}})],
      ['Baustellenadresse',()=>ask({tool:'site_info',args:{focus:'address'}})],
      ['Tagesrapport',()=>ask({tool:'report_draft',args:{}})],
      ['Mangel / Problem melden',()=>requestForm('site_issue')]],
    fahrzeuge:[['Service anfragen',()=>requestForm('vehicle_service')],
      ['Reparatur melden',()=>requestForm('vehicle_repair')],
      ['Fahrzeug-Services',()=>fleetOverview()]],
    werkzeuge:[['Werkzeug defekt',()=>requestForm('tool_repair')],
      ['Werkzeug zurückgeben',()=>toolReturn()],
      ['Werkzeugübersicht',()=>toolOverview()]],
    bestellungen:[['Material bestellen',()=>materialOrder()],
      ['Material anfragen',()=>requestForm('material_request')],
      ['Meine Bestellungen',()=>ownOrders()]],
    dokumente:[['Pläne anzeigen',()=>ask({tool:'site_documents',args:{}})],
      ['Dokument hochladen',()=>uploadInformation()]],
    postfach:[['Meine Ferienanträge',()=>ask({tool:'my_vacations',args:{}})],
      ['Meine Nachrichten',()=>showInbox()],
      ['Allgemeine Anfrage',()=>requestForm('general')]]
  };
  let sectionMenu=null, inboxTimer=null, noticeBox=null, lastNotified=new Set();
  function header(content){
    result.replaceChildren(el('h3',content));
    const back=button('← Zur Übersicht',()=>showHome());
    back.className='assistant-back';result.append(back);
    return result;
  }
  function showHome(){
    sectionMenu.hidden=false;
    result.replaceChildren(el('p','Wähle oben einen Bereich. Du musst keine Befehle schreiben.'));
  }
  function showSection(section){
    sectionMenu.hidden=true;header(({baustellen:'Baustellen',fahrzeuge:'Fahrzeuge',
      werkzeuge:'Werkzeuge',bestellungen:'Bestellungen',dokumente:'Dokumente',postfach:'Nachrichten'})[section]||section);
    const grid=el('div');grid.className='assistant-actions';
    for(const [name,action] of SECTIONS[section]){if(name==='Meine Ferienanträge'&&!vacationAvailable)continue;grid.append(button(name,action));}
    result.append(grid);
  }
  function formField(parent,title,tag='input'){
    const label=el('label',title);
    const control=el(tag);if(tag==='textarea'){control.rows=4;control.maxLength=1500;}
    label.append(control);parent.append(label);return control;
  }
  function populate(parent,items,title){
    const label=el('label',title),select=el('select');
    for(const item of items){const opt=el('option',item.label);opt.value=String(item.id);select.append(opt);}
    label.append(select);parent.append(label);return select;
  }
  async function requestForm(kind){
    sectionMenu.hidden=true;
    header(({vehicle_service:'Fahrzeug-Service anfragen',vehicle_repair:'Fahrzeug-Reparatur',
      tool_repair:'Werkzeug-Reparatur',material_request:'Material anfragen',
      site_issue:'Baustellenproblem melden',general:'Nachricht ans Büro'})[kind]);
    const generation=epoch;
    try{
      let targets=[],sites=[];
      if(kind.startsWith('vehicle_')){
        const data=await global.MonteurApi.get('/app/monteur/fleet');
        targets=(data.fahrzeuge||[]).map(v=>({id:v.id,label:[v.name,v.schild].filter(Boolean).join(' · ')}));
      }else if(kind==='tool_repair'){
        const data=await global.MonteurApi.get('/app/monteur/werkzeuge');
        targets=(data.werkzeuge||[]).filter(w=>w.verantwortlich!=='andere')
          .map(w=>({id:w.id,label:w.name+(w.status&&w.status!=='ok'?' ('+w.status+')':'')}));
      }
      if(kind==='site_issue'){
        const data=await global.MonteurApi.get('/app/monteur/sites');
        sites=(data.sites||[]).map(v=>({id:v.id,label:v.name}));
      }
      if(generation!==epoch)return;
      if((kind.startsWith('vehicle_')||kind==='tool_repair')&&!targets.length){
        result.append(el('p','Keine passenden Fahrzeuge oder Werkzeuge im Testbestand.'));return;
      }
      if(kind==='site_issue'&&!sites.length){
        result.append(el('p','Keine zugewiesene Baustelle vorhanden.'));return;
      }
      const form=el('div');
      const select=targets.length?populate(form,targets,kind==='tool_repair'?'Welches Werkzeug?':'Welches Fahrzeug?'):null;
      const siteSelect=sites.length?populate(form,sites,'Welche Baustelle?'):null;
      const details=formField(form,'Kurze Nachricht ans Büro','textarea');
      const defaults={vehicle_service:'Service nötig. Bitte Termin bestätigen.',
        vehicle_repair:'Fahrzeug benötigt eine Reparatur.',
        tool_repair:'Werkzeug defekt, bitte Reparatur organisieren.',
        material_request:'Ich benötige folgendes Material: ',
        site_issue:'Auf der Baustelle ist Folgendes passiert: ',
        general:''};
      details.value=defaults[kind]||'';
      const submit=button('Anfrage senden',async()=>{
        if(details.value.trim().length<3){failure(new Error('Bitte kurz beschreiben, was benötigt wird.'));return;}
        setBusy(true);
        try{
          const body={requestId:global.MonteurApi.newRequestId(),kind,message:details.value.trim()};
          if(select)body.targetId=select.value;
          if(siteSelect)body.siteId=siteSelect.value;
          const data=await global.MonteurApi.post('/app/monteur/requests',body);
          if(!data.ok)throw Error('Anfrage nicht bestätigt');
          await showInbox('Anfrage ans Büro gesendet. Die Antwort erscheint hier im Postfach.');
        }catch(e){failure(e);}
        finally{setBusy(false);}
      });
      form.append(submit);
      result.append(form);
    }catch(e){failure(e);}
  }
  function requestCard(parent,record){
    const card=el('article');
    card.append(el('h3',record.targetLabel||record.kind));
    line(card,'Anfrage',record.message);
    line(card,'Status',record.status);
    line(card,'Antwort Büro',record.reply);
    if(record.appointmentDate)line(card,'Termin',[record.appointmentDate,record.appointmentTime].filter(Boolean).join(' · '));
    line(card,'Bereit im Fach / Standort',record.pickupLocation);
    line(card,'Aktualisiert',record.updatedAt);
    if(record.version>record.ackVersion)card.append(button('✓ Gelesen',async()=>{
      try{
        await global.MonteurApi.post((record.kind==='vacation_request'?'/app/monteur/ferien/':'/app/monteur/requests/')+encodeURIComponent(record.id)+'/ack',{version:record.version});
        await showInbox();
      }catch(e){failure(e);}
    }));
    parent.append(card);
  }
  async function showInbox(message=''){
    sectionMenu.hidden=true;header('Meine Nachrichten');
    if(message)result.append(el('p',message));
    try{
      const data=await global.MonteurApi.get('/app/monteur/requests');
      const own=data.requests||[];
      if(!own.length)result.append(el('p','Noch keine Anfragen oder Antworten vorhanden.'));
      for(const r of own)requestCard(result,r);
    }catch(e){failure(e);}
  }
  async function checkMessages(){
    if(!global.MonteurApi?.hasSession()||noticeBox)return;
    const generation=epoch;
    try{
      const data=await global.MonteurApi.get('/app/monteur/requests');
      if(generation!==epoch||!global.MonteurApi.hasSession()||noticeBox)return;
      const unread=(data.requests||[]).filter(r=>r.version>r.ackVersion&&!lastNotified.has(r.id+':'+r.version));
      if(!unread.length)return;
      const first=unread[0];lastNotified.add(first.id+':'+first.version);
      noticeBox?.remove();
      noticeBox=el('div');
      noticeBox.className='assistant-notice';
      noticeBox.setAttribute('role','status');
      noticeBox.append(el('strong','📬 Neue Antwort vom Büro'));
      const shown=noticeBox;
      const r=unread[0];noticeBox.append(el('p',[r.targetLabel||r.kind,r.reply||r.status].join(' · ')));
      noticeBox.append(button('Nachricht ansehen',()=>{noticeBox.remove();noticeBox=null;panel.hidden=false;showInbox();}));
      if(r.kind==='vacation_request')noticeBox.append(button('Verstanden',async()=>{
        try{await global.MonteurApi.post('/app/monteur/ferien/'+encodeURIComponent(r.id)+'/ack',{version:r.version});
          if(generation!==epoch)return;shown.remove();if(noticeBox===shown)noticeBox=null;await checkMessages();
        }catch(e){if(generation===epoch&&noticeBox===shown)shown.append(el('p','Nicht quittiert. Bitte erneut versuchen.'));}
      }));
      else noticeBox.append(button('Später',()=>{noticeBox.remove();noticeBox=null;}));
      document.body.append(noticeBox);
    }catch{/* connection errors should not interrupt the Monteur's current work */}
  }
  function startInboxPolling(){
    if(inboxTimer)global.clearInterval(inboxTimer);
    lastNotified=new Set();
    checkMessages();
    inboxTimer=global.setInterval(checkMessages,60000);
  }
  function stopInboxPolling(){
    if(inboxTimer)global.clearInterval(inboxTimer);
    inboxTimer=null;noticeBox?.remove();noticeBox=null;lastNotified.clear();
  }
  async function fleetOverview(){
    sectionMenu.hidden=true;header('Fahrzeuge und Services');
    try{
      const [data,inbox]=await Promise.all([
        global.MonteurApi.get('/app/monteur/fleet'),
        global.MonteurApi.get('/app/monteur/requests')
      ]);
      for(const v of data.fahrzeuge||[]){
        const card=el('article');card.append(el('h3',[v.name,v.schild].filter(Boolean).join(' · ')));
        const next=(v.services||[]).filter(s=>s.typ==='reminder'&&s.reminderDate)
          .sort((a,b)=>a.reminderDate.localeCompare(b.reminderDate));
        if(next.length)for(const service of next.slice(0,3))
          line(card,'Service-Erinnerung',service.reminderDate+' – '+service.beschreibung);
        const appointments=(inbox.requests||[]).filter(r=>r.targetId===v.id &&
          (r.kind==='vehicle_service'||r.kind==='vehicle_repair') &&
          r.status==='terminiert'&&r.appointmentDate);
        for(const appointment of appointments)line(card,'Vom Büro bestätigter Termin',
          appointment.appointmentDate+(appointment.appointmentTime?' · '+appointment.appointmentTime:''));
        card.append(button('Service anfragen',()=>requestForm('vehicle_service')));
        result.append(card);
      }
    }catch(e){failure(e);}
  }
  async function toolOverview(){
    sectionMenu.hidden=true;header('Werkzeuge');
    try{
      const data=await global.MonteurApi.get('/app/monteur/werkzeuge');
      for(const tool of data.werkzeuge||[]){
        const card=el('article');card.append(el('strong',tool.name));
        line(card,'Status',tool.status);line(card,'Verantwortlich',tool.verantwortlich||'noch nicht zugeteilt');
        result.append(card);
      }
    }catch(e){failure(e);}
  }
  async function toolReturn(){
    sectionMenu.hidden=true;header('Werkzeug zurückgeben');
    try{
      const data=await global.MonteurApi.get('/app/monteur/werkzeuge');
      const list=(data.werkzeuge||[]).filter(w=>w.verantwortlich==='ich');
      if(!list.length){result.append(el('p','Du hast kein Werkzeug als ausgegeben hinterlegt.'));return;}
      const form=el('div'),select=populate(form,list.map(w=>({id:w.id,label:w.name})),'Werkzeug');
      const shelf=formField(form,'Rückgabeort (optional)');shelf.placeholder='z. B. Lager Allschwil';
      form.append(button('Rückgabe bestätigen',async()=>{
        try{
          const out=await global.MonteurApi.post('/app/monteur/werkzeug/bewegung',{
            werkzeugId:select.value,aktion:'rueckgabe',lagerort:shelf.value,requestId:global.MonteurApi.newRequestId()
          });
          if(out.ok){header('Rückgabe bestätigt');result.append(el('p','Werkzeug wurde als zurückgegeben verbucht.'));}
        }catch(e){failure(e);}
      }));
      result.append(form);
    }catch(e){failure(e);}
  }
  async function materialOrder(){
    sectionMenu.hidden=true;header('Material bestellen');
    try{
      const [products,sites]=await Promise.all([global.MonteurApi.get('/app/monteur/artikel'),
        global.MonteurApi.get('/app/monteur/sites')]);
      if(!products.artikel?.length){result.append(el('p','Kein Artikelkatalog hinterlegt. Material kannst du als freie Anfrage senden.'));result.append(button('Material anfragen',()=>requestForm('material_request')));return;}
      const form=el('div'),article=populate(form,products.artikel.map(x=>({id:x.id,label:x.name+' · '+x.einheit})),'Artikel');
      const qty=formField(form,'Menge');qty.type='number';qty.min='1';qty.max='10000';qty.value='1';
      const site=populate(form,[{id:'',label:'Ohne Baustellenbezug'},...(sites.sites||[]).map(x=>({id:x.id,label:x.name}))],'Baustelle');
      const note=formField(form,'Bemerkung (optional)');note.placeholder='z. B. dringend für morgen';
      form.append(button('Bestellung absenden',async()=>{
        const menge=Number(qty.value);
        if(!Number.isInteger(menge)||menge<1||menge>10000){failure(new Error('Bitte gültige Stückzahl eingeben.'));return;}
        try{
          const r=await global.MonteurApi.post('/app/monteur/bestellung',{
            requestId:global.MonteurApi.newRequestId(),items:[{artikelId:article.value,menge}],
            siteId:site.value||null,bemerkung:note.value
          });
          if(r.ok){header('Bestellung erfasst');result.append(el('p','Bestellung wurde im LagerTool registriert.'));
            line(result,'Versandstatus',r.bestellung?.mail?.status||'noch offen');
            if(!r.officeNotified)result.append(el('p','Die Zustellung ins Büro-Postfach ist noch nicht bestätigt. Bitte im Büro nachfragen.'));}
        }catch(e){failure(e);}
      }));
      result.append(form);
    }catch(e){failure(e);}
  }
  async function ownOrders(){
    sectionMenu.hidden=true;header('Meine Bestellungen');
    try{
      const data=await global.MonteurApi.get('/app/monteur/bestellungen');
      if(!data.bestellungen?.length)result.append(el('p','Noch keine Bestellung erfasst.'));
      for(const o of data.bestellungen||[]){
        const card=el('article');card.append(el('h3',o.siteName||'Materialbestellung'));
        line(card,'Status',o.status);line(card,'Artikel',(o.items||[]).map(i=>i.menge+' × '+i.name).join(', '));
        line(card,'Bemerkung',o.bemerkung);result.append(card);
      }
    }catch(e){failure(e);}
  }
  async function uploadInformation(){
    sectionMenu.hidden=true;header('Foto oder PDF hochladen');
    result.append(el('p','Dateien landen privat zur Prüfung beim Büro. Sie werden nicht automatisch für andere Monteure freigegeben.'));
    try{
      const data=await global.MonteurApi.get('/app/monteur/sites');
      const sites=data.sites||[];
      if(!sites.length){result.append(el('p','Keine zugewiesene Baustelle.'));return;}
      const form=el('div');
      const site=populate(form,sites.map(x=>({id:x.id,label:x.name})),'Baustelle');
      const label=el('label','Foto oder PDF (max. 8 MB)');
      const file=el('input');file.type='file';file.accept='.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp';
      label.append(file);form.append(label);
      form.append(button('Datei ans Büro senden',async()=>{
        const selected=file.files?.[0];
        if(!selected){failure(new Error('Bitte zuerst ein Foto oder PDF auswählen.'));return;}
        if(selected.size>8*1024*1024){failure(new Error('Die Datei darf maximal 8 MB gross sein.'));return;}
        setBusy(true);
        try{
          const done=await global.MonteurApi.uploadDocument(site.value,selected);
          if(done.ok){header('Upload erfolgreich');
            result.append(el('p','Die Datei '+done.fileName+' ist privat für das Büro hinterlegt.'));
            result.append(el('p','Sie erscheint in der Büro-Rubrik Anfragen und muss erst geprüft werden.'));}
        }catch(e){failure(e);}finally{setBusy(false);}
      }));
      result.append(form);
    }catch(e){failure(e);}
  }

  function mount(){
    if(panel)return;
    const style=el('style',`#monteur-assistant-launch{position:fixed;right:16px;bottom:85px;z-index:2000;padding:12px 18px;border-radius:24px;background:#155e4b;color:white;border:0;font-weight:700}#monteur-assistant{position:fixed;right:12px;bottom:85px;z-index:2100;width:min(660px,calc(100vw - 16px));max-height:92vh;overflow:auto;background:#fff;color:#152820;border:1px solid #cad7d0;border-radius:16px;box-shadow:0 12px 48px #0003;padding:18px;font:14px system-ui}#monteur-assistant[hidden],#monteur-assistant-launch[hidden]{display:none}#monteur-assistant button{padding:10px;margin:4px;border:1px solid #b4c8bc;border-radius:8px;background:#eef5ef;color:#183b2b;cursor:pointer}#monteur-assistant .assistant-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin:8px 0 16px}#monteur-assistant .assistant-actions button{min-height:55px;padding:12px;font-weight:650}#monteur-assistant .assistant-back{background:#e0ebe4}#monteur-assistant button:disabled{opacity:.5;cursor:wait}#monteur-assistant textarea,#monteur-assistant input{display:block;width:100%;box-sizing:border-box;margin:6px 0 12px;padding:10px;border:1px solid #a4b9ae;border-radius:7px}#monteur-assistant label{display:block;margin-top:10px}#monteur-assistant article{border-top:1px solid #dce5df;margin-top:12px;padding-top:8px}#monteur-assistant p{white-space:pre-wrap;overflow-wrap:anywhere;margin:9px 0}#assistant-errors{color:#a22525}`);
    style.textContent += '.assistant-notice{position:fixed;right:16px;top:16px;z-index:9999;background:#fff;color:#17372b;border:2px solid #337e61;box-shadow:0 12px 38px #0003;padding:16px;border-radius:12px;max-width:min(420px,calc(100vw - 32px));font:15px system-ui}.assistant-notice button{padding:9px;margin:4px;background:#e9f5ee;border:1px solid #a1c1ae;border-radius:8px;cursor:pointer}';
    document.body.append(style);
    launcher=button('Assistent',()=>{if(!panel.hidden)stopVoice();panel.hidden=!panel.hidden;if(!panel.hidden)input.focus();});launcher.id='monteur-assistant-launch';launcher.hidden=true;
    panel=el('section');panel.id='monteur-assistant';panel.hidden=true;panel.setAttribute('aria-label','Monteur-Assistent');
    panel.append(el('h2','Dein Assistent'),button('Schliessen',()=>{stopVoice();panel.hidden=true;}));
    panel.append(el('p','Frage mich nach deinen Baustellen, Adressen, Kontakten, Arbeitsbeginn, Plänen oder Berichten. Die Antworten kommen aus dem LagerTool – ohne zusätzliche KI.'));
    sectionMenu=el('div');sectionMenu.className='assistant-actions';
    for(const [id,title] of [['baustellen','🏗️ Baustellen'],['fahrzeuge','🚐 Fahrzeuge'],
      ['werkzeuge','🧰 Werkzeuge'],['bestellungen','📦 Bestellungen'],['dokumente','📁 Dokumente'],
      ['postfach','📬 Nachrichten']])sectionMenu.append(button(title,()=>showSection(id)));
    vacationButton=button('Ferien beantragen',()=>ask({tool:'vacation_request',args:{}}));vacationButton.id='assistant-vacation-launch';vacationButton.hidden=true;
    panel.append(vacationButton);
    panel.append(sectionMenu);
    const shortcutDetails=el('details');const quickSummary=el('summary','Schnellfragen (optional)');shortcutDetails.append(quickSummary);
    const shortcuts=el('div');shortcuts.style.display='grid';shortcuts.style.gridTemplateColumns='repeat(2,minmax(0,1fr))';
    for(const [label,command] of [
      ['Mein Einsatz morgen',{tool:'my_assignments',args:{date:'morgen'}}],
      ['Adresse meiner Baustelle',{tool:'site_info',args:{focus:'address'}}],
      ['Projektleitung / Telefon',{tool:'site_info',args:{focus:'contacts'}}],
      ['Montageinformationen',{tool:'site_info',args:{focus:'work'}}],
      ['Pläne anzeigen',{tool:'site_documents',args:{}}],
      ['Mit wem fahre ich?',{tool:'my_ride',args:{date:'morgen'}}],
      ['Bericht erfassen',{tool:'report_draft',args:{}}]
    ])shortcuts.append(button(label,()=>ask(command)));
    shortcutDetails.append(shortcuts);panel.append(shortcutDetails);
    const label=el('label','Deine Anfrage');input=el('textarea');input.id='assistant-message';input.maxLength=4000;input.placeholder='z. B. Adresse Mercedes Schlieren oder Wer ist die Projektleitung?';input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();const message=input.value.trim();if(message)ask({message});}});label.append(input);panel.append(label);
    addDictation(panel,input,'assistant-voice-question','Frage diktieren');
    if(speechAvailable()){
      panel.append(el('p','Datenschutz: Die Spracherkennung kann Audio an den Dienst des Browseranbieters übertragen. Sie startet nur mit deinem Klick. Prüfe den erkannten Text vor dem Senden.'));
    }else{
      panel.append(el('p','Spracheingabe hier nicht verfügbar. Die Texteingabe funktioniert weiterhin.'));
    }
    voiceStatus=el('p');voiceStatus.id='assistant-voice-status';voiceStatus.setAttribute('role','status');voiceStatus.setAttribute('aria-live','polite');
    panel.append(voiceStatus);
    panel.append(button('Senden',()=>{const message=input.value.trim();if(message)return ask({message});}));
    errorBox=el('div');errorBox.id='assistant-errors';errorBox.setAttribute('role','alert');result=el('div');result.id='assistant-result';result.setAttribute('aria-live','polite');panel.append(errorBox,result);
    document.body.append(launcher,panel);
  }
  function reset(){stopInboxPolling();stopVoice();epoch++;busy=false;vacationAvailable=false;if(!panel)return;result.replaceChildren();errorBox.replaceChildren();input.value='';panel.hidden=true;launcher.hidden=true;if(vacationButton)vacationButton.hidden=true;setBusy(false);}
  global.MonteurAssistant={ask,mount,show(){mount();launcher.hidden=false;startInboxPolling();loadVacationFeature();showHome();},reset};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})(typeof window!=='undefined'?window:globalThis);
