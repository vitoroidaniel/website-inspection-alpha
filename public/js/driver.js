// Kurtex - Driver Application
// Designed by Rekka Software

const STEPS = [];
let S = {
  step: 0, inspId: null, photos: {}, loc: null,
  user: null, type: 'pickup', asset: null
};

const TL = { pickup: 'PickUp Trailer', drop: 'Drop Trailer', general: 'General' };
const SAVE_KEY = 'kurtex_inprogress';

// ── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    const [mr, sr] = await Promise.all([fetch('/api/me'), fetch('/api/inspection-steps?type=pickup')]);
    if (!mr.ok) { location.href = '/login'; return; }
    const u = await mr.json();
    if (u.role !== 'driver') { location.href = '/agent/dashboard'; return; }

    STEPS.length = 0;
    STEPS.push(...(await sr.json()));
    S.user = u;

    document.getElementById('dName').textContent = u.name || u.username;
    document.getElementById('dTruck').textContent = [u.truck_model, u.truck_number].filter(Boolean).join(' · ') || 'No truck assigned';
    document.getElementById('iName').textContent = u.name || '—';
    document.getElementById('iTruck').textContent = u.truck_model || '—';
    document.getElementById('iNum').textContent = u.truck_number || '—';

    updateStepCount();
    loadRecent();
    initGPS();
    await checkBiometricSetup();
    checkInProgress();
  } catch (e) { location.href = '/login'; }
}

// ── In-progress resume ────────────────────────────────────────────────────────
async function checkInProgress() {
  // Check localStorage first (fastest)
  const saved = loadFromStorage();
  if (saved) {
    showResumeBanner(saved);
    return;
  }
  // Then check server
  try {
    const r = await fetch('/api/driver/inspections/in-progress');
    const d = await r.json();
    if (d && d.id) {
      showResumeBanner(d);
    }
  } catch (e) {}
}

function showResumeBanner(data) {
  const banner = document.getElementById('resumeBanner');
  const lbl = document.getElementById('resumeLabel');
  if (!banner) return;
  const stepsDone = data.photos ? (Array.isArray(data.photos) ? data.photos.length : Object.keys(data.photos).length) : (data.photo_count || 0);
  lbl.textContent = `Resume ${TL[data.inspection_type || data.type || 'pickup']} — ${stepsDone} photo${stepsDone !== 1 ? 's' : ''} saved`;
  banner.style.display = 'flex';
  banner.dataset.inspId = data.id || data.inspId || '';
  banner.dataset.type = data.inspection_type || data.type || 'pickup';
}

async function resumeInspection() {
  const banner = document.getElementById('resumeBanner');
  const inspId = banner.dataset.inspId;
  const type   = banner.dataset.type;

  // Try localStorage first
  const saved = loadFromStorage();
  if (saved && saved.inspId === inspId) {
    S.inspId = saved.inspId;
    S.type   = saved.type || type;
    S.photos = saved.photos || {};
    S.asset  = saved.asset || null;

    // Reload steps for this type
    const res = await fetch(`/api/inspection-steps?type=${S.type}`);
    STEPS.length = 0;
    STEPS.push(...(await res.json()));

    // Find first missing step
    S.step = 0;
    for (let i = 0; i < STEPS.length; i++) {
      if (!S.photos[i]) { S.step = i; break; }
    }

    updateAssetDisplay();
    banner.style.display = 'none';
    renderStep();
    showScreen('sInspect');
    return;
  }

  // Fallback: reload from server
  try {
    const r = await fetch('/api/driver/inspections/in-progress');
    const d = await r.json();
    if (!d) return;

    S.inspId = d.id;
    S.type   = d.inspection_type || type;
    S.asset  = d.asset_number ? { asset_number: d.asset_number, make: d.asset_make, model: d.asset_model } : null;

    const photos = d.photos || [];
    S.photos = {};
    photos.forEach(p => { S.photos[p.step_number - 1] = { path: p.file_path, photoId: p.id }; });

    const res = await fetch(`/api/inspection-steps?type=${S.type}`);
    STEPS.length = 0;
    STEPS.push(...(await res.json()));

    S.step = 0;
    for (let i = 0; i < STEPS.length; i++) {
      if (!S.photos[i]) { S.step = i; break; }
    }

    updateAssetDisplay();
    banner.style.display = 'none';
    renderStep();
    showScreen('sInspect');
  } catch (e) { alert('Could not resume. Please start a new inspection.'); }
}

