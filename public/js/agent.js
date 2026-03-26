// Kurtex - Agent/Dispatcher Application
// Designed by Rekka Software

const TL = { pickup: 'PickUp Trailer', drop: 'Drop Trailer', general: 'General' };

const G = {
  drivers: [], sel: null, isAdmin: false,
  lbPhotos: [], lbIdx: 0,
  feedFilter: 'all', feedRows: [],
  usersMap: {},
  allSteps: [],
  currentStepType: 'pickup'
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    const r = await fetch('/api/me');
    if (!r.ok) { location.href = '/login'; return; }
    const u = await r.json();
    if (u.role === 'driver') { location.href = '/driver/inspect'; return; }

    G.isAdmin = u.role === 'superadmin';
    document.getElementById('agentName').textContent = u.name || u.username;
    document.getElementById('roleBadge').textContent = G.isAdmin ? 'Admin' : 'Dispatcher';

    if (G.isAdmin) {
      document.getElementById('navAdmin').style.display = 'flex';
      document.getElementById('adminSep').style.display = 'block';
      const mNavAdmin = document.getElementById('mNavAdmin');
      if (mNavAdmin) mNavAdmin.style.display = 'flex';
    }

    document.getElementById('mobileNav').style.display = 'flex';
    loadStats();
    loadDrivers();
  } catch (e) { location.href = '/login'; }
}

// ── Stats ──────────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const d = await (await fetch('/api/agent/stats')).json();
    document.getElementById('sD').textContent  = d.totalDrivers;
    document.getElementById('sDi').textContent = d.totalDispatchers || '—';
    document.getElementById('sT').textContent  = d.totalInspections;
    document.getElementById('sTd').textContent = d.todayInspections;
    document.getElementById('sP').textContent  = d.totalPhotos;
  } catch (e) {}
}

// ── Drivers list ───────────────────────────────────────────────────────────
async function loadDrivers() {
  try {
    G.drivers = await (await fetch('/api/agent/drivers')).json();
    document.getElementById('dCount').textContent = G.drivers.filter(d => d.active).length;
    renderDrivers(G.drivers);
  } catch (e) {}
}

