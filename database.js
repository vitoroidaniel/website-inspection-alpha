// database.js — PostgreSQL connection, schema, migrations, seed
// by Rekka Software

const { Pool } = require('pg');
const bcrypt   = require('bcryptjs');

if (!process.env.DATABASE_URL) {
  console.error('❌  DATABASE_URL environment variable is not set.');
  console.error('    Copy .env.example to .env and set DATABASE_URL.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Test connection on startup
pool.connect()
  .then(c => { console.log('✅  Database connected'); c.release(); })
  .catch(e => {
    console.error('❌  Database connection failed:', e.message);
    process.exit(1);
  });

// Convert SQLite-style ? placeholders to PostgreSQL $1, $2, ...
function convertSql(sql) {
  let i = 0;
  sql = sql.replace(/\?/g, () => `$${++i}`);
  sql = sql.replace(/date\('now'\)/gi,     'CURRENT_DATE');
  sql = sql.replace(/datetime\('now'\)/gi, 'NOW()');
  return sql;
}

const db = {
  prepare: (sql) => {
    const pgSql = convertSql(sql);
    return {
      get:  async (...args) => { const r = await pool.query(pgSql, args); return r.rows[0] || null; },
      all:  async (...args) => { const r = await pool.query(pgSql, args); return r.rows; },
      run:  async (...args) => { const r = await pool.query(pgSql, args); return r; },
    };
  },
  exec: async (sql) => pool.query(sql),
};

// ── Schema ────────────────────────────────────────────────────────────────────
const initDatabase = async () => {

  // Users — drivers and dispatchers (no truck data here, see trucks table)
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    username      TEXT UNIQUE NOT NULL,
    email         TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    full_name     TEXT NOT NULL,
    role          TEXT NOT NULL CHECK(role IN ('driver','agent','superadmin')),
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TIMESTAMP DEFAULT NOW()
  )`);

  // Trucks — owned separately, assigned to a driver
  await pool.query(`CREATE TABLE IF NOT EXISTS trucks (
    id            SERIAL PRIMARY KEY,
    truck_number  TEXT NOT NULL,
    truck_model   TEXT NOT NULL DEFAULT '',
    year          TEXT DEFAULT '',
    make          TEXT DEFAULT '',
    vin           TEXT DEFAULT '',
    license_plate TEXT DEFAULT '',
    notes         TEXT DEFAULT '',
    driver_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TIMESTAMP DEFAULT NOW()
  )`);

  // Trailers / Assets
  await pool.query(`CREATE TABLE IF NOT EXISTS assets (
    id            SERIAL PRIMARY KEY,
    asset_number  TEXT NOT NULL,
    year          TEXT DEFAULT '',
    make          TEXT DEFAULT '',
    model         TEXT DEFAULT '',
    vin           TEXT DEFAULT '',
    license_plate TEXT DEFAULT '',
    notes         TEXT DEFAULT '',
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TIMESTAMP DEFAULT NOW()
  )`);

  // WebAuthn credentials (Face ID)
  await pool.query(`CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id            SERIAL PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id TEXT UNIQUE NOT NULL,
    public_key    TEXT NOT NULL,
    counter       INTEGER NOT NULL DEFAULT 0,
    transports    TEXT DEFAULT '[]',
    created_at    TIMESTAMP DEFAULT NOW()
  )`);

  // Inspections — snapshot of truck/trailer data at time of inspection
  await pool.query(`CREATE TABLE IF NOT EXISTS inspections (
    id                   TEXT PRIMARY KEY,
    driver_id            INTEGER NOT NULL REFERENCES users(id),
    driver_name          TEXT NOT NULL,
    truck_id             INTEGER REFERENCES trucks(id) ON DELETE SET NULL,
    truck_number         TEXT,
    truck_model          TEXT,
    asset_id             INTEGER REFERENCES assets(id) ON DELETE SET NULL,
    asset_number         TEXT,
    asset_year           TEXT,
    asset_make           TEXT,
    asset_model          TEXT,
    asset_vin            TEXT,
    asset_license_plate  TEXT,
    inspection_type      TEXT NOT NULL DEFAULT 'pickup',
    status               TEXT NOT NULL DEFAULT 'in_progress',
    latitude             REAL,
    longitude            REAL,
    notes                TEXT,
    started_at           TIMESTAMP,
    submitted_at         TIMESTAMP
  )`);

  // Inspection photos
  await pool.query(`CREATE TABLE IF NOT EXISTS inspection_photos (
    id            SERIAL PRIMARY KEY,
    inspection_id TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
    step_number   INTEGER NOT NULL,
    step_label    TEXT,
    file_path     TEXT NOT NULL,
    latitude      REAL,
    longitude     REAL,
    flagged       INTEGER NOT NULL DEFAULT 0,
    flag_note     TEXT DEFAULT '',
    taken_at      TIMESTAMP
  )`);

  // Inspection steps (configurable per type)
  await pool.query(`CREATE TABLE IF NOT EXISTS inspection_steps (
    id              SERIAL PRIMARY KEY,
    inspection_type TEXT NOT NULL DEFAULT 'pickup',
    step_number     INTEGER NOT NULL,
    label           TEXT NOT NULL,
    instruction     TEXT NOT NULL,
    active          INTEGER NOT NULL DEFAULT 1
  )`);

  // ── Safe migrations for existing deployments ──────────────────────────────
  const migrations = [
    // users: remove old truck columns if they exist (moved to trucks table)
    `ALTER TABLE users DROP COLUMN IF EXISTS truck_model`,
    `ALTER TABLE users DROP COLUMN IF EXISTS truck_number`,
    // trucks table
    `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS year TEXT DEFAULT ''`,
    `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS make TEXT DEFAULT ''`,
    `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS vin  TEXT DEFAULT ''`,
    `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS license_plate TEXT DEFAULT ''`,
    `ALTER TABLE trucks ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT ''`,
    // inspections: add truck_id FK
    `ALTER TABLE inspections ADD COLUMN IF NOT EXISTS truck_id INTEGER REFERENCES trucks(id) ON DELETE SET NULL`,
    `ALTER TABLE inspections ADD COLUMN IF NOT EXISTS truck_number TEXT`,
    `ALTER TABLE inspections ADD COLUMN IF NOT EXISTS truck_model  TEXT`,
    // assets
    `ALTER TABLE assets ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT ''`,
    // inspection_photos: drop taken_at NOT NULL if it exists with constraint
    `ALTER TABLE inspection_photos ADD COLUMN IF NOT EXISTS flag_note TEXT DEFAULT ''`,
    `ALTER TABLE inspection_photos ADD COLUMN IF NOT EXISTS flagged INTEGER NOT NULL DEFAULT 0`,
  ];

  for (const m of migrations) {
    try { await pool.query(m); } catch (_) {}
  }

  // ── Seed inspection steps ─────────────────────────────────────────────────
  const sc = await pool.query('SELECT COUNT(*) as c FROM inspection_steps');
  if (parseInt(sc.rows[0].c) === 0) {
    const steps = [
      ['pickup', 1,'Engine Hours','Photograph the engine hours display clearly. Ensure reading is visible.'],
      ['pickup', 2,'Trailer Annual Inspection','Photograph annual inspection sticker. Expiration date must be visible.'],
      ['pickup', 3,'Trailer Registration','Photograph the trailer registration document. All text must be legible.'],
      ['pickup', 4,'Front Driver Side Corner','Stand at front driver-side corner. Capture bumper, corner, front frame.'],
      ['pickup', 5,'Driver Side Landing Gear','Photograph driver-side landing gear fully. Show condition and position.'],
      ['pickup', 6,'Fuel Level','Photograph the fuel gauge or fuel level indicator clearly.'],
      ['pickup', 7,'Spare Tire','Photograph the spare tire. Show mounting, condition, and tread.'],
      ['pickup', 8,'Driver Side of Trailer (3 pics)','Take at least 3 photos of full driver side from front to rear.'],
      ['pickup', 9,'Driver Side Front Axel (3 pics)','At least 3 close-up photos of front axel tires on driver side.'],
      ['pickup',10,'Driver Side Rear Axel (3 pics)','At least 3 close-up photos of rear axel tires on driver side.'],
      ['pickup',11,'Back of Trailer + Lights On','Capture full rear of trailer with all lights illuminated and working.'],
      ['pickup',12,'Inside Trailer / Doors','Open trailer doors. Photograph interior, door condition, and seals.'],
      ['pickup',13,'License Plate Light','Close-up of license plate and its light. Ensure plate is legible.'],
      ['pickup',14,'Passenger Side Rear Axel (3 pics)','At least 3 close-up photos of rear axel tires on passenger side.'],
      ['pickup',15,'Passenger Side Front Axel (3 pics)','At least 3 close-up photos of front axel tires on passenger side.'],
      ['pickup',16,'Passenger Side of Trailer (3 pics)','Take at least 3 photos of full passenger side from front to rear.'],
      ['pickup',17,'Passenger Side Landing Gear','Photograph passenger-side landing gear. Show condition and position.'],
      ['pickup',18,'Front Crossmember','Photograph the front crossmember. Show any damage or wear.'],
      ['pickup',19,'Passenger Side Front Corner','Stand at passenger-side front corner. Capture bumper, corner, frame.'],
      ['pickup',20,'Front of Trailer','Photograph the full front face of the trailer.'],
      ['pickup',21,'Engine Compartment','Open reefer unit doors. Take 2-3 pictures of engine compartment interior.'],
      ['drop',  1,'Front Driver Side Corner','Stand at front driver-side corner. Capture bumper, corner, front frame.'],
      ['drop',  2,'Trailer Annual Inspection','Photograph annual inspection sticker. Expiration date must be visible.'],
      ['drop',  3,'Trailer Registration','Photograph the trailer registration document. All text must be legible.'],
      ['drop',  4,'Driver Side Landing Gear','Photograph driver-side landing gear fully. Show condition and position.'],
      ['drop',  5,'Fuel Level','Photograph the fuel gauge or fuel level indicator clearly.'],
      ['drop',  6,'Driver Side of Trailer (3 pics)','Take at least 3 photos of full driver side from front to rear.'],
      ['drop',  7,'Spare Tire','Photograph the spare tire. Show mounting, condition, and tread.'],
      ['drop',  8,'Driver Side Front Axel (3 pics)','At least 3 close-up photos of front axel tires on driver side.'],
      ['drop',  9,'Driver Side Rear Axel (3 pics)','At least 3 close-up photos of rear axel tires on driver side.'],
      ['drop', 10,'Back of Trailer + Lights On','Capture full rear of trailer with all lights illuminated and working.'],
      ['drop', 11,'Inside Trailer / Doors','Open trailer doors. Photograph interior, door condition, and seals.'],
      ['drop', 12,'License Plate Light','Close-up of license plate and its light. Ensure plate is legible.'],
      ['drop', 13,'Passenger Side Rear Axel (3 pics)','At least 3 close-up photos of rear axel tires on passenger side.'],
      ['drop', 14,'Passenger Side Front Axel (3 pics)','At least 3 close-up photos of front axel tires on passenger side.'],
      ['drop', 15,'Passenger Side of Trailer (3 pics)','Take at least 3 photos of full passenger side from front to rear.'],
      ['drop', 16,'Passenger Side Landing Gear','Photograph passenger-side landing gear. Show condition and position.'],
      ['drop', 17,'Front Crossmember','Photograph the front crossmember. Show any damage or wear.'],
      ['drop', 18,'Passenger Side Front Corner','Stand at passenger-side front corner. Capture bumper, corner, frame.'],
      ['drop', 19,'Front of Trailer','Photograph the full front face of the trailer.'],
      ['drop', 20,'Engine Compartment','Open reefer unit doors. Take 2-3 pictures of engine compartment interior.'],
      ['general',1,'Front of Trailer','Photograph the full front face of the trailer.'],
      ['general',2,'Driver Side Front Corner','Stand at front driver-side corner. Capture bumper, corner, front frame.'],
      ['general',3,'Engine Hours','Photograph the engine hours display clearly. Ensure reading is visible.'],
      ['general',4,'Annual Inspection','Photograph annual inspection sticker. Expiration date must be visible.'],
      ['general',5,'Trailer Registration','Photograph the trailer registration document. All text must be legible.'],
      ['general',6,'Fuel Level','Photograph the fuel gauge or fuel level indicator clearly.'],
      ['general',7,'Driver Side Landing Gear','Photograph driver-side landing gear fully. Show condition and position.'],
      ['general',8,'Driver Side of Trailer (3 pics)','Take at least 3 photos of full driver side from front to rear.'],
      ['general',9,'Driver Side Front Axel (3 pics)','At least 3 close-up photos of front axel tires on driver side.'],
      ['general',10,'Driver Side Rear Axel (3 pics)','At least 3 close-up photos of rear axel tires on driver side.'],
      ['general',11,'Back of Trailer + Lights On','Capture full rear of trailer with all lights illuminated and working.'],
      ['general',12,'License Plate Light','Close-up of license plate and its light. Ensure plate is legible.'],
      ['general',13,'Passenger Side of Trailer (3 pics)','Take at least 3 photos of full passenger side from front to rear.'],
      ['general',14,'Passenger Side Landing Gear','Photograph passenger-side landing gear. Show condition and position.'],
      ['general',15,'Passenger Side Front Corner','Stand at passenger-side front corner. Capture bumper, corner, frame.'],
      ['general',16,'Engine Compartment','Open reefer unit doors. Take 2-3 pictures of engine compartment interior.'],
    ];
    for (const s of steps) {
      await pool.query(
        'INSERT INTO inspection_steps (inspection_type,step_number,label,instruction) VALUES ($1,$2,$3,$4)', s
      );
    }
    console.log('✅  Seeded inspection steps');
  }

  // ── Seed default users ────────────────────────────────────────────────────
  const uc = await pool.query('SELECT COUNT(*) as c FROM users');
  if (parseInt(uc.rows[0].c) === 0) {
    await pool.query(
      'INSERT INTO users (username,email,password_hash,full_name,role) VALUES ($1,$2,$3,$4,$5)',
      ['admin','admin@kurtex.com', bcrypt.hashSync('admin123',10), 'System Admin', 'superadmin']
    );
    await pool.query(
      'INSERT INTO users (username,email,password_hash,full_name,role) VALUES ($1,$2,$3,$4,$5)',
      ['dispatch','dispatch@kurtex.com', bcrypt.hashSync('dispatch123',10), 'Sarah Mitchell', 'agent']
    );
    // Seed driver1
    const d1 = await pool.query(
      'INSERT INTO users (username,email,password_hash,full_name,role) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      ['driver1','james@kurtex.com', bcrypt.hashSync('driver123',10), 'James Rodriguez', 'driver']
    );
    // Seed driver2
    const d2 = await pool.query(
      'INSERT INTO users (username,email,password_hash,full_name,role) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      ['driver2','mike@kurtex.com', bcrypt.hashSync('driver123',10), 'Mike Thompson', 'driver']
    );
    // Seed trucks assigned to drivers
    await pool.query(
      'INSERT INTO trucks (truck_number,truck_model,year,make,driver_id) VALUES ($1,$2,$3,$4,$5)',
      ['TRK-001','Freightliner Cascadia','2022','Freightliner', d1.rows[0].id]
    );
    await pool.query(
      'INSERT INTO trucks (truck_number,truck_model,year,make,driver_id) VALUES ($1,$2,$3,$4,$5)',
      ['TRK-002','Kenworth T680','2021','Kenworth', d2.rows[0].id]
    );
    console.log('✅  Seeded users and trucks');
  }

  // ── Seed sample assets/trailers ───────────────────────────────────────────
  const ac = await pool.query('SELECT COUNT(*) as c FROM assets');
  if (parseInt(ac.rows[0].c) === 0) {
    const assets = [
      ['W98754','2022','Utility','n/a','3UTVS2534N8536419','n/a'],
      ['T12345','2021','Great Dane','Champion','1GRAA0629KB700001','IL 9R5227'],
      ['T67890','2020','Wabash','DuraPlate','1JJV532D9NL000123','IN 8X4411'],
    ];
    for (const a of assets) {
      await pool.query(
        'INSERT INTO assets (asset_number,year,make,model,vin,license_plate) VALUES ($1,$2,$3,$4,$5,$6)', a
      );
    }
    console.log('✅  Seeded sample trailers');
  }
};

initDatabase().catch(err => {
  console.error('❌  DB init error:', err.message);
  process.exit(1);
});

module.exports = db;
