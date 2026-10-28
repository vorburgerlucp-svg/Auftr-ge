import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const begin = html.indexOf('function bzRapportDatum(value) {');
const end = html.indexOf('function bzRender() {', begin);
if(begin<0||end<=begin)throw Error('Separate Rapportansicht fehlt');
const code = html.slice(begin,end);

const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));
function render(rapporte,opts={}) {
  const el={innerHTML:''};
  const ctx=vm.createContext({
    document:{getElementById:id=>id==='bz-rapporte-section'?el:null},
    bzSession:opts.session===false?null:{name:'Büro Test'},
    bzDaten:{rapporte},bzMeldung:null,
    bzRapportSiteId:opts.site||'all',bzRapportAutorId:opts.autor||'all',
    state:{baustellen:[{id:42,name:'Baustelle Nord'}]},
    bzName:id=> 'Mitarbeiter '+id,bzEsc:esc,Date
  });
  vm.runInContext(code+'\nbzRenderRapporte();',ctx);
  return el.innerHTML;
}
const samples=[
 {id:'rapport_abcd0001',siteId:'42',siteName:'Baustelle Nord',
  autorId:'m1',autorName:'Patrick Härter',datum:'2026-10-28',
  submittedAt:'2026-10-28T09:10:00Z',timeStart:'07:00',timeEnd:'16:00',breakMinutes:30,
  workPerformed:'Türrahmen montiert'},
 {id:'rapport_abcd0002',siteId:'57',siteName:'Baustelle Süd',
  autorId:'m2',autorName:'Test Monteur',datum:'2026-10-27',
  submittedAt:'2026-10-27T09:00:00Z',timeStart:'07:00',timeEnd:'15:00',breakMinutes:30,
  workPerformed:'Türen montiert'}
];

test('eigener Büro-Menüpunkt und eigene Seite, getrennt von Meldungen',()=>{
  assert.match(html,/onclick="showPage\('rapporte'\)"/);
  assert.match(html,/id="page-rapporte"/);
  assert.match(html,/id="bz-rapporte-section"/);
  assert.match(html,/id="page-meldungen"/);
  assert.match(html,/if \(id === 'rapporte'\)/);
});
test('Rapporte zeigen den originalen Einreicher und Abgabezeit – auch ohne aktiven Mitarbeitereintrag',()=>{
  const view=render(samples);
  assert.match(view,/Eingereicht von: Patrick Härter/);
  assert.match(view,/Mitarbeiter-ID: m1/);
  assert.match(view,/Abgegeben am:/);
  assert.match(view,/Rapport-ID: rapport_abcd0001/);
  assert.match(view,/Baustelle Nord/);
  assert.match(view,/Baustelle Süd/);
});
test('Büro kann nach Baustelle und Verfasser filtern',()=>{
  const siteView=render(samples,{site:'42'});
  assert.match(siteView,/Türrahmen montiert/);
  assert.doesNotMatch(siteView,/Türen montiert/);
  const authorView=render(samples,{autor:'m2'});
  assert.match(authorView,/Test Monteur/);
  assert.doesNotMatch(authorView,/Eingereicht von: Patrick Härter/);
});
test('Rapportdaten sind HTML-escaped und ohne Büroanmeldung nicht sichtbar',()=>{
  const injected=[{...samples[0],autorName:'<img src=x onerror=alert(1)>',
    workPerformed:'<script>alert("XSS")</script>'}];
  const view=render(injected);
  assert.doesNotMatch(view,/<img src=x onerror=/);
  assert.doesNotMatch(view,/<script>alert/);
  assert.match(view,/&lt;img/);
  assert.match(view,/&lt;script&gt;/);
  assert.doesNotMatch(render(injected,{session:false}),/rapport_abcd0001/);
});
