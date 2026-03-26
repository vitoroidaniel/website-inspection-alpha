// routes/agent.js — Dispatcher / Agent dashboard routes

const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const archiver = require('archiver');
const db       = require('../database');
const { agent } = require('../middleware/auth');

const router = express.Router();

// ── Assets (readable by any logged-in user) ───────────────────────────────────

router.get('/api/assets', (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  next();
}, async (req, res) => {
  try {
    const rows = await db
      .prepare('SELECT * FROM assets WHERE active=1 ORDER BY asset_number')
      .all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Asset detail with full inspection history
router.get('/api/assets/:id', agent, async (req, res) => {
  try {
    const asset = await db.prepare('SELECT * FROM assets WHERE id=?').get(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Not found' });

    const inspections = await db.prepare(`
      SELECT i.*, COUNT(p.id) as photo_count,
             SUM(CASE WHEN p.flagged=1 THEN 1 ELSE 0 END) as flagged_count
      FROM inspections i
      LEFT JOIN inspection_photos p ON p.inspection_id = i.id
      WHERE i.asset_id = ? AND i.status = 'submitted'
      GROUP BY i.id
      ORDER BY i.submitted_at DESC
    `).all(req.params.id);

    res.json({ ...asset, inspections });
  } catch (e) {
    console.error('Asset detail error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Drivers & inspections ─────────────────────────────────────────────────────

router.get('/api/agent/drivers', agent, async (req, res) => {
  try {
    const rows = await db.prepare(`
      SELECT u.id, u.full_name, u.username, u.email, u.active,
             t.truck_number, t.truck_model, t.id as truck_id,
             COUNT(i.id) as total_inspections,
             MAX(i.submitted_at) as last_inspection,
             SUM(CASE WHEN i.status='submitted' THEN 1 ELSE 0 END) as submitted_count
      FROM users u
      LEFT JOIN trucks t ON t.driver_id = u.id AND t.active = 1
      LEFT JOIN inspections i ON i.driver_id = u.id
      WHERE u.role = 'driver'
      GROUP BY u.id, t.truck_number, t.truck_model, t.id
      ORDER BY u.full_name
    `).all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/api/agent/drivers/:id/inspections', agent, async (req, res) => {
  try {
    const rows = await db.prepare(`
      SELECT i.*, COUNT(p.id) as photo_count
      FROM inspections i
      LEFT JOIN inspection_photos p ON p.inspection_id = i.id
      WHERE i.driver_id = ? AND i.status = 'submitted'
      GROUP BY i.id
      ORDER BY i.submitted_at DESC
    `).all(req.params.id);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/api/agent/inspections', agent, async (req, res) => {
  try {
    const rows = await db.prepare(`
      SELECT i.*, COUNT(p.id) as photo_count
      FROM inspections i
      LEFT JOIN inspection_photos p ON p.inspection_id = i.id
      WHERE i.status = 'submitted'
      GROUP BY i.id
      ORDER BY i.submitted_at DESC
      LIMIT 100
    `).all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/api/agent/inspections/:id', agent, async (req, res) => {
  try {
    const insp = await db.prepare('SELECT * FROM inspections WHERE id=?').get(req.params.id);
    if (!insp) return res.status(404).json({ error: 'Not found' });
    const photos = await db
      .prepare('SELECT * FROM inspection_photos WHERE inspection_id=? ORDER BY step_number')
      .all(req.params.id);
    res.json({ ...insp, photos });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Flag / unflag photo ───────────────────────────────────────────────────────

router.patch('/api/agent/photos/:photoId/flag', agent, async (req, res) => {
  try {
    const { flagged, flag_note } = req.body;
    await db
      .prepare('UPDATE inspection_photos SET flagged=?, flag_note=? WHERE id=?')
      .run(flagged ? 1 : 0, flag_note || '', req.params.photoId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Download ZIP ──────────────────────────────────────────────────────────────

router.get('/api/agent/inspections/:id/download', agent, async (req, res) => {
  try {
    const insp = await db.prepare('SELECT * FROM inspections WHERE id=?').get(req.params.id);
    if (!insp) return res.status(404).json({ error: 'Not found' });

    const photos = await db
      .prepare('SELECT * FROM inspection_photos WHERE inspection_id=? ORDER BY step_number')
      .all(req.params.id);

    const uploadsDir = req.app.locals.uploadsDir;
    const driverSlug = (insp.driver_name || '').replace(/[^a-z0-9]/gi, '_');
    const dateSlug   = (insp.submitted_at || '').toString().split('T')[0];

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="inspection_${driverSlug}_${dateSlug}.zip"`);

    const arc = archiver('zip');
    arc.pipe(res);

    photos.forEach(p => {
      const fp = path.join(uploadsDir,
        path.basename(path.dirname(p.file_path)),
        path.basename(p.file_path));
      if (fs.existsSync(fp)) {
        arc.file(fp, { name: `step_${p.step_number}_${p.step_label || ''}${path.extname(p.file_path)}` });
      }
    });

    arc.finalize();
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PDF Report — Whip Around inspired ────────────────────────────────────────

router.get('/api/agent/inspections/:id/report', agent, async (req, res) => {
  try {
    const insp = await db.prepare('SELECT * FROM inspections WHERE id=?').get(req.params.id);
    if (!insp) return res.status(404).json({ error: 'Not found' });

    const photos = await db
      .prepare('SELECT * FROM inspection_photos WHERE inspection_id=? ORDER BY step_number')
      .all(req.params.id);

    const TL        = { pickup: 'PickUp Trailer Pictures', drop: 'Drop Trailer', general: 'General' };
    const inspType  = TL[insp.inspection_type] || insp.inspection_type || 'PickUp Trailer Pictures';
    const inspNum   = insp.id.replace(/-/g, '').substring(0, 8).toUpperCase();
    const submittedDate = insp.submitted_at
      ? new Date(insp.submitted_at).toLocaleString('en-US', {
          weekday: 'short', year: 'numeric', month: 'short',
          day: 'numeric', hour: '2-digit', minute: '2-digit',
        })
      : 'N/A';

    const flaggedCount = photos.filter(p => p.flagged).length;

    let duration = 'n/a';
    if (insp.started_at && insp.submitted_at) {
      const ms   = new Date(insp.submitted_at) - new Date(insp.started_at);
      const mins = Math.floor(ms / 60000);
      const secs = Math.floor((ms % 60000) / 1000);
      duration   = `${mins}m ${secs}s`;
    }

    // Group photos by step
    const byStep = {};
    photos.forEach(p => {
      if (!byStep[p.step_number]) {
        byStep[p.step_number] = { label: p.step_label || `Step ${p.step_number}`, photos: [] };
      }
      byStep[p.step_number].photos.push(p);
    });

    // Build per-step photo HTML
    const photoSections = Object.entries(byStep).map(([stepNum, step]) => {
      const photoHtml = step.photos.map(p => {
        const fullUrl  = `${req.protocol}://${req.get('host')}${p.file_path}`;
        const flagBadge = p.flagged
          ? `<div class="flag-badge">⚑ FLAGGED${p.flag_note ? ': ' + p.flag_note : ''}</div>`
          : '';
        return `<div class="photo-item">
          <img src="${fullUrl}" onerror="this.style.display='none'" alt="Step ${stepNum} photo">
          ${flagBadge}
        </div>`;
      }).join('');

      return `<div class="step-section">
        <div class="step-header">
          <div class="step-num-badge">${stepNum}</div>
          <div class="step-title-text">${step.label}</div>
        </div>
        <div class="step-body">
          <div class="photo-grid">${photoHtml}</div>
        </div>
      </div>`;
    }).join('');

    const statusColor  = flaggedCount > 0 ? '#d94040' : '#1a8f4e';
    const statusBg     = flaggedCount > 0 ? '#fef2f2' : '#f0fdf4';
    const statusBorder = flaggedCount > 0 ? '#fca5a5' : '#bbf7d0';
    const statusText   = flaggedCount > 0
      ? `⚑ ${flaggedCount} ITEM${flaggedCount > 1 ? 'S' : ''} FLAGGED`
      : '✓ PASSED';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Inspection Report #${inspNum}</title>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Nunito', Arial, sans-serif; font-size: 13px; color: #1c1410; background: #fff; }
  @media print {
    .no-print { display: none !important; }
    @page { margin: 12mm 14mm; size: A4; }
    body { font-size: 12px; }
  }
  .no-print { position: fixed; bottom: 20px; right: 20px; background: #1e4da1; color: white; border: none; padding: 12px 20px; border-radius: 12px; font-family: 'Nunito', sans-serif; font-size: 14px; font-weight: 800; cursor: pointer; box-shadow: 0 4px 16px rgba(30,77,161,0.35); z-index: 100; display: flex; align-items: center; gap: 8px; }
  .no-print:hover { background: #163d85; }
  .top-stripe { height: 6px; background: linear-gradient(90deg, #1e4da1 0%, #7c4a1e 100%); }
  .page-header { display: flex; justify-content: space-between; align-items: center; padding: 18px 24px 14px; border-bottom: 2px solid #e5dfd6; }
  .brand-name { font-size: 24px; font-weight: 900; color: #1e4da1; letter-spacing: -0.5px; }
  .brand-sub { font-size: 11px; color: #a8977f; font-weight: 500; margin-top: 2px; }
  .report-label { text-align: right; }
  .report-label h1 { font-size: 20px; font-weight: 900; color: #1c1410; letter-spacing: -0.3px; }
  .report-id { font-size: 12px; color: #6b5c4e; font-weight: 600; margin-top: 3px; }
  .status-banner { margin: 14px 24px; background: ${statusBg}; border: 1.5px solid ${statusBorder}; border-radius: 12px; padding: 12px 18px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
  .status-badge { font-size: 14px; font-weight: 900; color: ${statusColor}; letter-spacing: -0.2px; }
  .status-meta { display: flex; gap: 20px; flex-wrap: wrap; }
  .status-meta span { font-size: 12px; color: #6b5c4e; }
  .status-meta strong { color: #1c1410; font-weight: 700; }
  .info-section { padding: 0 24px 14px; }
  .info-grid { display: grid; grid-template-columns: repeat(3, 1fr); border: 1.5px solid #e5dfd6; border-radius: 12px; overflow: hidden; }
  .info-cell { padding: 11px 14px; border-right: 1px solid #e5dfd6; border-bottom: 1px solid #e5dfd6; }
  .info-cell:nth-child(3n) { border-right: none; }
  .info-cell:nth-last-child(-n+3) { border-bottom: none; }
  .info-cell.full { grid-column: 1 / -1; }
  .info-lbl { font-size: 10px; font-weight: 700; color: #a8977f; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 3px; }
  .info-val { font-size: 13px; font-weight: 800; color: #1c1410; }
  .stats-row { display: grid; grid-template-columns: repeat(4,1fr); gap: 9px; padding: 0 24px 14px; }
  .stat-box { background: #faf8f5; border: 1.5px solid #e5dfd6; border-radius: 10px; padding: 11px 13px; }
  .stat-num { font-size: 22px; font-weight: 900; color: #1c1410; line-height: 1; }
  .stat-num.flagged { color: #d94040; }
  .stat-lbl { font-size: 10px; color: #6b5c4e; font-weight: 600; margin-top: 3px; text-transform: uppercase; letter-spacing: 0.4px; }
  .photos-title { font-size: 16px; font-weight: 900; color: #1c1410; padding: 6px 24px 12px; border-top: 1.5px solid #e5dfd6; margin-top: 6px; letter-spacing: -0.3px; }
  .step-section { margin: 0 24px 16px; break-inside: avoid; }
  .step-header { background: #1e4da1; border-radius: 10px 10px 0 0; padding: 9px 14px; display: flex; align-items: center; gap: 10px; }
  .step-num-badge { width: 26px; height: 26px; background: rgba(255,255,255,0.2); border-radius: 7px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 900; color: #fff; flex-shrink: 0; }
  .step-title-text { font-size: 13px; font-weight: 800; color: #fff; }
  .step-body { border: 1.5px solid #e5dfd6; border-top: none; border-radius: 0 0 10px 10px; padding: 12px; }
  .photo-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .photo-item { break-inside: avoid; }
  .photo-item img { width: 100%; height: auto; max-height: 180px; object-fit: cover; border-radius: 8px; border: 1px solid #e5dfd6; display: block; }
  .flag-badge { background: #fef2f2; border: 1px solid #fca5a5; color: #d94040; font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 4px; margin-top: 5px; display: inline-block; }
  .sig-section { padding: 0 24px; margin-top: 12px; }
  .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .sig-box { border: 1.5px solid #e5dfd6; border-radius: 10px; padding: 13px; }
  .sig-lbl { font-size: 10px; color: #a8977f; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 36px; }
  .sig-line { border-top: 1px solid #d4ccc0; padding-top: 5px; font-size: 11px; color: #a8977f; }
  .condition-bar { margin: 14px 24px 0; padding: 11px 16px; background: ${statusBg}; border: 1.5px solid ${statusBorder}; border-radius: 10px; font-size: 13px; font-weight: 700; color: ${statusColor}; }
  .page-footer { text-align: center; padding: 14px 24px 20px; font-size: 10px; color: #a8977f; margin-top: 14px; border-top: 1px solid #e5dfd6; }
</style>
</head>
<body>
<button class="no-print" onclick="window.print()">🖨 Print / Save PDF</button>
<div class="top-stripe"></div>
<div class="page-header">
  <div>
    <div class="brand-name">Kurtex</div>
    <div class="brand-sub">Fleet Inspection System · by Rekka Software</div>
  </div>
  <div class="report-label">
    <h1>Inspection Report</h1>
    <div class="report-id">#${inspNum} · ${inspType}</div>
  </div>
</div>
<div class="status-banner">
  <div class="status-badge">${statusText}</div>
  <div class="status-meta">
    <span>Date: <strong>${submittedDate}</strong></span>
    <span>Duration: <strong>${duration}</strong></span>
    <span>Driver: <strong>${insp.driver_name || 'N/A'}</strong></span>
  </div>
</div>
<div class="info-section">
  <div class="info-grid">
    <div class="info-cell"><div class="info-lbl">Form Type</div><div class="info-val">${inspType}</div></div>
    <div class="info-cell"><div class="info-lbl">Inspection Date</div><div class="info-val">${submittedDate}</div></div>
    <div class="info-cell"><div class="info-lbl">Duration</div><div class="info-val">${duration}</div></div>
    <div class="info-cell"><div class="info-lbl">Inspected By</div><div class="info-val">${insp.driver_name || 'N/A'}</div></div>
    <div class="info-cell"><div class="info-lbl">Truck #</div><div class="info-val">${insp.truck_number || 'N/A'}</div></div>
    <div class="info-cell"><div class="info-lbl">Truck Model</div><div class="info-val">${insp.truck_model || 'N/A'}</div></div>
    <div class="info-cell"><div class="info-lbl">Asset / Trailer</div><div class="info-val">${insp.asset_number || insp.truck_number || 'N/A'}</div></div>
    <div class="info-cell"><div class="info-lbl">Make &amp; Model</div><div class="info-val">${[insp.asset_make, insp.asset_model].filter(Boolean).join(' ') || 'N/A'}</div></div>
    <div class="info-cell"><div class="info-lbl">Year</div><div class="info-val">${insp.asset_year || 'N/A'}</div></div>
    <div class="info-cell"><div class="info-lbl">VIN</div><div class="info-val">${insp.asset_vin || 'N/A'}</div></div>
    <div class="info-cell"><div class="info-lbl">License Plate</div><div class="info-val">${insp.asset_license_plate || 'N/A'}</div></div>
    <div class="info-cell"><div class="info-lbl">GPS Location</div><div class="info-val">${insp.latitude ? `${parseFloat(insp.latitude).toFixed(5)}, ${parseFloat(insp.longitude).toFixed(5)}` : 'N/A'}</div></div>
    ${insp.notes ? `<div class="info-cell full"><div class="info-lbl">Notes</div><div class="info-val" style="font-weight:600;color:#6b5c4e;">${insp.notes}</div></div>` : ''}
  </div>
</div>
<div class="stats-row">
  <div class="stat-box"><div class="stat-num${flaggedCount > 0 ? ' flagged' : ''}">${flaggedCount}</div><div class="stat-lbl">Flagged Items</div></div>
  <div class="stat-box"><div class="stat-num">${photos.length}</div><div class="stat-lbl">Total Photos</div></div>
  <div class="stat-box"><div class="stat-num">${Object.keys(byStep).length}</div><div class="stat-lbl">Steps Done</div></div>
  <div class="stat-box"><div class="stat-num">${insp.truck_number || '—'}</div><div class="stat-lbl">Truck No.</div></div>
</div>
<div class="photos-title">📷 Inspection Photos</div>
${photoSections}
<div class="sig-section">
  <div class="sig-grid">
    <div class="sig-box"><div class="sig-lbl">Reporting Operator's Signature</div><div class="sig-line">Signed: ${insp.driver_name || 'N/A'}</div></div>
    <div class="sig-box"><div class="sig-lbl">Reviewing Operator's Signature</div><div class="sig-line">Pending review</div></div>
  </div>
</div>
<div class="condition-bar">Condition of the above asset is: <strong>${flaggedCount > 0 ? 'Requires Attention' : 'Satisfactory'}</strong></div>
<div class="page-footer">Generated by Kurtex Fleet Inspection System &nbsp;·&nbsp; Rekka Software &nbsp;·&nbsp; ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    console.error('PDF report error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Stats ─────────────────────────────────────────────────────────────────────

router.get('/api/agent/stats', agent, async (req, res) => {
  try {
    const totalDrivers     = await db.prepare("SELECT COUNT(*) as c FROM users WHERE role='driver' AND active=1").get();
    const totalDispatchers = await db.prepare("SELECT COUNT(*) as c FROM users WHERE role='agent' AND active=1").get();
    const totalInspections = await db.prepare("SELECT COUNT(*) as c FROM inspections WHERE status='submitted'").get();
    const todayInspections = await db.prepare("SELECT COUNT(*) as c FROM inspections WHERE status='submitted' AND DATE(submitted_at)=CURRENT_DATE").get();
    const totalPhotos      = await db.prepare("SELECT COUNT(*) as c FROM inspection_photos").get();

    res.json({
      totalDrivers:     parseInt(totalDrivers?.c     || 0),
      totalDispatchers: parseInt(totalDispatchers?.c  || 0),
      totalInspections: parseInt(totalInspections?.c  || 0),
      todayInspections: parseInt(todayInspections?.c  || 0),
      totalPhotos:      parseInt(totalPhotos?.c       || 0),
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
