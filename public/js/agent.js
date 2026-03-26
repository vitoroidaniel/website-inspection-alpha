// Kurtex - Agent/Dispatcher Application
// Designed by Rekka Software

const TL = { pickup: 'PickUp Trailer', drop: 'Drop Trailer', general: 'General' };

const G = {
  drivers: [], sel: null, isAdmin: false,
  lbPhotos: [], lbIdx: 0,
  feedFilter: 'all', feedRows: [],
  usersMap: {}
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

    const mobileNav = document.getElementById('mobileNav');
    if (mobileNav) mobileNav.style.display = '';

    loadStats();
    loadDrivers();
  } catch (e) { location.href = '/login'; }
}

// ── Stats ─────────────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const d = await (await fetch('/api/agent/stats')).json();
    document.getElementById('sD').textContent = d.totalDrivers;
    document.getElementById('sDi').textContent = d.totalDispatchers || '—';
    document.getElementById('sT').textContent = d.totalInspections;
    document.getElementById('sTd').textContent = d.todayInspections;
    document.getElementById('sP').textContent = d.totalPhotos;
  } catch (e) {}
}

// ── Drivers list ──────────────────────────────────────────────────────────────
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
        <div class="dr-sub">${esc(d.truck_model||'No truck')}${d.truck_number?' · '+esc(d.truck_number):''}</div>
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
  list.innerHTML = '<div style="padding:14px;font-size:15px;color:var(--dim);font-weight:600">Loading…</div>';

  try {
    const insps = await (await fetch(`/api/agent/drivers/${id}/inspections`)).json();
    if (!insps.length) { list.innerHTML = '<div style="padding:14px;font-size:15px;color:var(--dim);font-weight:600">No inspections yet.</div>'; return; }
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
            <span class="material-icons-round chev" id="chev-${i.id}" style="font-size:20px;color:var(--muted);transition:transform 0.2s">expand_more</span>
          </div>
        </div>
        <div class="insp-card-body" id="body-${i.id}">
          <div id="cnt-${i.id}"><div style="font-size:14px;color:var(--dim);font-weight:600">Loading…</div></div>
        </div>
      </div>`;
    }).join('');
  } catch (e) { list.innerHTML = '<div style="font-size:15px;color:var(--red);font-weight:700">Error loading.</div>'; }
}

async function toggleCard(id) {
  const body = document.getElementById(`body-${id}`), chev = document.getElementById(`chev-${id}`);
  if (body.classList.contains('open')) { body.classList.remove('open'); chev.classList.remove('open'); return; }
  body.classList.add('open'); chev.classList.add('open');
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
          ${p.flagged?'<div class="photo-flag-badge"><span class="material-icons-round" style="font-size:11px">flag</span></div>':''}
        </div>`).join('')}</div>` : '<div style="font-size:14px;color:var(--dim);margin-bottom:14px;font-weight:600">No photos</div>'}
      <div class="drows">
        <div class="drow"><span class="k">Driver</span><span class="v">${esc(insp.driver_name)}</span></div>
        <div class="drow"><span class="k">Type</span><span class="v">${esc(TL[insp.inspection_type]||insp.inspection_type||'PickUp')}</span></div>
        <div class="drow"><span class="k">Asset / Trailer</span><span class="v">${insp.asset_id
          ? `<span class="asset-link" onclick="openAssetPanel(${insp.asset_id})">${esc(insp.asset_number||'—')}${insp.asset_make?' ('+[insp.asset_make,insp.asset_model].filter(Boolean).join(' ')+')':''}</span>`
          : esc(insp.asset_number||'—')
        }</span></div>
        <div class="drow"><span class="k">Truck</span><span class="v">${esc(insp.truck_model||'—')}</span></div>
        ${insp.truck_number?`<div class="drow"><span class="k">Truck No.</span><span class="v">${esc(insp.truck_number)}</span></div>`:''}
        <div class="drow"><span class="k">Submitted</span><span class="v">${fmtDate(insp.submitted_at)}</span></div>
        <div class="drow"><span class="k">GPS</span><span class="v">${mapUrl?`<a href="${mapUrl}" target="_blank">View Maps</a>`:'Not recorded'}</span></div>
      </div>
      ${insp.notes?`<div class="notes-box"><span class="material-icons-round" style="font-size:14px;vertical-align:-2px;margin-right:4px">notes</span>${esc(insp.notes)}</div>`:''}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
        <a class="btn-dl" href="/api/agent/inspections/${id}/download" download>
          <span class="material-icons-round" style="font-size:16px">download</span> ZIP
        </a>
        <a class="btn-dl btn-pdf" href="/api/agent/inspections/${id}/report" target="_blank">
          <span class="material-icons-round" style="font-size:16px">picture_as_pdf</span> PDF Report
        </a>
      </div>`;
  } catch (e) { c.innerHTML = '<div style="font-size:14px;color:var(--red);font-weight:700">Error loading.</div>'; }
}