function renderDrivers(list) {
  const el = document.getElementById('driversList');
  if (!list.length) { el.innerHTML = '<div style="padding:16px;font-size:15px;color:var(--dim);font-weight:600">No drivers</div>'; return; }
  el.innerHTML = list.map(d => {
    const av = (d.full_name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    return `<div class="driver-row${G.sel?.id===d.id?' sel':''}" onclick="selectDriver(${d.id})" data-id="${d.id}">
      <div class="dr-av">${av}</div>
      <div class="dr-info">
        <div class="dr-name">${esc(d.full_name)}</div>
        <div class="dr-sub">${esc(d.truck_model||'No truck assigned')}${d.truck_number?' · '+esc(d.truck_number):''}</div>
      </div>
      <div class="dr-cnt">${d.submitted_count||0}</div>
    </div>`;
  }).join('');
}

function filterDrivers() {
  const q = document.getElementById('searchBox').value.toLowerCase();
  renderDrivers(G.drivers.filter(d =>
    (d.full_name||'').toLowerCase().includes(q) ||
    (d.truck_model||'').toLowerCase().includes(q) ||
    (d.truck_number||'').toLowerCase().includes(q)
  ));
}

async function selectDriver(id) {
  const d = G.drivers.find(x => x.id === id);
  if (!d) return;
  G.sel = d;
  document.querySelectorAll('.driver-row').forEach(el => el.classList.toggle('sel', parseInt(el.dataset.id) === id));
  document.getElementById('detailEmpty').style.display = 'none';
  const content = document.getElementById('detailContent');
  content.style.display = 'flex';
  document.getElementById('detailName').textContent = d.full_name;
  document.getElementById('detailSub').innerHTML = `<span>${esc(d.truck_model||'No truck')}${d.truck_number?' · '+esc(d.truck_number):''}</span><span>${d.submitted_count||0} inspection${d.submitted_count!==1?'s':''}</span>`;

  if (window.innerWidth <= 768) {
    document.querySelector('.drivers-col').style.display = 'none';
    document.querySelector('.detail-col').style.display = 'flex';
    document.getElementById('backToDriversBtn').style.display = 'flex';
    document.getElementById('inspList').scrollTop = 0;
  }

  const list = document.getElementById('inspList');
  list.innerHTML = '<div style="padding:14px;color:var(--dim);font-weight:600">Loading…</div>';

  try {
    const insps = await (await fetch(`/api/agent/drivers/${id}/inspections`)).json();
    if (!insps.length) { list.innerHTML = '<div style="padding:14px;color:var(--dim);font-weight:600">No inspections yet.</div>'; return; }
    list.innerHTML = insps.map(i => {
      const tk = i.inspection_type || 'pickup';
      return `<div class="insp-card">
        <div class="insp-card-hd" onclick="toggleCard('${i.id}')">
          <div>
            <div class="insp-card-date"><span class="type-badge ${tk}">${TL[tk]||tk}</span>${fmtDate(i.submitted_at)}</div>
            <div class="insp-card-sub">${i.photo_count} photos${i.asset_number?' · '+esc(i.asset_number):''}${i.latitude?' · GPS':''}</div>
          </div>
          <div class="insp-card-r">
            <div class="pill-ok">Submitted</div>
            <svg class="chev" id="chev-${i.id}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;color:var(--muted)"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
        </div>
        <div class="insp-card-body" id="body-${i.id}">
          <div id="cnt-${i.id}"><div style="color:var(--dim);font-weight:600">Loading…</div></div>
        </div>
      </div>`;
    }).join('');
  } catch (e) { list.innerHTML = '<div style="color:var(--red);font-weight:700">Error loading.</div>'; }
}

async function toggleCard(id) {
  const body = document.getElementById(`body-${id}`), chev = document.getElementById(`chev-${id}`);
  if (body.classList.contains('open')) { body.classList.remove('open'); if(chev) chev.classList.remove('open'); return; }
  body.classList.add('open'); if(chev) chev.classList.add('open');
  const c = document.getElementById(`cnt-${id}`);
  if (c.dataset.loaded) return;

  try {
    const insp = await (await fetch(`/api/agent/inspections/${id}`)).json();
    c.dataset.loaded = '1';
    const photos = insp.photos || [];
    const mapUrl = insp.latitude ? `https://www.google.com/maps?q=${insp.latitude},${insp.longitude}` : null;
    window._lbPhotos = window._lbPhotos || {};
    window._lbPhotos[id] = photos;

    c.innerHTML = `
      ${photos.length ? `<div class="photo-grid">${photos.map((p,i) =>
        `<div class="photo-cell${p.flagged?' flagged':''}" onclick="openLb('${id}',${i})">
          <img src="${esc(p.file_path)}" loading="lazy">
          <div class="photo-cell-lbl">${esc(p.step_label||'Step '+p.step_number)}</div>
          <div class="photo-cell-num">${p.step_number}</div>
          ${p.flagged?`<div class="photo-flag-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg></div>`:''}
        </div>`).join('')}</div>` : '<div style="color:var(--dim);margin-bottom:12px;font-weight:600">No photos</div>'}
      <div class="drows">
        <div class="drow"><span class="k">Driver</span><span class="v">${esc(insp.driver_name)}</span></div>
        <div class="drow"><span class="k">Type</span><span class="v">${esc(TL[insp.inspection_type]||insp.inspection_type||'PickUp')}</span></div>
        <div class="drow"><span class="k">Asset / Trailer</span><span class="v">${insp.asset_id
          ? `<span class="asset-link" onclick="openAssetPanel(${insp.asset_id})">${esc(insp.asset_number||'—')}</span>`
          : esc(insp.asset_number||'—')}</span></div>
        <div class="drow"><span class="k">Truck</span><span class="v">${esc(insp.truck_model||'—')}</span></div>
        ${insp.truck_number?`<div class="drow"><span class="k">Truck No.</span><span class="v">${esc(insp.truck_number)}</span></div>`:''}
        <div class="drow"><span class="k">Submitted</span><span class="v">${fmtDate(insp.submitted_at)}</span></div>
        <div class="drow"><span class="k">GPS</span><span class="v">${mapUrl?`<a href="${mapUrl}" target="_blank">View Maps</a>`:'Not recorded'}</span></div>
      </div>
      ${insp.notes?`<div class="notes-box">📝 ${esc(insp.notes)}</div>`:''}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <a class="btn-dl btn-zip" href="/api/agent/inspections/${id}/download" download>⬇ ZIP</a>
        <a class="btn-dl btn-pdf" href="/api/agent/inspections/${id}/report" target="_blank">📄 PDF Report</a>
      </div>`;
  } catch (e) { c.innerHTML = '<div style="color:var(--red);font-weight:700">Error loading.</div>'; }
}

function backToDrivers() {
  document.querySelector('.drivers-col').style.display = '';
  document.querySelector('.detail-col').style.display = '';
  document.getElementById('detailContent').style.display = 'none';
  document.getElementById('detailEmpty').style.display = 'flex';
  document.getElementById('backToDriversBtn').style.display = 'none';
  document.querySelectorAll('.driver-row').forEach(el => el.classList.remove('sel'));
  G.sel = null;
}

// ── Lightbox ───────────────────────────────────────────────────────────────
function openLb(id, idx) {
  const p = (window._lbPhotos && window._lbPhotos[id]) || [];
  if (!p.length) return;
  G.lbPhotos = p; G.lbIdx = idx; showLbPhoto();
  document.getElementById('lightbox').classList.add('open');
}
function openLbArr(key, idx) {
  const arr = window._lbPhotos && window._lbPhotos[key];
  if (!arr || !arr.length) return;
  G.lbPhotos = arr; G.lbIdx = idx; showLbPhoto();
  document.getElementById('lightbox').classList.add('open');
}
function showLbPhoto() {
  const p = G.lbPhotos[G.lbIdx]; if (!p) return;
  document.getElementById('lbImg').src = p.file_path;
  document.getElementById('lbMeta').textContent = `Step ${p.step_number}${p.step_label?' — '+p.step_label:''} | ${G.lbIdx+1} of ${G.lbPhotos.length}`;
  const flagBtn = document.getElementById('lbFlagBtn');
  if (flagBtn) {
    flagBtn.textContent = p.flagged ? '🚩 Remove Flag' : '🚩 Flag Photo';
    flagBtn.classList.toggle('flagged', !!p.flagged);
    flagBtn.dataset.photoId = p.id;
    flagBtn.dataset.flagged = p.flagged ? '1' : '0';
  }
}
async function toggleFlag() {
  const btn = document.getElementById('lbFlagBtn');
  const photoId = btn.dataset.photoId;
  const currently = btn.dataset.flagged === '1';
  if (!currently) {
    const note = prompt('Add a note for this flag (optional):') ?? ''; if (note === null) return;
    await fetch(`/api/agent/photos/${photoId}/flag`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ flagged:true, flag_note:note }) });
    G.lbPhotos[G.lbIdx].flagged = 1; G.lbPhotos[G.lbIdx].flag_note = note;
  } else {
    if (!confirm('Remove flag from this photo?')) return;
    await fetch(`/api/agent/photos/${photoId}/flag`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ flagged:false, flag_note:'' }) });
    G.lbPhotos[G.lbIdx].flagged = 0; G.lbPhotos[G.lbIdx].flag_note = '';
  }
  showLbPhoto();
  document.querySelectorAll('[id^="cnt-"]').forEach(c => { delete c.dataset.loaded; });
}
function lbNav(d) { const n = G.lbIdx + d; if (n < 0 || n >= G.lbPhotos.length) return; G.lbIdx = n; showLbPhoto(); }
function closeLb() { document.getElementById('lightbox').classList.remove('open'); }
document.addEventListener('keydown', e => {
  if (!document.getElementById('lightbox').classList.contains('open')) return;
  if (e.key === 'ArrowLeft') lbNav(-1);
  if (e.key === 'ArrowRight') lbNav(1);
  if (e.key === 'Escape') closeLb();
});

// ── Asset Panel ────────────────────────────────────────────────────────────
async function openAssetPanel(id) {
  // ensure history tab side panel works from any tab by using modal
  const panel = document.getElementById('assetPanel');
  // If we're not on the feed tab, show as floating modal
  const onFeed = document.getElementById('tabFeed').classList.contains('active');
  if (!onFeed) {
    panel.classList.add('open');
    panel.style.position = 'fixed';
    panel.style.right = '0';
    panel.style.top = '60px';
    panel.style.bottom = '0';
    panel.style.zIndex = '400';
    panel.style.boxShadow = '-4px 0 32px rgba(0,0,0,0.15)';
  } else {
    panel.classList.add('open');
    panel.style.position = '';
    panel.style.right = '';
    panel.style.top = '';
    panel.style.bottom = '';
    panel.style.zIndex = '';
    panel.style.boxShadow = '';
  }
  document.getElementById('apTitle').textContent = 'Loading…';
  document.getElementById('apSub').textContent = '';
  document.getElementById('apBody').innerHTML = '<div style="padding:20px;color:var(--dim);font-weight:600">Loading…</div>';
  try {
    const asset = await (await fetch(`/api/assets/${id}`)).json();
    const inspections = asset.inspections || [];
    document.getElementById('apTitle').textContent = asset.asset_number;
    document.getElementById('apSub').textContent = [asset.year, asset.make, asset.model].filter(Boolean).join(' ') || 'No details';
    const totalPhotos  = inspections.reduce((s,i) => s + parseInt(i.photo_count||0), 0);
    const totalFlagged = inspections.reduce((s,i) => s + parseInt(i.flagged_count||0), 0);
    const lastInsp     = inspections[0];
    document.getElementById('apBody').innerHTML = `
      <div class="ap-info-card">
        <div class="ap-info-row"><span class="k">Asset #</span><span class="v">${esc(asset.asset_number)}</span></div>
        <div class="ap-info-row"><span class="k">Year</span><span class="v">${esc(asset.year||'—')}</span></div>
        <div class="ap-info-row"><span class="k">Make / Model</span><span class="v">${esc([asset.make,asset.model].filter(Boolean).join(' ')||'—')}</span></div>
        <div class="ap-info-row"><span class="k">VIN</span><span class="v" style="font-family:monospace;font-size:12px">${esc(asset.vin||'—')}</span></div>
        <div class="ap-info-row"><span class="k">License Plate</span><span class="v">${esc(asset.license_plate||'—')}</span></div>
        ${asset.notes?`<div class="ap-info-row"><span class="k">Notes</span><span class="v">${esc(asset.notes)}</span></div>`:''}
      </div>
      <div class="ap-stats">
        <div class="ap-stat"><div class="ap-stat-num">${inspections.length}</div><div class="ap-stat-lbl">Inspections</div></div>
        <div class="ap-stat"><div class="ap-stat-num">${totalPhotos}</div><div class="ap-stat-lbl">Total Photos</div></div>
        <div class="ap-stat ${totalFlagged>0?'flagged':''}"><div class="ap-stat-num">${totalFlagged}</div><div class="ap-stat-lbl">Flagged</div></div>
        <div class="ap-stat"><div class="ap-stat-num">${lastInsp?fmtDateShort(lastInsp.submitted_at):'—'}</div><div class="ap-stat-lbl">Last Insp.</div></div>
      </div>
      <div class="ap-section-hd">Inspection History</div>
      ${!inspections.length ? '<div style="padding:16px;color:var(--dim);font-weight:600;text-align:center">No inspections yet</div>'
        : `<div class="ap-info-card">${inspections.map(i => {
            const tk = i.inspection_type||'pickup';
            return `<div class="ap-insp-row" onclick="openHistPanel('${i.id}')">
              <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:7px;margin-bottom:3px">
                  <span class="type-badge ${tk}">${TL[tk]||tk}</span>
                  ${parseInt(i.flagged_count)>0?`<span class="ap-flag-badge">⚑ ${i.flagged_count}</span>`:''}
                </div>
                <div style="font-size:13px;font-weight:700">${fmtDate(i.submitted_at)}</div>
                <div style="font-size:12px;color:var(--dim);margin-top:2px">${esc(i.driver_name)} · ${i.photo_count} photos</div>
              </div>
              <a class="btn-dl btn-pdf" href="/api/agent/inspections/${i.id}/report" target="_blank" onclick="event.stopPropagation()" style="font-size:12px;padding:5px 10px">PDF</a>
            </div>`;
          }).join('')}</div>`}`;
  } catch (e) { document.getElementById('apBody').innerHTML = '<div style="padding:20px;color:var(--red);font-weight:700">Error loading.</div>'; }
}
function closeAssetPanel() {
  const panel = document.getElementById('assetPanel');
  panel.classList.remove('open');
  panel.style.position = '';
  panel.style.right = '';
  panel.style.top = '';
  panel.style.bottom = '';
  panel.style.zIndex = '';
  panel.style.boxShadow = '';
}

function fmtDateShort(dt) {
  if (!dt) return '—';
  return new Date(dt.includes('T')?dt:dt+'Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit'});
}

// ── History / Feed ─────────────────────────────────────────────────────────
async function loadFeed() {
  try {
    G.feedRows = await (await fetch('/api/agent/inspections')).json();
    renderFeed();
  } catch (e) { document.getElementById('feedBody').innerHTML = '<tr><td colspan="7" style="padding:20px;color:var(--red);font-weight:700">Error loading.</td></tr>'; }
}

function setFilter(f) {
  G.feedFilter = f;
  ['All','Pickup','Drop','General'].forEach(t => {
    document.getElementById('f'+t).classList.toggle('active', t.toLowerCase()===f||(f==='all'&&t==='All'));
  });
  renderFeed();
}

function renderFeed() {
  const tbody = document.getElementById('feedBody');
  let rows = G.feedRows;
  if (G.feedFilter !== 'all') rows = rows.filter(r => (r.inspection_type||'pickup') === G.feedFilter);
  if (!rows.length) { tbody.innerHTML = `<tr><td colspan="7" style="padding:20px;color:var(--dim);font-weight:600">No inspections found.</td></tr>`; return; }
  tbody.innerHTML = rows.map(i => {
    const tk = i.inspection_type||'pickup';
    return `<tr onclick="openHistPanel('${i.id}')">
      <td><span style="font-family:monospace;font-size:12px;color:var(--muted)">#${i.id.slice(0,8).toUpperCase()}</span></td>
      <td><span class="pill-ok">Submitted</span></td>
      <td style="color:var(--dim);font-size:14px">${fmtDate(i.submitted_at)}</td>
      <td onclick="event.stopPropagation()">${i.asset_number
        ? `<span class="asset-link" onclick="openAssetPanel(${i.asset_id||0})" title="View trailer details">🔍 ${esc(i.asset_number)}</span>`
        : i.truck_number ? `<span style="color:var(--dim)">${esc(i.truck_number)}</span>` : '<span style="color:var(--muted)">—</span>'}</td>
      <td style="font-weight:800">${esc(i.driver_name)}</td>
      <td><span class="type-badge ${tk}">${TL[tk]||tk}</span></td>
      <td onclick="event.stopPropagation()">
        <div style="display:flex;gap:5px;flex-wrap:nowrap">
          <button class="action-btn" onclick="openHistPanel('${i.id}')">🔍 View</button>
          <a class="action-btn" href="/api/agent/inspections/${i.id}/report" target="_blank" style="text-decoration:none">PDF</a>
          <a class="action-btn" href="/api/agent/inspections/${i.id}/download" download style="text-decoration:none">ZIP</a>
        </div>
      </td>
    </tr>`;
  }).join('');
}

async function openHistPanel(id) {
  const panel = document.getElementById('histPanel');
  panel.classList.add('open');
  document.getElementById('hpTitle').textContent = '#'+id.slice(0,8).toUpperCase();
  document.getElementById('hpBody').innerHTML = '<div style="color:var(--dim);font-weight:600;padding:8px">Loading…</div>';
  try {
    const insp = await (await fetch(`/api/agent/inspections/${id}`)).json();
    const photos = insp.photos||[];
    const tk = insp.inspection_type||'pickup';
    const mapUrl = insp.latitude ? `https://www.google.com/maps?q=${insp.latitude},${insp.longitude}` : null;
    window._lbPhotos = window._lbPhotos||{};
    const lbKey = 'hist_'+id;
    window._lbPhotos[lbKey] = photos;
    document.getElementById('hpBody').innerHTML = `
      <div style="margin-bottom:14px">
        <span class="type-badge ${tk}">${TL[tk]||tk}</span>
        <span style="font-size:13px;color:var(--dim);font-weight:600">${fmtDate(insp.submitted_at)}</span>
      </div>
      ${photos.length?`<div class="photo-grid">${photos.map((p,i)=>
        `<div class="photo-cell${p.flagged?' flagged':''}" onclick="openLbArr('${lbKey}',${i})">
          <img src="${esc(p.file_path)}" loading="lazy">
          <div class="photo-cell-lbl">${esc(p.step_label||'Step '+p.step_number)}</div>
          <div class="photo-cell-num">${p.step_number}</div>
          ${p.flagged?`<div class="photo-flag-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg></div>`:''}
        </div>`).join('')}</div>`:''}
      <div class="drows" style="margin-top:12px">
        <div class="drow"><span class="k">Driver</span><span class="v">${esc(insp.driver_name)}</span></div>
        <div class="drow"><span class="k">Asset</span><span class="v">${insp.asset_id?`<span class="asset-link" onclick="openAssetPanel(${insp.asset_id})">${esc(insp.asset_number||'—')}</span>`:esc(insp.asset_number||'—')}</span></div>
        <div class="drow"><span class="k">Truck</span><span class="v">${esc(insp.truck_model||'—')}</span></div>
        ${insp.truck_number?`<div class="drow"><span class="k">Truck No.</span><span class="v">${esc(insp.truck_number)}</span></div>`:''}
        <div class="drow"><span class="k">Photos</span><span class="v">${photos.length}</span></div>
        <div class="drow"><span class="k">GPS</span><span class="v">${mapUrl?`<a href="${mapUrl}" target="_blank">View</a>`:'—'}</span></div>
      </div>
      ${insp.notes?`<div class="notes-box">📝 ${esc(insp.notes)}</div>`:''}
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn-dl btn-pdf" href="/api/agent/inspections/${id}/report" target="_blank">📄 PDF Report</a>
        <a class="btn-dl btn-zip" href="/api/agent/inspections/${id}/download" download>⬇ Download ZIP</a>
      </div>`;
  } catch (e) { document.getElementById('hpBody').innerHTML = '<div style="color:var(--red);font-weight:700">Error loading.</div>'; }
}
function closeHistPanel() { document.getElementById('histPanel').classList.remove('open'); }

// ── INCOMPLETE INSPECTIONS ─────────────────────────────────────────────────
async function loadIncomplete() {
  const el = document.getElementById('incompleteList');
  el.innerHTML = '<div style="padding:24px;color:var(--dim);font-weight:600">Loading…</div>';
  try {
    const rows = await (await fetch('/api/agent/inspections/incomplete')).json();
    if (!rows || !rows.length) {
      el.innerHTML = `<div style="padding:40px;text-align:center">
        <div style="font-size:40px;margin-bottom:12px">✅</div>
        <div style="font-size:16px;font-weight:800;color:var(--text)">All clear!</div>
        <div style="font-size:14px;color:var(--dim);font-weight:500;margin-top:4px">No incomplete inspections found.</div>
      </div>`;
      return;
    }
    el.innerHTML = rows.map(i => {
      const tk = i.inspection_type || 'pickup';
      const startedAgo = timeAgo(i.started_at);
      const photosDone = i.photo_count || 0;
      // Determine reason for incompleteness
      const reasons = [];
      if (!i.submitted_at) {
        const minsAgo = (Date.now() - new Date(i.started_at)) / 60000;
        if (minsAgo > 60) reasons.push('Abandoned — left app');
        else if (minsAgo > 15) reasons.push('Possibly disconnected');
        else reasons.push('In progress');
      }
      const reasonText = reasons[0] || 'In progress';
      const isActive = (Date.now() - new Date(i.started_at)) / 60000 < 10;

      return `<div class="incomplete-card">
        <div class="incomplete-icon">
          ${isActive
            ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`}
        </div>
        <div class="incomplete-info">
          <div class="incomplete-name">${esc(i.driver_name)}</div>
          <div class="incomplete-meta">
            <span class="type-badge ${tk}">${TL[tk]||tk}</span>
            Started ${startedAgo}
            ${i.truck_number?' · '+esc(i.truck_number):''}
            ${i.asset_number?' · Trailer: '+esc(i.asset_number):''}
          </div>
          <div class="incomplete-reason">${isActive ? '🟢 Active now' : '⚠️ '+reasonText}</div>
          <div style="font-size:13px;color:var(--dim);font-weight:600">${photosDone} photo${photosDone!==1?'s':''} captured</div>
          ${i.total_steps ? `
            <div class="incomplete-progress" style="margin-top:8px">
              <div class="incomplete-progress-fill" style="width:${Math.min(100,Math.round(photosDone/i.total_steps*100))}%"></div>
            </div>
            <div style="font-size:11px;color:var(--muted);font-weight:600;margin-top:4px">${Math.min(100,Math.round(photosDone/(i.total_steps||1)*100))}% complete</div>
          ` : ''}
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    el.innerHTML = '<div style="padding:24px;color:var(--red);font-weight:700">Error loading incomplete inspections.</div>';
  }
}

function timeAgo(dt) {
  if (!dt) return 'unknown time ago';
  const mins = Math.floor((Date.now() - new Date(dt.includes('T')?dt:dt+'Z')) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs/24)}d ago`;
}

// ── Admin ──────────────────────────────────────────────────────────────────
function setAdminTab(t) {
  const map = { drivers:'asDrivers', dispatchers:'asDispatchers', steps:'asSteps', assets:'asAssets', trucks:'asTrucks' };
  const btnMap = { drivers:'admBtnDrivers', dispatchers:'admBtnDispatchers', steps:'admBtnSteps', assets:'admBtnAssets', trucks:'admBtnTrucks' };
  Object.values(map).forEach(id => { const el=document.getElementById(id); if(el) el.classList.remove('active'); });
  Object.values(btnMap).forEach(id => { const el=document.getElementById(id); if(el) el.classList.remove('active'); });
  const sec = document.getElementById(map[t]); if(sec) sec.classList.add('active');
  const btn = document.getElementById(btnMap[t]); if(btn) btn.classList.add('active');
  if (t==='drivers') loadAdminDrivers();
  if (t==='dispatchers') loadAdminDispatchers();
  if (t==='steps') loadSteps();
  if (t==='assets') loadAdminAssets();
  if (t==='trucks') loadAdminTrucks();
}

async function createDriver() {
  const body = { full_name:v('drName'), username:v('drUser'), email:v('drEmail'), password:v('drPass'), role:'driver' };
  const al = document.getElementById('drAlert');
  if (!body.full_name || !body.username || !body.password) { showAlert(al,'error','Name, username and password required.'); return; }
  const r = await fetch('/api/admin/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const d = await r.json();
  if (!r.ok) { showAlert(al,'error',d.error||'Error'); return; }
  showAlert(al,'ok',`Driver "${body.full_name}" added!`);
  ['drName','drUser','drEmail','drPass'].forEach(id => document.getElementById(id).value='');
  loadAdminDrivers(); loadDrivers(); loadStats();
}

async function createDispatcher() {
  const body = { full_name:v('diName'), username:v('diUser'), email:v('diEmail'), password:v('diPass'), role:'agent' };
  const al = document.getElementById('diAlert');
  if (!body.full_name || !body.username || !body.password) { showAlert(al,'error','Name, username and password required.'); return; }
  const r = await fetch('/api/admin/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const d = await r.json();
  if (!r.ok) { showAlert(al,'error',d.error||'Error'); return; }
  showAlert(al,'ok',`Dispatcher "${body.full_name}" added!`);
  ['diName','diUser','diEmail','diPass'].forEach(id => document.getElementById(id).value='');
  loadAdminDispatchers(); loadStats();
}

async function loadAdminDrivers() {
  try {
    const users = await (await fetch('/api/admin/users?role=driver')).json();
    const el = document.getElementById('driversTable');
    if (!users.length) { el.innerHTML = '<div style="color:var(--dim);font-weight:600;padding:12px 0">No drivers yet.</div>'; return; }
    users.forEach(u => G.usersMap[u.id]=u);
    el.innerHTML = `<div class="utbl-wrap"><table class="utbl">
      <thead><tr><th>Name</th><th>Username</th><th>Email</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${users.map(u=>`<tr>
        <td style="font-weight:800">${esc(u.full_name)}</td>
        <td style="color:var(--dim)">${esc(u.username)}</td>
        <td style="color:var(--dim);font-size:13px">${esc(u.email||'—')}</td>
        <td><span style="font-size:12px;font-weight:700;padding:3px 10px;border-radius:20px;background:${u.active?'var(--green-light)':'var(--red-light)'};color:${u.active?'var(--green)':'var(--red)'}">${u.active?'Active':'Disabled'}</span></td>
        <td><div class="utbl-actions">
          <button class="tbl-btn edit" onclick="openEditModal(${u.id})">Edit</button>
          <button class="tbl-btn ${u.active?'disable':'enable'}" onclick="toggleUser(${u.id},${u.active},'drivers')">${u.active?'Disable':'Enable'}</button>
          <button class="tbl-btn del" onclick="deleteUser(${u.id},'${esc(u.full_name)}','drivers')">Delete</button>
        </div></td>
      </tr>`).join('')}</tbody></table></div>`;
  } catch (e) {}
}

async function loadAdminDispatchers() {
  try {
    const users = await (await fetch('/api/admin/users?role=agent')).json();
    const el = document.getElementById('dispatchersTable');
    if (!users.length) { el.innerHTML = '<div style="color:var(--dim);font-weight:600;padding:12px 0">No dispatchers yet.</div>'; return; }
    users.forEach(u => G.usersMap[u.id]=u);
    el.innerHTML = `<div class="utbl-wrap"><table class="utbl">
      <thead><tr><th>Name</th><th>Username</th><th>Email</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${users.map(u=>`<tr>
        <td style="font-weight:800">${esc(u.full_name)}</td>
        <td style="color:var(--dim)">${esc(u.username)}</td>
        <td style="color:var(--dim);font-size:13px">${esc(u.email||'—')}</td>
        <td><span style="font-size:12px;font-weight:700;padding:3px 10px;border-radius:20px;background:${u.active?'var(--green-light)':'var(--red-light)'};color:${u.active?'var(--green)':'var(--red)'}">${u.active?'Active':'Disabled'}</span></td>
        <td><div class="utbl-actions">
          <button class="tbl-btn edit" onclick="openEditModal(${u.id})">Edit</button>
          <button class="tbl-btn ${u.active?'disable':'enable'}" onclick="toggleUser(${u.id},${u.active},'dispatchers')">${u.active?'Disable':'Enable'}</button>
          <button class="tbl-btn del" onclick="deleteUser(${u.id},'${esc(u.full_name)}','dispatchers')">Delete</button>
        </div></td>
      </tr>`).join('')}</tbody></table></div>`;
  } catch (e) {}
}

function openEditModal(id) {
  const user = G.usersMap[id]; if (!user) return;
  document.getElementById('editUserId').value = user.id;
  document.getElementById('editName').value = user.full_name||'';
  document.getElementById('editUsername').value = user.username||'';
  document.getElementById('editEmail').value = user.email||'';
  document.getElementById('editPass').value = '';
  const tf = document.getElementById('editTruck'); if(tf) tf.value = user.truck_model||'';
  const tn = document.getElementById('editTruckNum'); if(tn) tn.value = user.truck_number||'';
  document.getElementById('editTruckFields').style.display = user.role==='driver'?'block':'none';
  document.getElementById('editModalTitle').textContent = 'Edit '+user.full_name;
  document.getElementById('editAlert').style.display = 'none';
  document.getElementById('editModal').classList.add('open');
}
function closeEditModal() { document.getElementById('editModal').classList.remove('open'); }
async function saveEditUser() {
  const id = document.getElementById('editUserId').value;
  const body = { full_name:v('editName'), username:v('editUsername'), email:v('editEmail'), password:v('editPass'), truck_model:v('editTruck'), truck_number:v('editTruckNum') };
  const al = document.getElementById('editAlert');
  const r = await fetch(`/api/admin/users/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const d = await r.json();
  if (!r.ok) { showAlert(al,'error',d.error||'Error'); return; }
  showAlert(al,'ok','Changes saved!');
  setTimeout(() => { closeEditModal(); loadAdminDrivers(); loadAdminDispatchers(); loadDrivers(); }, 1200);
}
async function toggleUser(id, active, tab) {
  await fetch(`/api/admin/users/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({active:!active})});
  if (tab==='drivers') loadAdminDrivers(); else loadAdminDispatchers();
  loadDrivers(); loadStats();
}
async function deleteUser(id, name, tab) {
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
  const r = await fetch(`/api/admin/users/${id}`,{method:'DELETE'});
  const d = await r.json();
  if (!r.ok) { alert(d.error||'Error deleting'); return; }
  if (tab==='drivers') loadAdminDrivers(); else loadAdminDispatchers();
  loadDrivers(); loadStats();
}

// ── Steps — split view ─────────────────────────────────────────────────────
async function loadSteps() {
  try {
    G.allSteps = await (await fetch('/api/admin/steps')).json();
    // Update counts
    ['pickup','drop','general'].forEach(type => {
      const count = G.allSteps.filter(s => s.inspection_type===type).length;
      const el = document.getElementById(`stepCount${type.charAt(0).toUpperCase()+type.slice(1)}`);
      if (el) el.textContent = count;
    });
    renderStepType(G.currentStepType);
  } catch (e) {}
}

function viewStepType(type) {
  G.currentStepType = type;
  ['pickup','drop','general'].forEach(t => {
    const btn = document.getElementById(`stepTypeBtn${t.charAt(0).toUpperCase()+t.slice(1)}`);
    if (btn) btn.classList.toggle('active', t===type);
  });
  renderStepType(type);
}

function renderStepType(type) {
  const el = document.getElementById('stepsListCol');
  const steps = G.allSteps.filter(s => s.inspection_type === type);
  if (!steps.length) {
    el.innerHTML = '<div style="padding:20px;color:var(--dim);font-weight:600">No steps for this type yet.</div>';
    return;
  }
  el.innerHTML = steps.map(s => `
    <div class="step-row${!s.active?' inactive':''}">
      <div class="step-num-badge">${s.step_number}</div>
      <div class="step-info">
        <div class="step-lbl">${esc(s.label)}</div>
        <div class="step-inst">${esc(s.instruction)}</div>
      </div>
      <div class="step-actions">
        <button class="step-tog" onclick="openEditStepModal(${s.id},'${esc(s.label).replace(/'/g,"\\'")}','${esc(s.instruction).replace(/'/g,"\\'")}','${s.inspection_type}')">Edit</button>
        <button class="step-tog${s.active?'':' off'}" onclick="toggleStep(${s.id},${s.active})">${s.active?'Disable':'Enable'}</button>
        <button class="step-del" onclick="deleteStep(${s.id},'${esc(s.label)}')" title="Delete">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>
    </div>`).join('');
}

async function addStep() {
  const type = document.getElementById('newStepType').value;
  const label = document.getElementById('newStepLabel').value.trim();
  const instruction = document.getElementById('newStepInstruction').value.trim();
  const al = document.getElementById('stepAlert');
  if (!label || !instruction) { showAlert(al,'error','Step label and instruction are required.'); return; }
  const r = await fetch('/api/admin/steps',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({inspection_type:type,label,instruction})});
  const d = await r.json();
  if (!r.ok) { showAlert(al,'error',d.error||'Error adding step'); return; }
  showAlert(al,'ok',`Step "${label}" added to ${TL[type]||type}!`);
  document.getElementById('newStepLabel').value='';
  document.getElementById('newStepInstruction').value='';
  await loadSteps();
  viewStepType(type); // switch to the type we just added to
}

async function toggleStep(id, active) {
  await fetch(`/api/admin/steps/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({active:!active})});
  loadSteps();
}
async function deleteStep(id, label) {
  if (!confirm(`Delete step "${label}"? This cannot be undone.`)) return;
  const r = await fetch(`/api/admin/steps/${id}`,{method:'DELETE'});
  if (!r.ok) { const d = await r.json().catch(()=>({})); alert(d.error||'Error deleting step'); return; }
  loadSteps();
}

// ── Assets ─────────────────────────────────────────────────────────────────
async function loadAdminAssets() {
  try {
    const assets = await (await fetch('/api/admin/assets')).json();
    const el = document.getElementById('assetsTable');
    if (!assets.length) { el.innerHTML = '<div style="color:var(--dim);font-weight:600;padding:12px 0">No assets yet.</div>'; return; }
    el.innerHTML = `<div class="utbl-wrap"><table class="utbl">
      <thead><tr><th>Asset #</th><th>Year</th><th>Make / Model</th><th>Plate</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${assets.map(a=>`<tr style="${!a.active?'opacity:0.55':''}">
        <td style="font-weight:800;color:var(--brand)">${esc(a.asset_number)}</td>
        <td style="color:var(--dim)">${esc(a.year||'—')}</td>
        <td>${esc([a.make,a.model].filter(Boolean).join(' ')||'—')}</td>
        <td>${esc(a.license_plate||'—')}</td>
        <td><span style="font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px;background:${a.active?'var(--green-light)':'var(--red-light)'};color:${a.active?'var(--green)':'var(--red)'}">${a.active?'Active':'Disabled'}</span></td>
        <td><div class="utbl-actions">
          <button class="tbl-btn edit" onclick="openEditAssetModal(${a.id},'${esc(a.asset_number)}','${esc(a.year||'')}','${esc(a.make||'')}','${esc(a.model||'')}','${esc(a.vin||'')}','${esc(a.license_plate||'')}','${esc(a.notes||'')}',${a.active?1:0})">Edit</button>
          <button class="tbl-btn ${a.active?'disable':'enable'}" onclick="toggleAssetInline(${a.id},${a.active?1:0})">${a.active?'Disable':'Enable'}</button>
          <button class="tbl-btn del" onclick="deleteAsset(${a.id},'${esc(a.asset_number)}')">Delete</button>
        </div></td>
      </tr>`).join('')}</tbody></table></div>`;
  } catch (e) {}
}

async function toggleAssetInline(id, active) {
  await fetch(`/api/admin/assets/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({active:!active})});
  loadAdminAssets();
}

async function createAsset() {
  const body = { asset_number:v('assetNum'), year:v('assetYear'), make:v('assetMake'), model:v('assetModel'), vin:v('assetVin'), license_plate:v('assetPlate') };
  const al = document.getElementById('assetAlert');
  if (!body.asset_number) { showAlert(al,'error','Asset number is required.'); return; }
  const r = await fetch('/api/admin/assets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const d = await r.json();
  if (!r.ok) { showAlert(al,'error',d.error||'Error'); return; }
  showAlert(al,'ok',`Asset "${body.asset_number}" added!`);
  ['assetNum','assetYear','assetMake','assetModel','assetVin','assetPlate'].forEach(id => { const e=document.getElementById(id); if(e) e.value=''; });
  loadAdminAssets();
}
async function deleteAsset(id, num) {
  if (!confirm(`Delete asset "${num}"? This cannot be undone.`)) return;
  await fetch(`/api/admin/assets/${id}`,{method:'DELETE'});
  loadAdminAssets();
}

// Edit asset modal
function openEditAssetModal(id, asset_number, year, make, model, vin, license_plate, notes, active) {
  document.getElementById('editAssetId').value = id;
  document.getElementById('editAssetNum').value = asset_number||'';
  document.getElementById('editAssetYear').value = year||'';
  document.getElementById('editAssetMake').value = make||'';
  document.getElementById('editAssetModel').value = model||'';
  document.getElementById('editAssetVin').value = vin||'';
  document.getElementById('editAssetPlate').value = license_plate||'';
  document.getElementById('editAssetNotes').value = notes||'';
  document.getElementById('editAssetToggleBtn').textContent = active ? 'Disable' : 'Enable';
  document.getElementById('editAssetToggleBtn').dataset.active = active;
  document.getElementById('editAssetAlert').style.display = 'none';
  document.getElementById('editAssetModal').classList.add('open');
}
function closeEditAssetModal() { document.getElementById('editAssetModal').classList.remove('open'); }
async function saveEditAsset() {
  const id = document.getElementById('editAssetId').value;
  const body = { asset_number:v('editAssetNum'), year:v('editAssetYear'), make:v('editAssetMake'), model:v('editAssetModel'), vin:v('editAssetVin'), license_plate:v('editAssetPlate'), notes:v('editAssetNotes') };
  const al = document.getElementById('editAssetAlert');
  if (!body.asset_number) { showAlert(al,'error','Asset number required.'); return; }
  const r = await fetch(`/api/admin/assets/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const d = await r.json();
  if (!r.ok) { showAlert(al,'error',d.error||'Error'); return; }
  showAlert(al,'ok','Saved!');
  setTimeout(()=>{ closeEditAssetModal(); loadAdminAssets(); }, 900);
}
async function toggleAssetFromModal() {
  const id = document.getElementById('editAssetId').value;
  const active = parseInt(document.getElementById('editAssetToggleBtn').dataset.active);
  const al = document.getElementById('editAssetAlert');
  const r = await fetch(`/api/admin/assets/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({active:!active})});
  if (!r.ok) { showAlert(al,'error','Error'); return; }
  const newActive = !active;
  document.getElementById('editAssetToggleBtn').textContent = newActive ? 'Disable' : 'Enable';
  document.getElementById('editAssetToggleBtn').dataset.active = newActive ? 1 : 0;
  showAlert(al,'ok', newActive ? 'Trailer enabled.' : 'Trailer disabled.');
  loadAdminAssets();
}


// ── Edit Step ─────────────────────────────────────────────────────────────
function openEditStepModal(id, label, instruction, type) {
  document.getElementById('editStepId').value = id;
  document.getElementById('editStepLabel').value = label;
  document.getElementById('editStepInstruction').value = instruction;
  document.getElementById('editStepTypeDisplay').textContent = {pickup:'PickUp',drop:'Drop',general:'General'}[type]||type;
  document.getElementById('editStepAlert').style.display = 'none';
  document.getElementById('editStepModal').classList.add('open');
}
function closeEditStepModal() { document.getElementById('editStepModal').classList.remove('open'); }
async function saveEditStep() {
  const id = document.getElementById('editStepId').value;
  const label = v('editStepLabel'), instruction = v('editStepInstruction');
  const al = document.getElementById('editStepAlert');
  if (!label || !instruction) { showAlert(al,'error','Label and instruction required.'); return; }
  const r = await fetch(`/api/admin/steps/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({label,instruction})});
  const d = await r.json();
  if (!r.ok) { showAlert(al,'error',d.error||'Error'); return; }
  showAlert(al,'ok','Step updated!');
  setTimeout(()=>{ closeEditStepModal(); loadSteps(); }, 900);
}

// ── Trucks ─────────────────────────────────────────────────────────────────
async function loadAdminTrucks() {
  try {
    const [trucks, drivers] = await Promise.all([
      (await fetch('/api/admin/trucks')).json(),
      (await fetch('/api/admin/users?role=driver')).json()
    ]);
    const el = document.getElementById('trucksTable');
    if (!trucks.length) { el.innerHTML = '<div style="color:var(--dim);font-weight:600;padding:12px 0">No trucks yet.</div>'; return; }
    el.innerHTML = `<div class="utbl-wrap"><table class="utbl">
      <thead><tr><th>Truck #</th><th>Model</th><th>Year / Make</th><th>Driver</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${trucks.map(t=>`<tr style="${!t.active?'opacity:0.55':''}">
        <td style="font-weight:800;color:var(--brand)">${esc(t.truck_number)}</td>
        <td>${esc(t.truck_model||'—')}</td>
        <td style="color:var(--dim)">${esc([t.year,t.make].filter(Boolean).join(' ')||'—')}</td>
        <td>${t.driver_name?`<span style="font-weight:700">${esc(t.driver_name)}</span>`:'<span style="color:var(--muted)">Unassigned</span>'}</td>
        <td><span style="font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px;background:${t.active?'var(--green-light)':'var(--red-light)'};color:${t.active?'var(--green)':'var(--red)'}">${t.active?'Active':'Disabled'}</span></td>
        <td><div class="utbl-actions">
          <button class="tbl-btn edit" onclick="openEditTruckModal(${t.id},'${esc(t.truck_number)}','${esc(t.truck_model||'')}','${esc(t.year||'')}','${esc(t.make||'')}','${esc(t.vin||'')}','${esc(t.license_plate||'')}','${esc(t.notes||'')}',${t.driver_id||'null'},${t.active?1:0})">Edit</button>
          <button class="tbl-btn ${t.active?'disable':'enable'}" onclick="toggleTruckInline(${t.id},${t.active?1:0})">${t.active?'Disable':'Enable'}</button>
          <button class="tbl-btn del" onclick="deleteTruck(${t.id},'${esc(t.truck_number)}')">Delete</button>
        </div></td>
      </tr>`).join('')}</tbody></table></div>`;
  } catch(e) {}
}

async function toggleTruckInline(id, active) {
  await fetch(`/api/admin/trucks/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({active:!active})});
  loadAdminTrucks();
}

async function createTruck() {
  const body = { truck_number:v('truckNum'), truck_model:v('truckModel'), year:v('truckYear'), make:v('truckMake'), vin:v('truckVin'), license_plate:v('truckPlate') };
  const al = document.getElementById('truckAlert');
  if (!body.truck_number) { showAlert(al,'error','Truck number is required.'); return; }
  const r = await fetch('/api/admin/trucks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const d = await r.json();
  if (!r.ok) { showAlert(al,'error',d.error||'Error'); return; }
  showAlert(al,'ok',`Truck "${body.truck_number}" added!`);
  ['truckNum','truckModel','truckYear','truckMake','truckVin','truckPlate'].forEach(id=>{ const e=document.getElementById(id); if(e) e.value=''; });
  loadAdminTrucks();
}

async function deleteTruck(id, num) {
  if (!confirm(`Delete truck "${num}"? This cannot be undone.`)) return;
  await fetch(`/api/admin/trucks/${id}`,{method:'DELETE'});
  loadAdminTrucks();
}

function openEditTruckModal(id, truck_number, truck_model, year, make, vin, license_plate, notes, driver_id, active) {
  document.getElementById('editTruckId').value = id;
  document.getElementById('editTruckNum').value = truck_number||'';
  document.getElementById('editTruckModel').value = truck_model||'';
  document.getElementById('editTruckYear').value = year||'';
  document.getElementById('editTruckMake').value = make||'';
  document.getElementById('editTruckVin').value = vin||'';
  document.getElementById('editTruckPlate').value = license_plate||'';
  document.getElementById('editTruckNotes').value = notes||'';
  document.getElementById('editTruckDriver').value = driver_id||'';
  document.getElementById('editTruckToggleBtn').textContent = active ? 'Disable' : 'Enable';
  document.getElementById('editTruckToggleBtn').dataset.active = active;
  document.getElementById('editTruckAlert').style.display = 'none';
  // Populate driver select
  fetch('/api/admin/users?role=driver').then(r=>r.json()).then(drivers => {
    const sel = document.getElementById('editTruckDriver');
    sel.innerHTML = '<option value="">— Unassigned —</option>' +
      drivers.map(d=>`<option value="${d.id}" ${d.id==driver_id?'selected':''}>${esc(d.full_name)}</option>`).join('');
  });
  document.getElementById('editTruckModal').classList.add('open');
}
function closeEditTruckModal() { document.getElementById('editTruckModal').classList.remove('open'); }
async function saveEditTruck() {
  const id = document.getElementById('editTruckId').value;
  const body = { truck_number:v('editTruckNum'), truck_model:v('editTruckModel'), year:v('editTruckYear'), make:v('editTruckMake'), vin:v('editTruckVin'), license_plate:v('editTruckPlate'), notes:v('editTruckNotes'), driver_id: document.getElementById('editTruckDriver').value||null };
  const al = document.getElementById('editTruckAlert');
  if (!body.truck_number) { showAlert(al,'error','Truck number required.'); return; }
  const r = await fetch(`/api/admin/trucks/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const d = await r.json();
  if (!r.ok) { showAlert(al,'error',d.error||'Error'); return; }
  showAlert(al,'ok','Saved!');
  setTimeout(()=>{ closeEditTruckModal(); loadAdminTrucks(); loadDrivers(); }, 900);
}
async function toggleTruckFromModal() {
  const id = document.getElementById('editTruckId').value;
  const active = parseInt(document.getElementById('editTruckToggleBtn').dataset.active);
  const al = document.getElementById('editTruckAlert');
  const r = await fetch(`/api/admin/trucks/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({active:!active})});
  if (!r.ok) { showAlert(al,'error','Error'); return; }
  const newActive = !active;
  document.getElementById('editTruckToggleBtn').textContent = newActive ? 'Disable' : 'Enable';
  document.getElementById('editTruckToggleBtn').dataset.active = newActive ? 1 : 0;
  showAlert(al,'ok', newActive ? 'Truck enabled.' : 'Truck disabled.');
  loadAdminTrucks();
}

// ── Tab navigation ─────────────────────────────────────────────────────────
function showTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn, .mobile-nav-btn').forEach(b => b.classList.remove('active'));
  const tab = document.getElementById(`tab${name}`); if(tab) tab.classList.add('active');
  const navBtn = document.getElementById(`nav${name}`); if(navBtn) navBtn.classList.add('active');
  const mBtn = document.getElementById(`mNav${name}`); if(mBtn) mBtn.classList.add('active');
  if (name==='Feed') loadFeed();
  if (name==='Incomplete') loadIncomplete();
  if (name==='Admin') { setAdminTab('drivers'); }
}

// ── Utils ──────────────────────────────────────────────────────────────────
function fmtDate(dt) {
  if (!dt) return 'N/A';
  return new Date(dt.includes('T')?dt:dt+'Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'});
}
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function v(id) { return (document.getElementById(id)||{}).value?.trim()||''; }
function showAlert(el, type, msg) {
  el.textContent = msg;
  el.style.color = type==='ok'?'var(--green)':'var(--red)';
  el.style.borderColor = type==='ok'?'rgba(22,163,74,.3)':'rgba(220,38,38,.3)';
  el.style.background = type==='ok'?'var(--green-light)':'var(--red-light)';
  el.style.display = 'block';
  if (type==='ok') setTimeout(()=>el.style.display='none', 3500);
}
async function logout() { await fetch('/api/logout',{method:'POST'}); location.href='/login'; }

// ── Expose globals ─────────────────────────────────────────────────────────
window.openAssetPanel = openAssetPanel; window.closeAssetPanel = closeAssetPanel;
window.filterDrivers = filterDrivers; window.selectDriver = selectDriver;
window.toggleCard = toggleCard; window.openLb = openLb; window.openLbArr = openLbArr;
window.lbNav = lbNav; window.closeLb = closeLb; window.toggleFlag = toggleFlag;
window.setFilter = setFilter; window.openHistPanel = openHistPanel;
window.closeHistPanel = closeHistPanel; window.setAdminTab = setAdminTab;
window.createDriver = createDriver; window.createDispatcher = createDispatcher;
window.openEditModal = openEditModal; window.closeEditModal = closeEditModal;
window.saveEditUser = saveEditUser; window.toggleUser = toggleUser;
window.deleteUser = deleteUser; window.toggleStep = toggleStep;
window.addStep = addStep; window.deleteStep = deleteStep;
window.createAsset = createAsset; window.deleteAsset = deleteAsset;
window.loadAdminAssets = loadAdminAssets; window.viewStepType = viewStepType;
window.openEditAssetModal = openEditAssetModal; window.closeEditAssetModal = closeEditAssetModal;
window.saveEditAsset = saveEditAsset; window.toggleAssetInline = toggleAssetInline;
window.toggleAssetFromModal = toggleAssetFromModal;
window.openEditStepModal = openEditStepModal; window.closeEditStepModal = closeEditStepModal;
window.saveEditStep = saveEditStep;
window.loadAdminTrucks = loadAdminTrucks; window.createTruck = createTruck; window.deleteTruck = deleteTruck;
window.openEditTruckModal = openEditTruckModal; window.closeEditTruckModal = closeEditTruckModal;
window.saveEditTruck = saveEditTruck; window.toggleTruckInline = toggleTruckInline;
window.toggleTruckFromModal = toggleTruckFromModal;
window.showTab = showTab; window.logout = logout; window.backToDrivers = backToDrivers;
window.loadIncomplete = loadIncomplete;
