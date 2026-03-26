# Kurtex Fleet Inspection System
**by Rekka Software**

A mobile-first vehicle inspection platform for trucking fleets. Drivers capture photos step-by-step on their phones; dispatchers and admins review everything on desktop.

---

## Project Structure

```
kurtex/
├── server.js              — App entry point: bootstrap, static files, page routes
├── database.js            — PostgreSQL connection and helpers
├── .env.example           — Copy to .env and fill in values before running
│
├── middleware/
│   └── auth.js            — Session guards: auth, agent, admin, driver
│
├── routes/
│   ├── auth.js            — POST /api/login, /api/logout, GET /api/me
│   │                        POST /api/auth/webauthn/* (Face ID registration & login)
│   ├── driver.js          — Inspection flow: start, photo upload, submit, history
│   ├── agent.js           — Dispatcher: drivers list, inspections, PDF report, ZIP, stats
│   └── admin.js           — Admin CRUD: users, inspection steps, assets/trailers
│
└── public/
    ├── login.html         — Login page (Driver / Dispatcher tabs, Face ID)
    ├── driver.html        — Mobile inspection app
    ├── agent.html         — Desktop dispatcher dashboard
    ├── css/styles.css     — Design system (brown-blue trucking theme)
    └── js/
        ├── login.js       — Login logic + WebAuthn Face ID client
        ├── driver.js      — Inspection flow client
        └── agent.js       — Dashboard client
```

---

## Quick Start

### 1. Clone & install
```bash
git clone <repo>
cd kurtex
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env — set DATABASE_URL and SESSION_SECRET at minimum
```

### 3. Set up the database
Run `database.js` schema against your PostgreSQL instance, or let it auto-migrate on first start.

### 4. Run
```bash
npm run dev     # development (nodemon auto-restart)
npm start       # production
```

---

## Roles

| Role         | Access                                      |
|--------------|---------------------------------------------|
| `driver`     | Mobile inspection app only                  |
| `agent`      | Dispatcher dashboard — view all inspections |
| `superadmin` | Full admin panel — manage users/steps/assets|

Login uses **Telegram username** (with or without `@`).

---

## Face ID / Biometric Login

Uses the **WebAuthn / Passkey** standard — the same cryptographic protocol that powers Face ID on iPhones, fingerprint on Android, and Windows Hello. Requires HTTPS in production.

Set in `.env`:
```
RP_ID=yourdomain.com
RP_ORIGIN=https://yourdomain.com
```

---

## Deployment (Railway)

The project includes `railway.toml` and `nixpacks.toml` for zero-config Railway deployment.

Set environment variables in Railway dashboard:
- `DATABASE_URL` — provided automatically if using Railway Postgres
- `SESSION_SECRET` — generate a random 32+ char string
- `RP_ID` / `RP_ORIGIN` — your public domain (required for Face ID)
- `NODE_ENV=production`

---

## PDF Reports

Inspection reports are generated server-side as styled HTML (print-to-PDF via browser).  
Route: `GET /api/agent/inspections/:id/report`

---

© 2026 Rekka Software