// ── Lightbox with flagging ────────────────────────────────────────────────────
function openLb(id, idx) {
  const p = (window._lbPhotos && window._lbPhotos[id]) || [];
  if (!p.length) return;
  G.lbPhotos = p; G.lbIdx = idx;
  showLbPhoto();
  document.getElementById('lightbox').classList.add('open');
}

function openLbArr(key, idx) {
  const arr = window._lbPhotos && window._lbPhotos[key];
  if (!arr || !arr.length) return;
  G.lbPhotos = arr; G.lbIdx = idx;
  showLbPhoto();
  document.getElementById('lightbox').classList.add('open');
}

function showLbPhoto() {
  const p = G.lbPhotos[G.lbIdx];
  if (!p) return;
  document.getElementById('lbImg').src = p.file_path;
  document.getElementById('lbMeta').textContent = `Step ${p.step_number}${p.step_label?' — '+p.step_label:''} | ${G.lbIdx+1} of ${G.lbPhotos.length}`;

  const flagBtn = document.getElementById('lbFlagBtn');
  if (flagBtn) {
    if (p.flagged) {
      flagBtn.textContent = 'Remove Flag';
      flagBtn.classList.add('flagged');
    } else {
      flagBtn.textContent = 'Flag Photo';
      flagBtn.classList.remove('flagged');
    }
    flagBtn.dataset.photoId = p.id;
    flagBtn.dataset.flagged = p.flagged ? '1' : '0';
    flagBtn.dataset.note = p.flag_note || '';
  }
}

async function toggleFlag() {
  const btn = document.getElementById('lbFlagBtn');
  const photoId = btn.dataset.photoId;
  const currentlyFlagged = btn.dataset.flagged === '1';

  if (!currentlyFlagged) {
    // Ask for note
    const note = prompt('Add a note for this flag (optional):') ?? '';
    if (note === null) return; // cancelled
    await fetch(`/api/agent/photos/${photoId}/flag`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flagged: true, flag_note: note })
    });
    G.lbPhotos[G.lbIdx].flagged = 1;
    G.lbPhotos[G.lbIdx].flag_note = note;
  } else {
    if (!confirm('Remove flag from this photo?')) return;
    await fetch(`/api/agent/photos/${photoId}/flag`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flagged: false, flag_note: '' })
    });
    G.lbPhotos[G.lbIdx].flagged = 0;
    G.lbPhotos[G.lbIdx].flag_note = '';
  }
  showLbPhoto();
  // Refresh the card
  const cards = document.querySelectorAll('[id^="cnt-"]');
  cards.forEach(c => { delete c.dataset.loaded; });
}

function lbNav(d) {
  const n = G.lbIdx + d;
  if (n < 0 || n >= G.lbPhotos.length) return;
  G.lbIdx = n; showLbPhoto();
}

function closeLb() { document.getElementById('lightbox').classList.remove('open'); }

document.addEventListener('keydown', e => {
  if (!document.getElementById('lightbox').classList.contains('open')) return;
  if (e.key === 'ArrowLeft') lbNav(-1);
  if (e.key === 'ArrowRight') lbNav(1);
  if (e.key === 'Escape') closeLb();
});

