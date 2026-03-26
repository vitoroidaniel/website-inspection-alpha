<div align="center">

<img src="public/img/logo-inspection.png" width="80" height="80" alt="Kurtex Logo">

# Kurtex Fleet Inspection System

**Mobile-first vehicle inspection platform built for trucking fleets**

[![License](https://img.shields.io/badge/license-Commercial-1e4da1.svg)](#license)
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org)
[![PostgreSQL](https://img.shields.io/badge/database-PostgreSQL-336791.svg)](https://postgresql.org)
[![Deploy on Railway](https://img.shields.io/badge/deploy-Railway-7B68EE.svg)](https://railway.app)

*Built by [Rekka Software](https://rekkasoftware.com)*

---

[Features](#features) · [Tech Stack](#tech-stack) · [Quick Start](#quick-start) · [Deployment](#deployment) · [License](#license)

</div>

---

## Overview

Kurtex is a production-ready fleet inspection platform that replaces paper-based vehicle walkarounds. Drivers complete photo-based inspections on their phones in minutes — dispatchers and fleet managers review everything in real time from desktop.

Built for trucking companies that need a simple, reliable, and professional inspection workflow with no per-seat fees.

---

## Features

### 📱 Driver App — Mobile-First
- Step-by-step photo inspection flow with guided instructions per step
- Live camera capture — no gallery uploads, photos must be taken live
- GPS location recorded automatically
- PickUp, Drop, and General inspection types
- Resume interrupted inspections
- Face ID / fingerprint quick login (WebAuthn — same standard as banking apps)
- Runs in any mobile browser — no app store install required

### 🖥️ Dispatcher Dashboard — Desktop
- Real-time fleet overview with per-driver inspection history
- Full photo lightbox with flag / unflag per photo
- Side-panel inspection detail without leaving the page
- Asset / trailer registry with complete inspection history per asset
- Filter history by inspection type
- One-click PDF report or ZIP photo archive per inspection

### 📋 Admin Panel
- Add and manage drivers and dispatchers
- Customize inspection steps per type (PickUp / Drop / General)
- Reorder and toggle steps live — drivers see changes immediately
- Manage fleet assets and trailer registry

### 📄 PDF Reports
- Professional inspection reports — Whip Around inspired layout
- Per-step photo grid with flagged item callouts
- Vehicle details, GPS coordinates, duration, signature blocks
- Print or save as PDF directly from the browser — no dependencies

### 🔐 Security
- WebAuthn / Passkey biometric login (Face ID on iPhone, fingerprint on Android, Windows Hello)
- bcrypt password hashing (cost factor 10)
- Session-based auth with configurable 8-hour / 30-day expiry
- Role isolation — drivers cannot access dispatcher or admin routes
- `httpOnly` + `sameSite` + `secure` cookie flags in production
- Telegram username support — login with or without `@`

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ |
| Framework | Express 4 |
| Database | PostgreSQL 14+ |
| Auth | express-session · bcryptjs · WebAuthn (@simplewebauthn/server v9) |
| File Uploads | Multer · Sharp (auto-compress to 1920px / 70% JPEG) |
| Frontend | Vanilla HTML · CSS · JavaScript — zero build step |
| Deployment | Railway (config included) |

No frontend framework, no build pipeline, no webpack. Clean HTML/CSS/JS that works on any device from day one.

---

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 14+

### 1. Clone & install
```bash
git clone https://github.com/rekkasoftware/kurtex.git
cd kurtex
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```

Open `.env` and set at minimum:
```env
DATABASE_URL=postgresql://user:password@localhost:5432/kurtex
SESSION_SECRET=your-long-random-string
```

### 3. Run
```bash
npm run dev     # development — auto-restarts on changes
npm start       # production
```

Database tables and seed data are created automatically on first boot.

### Default credentials

> ⚠️ **Change these immediately after first login.**

| Role | Username | Password |
|---|---|---|
| Admin | `admin` | `admin123` |
| Dispatcher | `dispatch` | `dispatch123` |
| Driver | `driver1` | `driver123` |

---

## Project Structure

```
kurtex/
├── server.js              — Entry point: bootstrap, static files, page routes
├── database.js            — PostgreSQL pool, schema migrations, seed data
├── .env.example           — All environment variables documented
│
├── middleware/
│   └── auth.js            — Role guards: auth / agent / admin / driver
│
├── routes/
│   ├── auth.js            — Login, logout, /me, full WebAuthn Face ID flow
│   ├── driver.js          — Inspection: start, photo upload, submit, history
│   ├── agent.js           — Dashboard: drivers, inspections, PDF report, ZIP, stats
│   └── admin.js           — Admin CRUD: users, inspection steps, assets
│
└── public/
    ├── login.html         — Login page (Driver / Dispatcher tabs, Face ID)
    ├── driver.html        — Mobile inspection app
    ├── agent.html         — Desktop dispatcher dashboard
    ├── css/styles.css     — Design system (trucking brown-blue theme)
    └── js/
        ├── login.js       — Auth logic + WebAuthn client
        ├── driver.js      — Inspection flow client
        └── agent.js       — Dashboard client
```

---

## Deployment

### Railway (Recommended)

Ships with `railway.toml` and `nixpacks.toml` — push to Railway and it deploys automatically.

**Required environment variables:**

| Variable | Value |
|---|---|
| `DATABASE_URL` | Auto-provided by Railway Postgres plugin |
| `SESSION_SECRET` | Random 64-char hex string (`openssl rand -hex 32`) |
| `NODE_ENV` | `production` |
| `RP_ID` | Your domain, no protocol — e.g. `kurtex.up.railway.app` |
| `RP_ORIGIN` | Full origin — e.g. `https://kurtex.up.railway.app` |

`PORT` is injected automatically — do not set it manually.

**Photo persistence:** Attach a Railway Volume and mount it at `/data`. Without a volume, uploaded photos are lost on redeploy.

### Other Platforms

Any Node.js host with PostgreSQL works. Set the environment variables above and run `npm start`.

---

## API Reference

| Method | Route | Role | Description |
|---|---|---|---|
| POST | `/api/login` | — | Password login (Telegram username supported) |
| POST | `/api/logout` | any | Destroy session |
| GET | `/api/me` | any | Current session user |
| POST | `/api/auth/webauthn/register-options` | any | Begin Face ID setup |
| POST | `/api/auth/webauthn/register` | any | Complete Face ID setup |
| POST | `/api/auth/webauthn/login-options` | — | Begin biometric login |
| POST | `/api/auth/webauthn/login` | — | Complete biometric login |
| GET | `/api/inspection-steps` | any | Steps list for given type |
| POST | `/api/inspections/start` | driver | Start new inspection |
| POST | `/api/inspections/:id/step/:step/photo` | driver | Upload step photo |
| POST | `/api/inspections/:id/submit` | driver | Submit completed inspection |
| GET | `/api/driver/inspections` | driver | Driver's inspection history |
| GET | `/api/agent/drivers` | agent | All drivers with stats |
| GET | `/api/agent/inspections` | agent | All submitted inspections |
| GET | `/api/agent/inspections/:id` | agent | Single inspection + photos |
| GET | `/api/agent/inspections/:id/report` | agent | PDF report (print-ready HTML) |
| GET | `/api/agent/inspections/:id/download` | agent | ZIP archive of photos |
| PATCH | `/api/agent/photos/:id/flag` | agent | Flag / unflag a photo |
| GET | `/api/agent/stats` | agent | Dashboard counters |
| GET/POST/PUT/DELETE | `/api/admin/users` | superadmin | User management |
| GET/POST/PATCH/DELETE | `/api/admin/steps` | superadmin | Inspection step management |
| GET/POST/PUT/DELETE | `/api/admin/assets` | superadmin | Asset / trailer management |

---

## Security Notes

- **Never commit `.env`** — it is in `.gitignore` by default
- **Rotate `SESSION_SECRET`** with care — changing it will log out all active users
- **Face ID / WebAuthn requires HTTPS** — Railway provides this automatically. Set `RP_ID` and `RP_ORIGIN` exactly to your public domain
- **`NODE_ENV=production`** enables `secure: true` on session cookies — do not skip this in production
- **Default passwords** in seed data must be changed before going live

---

## License

**Proprietary Commercial License — All Rights Reserved**

Copyright © 2026 Rekka Software. All rights reserved.

This software, including all source code, design assets, and documentation, is the exclusive intellectual property of Rekka Software. A purchased license grants the licensee the right to deploy and operate this software for internal business purposes only.

**You may not:**
- Redistribute, resell, sublicense, or transfer this software or its source code to any third party
- Use this codebase as the basis for a competing SaaS product or resold service
- Remove, alter, or obscure any copyright, trademark, or proprietary notices
- Reverse engineer any obfuscated or compiled components

**You may:**
- Deploy on any number of servers for your own fleet operation
- Modify configuration and branding for your internal use under a white-label agreement

For licensing inquiries, white-label packages, or custom development:

📧 **[hello@rekkasoftware.com](mailto:hello@rekkasoftware.com)**

---

<div align="center">

Built with ☕ by **[Rekka Software](https://rekkasoftware.com)**<br>
© 2026 Rekka Software — All Rights Reserved

</div>
