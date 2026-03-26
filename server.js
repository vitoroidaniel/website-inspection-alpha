// server.js — Kurtex Fleet Inspection System
// by Rekka Software

const express  = require('express');
const session  = require('express-session');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');

const db = require('./database');

const authRouter   = require('./routes/auth');
const driverRouter = require('./routes/driver');
const agentRouter  = require('./routes/agent');
const adminRouter  = require('./routes/admin');
const { auth }     = require('./middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Trust Railway's proxy so secure cookies work over HTTPS ──────────────────
app.set('trust proxy', 1);

// ── Uploads directory ─────────────────────────────────────────────────────────
const uploadsDir =
  process.env.UPLOADS_DIR ||
  process.env.RAILWAY_VOLUME_MOUNT_PATH ||
  path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// ── Multer ────────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(uploadsDir, req.params.inspectionId || 'temp');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `step_${req.params.step}_${Date.now()}.jpg`),
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Images only')),
});

app.locals.upload     = upload;
app.locals.uploadsDir = uploadsDir;

// ── Core middleware ───────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

app.use(session({
  secret:            process.env.SESSION_SECRET || 'kurtex-secret-2025',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    maxAge:   30 * 24 * 60 * 60 * 1000,
    secure:   process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
  },
}));

// ── Page routes ───────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  return req.session.user.role === 'driver'
    ? res.redirect('/driver/inspect')
    : res.redirect('/agent/dashboard');
});

app.get('/login',           (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/driver/inspect',  auth, (req, res) => req.session.user.role === 'driver' ? res.sendFile(path.join(__dirname, 'public', 'driver.html')) : res.redirect('/agent/dashboard'));
app.get('/agent/dashboard', auth, (req, res) => req.session.user.role !== 'driver'  ? res.sendFile(path.join(__dirname, 'public', 'agent.html'))  : res.redirect('/driver/inspect'));

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api',      authRouter);   // POST /api/login, /api/logout, GET /api/me
app.use('/api/auth', authRouter);   // POST /api/auth/webauthn/*
app.use('/',         driverRouter);
app.use('/',         agentRouter);
app.use('/',         adminRouter);

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () =>
  console.log(`Kurtex by Rekka Software — running on port ${PORT}`));