// ── Asset Detail Panel ────────────────────────────────────────────────────────
async function openAssetPanel(id) {
  const panel = document.getElementById('assetPanel');
  panel.classList.remove('closed');
  document.getElementById('apTitle').textContent = 'Loading…';
  document.getElementById('apSub').textContent = '';
  document.getElementById('apBody').innerHTML = '<div style="padding:20px;font-size:15px;color:var(--dim);font-weight:600">Loading…</div>';

  try {
    const asset = await (await fetch(`/api/assets/${id}`)).json();
    const inspections = asset.inspections || [];

    document.getElementById('apTitle').textContent = asset.asset_number;
    document.getElementById('apSub').textContent = [asset.year, asset.make, asset.model].filter(Boolean).join(' ') || 'No details';

    const totalPhotos  = inspections.reduce((s, i) => s + parseInt(i.photo_count || 0), 0);
    const totalFlagged = inspections.reduce((s, i) => s + parseInt(i.flagged_count || 0), 0);
    const lastInsp     = inspections[0];

    document.getElementById('apBody').innerHTML = `
      <!-- Asset info card -->
      <div class="ap-info-card">
        <div class="ap-info-row"><span class="k">Asset #</span><span class="v">${esc(asset.asset_number)}</span></div>
        <div class="ap-info-row"><span class="k">Year</span><span class="v">${esc(asset.year || '—')}</span></div>
        <div class="ap-info-row"><span class="k">Make</span><span class="v">${esc(asset.make || '—')}</span></div>
        <div class="ap-info-row"><span class="k">Model</span><span class="v">${esc(asset.model || '—')}</span></div>
        <div class="ap-info-row"><span class="k">VIN</span><span class="v" style="font-family:monospace;font-size:12px">${esc(asset.vin || '—')}</span></div>
        <div class="ap-info-row"><span class="k">License Plate</span><span class="v">${esc(asset.license_plate || '—')}</span></div>
        ${asset.notes ? `<div class="ap-info-row"><span class="k">Notes</span><span class="v">${esc(asset.notes)}</span></div>` : ''}
      </div>

      <!-- Stats row -->
      <div class="ap-stats">
        <div class="ap-stat"><div class="ap-stat-num">${inspections.length}</div><div class="ap-stat-lbl">Inspections</div></div>
        <div class="ap-stat"><div class="ap-stat-num">${totalPhotos}</div><div class="ap-stat-lbl">Total Photos</div></div>
        <div class="ap-stat ${totalFlagged > 0 ? 'flagged' : ''}"><div class="ap-stat-num">${totalFlagged}</div><div class="ap-stat-lbl">Flagged</div></div>
        <div class="ap-stat"><div class="ap-stat-num">${lastInsp ? fmtDateShort(lastInsp.submitted_at) : '—'}</div><div class="ap-stat-lbl">Last Inspection</div></div>
      </div>

      <!-- Inspection history -->
      <div class="ap-section-hd">Inspection History</div>
      ${!inspections.length
        ? '<div style="padding:16px;font-size:15px;color:var(--dim);font-weight:600;text-align:center">No inspections recorded for this asset yet.</div>'
        : inspections.map(i => {
            const tk = i.inspection_type || 'pickup';
            const flagBadge = parseInt(i.flagged_count) > 0
              ? `<span class="ap-flag-badge"><span class="material-icons-round" style="font-size:11px">flag</span> ${i.flagged_count}</span>`
              : '';
            return `<div class="ap-insp-row" onclick="openHistPanel('${i.id}')">
              <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:3px">
                  <span class="type-badge ${tk}">${TL[tk] || tk}</span>
                  ${flagBadge}
                </div>
                <div style="font-size:13px;font-weight:700;color:var(--text)">${fmtDate(i.submitted_at)}</div>
                <div style="font-size:12px;color:var(--dim);margin-top:2px">
                  ${esc(i.driver_name)} · ${i.photo_count} photo${i.photo_count != 1 ? 's' : ''}
                </div>
              </div>
              <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;flex-shrink:0">
                <a class="btn-dl btn-pdf" href="/api/agent/inspections/${i.id}/report" target="_blank" onclick="event.stopPropagation()" style="font-size:12px;padding:5px 10px">
                  <span class="material-icons-round" style="font-size:13px">picture_as_pdf</span> PDF
                </a>
              </div>
            </div>`;
          }).join('')
      }`;
  } catch (e) {
    document.getElementById('apBody').innerHTML = '<div style="padding:20px;font-size:15px;color:var(--red);font-weight:700">Error loading asset.</div>';
  }
}

function closeAssetPanel() { document.getElementById('assetPanel').classList.add('closed'); }

