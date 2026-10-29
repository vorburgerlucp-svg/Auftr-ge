// PINs stay in password inputs only; no browser persistence. Success requires a fresh login.
(function(global){
'use strict';
let current=null;
function close(){if(current){current.remove();current=null;}}
function open({change,complete,cancel}){
 close();
 const dialog=document.createElement('dialog');current=dialog;
 dialog.setAttribute('aria-label','PIN-Erstwechsel');
 const form=document.createElement('form');form.method='dialog';
 const heading=document.createElement('h2');heading.textContent='PIN beim ersten Zugang ändern';form.append(heading);
 const inputs=[];
 for(const [label,id] of [['Bisherige PIN','old-pin'],['Neue PIN','new-pin'],['Neue PIN bestätigen','confirm-pin']]){
  const box=document.createElement('label');box.textContent=label;
  const input=document.createElement('input');input.id=id;input.type='password';input.inputMode='numeric';input.maxLength=4;input.pattern='[0-9]{4}';input.required=true;input.autocomplete=id==='old-pin'?'current-password':'new-password';
  box.append(input);form.append(box,document.createElement('br'));inputs.push(input);
 }
 const message=document.createElement('p');message.setAttribute('role','status');form.append(message);
 const submit=document.createElement('button');submit.textContent='PIN ändern';submit.type='submit';form.append(submit);
 const abort=document.createElement('button');abort.textContent='Abbrechen';abort.type='button';abort.onclick=()=>{close();cancel?.();};form.append(abort);
 dialog.addEventListener('cancel',()=>{close();cancel?.();});
 form.onsubmit=async event=>{
  event.preventDefault();if(submit.disabled)return;
  const [old,newPin,confirm]=inputs.map(i=>i.value);
  if(!/^\d{4}$/.test(newPin)||newPin!==confirm||old===newPin){message.textContent='Neue PIN prüfen: vier Ziffern, zweimal gleich und anders als bisher.';return;}
  submit.disabled=true;message.textContent='';
  try{await change(old,newPin);if(current!==dialog)return;inputs.forEach(i=>i.value='');close();complete();}
  catch(e){if(current!==dialog)return;message.textContent=e.status===423?'Konto vorübergehend gesperrt.':e.status===0?'Keine Verbindung. Bitte erneut versuchen.':'PIN konnte nicht geändert werden. Eingaben prüfen.';}
  finally{submit.disabled=false;}
 };
 dialog.append(form);document.body.append(dialog);dialog.showModal();
}
global.PilotPin={open,close};
})(window);