function dismissResume() {
  document.getElementById('resumeBanner').style.display = 'none';
  clearStorage();
}

// ── LocalStorage save/load ───────────────────────────────────────────────────
function saveToStorage() {
  if (!S.inspId) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      inspId: S.inspId, type: S.type, photos: S.photos, asset: S.asset,
      savedAt: Date.now()
    }));
  } catch (e) {}
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    // Expire after 24 hours
    if (Date.now() - (d.savedAt || 0) > 86400000) { clearStorage(); return null; }
    return d;
  } catch (e) { return null; }
}

function clearStorage() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
}

// ── Type selection ────────────────────────────────────────────────────────────
async function setType(t) {
  S.type = t;
  ['pickup','drop','general'].forEach(x => {
    const btn = document.getElementById('typeBtn' + x[0].toUpperCase() + x.slice(1));
    if (btn) btn.classList.toggle('active', x === t);
  });
  const res = await fetch(`/api/inspection-steps?type=${t}`);
  STEPS.length = 0;
  STEPS.push(...(await res.json()));
  updateStepCount();
}

function updateStepCount() {
  document.getElementById('iSteps').textContent = STEPS.length;
  document.getElementById('startBadge').textContent = STEPS.length + ' steps';
}

// ── GPS ──────────────────────────────────────────────────────────────────────
function initGPS() {
  if (!navigator.geolocation) { setGPS(false, 'GPS not available'); return; }
  navigator.geolocation.getCurrentPosition(
    p => { S.loc = { lat: p.coords.latitude, lng: p.coords.longitude }; setGPS(true, `GPS locked — ${p.coords.latitude.toFixed(4)}, ${p.coords.longitude.toFixed(4)}`); },
    () => setGPS(false, 'Location access denied'),
    { enableHighAccuracy: true, timeout: 12000 }
  );
}

function setGPS(ok, txt) {
  const dot = document.getElementById('gpsDot'), text = document.getElementById('gpsText');
  if (dot) dot.className = 'gps-dot ' + (ok ? 'on' : 'err');
  if (text) text.textContent = txt;
}

// ── Recent inspections ────────────────────────────────────────────────────────
async function loadRecent() {
  try {
    const rows = await (await fetch('/api/driver/inspections')).json();
    const el = document.getElementById('recentList');
    if (!rows.length) { el.innerHTML = '<p style="font-size:16px;color:var(--dim);font-weight:600">No inspections yet.</p>'; return; }
    el.innerHTML = rows.filter(i => i.status === 'submitted').slice(0,5).map(i => `
      <div class="insp-row">
        <div>
          <div class="insp-meta">${fmtDate(i.submitted_at || i.started_at)}</div>
          <div class="insp-info">
            <span class="type-chip ${i.inspection_type||'pickup'}">${TL[i.inspection_type||'pickup']}</span>
            ${i.asset_number ? '<strong>' + i.asset_number + '</strong> · ' : ''}${i.photo_count} photo${i.photo_count !== 1 ? 's' : ''}
          </div>
        </div>
        <div class="status-pill submitted">Submitted</div>
      </div>`).join('');
  } catch (e) {}
}

