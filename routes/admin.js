// routes/admin.js — Admin-only: users, inspection steps, assets

const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../database');
const { agent, admin } = require('../middleware/auth');

const router = express.Router();

// ── Users ─────────────────────────────────────────────────────────────────────

router.get('/api/admin/users', admin, async (req, res) => {
  try {
    const role = req.query.role;
    const rows = role
      ? await db.prepare(
          "SELECT id,username,email,full_name,role,truck_model,truck_number,active,created_at FROM users WHERE role=? AND role!='superadmin' ORDER BY full_name"
        ).all(role)
      : await db.prepare(
          "SELECT id,username,email,full_name,role,truck_model,truck_number,active,created_at FROM users WHERE role!='superadmin' ORDER BY role,full_name"
        ).all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/api/admin/users', admin, async (req, res) => {
  try {
    const { username, email, password, full_name, role, truck_model, truck_number } = req.body;

    if (!full_name || !role || !username || !password) {
      return res.status(400).json({ error: 'Name, username and password required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (await db.prepare('SELECT id FROM users WHERE username=?').get(username)) {
      return res.status(409).json({ error: 'Username already taken' });
    }
    if (email && await db.prepare('SELECT id FROM users WHERE email=?').get(email)) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    await db.prepare(
      'INSERT INTO users (username,email,password_hash,full_name,role,truck_model,truck_number) VALUES (?,?,?,?,?,?,?)'
    ).run(username, email || null, bcrypt.hashSync(password, 10), full_name, role, truck_model || '', truck_number || '');

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/api/admin/users/:id', admin, async (req, res) => {
  try {
    const { full_name, username, email, password, truck_model, truck_number, active } = req.body;
    const user = await db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Not found' });
    if (user.role === 'superadmin') return res.status(403).json({ error: 'Cannot edit superadmin' });

    if (username && username !== user.username) {
      if (await db.prepare('SELECT id FROM users WHERE username=? AND id!=?').get(username, req.params.id)) {
        return res.status(409).json({ error: 'Username taken' });
      }
    }
    if (email !== undefined && email !== user.email) {
      if (await db.prepare('SELECT id FROM users WHERE email=? AND id!=?').get(email, req.params.id)) {
        return res.status(409).json({ error: 'Email in use' });
      }
    }

    if (full_name)              await db.prepare('UPDATE users SET full_name=?    WHERE id=?').run(full_name, req.params.id);
    if (username)               await db.prepare('UPDATE users SET username=?     WHERE id=?').run(username, req.params.id);
    if (email !== undefined)    await db.prepare('UPDATE users SET email=?        WHERE id=?').run(email || null, req.params.id);
    if (truck_model !== undefined) await db.prepare('UPDATE users SET truck_model=? WHERE id=?').run(truck_model, req.params.id);
    if (truck_number !== undefined) await db.prepare('UPDATE users SET truck_number=? WHERE id=?').run(truck_number, req.params.id);
    if (active !== undefined)   await db.prepare('UPDATE users SET active=?       WHERE id=?').run(active ? 1 : 0, req.params.id);
    if (password && password.length >= 6) {
      await db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(password, 10), req.params.id);
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/api/admin/users/:id', admin, async (req, res) => {
  try {
    const user = await db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Not found' });
    if (user.role === 'superadmin') return res.status(403).json({ error: 'Cannot delete superadmin' });

    await db.prepare('DELETE FROM webauthn_credentials WHERE user_id=?').run(req.params.id);
    await db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Inspection steps ──────────────────────────────────────────────────────────

router.get('/api/admin/steps', agent, async (req, res) => {
  try {
    const steps = await db
      .prepare('SELECT * FROM inspection_steps ORDER BY inspection_type, step_number')
      .all();
    res.json(steps);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/api/admin/steps', admin, async (req, res) => {
  try {
    const { label, instruction, inspection_type } = req.body;
    if (!label || !instruction) return res.status(400).json({ error: 'Required' });

    const type   = inspection_type || 'pickup';
    const max    = await db.prepare('SELECT MAX(step_number) as m FROM inspection_steps WHERE inspection_type=?').get(type);
    const nextStep = (max?.m || 0) + 1;

    await db.prepare(
      'INSERT INTO inspection_steps (inspection_type,step_number,label,instruction) VALUES (?,?,?,?)'
    ).run(type, nextStep, label, instruction);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/api/admin/steps/:id', admin, async (req, res) => {
  try {
    const { active, label, instruction } = req.body;
    if (active !== undefined) await db.prepare('UPDATE inspection_steps SET active=?       WHERE id=?').run(active ? 1 : 0, req.params.id);
    if (label)                await db.prepare('UPDATE inspection_steps SET label=?        WHERE id=?').run(label, req.params.id);
    if (instruction)          await db.prepare('UPDATE inspection_steps SET instruction=?  WHERE id=?').run(instruction, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/api/admin/steps/:id', admin, async (req, res) => {
  try {
    const step = await db.prepare('SELECT * FROM inspection_steps WHERE id=?').get(req.params.id);
    if (!step) return res.status(404).json({ error: 'Step not found' });

    await db.prepare('DELETE FROM inspection_steps WHERE id=?').run(req.params.id);

    // Re-number remaining steps to fill gap
    const remaining = await db
      .prepare('SELECT id FROM inspection_steps WHERE inspection_type=? ORDER BY step_number ASC')
      .all(step.inspection_type);
    for (let i = 0; i < remaining.length; i++) {
      await db.prepare('UPDATE inspection_steps SET step_number=? WHERE id=?').run(i + 1, remaining[i].id);
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Assets ────────────────────────────────────────────────────────────────────

router.post('/api/admin/assets', admin, async (req, res) => {
  try {
    const { asset_number, year, make, model, vin, license_plate, notes } = req.body;
    if (!asset_number) return res.status(400).json({ error: 'Asset number required' });

    if (await db.prepare('SELECT id FROM assets WHERE asset_number=? AND active=1').get(asset_number)) {
      return res.status(409).json({ error: 'Asset number already exists' });
    }

    await db.prepare(
      'INSERT INTO assets (asset_number,year,make,model,vin,license_plate,notes) VALUES (?,?,?,?,?,?,?)'
    ).run(asset_number, year || '', make || '', model || '', vin || '', license_plate || '', notes || '');

    res.json({ ok: true });
  } catch (e) {
    console.error('Create asset error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/api/admin/assets/:id', admin, async (req, res) => {
  try {
    const { asset_number, year, make, model, vin, license_plate, notes, active } = req.body;
    const asset = await db.prepare('SELECT * FROM assets WHERE id=?').get(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Not found' });

    if (asset_number !== undefined)    await db.prepare('UPDATE assets SET asset_number=?   WHERE id=?').run(asset_number, req.params.id);
    if (year !== undefined)            await db.prepare('UPDATE assets SET year=?           WHERE id=?').run(year, req.params.id);
    if (make !== undefined)            await db.prepare('UPDATE assets SET make=?           WHERE id=?').run(make, req.params.id);
    if (model !== undefined)           await db.prepare('UPDATE assets SET model=?          WHERE id=?').run(model, req.params.id);
    if (vin !== undefined)             await db.prepare('UPDATE assets SET vin=?            WHERE id=?').run(vin, req.params.id);
    if (license_plate !== undefined)   await db.prepare('UPDATE assets SET license_plate=?  WHERE id=?').run(license_plate, req.params.id);
    if (notes !== undefined)           await db.prepare('UPDATE assets SET notes=?          WHERE id=?').run(notes, req.params.id);
    if (active !== undefined)          await db.prepare('UPDATE assets SET active=?         WHERE id=?').run(active ? 1 : 0, req.params.id);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/api/admin/assets/:id', admin, async (req, res) => {
  try {
    await db.prepare('UPDATE assets SET active=0 WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

// ── Trucks ────────────────────────────────────────────────────────────────────

router.get('/api/admin/trucks', admin, async (req, res) => {
  try {
    const rows = await db.prepare(`
      SELECT t.*, u.full_name as driver_name, u.username as driver_username
      FROM trucks t
      LEFT JOIN users u ON u.id = t.driver_id
      WHERE t.active = 1
      ORDER BY t.truck_number
    `).all();
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/api/admin/trucks', admin, async (req, res) => {
  try {
    const { truck_number, truck_model, year, make, vin, license_plate, notes, driver_id } = req.body;
    if (!truck_number) return res.status(400).json({ error: 'Truck number required' });
    if (await db.prepare('SELECT id FROM trucks WHERE truck_number=? AND active=1').get(truck_number))
      return res.status(409).json({ error: 'Truck number already exists' });
    await db.prepare(
      'INSERT INTO trucks (truck_number,truck_model,year,make,vin,license_plate,notes,driver_id) VALUES (?,?,?,?,?,?,?,?)'
    ).run(truck_number, truck_model||'', year||'', make||'', vin||'', license_plate||'', notes||'', driver_id||null);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

router.put('/api/admin/trucks/:id', admin, async (req, res) => {
  try {
    const { truck_number, truck_model, year, make, vin, license_plate, notes, driver_id, active } = req.body;
    const truck = await db.prepare('SELECT * FROM trucks WHERE id=?').get(req.params.id);
    if (!truck) return res.status(404).json({ error: 'Not found' });
    if (truck_number !== undefined)    await db.prepare('UPDATE trucks SET truck_number=?   WHERE id=?').run(truck_number, req.params.id);
    if (truck_model !== undefined)     await db.prepare('UPDATE trucks SET truck_model=?    WHERE id=?').run(truck_model, req.params.id);
    if (year !== undefined)            await db.prepare('UPDATE trucks SET year=?           WHERE id=?').run(year, req.params.id);
    if (make !== undefined)            await db.prepare('UPDATE trucks SET make=?           WHERE id=?').run(make, req.params.id);
    if (vin !== undefined)             await db.prepare('UPDATE trucks SET vin=?            WHERE id=?').run(vin, req.params.id);
    if (license_plate !== undefined)   await db.prepare('UPDATE trucks SET license_plate=?  WHERE id=?').run(license_plate, req.params.id);
    if (notes !== undefined)           await db.prepare('UPDATE trucks SET notes=?          WHERE id=?').run(notes, req.params.id);
    if (active !== undefined)          await db.prepare('UPDATE trucks SET active=?         WHERE id=?').run(active ? 1 : 0, req.params.id);
    // Assign/unassign driver — also clear from previous driver
    if (driver_id !== undefined) {
      await db.prepare('UPDATE trucks SET driver_id=? WHERE id=?').run(driver_id || null, req.params.id);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/api/admin/trucks/:id', admin, async (req, res) => {
  try {
    await db.prepare('UPDATE trucks SET active=0, driver_id=NULL WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// Assign truck to driver (convenience endpoint)
router.post('/api/admin/trucks/:id/assign', admin, async (req, res) => {
  try {
    const { driver_id } = req.body;
    // Unassign this truck from whoever had it
    await db.prepare('UPDATE trucks SET driver_id=NULL WHERE driver_id=? AND id!=?').run(driver_id, req.params.id);
    await db.prepare('UPDATE trucks SET driver_id=? WHERE id=?').run(driver_id || null, req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// GET all assets including inactive (for admin panel)
router.get('/api/admin/assets', admin, async (req, res) => {
  try {
    const rows = await db.prepare('SELECT * FROM assets ORDER BY active DESC, asset_number').all();
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});