function fmtDateShort(dt) {
  if (!dt) return '—';
  const d = new Date(dt.includes('T') ? dt : dt + 'Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

// ── History / Feed ────────────────────────────────────────────────────────────
async function loadFeed() {
  try {
    G.feedRows = await (await fetch('/api/agent/inspections')).json();
    renderFeed();
  } catch (e) {
    document.getElementById('feedBody').innerHTML = '<tr><td colspan="7" style="padding:20px;font-size:15px;color:var(--red);font-weight:700">Error loading.</td></tr>';
  }
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
  if (!rows.length) { tbody.innerHTML = `<tr><td colspan="7" style="padding:20px;font-size:15px;color:var(--dim);font-weight:600">No inspections found.</td></tr>`; return; }
  tbody.innerHTML = rows.map(i => {
    const tk = i.inspection_type || 'pickup';
    return `<tr onclick="openHistPanel('${i.id}')">
      <td><span class="insp-id">#${i.id.slice(0,8).toUpperCase()}</span></td>
      <td><span class="pill-ok" style="font-size:12px;padding:5px 12px">Submitted</span></td>
      <td style="color:var(--dim);font-size:14px">${fmtDate(i.submitted_at)}</td>
      <td>${i.asset_number
        ? `<span class="asset-val asset-link" onclick="event.stopPropagation();openAssetPanel(${i.asset_id||0})" title="View asset details">${esc(i.asset_number)}</span>`
        : i.truck_number
          ? `<span class="asset-val">${esc(i.truck_number)}</span>`
          : '<span style="color:var(--muted)">—</span>'}</td>
      <td style="font-weight:800">${esc(i.driver_name)}</td>
      <td><span class="type-badge ${tk}">${TL[tk]||tk}</span></td>
      <td onclick="event.stopPropagation()">
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="action-btn" onclick="openHistPanel('${i.id}')">
            <span class="material-icons-round" style="font-size:14px;vertical-align:-3px">search</span> View
          </button>
          <a class="action-btn" href="/api/agent/inspections/${i.id}/report" target="_blank" style="text-decoration:none">
            <span class="material-icons-round" style="font-size:14px;vertical-align:-3px">picture_as_pdf</span> PDF
          </a>
          <a class="action-btn" href="/api/agent/inspections/${i.id}/download" download style="text-decoration:none">
            <span class="material-icons-round" style="font-size:14px;vertical-align:-3px">download</span> ZIP
          </a>
        </div>
      </td>
    </tr>`;
  }).join('');
}

async function openHistPanel(id) {
  const panel = document.getElementById('histPanel');
  panel.classList.remove('closed');
  document.getElementById('hpTitle').textContent = '#'+id.slice(0,8).toUpperCase();
  document.getElementById('hpBody').innerHTML = '<div style="font-size:15px;color:var(--dim);font-weight:600;padding:8px">Loading…</div>';

  try {
    const insp = await (await fetch(`/api/agent/inspections/${id}`)).json();
    const photos = insp.photos || [];
    const tk = insp.inspection_type || 'pickup';
    const mapUrl = insp.latitude ? `https://www.google.com/maps?q=${insp.latitude},${insp.longitude}` : null;

    window._lbPhotos = window._lbPhotos || {};
    const lbKey = 'hist_'+id;
    window._lbPhotos[lbKey] = photos;

    document.getElementById('hpBody').innerHTML = `
      <div style="margin-bottom:16px">
        <span class="type-badge ${tk}">${TL[tk]||tk}</span>
        <span style="font-size:14px;color:var(--dim);font-weight:600">${fmtDate(insp.submitted_at)}</span>
      </div>
      ${photos.length?`<div class="photo-grid">${photos.map((p,i)=>
        `<div class="photo-cell${p.flagged?' flagged':''}" onclick="openLbArr('${lbKey}',${i})">
          <img src="${esc(p.file_path)}" loading="lazy">
          <div class="photo-cell-lbl">${esc(p.step_label||'Step '+p.step_number)}</div>
          <div class="photo-cell-num">${p.step_number}</div>
          ${p.flagged?'<div class="photo-flag-badge"><span class="material-icons-round" style="font-size:11px">flag</span></div>':''}
        </div>`).join('')}</div>`:''}
      <div class="drows" style="margin-top:14px">
        <div class="drow"><span class="k">Driver</span><span class="v">${esc(insp.driver_name)}</span></div>
        <div class="drow"><span class="k">Asset / Trailer</span><span class="v">${insp.asset_id
          ? `<span class="asset-link" onclick="openAssetPanel(${insp.asset_id})">${esc(insp.asset_number||'—')}</span>`
          : esc(insp.asset_number||'—')}</span></div>
        <div class="drow"><span class="k">Truck</span><span class="v">${esc(insp.truck_model||'—')}</span></div>
        ${insp.truck_number?`<div class="drow"><span class="k">Truck No.</span><span class="v">${esc(insp.truck_number)}</span></div>`:''}
        <div class="drow"><span class="k">Photos</span><span class="v">${photos.length}</span></div>
        <div class="drow"><span class="k">GPS</span><span class="v">${mapUrl?`<a href="${mapUrl}" target="_blank">View</a>`:'—'}</span></div>
      </div>
      ${insp.notes?`<div class="notes-box" style="margin-top:12px"><span class="material-icons-round" style="font-size:14px;vertical-align:-2px;margin-right:4px">notes</span>${esc(insp.notes)}</div>`:''}
      <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn-dl btn-pdf" href="/api/agent/inspections/${id}/report" target="_blank">
          <span class="material-icons-round" style="font-size:16px">picture_as_pdf</span> PDF Report
        </a>
        <a class="btn-dl" href="/api/agent/inspections/${id}/download" download>
          <span class="material-icons-round" style="font-size:16px">download</span> Download ZIP
        </a>
      </div>`;
  } catch (e) { document.getElementById('hpBody').innerHTML = '<div style="font-size:15px;color:var(--red);font-weight:700">Error loading.</div>'; }
}

function closeHistPanel() { document.getElementById('histPanel').classList.add('closed'); }

function backToDrivers() {
  document.querySelector('.drivers-col').style.display = '';
  document.querySelector('.detail-col').style.display = '';
  document.getElementById('detailContent').style.display = 'none';
  document.getElementById('detailEmpty').style.display = 'flex';
  document.getElementById('backToDriversBtn').style.display = 'none';
  document.querySelectorAll('.driver-row').forEach(el => el.classList.remove('sel'));
  G.sel = null;
}

// ── Admin ─────────────────────────────────────────────────────────────────────
function setAdminTab(t) {
  const tabs = { drivers:'asDrivers', dispatchers:'asDispatchers', steps:'asSteps', assets:'asAssets' };
  Object.values(tabs).forEach(id => { const el=document.getElementById(id); if(el) el.classList.remove('active'); });
  const el = document.getElementById(tabs[t]); if(el) el.classList.add('active');
  document.querySelectorAll('.at-btn').forEach((b,i) =>
    b.classList.toggle('active', ['drivers','dispatchers','steps','assets'][i] === t));
  if (t==='drivers') loadAdminDrivers();
  if (t==='dispatchers') loadAdminDispatchers();
  if (t==='steps') loadSteps();
  if (t==='assets') loadAdminAssets();
}

async function createDriver() {
  const body = { full_name:v('drName'), username:v('drUser'), email:v('drEmail'), password:v('drPass'), truck_model:v('drTruck'), truck_number:v('drTruckNum'), role:'driver' };
  const al = document.getElementById('drAlert');
  if (!body.full_name || !body.username || !body.password) { showAlert(al,'error','Name, username and password required.'); return; }
  const r = await fetch('/api/admin/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const d = await r.json();
  if (!r.ok) { showAlert(al,'error',d.error||'Error'); return; }
  showAlert(al,'ok',`Driver "${body.full_name}" added!`);
  ['drName','drUser','drEmail','drPass','drTruck','drTruckNum'].forEach(id => document.getElementById(id).value='');
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
    if (!users.length) { el.innerHTML = '<div style="font-size:15px;color:var(--dim);font-weight:600">No drivers yet.</div>'; return; }
    users.forEach(u => G.usersMap[u.id]=u);
    el.innerHTML = `<div class="utbl-wrap"><table class="utbl">
      <thead><tr><th>Name</th><th>Username</th><th>Email</th><th>Truck</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${users.map(u=>`<tr>
        <td style="font-weight:800">${esc(u.full_name)}</td>
        <td style="color:var(--dim)">${esc(u.username)}</td>
        <td style="color:var(--dim);font-size:13px">${esc(u.email||'—')}</td>
        <td style="font-size:13px;color:var(--dim)">${esc(u.truck_model||'—')}${u.truck_number?' · <strong>'+esc(u.truck_number)+'</strong>':''}</td>
        <td><span style="font-size:12px;font-weight:800;padding:4px 12px;border-radius:20px;background:${u.active?'var(--green-light)':'var(--red-light)'};color:${u.active?'#16a34a':'var(--red)'}">${u.active?'Active':'Disabled'}</span></td>
        <td><div class="utbl-actions">
          <button class="tbl-btn edit" onclick="openEditModal(${u.id})"><span class="material-icons-round" style="font-size:13px;vertical-align:-2px">edit</span> Edit</button>
          <button class="tbl-btn ${u.active?'disable':'enable'}" onclick="toggleUser(${u.id},${u.active},'drivers')">${u.active?'Disable':'Enable'}</button>
          <button class="tbl-btn del" onclick="deleteUser(${u.id},'${esc(u.full_name)}','drivers')"><span class="material-icons-round" style="font-size:13px;vertical-align:-2px">delete</span> Delete</button>
        </div></td>
      </tr>`).join('')}</tbody></table></div>`;
  } catch (e) {}
}

async function loadAdminDispatchers() {
  try {
    const users = await (await fetch('/api/admin/users?role=agent')).json();
    const el = document.getElementById('dispatchersTable');
    if (!users.length) { el.innerHTML = '<div style="font-size:15px;color:var(--dim);font-weight:600">No dispatchers yet.</div>'; return; }
    users.forEach(u => G.usersMap[u.id]=u);
    el.innerHTML = `<div class="utbl-wrap"><table class="utbl">
      <thead><tr><th>Name</th><th>Username</th><th>Email</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${users.map(u=>`<tr>
        <td style="font-weight:800">${esc(u.full_name)}</td>
        <td style="color:var(--dim)">${esc(u.username)}</td>
        <td style="color:var(--dim);font-size:13px">${esc(u.email||'—')}</td>
        <td><span style="font-size:12px;font-weight:800;padding:4px 12px;border-radius:20px;background:${u.active?'var(--green-light)':'var(--red-light)'};color:${u.active?'#16a34a':'var(--red)'}">${u.active?'Active':'Disabled'}</span></td>
        <td><div class="utbl-actions">
          <button class="tbl-btn edit" onclick="openEditModal(${u.id})"><span class="material-icons-round" style="font-size:13px;vertical-align:-2px">edit</span> Edit</button>
          <button class="tbl-btn ${u.active?'disable':'enable'}" onclick="toggleUser(${u.id},${u.active},'dispatchers')">${u.active?'Disable':'Enable'}</button>
          <button class="tbl-btn del" onclick="deleteUser(${u.id},'${esc(u.full_name)}','dispatchers')"><span class="material-icons-round" style="font-size:13px;vertical-align:-2px">delete</span> Delete</button>
        </div></td>
      </tr>`).join('')}</tbody></table></div>`;
  } catch (e) {}
}

function openEditModal(id) {
  const user = G.usersMap[id]; if (!user) return;
  document.getElementById('editUserId').value = user.id;
  document.getElementById('editName').value = user.full_name || '';
  document.getElementById('editUsername').value = user.username || '';
  document.getElementById('editEmail').value = user.email || '';
  document.getElementById('editPass').value = '';
  document.getElementById('editTruck').value = user.truck_model || '';
  document.getElementById('editTruckNum').value = user.truck_number || '';
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

// ── Steps ─────────────────────────────────────────────────────────────────────
async function loadSteps() {
  try {
    const steps = await (await fetch('/api/admin/steps')).json();
    const el = document.getElementById('stepsTable');
    if (!steps.length) { el.innerHTML = '<div style="font-size:15px;color:var(--dim);font-weight:600">No steps</div>'; return; }
    const byType = {};
    steps.forEach(s => { if (!byType[s.inspection_type]) byType[s.inspection_type]=[]; byType[s.inspection_type].push(s); });
    el.innerHTML = Object.entries(byType).map(([type,ss]) => `
      <div class="steps-list" style="margin-bottom:16px">
        <div class="step-type-hd"><span class="type-badge ${type}">${TL[type]||type}</span>${ss.length} steps</div>
        ${ss.map(s => `<div class="step-row${!s.active?' inactive':''}">
          <div class="step-num-badge">${s.step_number}</div>
          <div class="step-info"><div class="step-lbl">${esc(s.label)}</div><div class="step-inst">${esc(s.instruction)}</div></div>
          <div class="step-actions">
            <button class="step-tog${s.active?'':' off'}" onclick="toggleStep(${s.id},${s.active})">${s.active?'Disable':'Enable'}</button>
            <button class="step-del" onclick="deleteStep(${s.id},'${esc(s.label)}')" title="Delete step"><span class="material-icons-round" style="font-size:14px;vertical-align:-2px">delete</span></button>
          </div>
        </div>`).join('')}
      </div>`).join('');
  } catch (e) {}
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
  loadSteps();
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

// ── Assets ────────────────────────────────────────────────────────────────────
async function loadAdminAssets() {
  try {
    const assets = await (await fetch('/api/assets')).json();
    const el = document.getElementById('assetsTable');
    if (!assets.length) { el.innerHTML = '<div style="font-size:15px;color:var(--dim);font-weight:600">No assets yet.</div>'; return; }
    el.innerHTML = `<div class="utbl-wrap"><table class="utbl">
      <thead><tr><th>Asset #</th><th>Year</th><th>Make</th><th>Model</th><th>VIN</th><th>Plate</th><th>Actions</th></tr></thead>
      <tbody>${assets.map(a=>`<tr>
        <td style="font-weight:800;color:var(--brand)">${esc(a.asset_number)}</td>
        <td style="color:var(--dim)">${esc(a.year||'—')}</td>
        <td>${esc(a.make||'—')}</td>
        <td>${esc(a.model||'—')}</td>
        <td style="font-size:12px;color:var(--dim);font-family:monospace">${esc(a.vin||'—')}</td>
        <td style="font-size:13px">${esc(a.license_plate||'—')}</td>
        <td><div class="utbl-actions">
          <button class="tbl-btn edit" onclick="openAssetPanel(${a.id})"><span class="material-icons-round" style="font-size:13px;vertical-align:-2px">open_in_new</span> View</button>
          <button class="tbl-btn del" onclick="deleteAsset(${a.id},'${esc(a.asset_number)}')"><span class="material-icons-round" style="font-size:13px;vertical-align:-2px">delete</span> Remove</button>
        </div></td>
      </tr>`).join('')}</tbody></table></div>`;
  } catch (e) {}
}

async function createAsset() {
  const body = {
    asset_number: v('assetNum'), year: v('assetYear'), make: v('assetMake'),
    model: v('assetModel'), vin: v('assetVin'), license_plate: v('assetPlate'), notes: v('assetNotes')
  };
  const al = document.getElementById('assetAlert');
  if (!body.asset_number) { showAlert(al,'error','Asset number is required.'); return; }
  const r = await fetch('/api/admin/assets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const d = await r.json();
  if (!r.ok) { showAlert(al,'error',d.error||'Error'); return; }
  showAlert(al,'ok',`Asset "${body.asset_number}" added!`);
  ['assetNum','assetYear','assetMake','assetModel','assetVin','assetPlate','assetNotes'].forEach(id => { const e=document.getElementById(id); if(e) e.value=''; });
  loadAdminAssets();
}

async function deleteAsset(id, num) {
  if (!confirm(`Remove asset "${num}"? It won't appear in new inspections.`)) return;
  await fetch(`/api/admin/assets/${id}`,{method:'DELETE'});
  loadAdminAssets();
}

// ── Tab nav ───────────────────────────────────────────────────────────────────
function showTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`tab${name}`).classList.add('active');
  document.getElementById(`nav${name}`).classList.add('active');

  const mobileNavMap = { Overview:'mNavOverview', Feed:'mNavFeed', Admin:'mNavAdmin' };
  document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));
  const mBtn = document.getElementById(mobileNavMap[name]);
  if (mBtn) mBtn.classList.add('active');

  if (name==='Feed') loadFeed();
  if (name==='Admin') { loadAdminDrivers(); loadAdminDispatchers(); loadSteps(); }
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function fmtDate(dt) {
  if (!dt) return 'N/A';
  const d = new Date(dt.includes('T')?dt:dt+'Z');
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'});
}

function esc(s) { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function v(id) { return (document.getElementById(id)||{}).value?.trim()||''; }

function showAlert(el, type, msg) {
  el.textContent = msg;
  el.style.color = type==='ok'?'#16a34a':'var(--red)';
  el.style.borderColor = type==='ok'?'rgba(34,197,94,.3)':'rgba(239,68,68,.3)';
  el.style.background = type==='ok'?'var(--green-light)':'var(--red-light)';
  el.style.display = 'block';
  if (type==='ok') setTimeout(()=>el.style.display='none',3500);
}

async function logout() { await fetch('/api/logout',{method:'POST'}); location.href='/login'; }

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
window.loadAdminAssets = loadAdminAssets;
window.showTab = showTab; window.logout = logout; window.backToDrivers = backToDrivers;
