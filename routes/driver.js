// routes/driver.js — Driver inspection flow

const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const { v4: uuidv4 } = require('uuid');
const sharp    = require('sharp');
const db       = require('../database');
const { driver } = require('../middleware/auth');

const router = express.Router();

// multer is configured in server.js and injected via app.locals
function getUpload(req) {
  return req.app.locals.upload;
}

// ── Inspection steps list ─────────────────────────────────────────────────────

router.get('/api/inspection-steps', (req, res, next) => {
  // auth checked inline — any logged-in user may fetch steps
  if (!req.session.user) return res.redirect('/login');
  next();
}, async (req, res) => {
  try {
    const steps = await db
      .prepare('SELECT * FROM inspection_steps WHERE active=1 AND inspection_type=? ORDER BY step_number')
      .all(req.query.type || 'pickup');
    res.json(steps);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Start inspection ──────────────────────────────────────────────────────────

router.post('/api/inspections/start', driver, async (req, res) => {
  try {
    const id = uuidv4();
    const u  = req.session.user;
    const { inspection_type, asset_id } = req.body;
    const type = inspection_type || 'pickup';

    // Get assigned truck for this driver
    const truck = await db
      .prepare('SELECT * FROM trucks WHERE driver_id=? AND active=1 LIMIT 1')
      .get(u.id);

    let assetData = {};
    if (asset_id) {
      const asset = await db
        .prepare('SELECT * FROM assets WHERE id=? AND active=1')
        .get(asset_id);
      if (asset) {
        assetData = {
          asset_id:            asset.id,
          asset_number:        asset.asset_number,
          asset_year:          asset.year,
          asset_make:          asset.make,
          asset_model:         asset.model,
          asset_vin:           asset.vin,
          asset_license_plate: asset.license_plate,
        };
      }
    }

    await db.prepare(`
      INSERT INTO inspections
        (id, driver_id, driver_name, truck_id, truck_number, truck_model,
         asset_id, asset_number, asset_year, asset_make, asset_model,
         asset_vin, asset_license_plate, inspection_type, status, started_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'${type}','in_progress',NOW())
    `).run(
      id, u.id, u.name,
      truck ? truck.id           : null,
      truck ? truck.truck_number : 'N/A',
      truck ? truck.truck_model  : 'N/A',
      assetData.asset_id            || null,
      assetData.asset_number        || null,
      assetData.asset_year          || null,
      assetData.asset_make          || null,
      assetData.asset_model         || null,
      assetData.asset_vin           || null,
      assetData.asset_license_plate || null,
    );

    res.json({ inspectionId: id, truck, asset: assetData });
  } catch (e) {
    console.error('Start inspection error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Photo upload ──────────────────────────────────────────────────────────────

router.post('/api/inspections/:inspectionId/step/:step/photo', driver, (req, res) => {
  const upload = req.app.locals.upload;

  upload.single('photo')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file' });

    const { inspectionId, step } = req.params;
    const { latitude, longitude, stepLabel } = req.body;

    try {
      const inspection = await db
        .prepare('SELECT id FROM inspections WHERE id=? AND driver_id=?')
        .get(inspectionId, req.session.user.id);
      if (!inspection) return res.status(404).json({ error: 'Not found' });

      // Compress photo in-place
      const compressedPath = req.file.path.replace(/\.[^.]+$/, '_compressed.jpg');
      await sharp(req.file.path)
        .jpeg({ quality: 70 })
        .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
        .toFile(compressedPath);
      fs.unlinkSync(req.file.path);
      fs.renameSync(compressedPath, req.file.path);

      const photoPath = `/uploads/${inspectionId}/${path.basename(req.file.path)}`;
      await db.prepare(
        'INSERT INTO inspection_photos (inspection_id,step_number,step_label,file_path,latitude,longitude,taken_at) VALUES (?,?,?,?,?,?,NOW())'
      ).run(inspectionId, parseInt(step), stepLabel || null, photoPath, latitude || null, longitude || null);

      res.json({ ok: true, path: photoPath });
    } catch (e) {
      console.error('Photo upload error:', e.message);
      // Fallback: save without compression
      try {
        const photoPath = `/uploads/${inspectionId}/${req.file.filename}`;
        await db.prepare(
          'INSERT INTO inspection_photos (inspection_id,step_number,step_label,file_path,latitude,longitude,taken_at) VALUES (?,?,?,?,?,?,NOW())'
        ).run(inspectionId, parseInt(step), stepLabel || null, photoPath, latitude || null, longitude || null);
        res.json({ ok: true, path: photoPath });
      } catch (e2) {
        res.status(500).json({ error: 'Failed to save photo' });
      }
    }
  });
});

// ── Submit inspection ─────────────────────────────────────────────────────────

router.post('/api/inspections/:inspectionId/submit', driver, async (req, res) => {
  try {
    const { inspectionId } = req.params;
    const { latitude, longitude, notes } = req.body;

    const insp = await db
      .prepare('SELECT * FROM inspections WHERE id=? AND driver_id=?')
      .get(inspectionId, req.session.user.id);
    if (!insp) return res.status(404).json({ error: 'Not found' });

    const photos = await db
      .prepare('SELECT * FROM inspection_photos WHERE inspection_id=?')
      .all(inspectionId);
    if (!photos.length) return res.status(400).json({ error: 'No photos' });

    const loc = photos.find(p => p.latitude);
    await db.prepare(
      `UPDATE inspections SET status='submitted', submitted_at=NOW(), latitude=?, longitude=?, notes=? WHERE id=?`
    ).run(
      latitude  || (loc ? loc.latitude  : null),
      longitude || (loc ? loc.longitude : null),
      notes || '',
      inspectionId,
    );

    res.json({ ok: true });
  } catch (e) {
    console.error('Submit error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Driver history ────────────────────────────────────────────────────────────

router.get('/api/driver/inspections', driver, async (req, res) => {
  try {
    const rows = await db.prepare(`
      SELECT i.*, COUNT(p.id) as photo_count
      FROM inspections i
      LEFT JOIN inspection_photos p ON p.inspection_id = i.id
      WHERE i.driver_id = ?
      GROUP BY i.id
      ORDER BY i.started_at DESC
      LIMIT 10
    `).all(req.session.user.id);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Resume in-progress inspection
router.get('/api/driver/inspections/in-progress', driver, async (req, res) => {
  try {
    const insp = await db.prepare(`
      SELECT i.*, COUNT(p.id) as photo_count
      FROM inspections i
      LEFT JOIN inspection_photos p ON p.inspection_id = i.id
      WHERE i.driver_id = ? AND i.status = 'in_progress'
      GROUP BY i.id
      ORDER BY i.started_at DESC
      LIMIT 1
    `).get(req.session.user.id);

    if (!insp) return res.json(null);

    const photos = await db
      .prepare('SELECT * FROM inspection_photos WHERE inspection_id=? ORDER BY step_number')
      .all(insp.id);
    res.json({ ...insp, photos });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
