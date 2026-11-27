// Shared report rubric for the office app and the isolated pilot office.
function bzRapportDatum(value) {
  if (!value) return 'Zeitpunkt nicht hinterlegt';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Zeitpunkt nicht hinterlegt'
    : date.toLocaleString('de-CH', { timeZone: 'Europe/Zurich', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function bzRenderRapporte() {
  const el = document.getElementById('bz-rapporte-section');
  if (!el) return;
  if (!bzSession) {
    el.innerHTML = `
      <div style="font-weight:700;font-size:14px;margin-bottom:8px">Büro-Anmeldung für Arbeitsrapporte</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px">Nur berechtigte Büromitarbeiter können Rapporte sehen.</div>
      <input type="text" id="bz-rapport-login-name" autocomplete="username" placeholder="Name" style="margin-bottom:6px">
      <input type="password" id="bz-rapport-login-pin" autocomplete="current-password" maxlength="4" inputmode="numeric" placeholder="PIN" style="margin-bottom:6px">
      <button class="btn btn-primary" onclick="bzAnmelden('rapporte')">Anmelden</button>
      ${bzMeldung ? '<div style="font-size:12px;color:var(--red);margin-top:8px">' + bzEsc(bzMeldung) + '</div>' : ''}`;
    return;
  }
  const rapporte = Array.isArray(bzDaten.rapporte) ? bzDaten.rapporte : [];
  const baustellen = state.baustellen || [];
  // Alte Rapporte bleiben auch sichtbar, wenn die Baustelle nicht mehr im Stamm geführt wird.
  const sites = new Map(baustellen.map(b => [String(b.id), String(b.name || b.id)]));
  for (const r of rapporte) if (!sites.has(String(r.siteId))) sites.set(String(r.siteId), String(r.siteName || r.siteId));
  const siteOptions = [...sites.entries()].sort((a,b) => a[1].localeCompare(b[1], 'de'))
    .map(([id,name]) => `<option value="${bzEsc(id)}"${bzRapportSiteId === id ? ' selected' : ''}>${bzEsc(name)}</option>`).join('');
  const people = new Map();
  for (const r of rapporte) {
    if (r.autorId == null) continue;
    const id = String(r.autorId), name = String(r.autorName || bzName(id));
    if (!people.has(id)) people.set(id, name);
  }
  const personOptions = [...people.entries()].sort((a,b) => a[1].localeCompare(b[1], 'de'))
    .map(([id,name]) => `<option value="${bzEsc(id)}"${bzRapportAutorId === id ? ' selected' : ''}>${bzEsc(name)}</option>`).join('');
  const selection = rapporte.filter(r =>
    (bzRapportSiteId === 'all' || String(r.siteId) === bzRapportSiteId) &&
    (bzRapportAutorId === 'all' || String(r.autorId) === bzRapportAutorId)
  ).sort((a,b) => String(b.submittedAt || b.createdAt || b.datum || '').localeCompare(String(a.submittedAt || a.createdAt || a.datum || '')));
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px">
      <div><b>Angemeldet als ${bzEsc(bzSession.name)}</b></div>
      <div><button class="btn btn-sm" onclick="bzLaden()">↻ Aktualisieren</button>
      <button class="btn btn-sm" onclick="bzAbmelden()">Abmelden</button></div>
    </div>
    ${bzMeldung ? '<p style="color:var(--red)">' + bzEsc(bzMeldung) + '</p>' : ''}
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">
      <label style="flex:1;min-width:170px">Baustelle
        <select id="bz-rapport-site" onchange="bzRapportSiteId=this.value;bzRenderRapporte()">
          <option value="all">Alle Baustellen</option>${siteOptions}
        </select>
      </label>
      <label style="flex:1;min-width:170px">Eingereicht von
        <select id="bz-rapport-autor" onchange="bzRapportAutorId=this.value;bzRenderRapporte()">
          <option value="all">Alle Monteure</option>${personOptions}
        </select>
      </label>
    </div>
    <div style="font-weight:700;font-size:14px;margin-bottom:10px">Eingereichte Rapporte (${selection.length})</div>
    ${selection.length ? selection.map(r => `
      <article style="border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px">
        <div style="font-weight:700;font-size:13px">${bzEsc(r.siteName || sites.get(String(r.siteId)) || r.siteId)} · ${bzEsc(r.datum)}</div>
        ${r.mode === 'simple' ? '' : `<div style="font-size:12px;color:var(--muted);margin-top:4px">Arbeitszeit: ${bzEsc(r.timeStart)}–${bzEsc(r.timeEnd)} · Pause ${bzEsc(r.breakMinutes)} Min.${r.totalHours == null ? '' : ' · ' + bzEsc(r.totalHours) + ' Std.'}</div>`}
        <div style="font-size:13px;margin-top:8px"><b>Eingereicht von: ${bzEsc(r.autorName || bzName(r.autorId))}</b> (Mitarbeiter-ID: ${bzEsc(r.autorId)})</div>
        <div style="font-size:12px;color:var(--muted)">Abgegeben am: ${bzEsc(bzRapportDatum(r.submittedAt || r.createdAt))} · Rapport-ID: ${bzEsc(r.id)}</div>
        <div style="white-space:pre-wrap;overflow-wrap:anywhere;margin-top:9px">${bzEsc(r.workPerformed)}</div>
        ${r.materialUsed ? '<div style="margin-top:6px;font-size:12px">Material: ' + bzEsc(r.materialUsed) + '</div>' : ''}
        ${r.issues ? '<div style="margin-top:6px;font-size:12px">Probleme: ' + bzEsc(r.issues) + '</div>' : ''}
        ${r.extraWork ? '<div style="margin-top:6px;font-size:12px">Zusatzarbeiten: ' + bzEsc(r.extraWork) + '</div>' : ''}
        ${r.notes ? '<div style="margin-top:6px;font-size:12px">Notizen: ' + bzEsc(r.notes) + '</div>' : ''}
        <div style="margin-top:8px;font-size:12px;color:var(--muted)">Für Rückfragen: ${bzEsc(r.autorName || bzName(r.autorId))}</div>
      </article>`).join('') : '<p style="color:var(--muted)">Keine Arbeitsrapporte für diese Auswahl vorhanden.</p>'}`;
}