// ── Trailer / Asset selection ─────────────────────────────────────────────────
async function openTrailerModal() {
  const modal = document.getElementById('trailerModal');
  const list  = document.getElementById('trailerList');
  modal.classList.add('open');
  list.innerHTML = '<div style="padding:16px;color:var(--dim);font-weight:600">Loading trailers…</div>';
  try {
    const assets = await (await fetch('/api/assets')).json();
    if (!assets.length) {
      list.innerHTML = '<div style="padding:16px;color:var(--dim);font-weight:600">No trailers registered. Contact your dispatcher.</div>';
      return;
    }
    list.innerHTML = assets.map(a => `
      <div class="trailer-row${S.asset?.id === a.id ? ' sel' : ''}" onclick="selectTrailer(${a.id},'${esc(a.asset_number)}','${esc(a.make)}','${esc(a.model)}','${esc(a.year)}','${esc(a.vin)}','${esc(a.license_plate)}')">
        <div class="trailer-num">${esc(a.asset_number)}</div>
        <div class="trailer-info">${[a.year, a.make, a.model].filter(Boolean).join(' ')}</div>
        <div class="trailer-vin">${a.vin || ''}</div>
        ${S.asset?.id === a.id ? '<span class="trailer-sel-badge">Selected</span>' : ''}
      </div>`).join('');
  } catch (e) {
    list.innerHTML = '<div style="padding:16px;color:var(--red);font-weight:600">Error loading trailers.</div>';
  }
}

function selectTrailer(id, num, make, model, year, vin, plate) {
  S.asset = { id, asset_number: num, make, model, year, vin, license_plate: plate };
  updateAssetDisplay();
  closeTrailerModal();
}

function clearTrailer() {
  S.asset = null;
  updateAssetDisplay();
}

function updateAssetDisplay() {
  const el = document.getElementById('selectedAsset');
  const clearBtn = document.getElementById('clearAssetBtn');
  if (!el) return;
  if (S.asset) {
    el.textContent = S.asset.asset_number + (S.asset.make ? ' — ' + [S.asset.make, S.asset.model].filter(Boolean).join(' ') : '');
    el.style.color = 'var(--brand)';
    if (clearBtn) clearBtn.style.display = 'inline-flex';
  } else {
    el.textContent = 'No trailer selected (optional)';
    el.style.color = 'var(--muted)';
    if (clearBtn) clearBtn.style.display = 'none';
  }
}

function closeTrailerModal() { document.getElementById('trailerModal').classList.remove('open'); }

