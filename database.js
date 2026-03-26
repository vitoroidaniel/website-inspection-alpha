const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:QDMCeTBgQfovbdUlDROlcsVXYxcizJgl@postgres.railway.internal:5432/railway',
});

function convertSql(sql) {
  let i = 0;
  sql = sql.replace(/\?/g, () => `$${++i}`);
  sql = sql.replace(/date\('now'\)/gi, 'CURRENT_DATE');
  sql = sql.replace(/datetime\('now'\)/gi, 'NOW()');
  return sql;
}

const db = {
  prepare: (sql) => {
    const pgSql = convertSql(sql);
    return {
      get: async (...args) => { const r = await pool.query(pgSql, args); return r.rows[0]; },
      all: async (...args) => { const r = await pool.query(pgSql, args); return r.rows; },
      run: async (...args) => { const r = await pool.query(pgSql, args); return r; }
    };
  },
  exec: async (sql) => pool.query(sql)
};

const initDatabase = async () => {

  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE,
    password_hash TEXT NOT NULL, full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('driver','agent','superadmin')),
    truck_model TEXT DEFAULT '', truck_number TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMP DEFAULT NOW()
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL,
    credential_id TEXT UNIQUE NOT NULL, public_key TEXT NOT NULL,
    transports TEXT DEFAULT '[]', created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Assets / Trailers registry
  await pool.query(`CREATE TABLE IF NOT EXISTS assets (
    id SERIAL PRIMARY KEY,
    asset_number TEXT NOT NULL,
    year TEXT DEFAULT '',
    make TEXT DEFAULT '',
    model TEXT DEFAULT '',
    vin TEXT DEFAULT '',
    license_plate TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    notes TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT NOW()
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS inspections (
    id TEXT PRIMARY KEY, driver_id INTEGER NOT NULL, driver_name TEXT NOT NULL,
    truck_model TEXT, truck_number TEXT,
    asset_id INTEGER, asset_number TEXT, asset_year TEXT,
    asset_make TEXT, asset_model TEXT, asset_vin TEXT, asset_license_plate TEXT,
    inspection_type TEXT NOT NULL DEFAULT 'pickup',
    status TEXT NOT NULL DEFAULT 'in_progress',
    latitude REAL, longitude REAL, notes TEXT,
    started_at TIMESTAMP, submitted_at TIMESTAMP,
    FOREIGN KEY(driver_id) REFERENCES users(id)
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS inspection_photos (
    id SERIAL PRIMARY KEY, inspection_id TEXT NOT NULL,
    step_number INTEGER NOT NULL, step_label TEXT, file_path TEXT NOT NULL,
    latitude REAL, longitude REAL, taken_at TIMESTAMP,
    flagged INTEGER NOT NULL DEFAULT 0,
    flag_note TEXT DEFAULT '',
    FOREIGN KEY(inspection_id) REFERENCES inspections(id)
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS inspection_steps (
    id SERIAL PRIMARY KEY, inspection_type TEXT NOT NULL DEFAULT 'pickup',
    step_number INTEGER NOT NULL, label TEXT NOT NULL,
    instruction TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
  )`);

  // Safe migrations for existing deployments
  const migrations = [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS truck_model TEXT DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS truck_number TEXT DEFAULT ''`,
    `ALTER TABLE inspections ADD COLUMN IF NOT EXISTS truck_number TEXT`,
    `ALTER TABLE inspections ADD COLUMN IF NOT EXISTS inspection_type TEXT NOT NULL DEFAULT 'pickup'`,
    `ALTER TABLE inspections ADD COLUMN IF NOT EXISTS asset_id INTEGER`,
    `ALTER TABLE inspections ADD COLUMN IF NOT EXISTS asset_number TEXT`,
    `ALTER TABLE inspections ADD COLUMN IF NOT EXISTS asset_year TEXT`,
    `ALTER TABLE inspections ADD COLUMN IF NOT EXISTS asset_make TEXT`,
    `ALTER TABLE inspections ADD COLUMN IF NOT EXISTS asset_model TEXT`,
    `ALTER TABLE inspections ADD COLUMN IF NOT EXISTS asset_vin TEXT`,
    `ALTER TABLE inspections ADD COLUMN IF NOT EXISTS asset_license_plate TEXT`,
    `ALTER TABLE inspection_photos ADD COLUMN IF NOT EXISTS step_label TEXT`,
    `ALTER TABLE inspection_photos ADD COLUMN IF NOT EXISTS flagged INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE inspection_photos ADD COLUMN IF NOT EXISTS flag_note TEXT DEFAULT ''`,
    `ALTER TABLE inspection_steps ADD COLUMN IF NOT EXISTS inspection_type TEXT NOT NULL DEFAULT 'pickup'`,
    `ALTER TABLE assets ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT ''`,
  ];
  for (const m of migrations) {
    try { await pool.query(m); } catch (e) {}
  }

  // Seed steps
  const sc = await pool.query('SELECT COUNT(*) as c FROM inspection_steps');
  if (parseInt(sc.rows[0].c) === 0) {
    const steps = [
      ['pickup',1,'Engine Hours','Photograph the engine hours display clearly. Ensure reading is visible.'],
      ['pickup',2,'Trailer Annual Inspection','Photograph annual inspection sticker. Expiration date must be visible.'],
      ['pickup',3,'Trailer Registration','Photograph the trailer registration document. All text must be legible.'],
      ['pickup',4,'Front Driver Side Corner','Stand at front driver-side corner. Capture bumper, corner, front frame.'],
      ['pickup',5,'Driver Side Landing Gear','Photograph driver-side landing gear fully. Show condition and position.'],
      ['pickup',6,'Fuel Level','Photograph the fuel gauge or fuel level indicator clearly.'],
      ['pickup',7,'Spare Tire','Photograph the spare tire. Show mounting, condition, and tread.'],
      ['pickup',8,'Driver Side of Trailer (3 pics)','Take at least 3 photos of full driver side from front to rear.'],
      ['pickup',9,'Driver Side Front Axel (3 pics)','At least 3 close-up photos of front axel tires on driver side.'],
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
      ['drop',1,'Front Driver Side Corner','Stand at front driver-side corner. Capture bumper, corner, front frame.'],
      ['drop',2,'Trailer Annual Inspection','Photograph annual inspection sticker. Expiration date must be visible.'],
      ['drop',3,'Trailer Registration','Photograph the trailer registration document. All text must be legible.'],
      ['drop',4,'Driver Side Landing Gear','Photograph driver-side landing gear fully. Show condition and position.'],
      ['drop',5,'Fuel Level','Photograph the fuel gauge or fuel level indicator clearly.'],
      ['drop',6,'Driver Side of Trailer (3 pics)','Take at least 3 photos of full driver side from front to rear.'],
      ['drop',7,'Spare Tire','Photograph the spare tire. Show mounting, condition, and tread.'],
      ['drop',8,'Driver Side Front Axel (3 pics)','At least 3 close-up photos of front axel tires on driver side.'],
      ['drop',9,'Driver Side Rear Axel (3 pics)','At least 3 close-up photos of rear axel tires on driver side.'],
      ['drop',10,'Back of Trailer + Lights On','Capture full rear of trailer with all lights illuminated and working.'],
      ['drop',11,'Inside Trailer / Doors','Open trailer doors. Photograph interior, door condition, and seals.'],
      ['drop',12,'License Plate Light','Close-up of license plate and its light. Ensure plate is legible.'],
      ['drop',13,'Passenger Side Rear Axel (3 pics)','At least 3 close-up photos of rear axel tires on passenger side.'],
      ['drop',14,'Passenger Side Front Axel (3 pics)','At least 3 close-up photos of front axel tires on passenger side.'],
      ['drop',15,'Passenger Side of Trailer (3 pics)','Take at least 3 photos of full passenger side from front to rear.'],
      ['drop',16,'Passenger Side Landing Gear','Photograph passenger-side landing gear. Show condition and position.'],
      ['drop',17,'Front Crossmember','Photograph the front crossmember. Show any damage or wear.'],
      ['drop',18,'Passenger Side Front Corner','Stand at passenger-side front corner. Capture bumper, corner, frame.'],
      ['drop',19,'Front of Trailer','Photograph the full front face of the trailer.'],
      ['drop',20,'Engine Compartment','Open reefer unit doors. Take 2-3 pictures of engine compartment interior.'],
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
      await pool.query('INSERT INTO inspection_steps (inspection_type,step_number,label,instruction) VALUES ($1,$2,$3,$4)', s);
    }
    console.log('Seeded inspection steps');
  }

  // Seed users
  const uc = await pool.query('SELECT COUNT(*) as c FROM users');
  if (parseInt(uc.rows[0].c) === 0) {
    await pool.query('INSERT INTO users (username,email,password_hash,full_name,role) VALUES ($1,$2,$3,$4,$5)', ['admin','admin@kurtex.com',bcrypt.hashSync('admin123',10),'System Admin','superadmin']);
    await pool.query('INSERT INTO users (username,email,password_hash,full_name,role) VALUES ($1,$2,$3,$4,$5)', ['dispatch','dispatch@kurtex.com',bcrypt.hashSync('dispatch123',10),'Sarah Mitchell','agent']);
    await pool.query('INSERT INTO users (username,email,password_hash,full_name,role,truck_model,truck_number) VALUES ($1,$2,$3,$4,$5,$6,$7)', ['driver1','james@kurtex.com',bcrypt.hashSync('driver123',10),'James Rodriguez','driver','Freightliner Cascadia 2022','TRK-001']);
    await pool.query('INSERT INTO users (username,email,password_hash,full_name,role,truck_model,truck_number) VALUES ($1,$2,$3,$4,$5,$6,$7)', ['driver2','mike@kurtex.com',bcrypt.hashSync('driver123',10),'Mike Thompson','driver','Kenworth T680 2021','TRK-002']);
    console.log('Seeded users');
  }

  // Seed sample assets
  const ac = await pool.query('SELECT COUNT(*) as c FROM assets');
  if (parseInt(ac.rows[0].c) === 0) {
    const assets = [
      ['W98754','2022','Utility Trailer','n/a','3UTVS2534N8536419','n/a'],
      ['T12345','2021','Great Dane','Champion','1GRAA0629KB700001','IL 9R5227'],
      ['T67890','2020','Wabash','DuraPlate','1JJV532D9NL000123','IN 8X4411'],
    ];
    for (const a of assets) {
      await pool.query('INSERT INTO assets (asset_number,year,make,model,vin,license_plate) VALUES ($1,$2,$3,$4,$5,$6)', a);
    }
    console.log('Seeded sample assets');
  }
};

initDatabase().catch(err => console.error('DB init error:', err.message));

module.exports = db;