// ── Start inspection ──────────────────────────────────────────────────────────
async function startInspection() {
  if (!STEPS.length) { alert('No steps configured. Contact your dispatcher.'); return; }
  try {
    const body = { inspection_type: S.type };
    if (S.asset?.id) body.asset_id = S.asset.id;

    const r = await fetch('/api/inspections/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const d = await r.json();
    if (!r.ok) throw new Error();

    S.inspId = d.inspectionId;
    S.step = 0;
    S.photos = {};
    saveToStorage();
    renderStep();
    showScreen('sInspect');
  } catch (e) { alert('Could not start. Check connection.'); }
}

// ── Render step ───────────────────────────────────────────────────────────────
function renderStep() {
  const i = S.step, s = STEPS[i];
  document.getElementById('sCtr').textContent = `${i+1} / ${STEPS.length}`;
  document.getElementById('progFill').style.width = `${(i/STEPS.length)*100}%`;
  document.getElementById('sLabel').textContent = s.label;
  document.getElementById('sEye').textContent = `STEP ${i+1} OF ${STEPS.length}`;
  document.getElementById('sTitle').textContent = s.label;
  document.getElementById('sDesc').textContent = s.instruction;

  document.getElementById('stepDots').innerHTML = STEPS.map((_,j) =>
    `<div class="sdot${j<i?' done':j===i?' active':''}"></div>`).join('');

  const p = S.photos[i];
  const prev = document.getElementById('phPreview'), ph = document.getElementById('phPlaceholder');
  const badge = document.getElementById('phBadge'), rb = document.getElementById('retakeBtn');
  const cb = document.getElementById('camBtn'), pz = document.getElementById('photoZone');
  const bn = document.getElementById('btnNext');

  document.getElementById('phErr').style.display = 'none';
  document.getElementById('uploadOverlay').style.display = 'none';

  if (p) {
    prev.src = p.path; prev.style.display = 'block';
    ph.style.display = 'none'; badge.style.display = 'flex';
    rb.style.display = 'block'; cb.style.display = 'none';
    pz.classList.add('captured'); pz.onclick = null;
    bn.disabled = false;
    bn.textContent = i === STEPS.length - 1 ? 'Review & Submit' : 'Continue';
  } else {
    prev.style.display = 'none'; ph.style.display = 'flex';
    badge.style.display = 'none'; rb.style.display = 'none';
    cb.style.display = 'flex'; pz.classList.remove('captured');
    pz.onclick = triggerCam; bn.disabled = true;
    bn.textContent = 'Continue';
  }
}

// ── Camera ────────────────────────────────────────────────────────────────────
function triggerCam() { document.getElementById('camInput').click(); }

function retake(e) {
  e.stopPropagation();
  S.photos[S.step] = null;
  renderStep();
  document.getElementById('camInput').click();
}

document.getElementById('camInput').addEventListener('change', async function() {
  const file = this.files[0];
  if (!file) return;
  const i = S.step;
  const prev = document.getElementById('phPreview'), ph = document.getElementById('phPlaceholder');
  const overlay = document.getElementById('uploadOverlay'), err = document.getElementById('phErr');

  const reader = new FileReader();
  reader.onload = e => { prev.src = e.target.result; prev.style.display = 'block'; ph.style.display = 'none'; };
  reader.readAsDataURL(file);

  overlay.style.display = 'flex'; err.style.display = 'none';

  try {
    const form = new FormData();
    form.append('photo', file);
    form.append('stepLabel', STEPS[i].label);
    if (S.loc) { form.append('latitude', S.loc.lat); form.append('longitude', S.loc.lng); }

    const r = await fetch(`/api/inspections/${S.inspId}/step/${i+1}/photo`, { method: 'POST', body: form });
    const d = await r.json();
    if (!r.ok) throw new Error();

    S.photos[i] = { path: d.path, photoId: d.photoId };
    saveToStorage(); // Auto-save after each photo
    renderStep();
  } catch (e) {
    overlay.style.display = 'none'; prev.style.display = 'none'; ph.style.display = 'flex';
    err.textContent = 'Upload failed — try again.'; err.style.display = 'block';
  }
  this.value = '';
});

// ── Navigation ────────────────────────────────────────────────────────────────
function nextStep() {
  if (!S.photos[S.step]) return;
  if (S.step === STEPS.length - 1) { showReview(); return; }
  S.step++;
  renderStep();
  document.querySelector('.inspect-body').scrollTop = 0;
}

function prevStep() {
  if (S.step === 0) { showScreen('sHome'); return; }
  S.step--;
  renderStep();
}

function goBackToPhotos() { S.step = STEPS.length - 1; renderStep(); showScreen('sInspect'); }

// ── Review ────────────────────────────────────────────────────────────────────
function showReview() {
  document.getElementById('revCount').textContent = Object.keys(S.photos).length;
  document.getElementById('revGrid').innerHTML = STEPS.map((s, i) => {
    const p = S.photos[i];
    return `<div class="r-thumb">
      ${p ? `<img src="${p.path}" loading="lazy"><div class="r-thumb-ok"><svg viewBox="0 0 10 10" fill="none"><polyline points="2,5 4.5,7.5 8,2.5" stroke="white" stroke-width="2"/></svg></div>` : `<div class="r-missing" style="font-size:16px;font-weight:900;color:var(--red)">—</div>`}
      <div class="r-thumb-num">${i+1}</div>
    </div>`;
  }).join('');

  const tl = TL[S.type] || 'Inspection';
  document.getElementById('revType').textContent = tl + ' Inspection';
  document.getElementById('revDriver').textContent = S.user?.name || '—';
  document.getElementById('revTruck').textContent = S.user?.truck_model || '—';
  document.getElementById('revNum').textContent = S.user?.truck_number || '—';
  document.getElementById('revTypeRow').textContent = tl;
  document.getElementById('revTrailer').textContent = S.asset ? S.asset.asset_number + (S.asset.make ? ' — '+[S.asset.make,S.asset.model].filter(Boolean).join(' ') : '') : 'Not selected';
  document.getElementById('revTime').textContent = new Date().toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'});

  if (S.loc) {
    const lt = S.loc.lat.toFixed(5), lg = S.loc.lng.toFixed(5);
    document.getElementById('revLoc').innerHTML = `<a href="https://maps.google.com/?q=${lt},${lg}" target="_blank">${lt}, ${lg}</a>`;
  } else {
    document.getElementById('revLoc').textContent = 'Not available';
  }
  showScreen('sReview');
}

// ── Submit ────────────────────────────────────────────────────────────────────
async function submitInspection() {
  const btn = document.getElementById('btnSubmit'), txt = document.getElementById('submitTxt');
  btn.disabled = true; txt.textContent = 'Submitting…';
  try {
    const body = { notes: document.getElementById('notesInput').value };
    if (S.loc) { body.latitude = S.loc.lat; body.longitude = S.loc.lng; }
    const r = await fetch(`/api/inspections/${S.inspId}/submit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error();
    clearStorage(); // Clear saved progress on success
    showScreen('sSuccess');
  } catch (e) { btn.disabled = false; txt.textContent = 'Submit Inspection'; alert('Submission failed.'); }
}

function newInspection() {
  S = { step: 0, inspId: null, photos: {}, loc: S.loc, user: S.user, type: S.type, asset: null };
  document.getElementById('notesInput').value = '';
  updateAssetDisplay();
  loadRecent();
  showScreen('sHome');
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

function updateAssetDisplay() {
  const el = document.getElementById('selectedAsset'), clearBtn = document.getElementById('clearAssetBtn');
  if (!el) return;
  if (S.asset) {
    el.textContent = S.asset.asset_number + (S.asset.make ? ' — ' + [S.asset.make, S.asset.model].filter(Boolean).join(' ') : '');
    el.style.color = 'var(--brand)';
    if (clearBtn) clearBtn.style.display = 'inline-flex';
  } else {
    el.textContent = 'No trailer selected (optional)';
    el.style.color = 'var(--muted)';
    if (clearBtn) clearBtn.style.display = 'none';
  }
}

function fmtDate(dt) {
  if (!dt) return 'N/A';
  const d = new Date(dt.includes('T') ? dt : dt+'Z');
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
}

function esc(s) { return String(s||'').replace(/'/g, "\\'"); }

async function logout() { await fetch('/api/logout',{method:'POST'}); location.href='/login'; }

// ── Settings – Biometric ─────────────────────────────────────────────────────
async function checkBiometricSetup() {
  try {
    const r = await fetch('/api/auth/webauthn/has-credential');
    const d = await r.json();
    const badge = document.getElementById('bioSetupBadge');
    if (badge) { badge.textContent = d.registered ? 'Setup' : 'Not Setup'; badge.className = 'setting-status '+(d.registered?'setup':'not-setup'); }
  } catch (e) {}
}

function openSettings() { document.getElementById('settingsModal').classList.add('open'); checkBiometricSetupForSettings(); }
function closeSettings() { document.getElementById('settingsModal').classList.remove('open'); }

async function checkBiometricSetupForSettings() {
  try {
    const r = await fetch('/api/auth/webauthn/has-credential');
    const d = await r.json();
    const setupBtn = document.getElementById('setupBioBtn'), removeBtn = document.getElementById('removeBioBtn'), badge = document.getElementById('bioSetupBadge');
    if (d.registered) { setupBtn.style.display='none'; removeBtn.style.display='block'; badge.textContent='Setup'; badge.className='setting-status setup'; }
    else { setupBtn.style.display='block'; removeBtn.style.display='none'; badge.textContent='Not Setup'; badge.className='setting-status not-setup'; }
  } catch (e) {}
}

async function setupBiometric() {
  const alertEl = document.getElementById('settingsAlert'), setupBtn = document.getElementById('setupBioBtn');
  if (!window.PublicKeyCredential) { showAlert(alertEl,'error','Face ID is not supported on this browser.'); return; }
  setupBtn.disabled = true; setupBtn.textContent = 'Scanning…'; alertEl.style.display = 'none';
  try {
    const optRes = await fetch('/api/auth/webauthn/register-options',{method:'POST',headers:{'Content-Type':'application/json'}});
    if (!optRes.ok) { showAlert(alertEl,'error','Could not start Face ID setup.'); return; }
    const opts = await optRes.json();
    opts.challenge = new TextEncoder().encode(opts.challenge);
    opts.user.id = Uint8Array.from(atob(opts.user.id), x => x.charCodeAt(0));
    const credential = await navigator.credentials.create({ publicKey: opts });
    const credId = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));
    let publicKey = '';
    try { const pkBuffer = credential.response.getPublicKey?.(); if (pkBuffer) publicKey = btoa(String.fromCharCode(...new Uint8Array(pkBuffer))); } catch (_) {}
    const regRes = await fetch('/api/auth/webauthn/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({credentialId:credId,publicKey,transports:['internal']})});
    const regData = await regRes.json();
    if (!regRes.ok) { showAlert(alertEl,'error',regData.error||'Registration failed.'); return; }
    showAlert(alertEl,'ok','Face ID set up! You can now log in with Face ID on the login screen.');
    checkBiometricSetupForSettings();
  } catch (e) {
    if (e.name==='NotAllowedError') {} // user cancelled
    else if (e.name==='InvalidStateError') showAlert(alertEl,'error','Face ID already registered on this device.');
    else showAlert(alertEl,'error','Setup failed: '+(e.message||'Please try again.'));
  } finally { setupBtn.disabled=false; setupBtn.textContent='Setup'; }
}

async function removeBiometric() {
  if (!confirm('Remove biometric login? You can set it up again anytime.')) return;
  const alertEl = document.getElementById('settingsAlert');
  try {
    await fetch('/api/auth/webauthn/remove-credential',{method:'POST',headers:{'Content-Type':'application/json'}});
    showAlert(alertEl,'ok','Biometric removed');
    checkBiometricSetupForSettings();
  } catch (e) { showAlert(alertEl,'error','Failed to remove biometric'); }
}

function showAlert(el, type, msg) {
  el.textContent = msg;
  el.style.color = type==='ok'?'#16a34a':'var(--red)';
  el.style.borderColor = type==='ok'?'rgba(34,197,94,.3)':'rgba(239,68,68,.3)';
  el.style.background = type==='ok'?'var(--green-light)':'var(--red-light)';
  el.style.display = 'block';
  if (type==='ok') setTimeout(()=>el.style.display='none',3000);
}

// Exports
window.setType = setType;
window.startInspection = startInspection;
window.triggerCam = triggerCam;
window.retake = retake;
window.nextStep = nextStep;
window.prevStep = prevStep;
window.goBackToPhotos = goBackToPhotos;
window.submitInspection = submitInspection;
window.newInspection = newInspection;
window.logout = logout;
window.openSettings = openSettings;
window.closeSettings = closeSettings;
window.setupBiometric = setupBiometric;
window.removeBiometric = removeBiometric;
window.openTrailerModal = openTrailerModal;
window.closeTrailerModal = closeTrailerModal;
window.selectTrailer = selectTrailer;
window.clearTrailer = clearTrailer;
window.resumeInspection = resumeInspection;
window.dismissResume = dismissResume;
