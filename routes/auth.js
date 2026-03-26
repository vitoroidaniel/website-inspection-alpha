// routes/auth.js — Login, logout, /me, WebAuthn (Face ID)

const express  = require('express');
const bcrypt   = require('bcryptjs');
const db       = require('../database');
const { auth } = require('../middleware/auth');

const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

function getRpId(req) {
  return process.env.RP_ID || req.hostname;
}

function getOrigin(req) {
  if (process.env.RP_ORIGIN) return process.env.RP_ORIGIN;
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  return `${proto}://${req.hostname}`;
}

// ── Password login ────────────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  try {
    // Strip leading @ so Telegram usernames work either way
    const rawUsername = (req.body.username || '').trim().replace(/^@/, '');
    const { password, keepSignedIn } = req.body;

    const user = await db.prepare(
      'SELECT * FROM users WHERE (username=? OR email=?) AND active=1'
    ).get(rawUsername, rawUsername);

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    req.session.cookie.maxAge = keepSignedIn
      ? 30 * 24 * 60 * 60 * 1000  // 30 days
      :  8 * 60 * 60 * 1000;       // 8 hours

    req.session.user = {
      id:           user.id,
      username:     user.username,
      email:        user.email,
      role:         user.role,
      name:         user.full_name,
      truck_model:  user.truck_model,
      truck_number: user.truck_number,
    };

    res.json({ role: user.role, name: user.full_name });
  } catch (e) {
    console.error('Login error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

router.get('/me', auth, (req, res) => res.json(req.session.user));

// ── WebAuthn — Face ID / Fingerprint ─────────────────────────────────────────

// Step 1: generate registration challenge
router.post('/webauthn/register-options', auth, async (req, res) => {
  try {
    const user = req.session.user;

    const existingCreds = await db
      .prepare('SELECT credential_id FROM webauthn_credentials WHERE user_id=?')
      .all(user.id);

    const options = await generateRegistrationOptions({
      rpName:          'Kurtex',
      rpID:            getRpId(req),
      userID:          Buffer.from(String(user.id)),
      userName:        user.username,
      userDisplayName: user.name,
      timeout:         60000,
      attestationType: 'none',
      excludeCredentials: existingCreds.map(c => ({
        id:   Buffer.from(c.credential_id, 'base64'),
        type: 'public-key',
      })),
      authenticatorSelection: {
        userVerification:      'required',
        residentKey:           'discouraged',
        authenticatorAttachment: 'platform',   // device biometric only
      },
      supportedAlgorithmIDs: [-7, -257],
    });

    req.session.webauthnChallenge = options.challenge;
    req.session.save();
    res.json(options);
  } catch (e) {
    console.error('WebAuthn register-options error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Step 2: verify attestation and store credential
router.post('/webauthn/register', auth, async (req, res) => {
  try {
    const user              = req.session.user;
    const expectedChallenge = req.session.webauthnChallenge;

    if (!expectedChallenge) {
      return res.status(400).json({ error: 'No challenge in session — please retry' });
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response:                req.body,
        expectedChallenge,
        expectedOrigin:          getOrigin(req),
        expectedRPID:            getRpId(req),
        requireUserVerification: true,
      });
    } catch (verifyErr) {
      console.error('WebAuthn registration verification failed:', verifyErr.message);
      return res.status(400).json({ error: 'Biometric verification failed: ' + verifyErr.message });
    }

    const { verified, registrationInfo } = verification;
    if (!verified || !registrationInfo) {
      return res.status(400).json({ error: 'Registration not verified' });
    }

    const { credential }   = registrationInfo;
    const credentialIdB64  = Buffer.from(credential.id).toString('base64');
    const publicKeyB64     = Buffer.from(credential.publicKey).toString('base64');
    const counter          = credential.counter ?? 0;
    const transports       = req.body.response?.transports || req.body.transports || ['internal'];

    // One credential per user — replace on re-registration
    await db.prepare('DELETE FROM webauthn_credentials WHERE user_id=?').run(user.id);
    await db.prepare(
      'INSERT INTO webauthn_credentials (user_id,credential_id,public_key,counter,transports) VALUES (?,?,?,?,?)'
    ).run(user.id, credentialIdB64, publicKeyB64, counter, JSON.stringify(transports));

    delete req.session.webauthnChallenge;
    req.session.save();
    res.json({ ok: true });
  } catch (e) {
    console.error('WebAuthn register error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Remove stored credential
router.post('/webauthn/remove-credential', auth, async (req, res) => {
  try {
    await db.prepare('DELETE FROM webauthn_credentials WHERE user_id=?').run(req.session.user.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to remove credential' });
  }
});

// Step 3: generate authentication challenge
router.post('/webauthn/login-options', async (req, res) => {
  try {
    const allCreds = await db.prepare('SELECT * FROM webauthn_credentials').all();

    const options = await generateAuthenticationOptions({
      rpID:             getRpId(req),
      timeout:          60000,
      userVerification: 'required',
      allowCredentials: allCreds.map(c => ({
        id:         Buffer.from(c.credential_id, 'base64'),
        type:       'public-key',
        transports: JSON.parse(c.transports || '["internal"]'),
      })),
    });

    req.session.webauthnChallenge = options.challenge;
    req.session.save();
    res.json(options);
  } catch (e) {
    console.error('WebAuthn login-options error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Step 4: verify assertion signature and create session
router.post('/webauthn/login', async (req, res) => {
  try {
    const expectedChallenge = req.session.webauthnChallenge;
    if (!expectedChallenge) {
      return res.status(400).json({ error: 'No challenge in session — please retry' });
    }

    const credentialId = req.body.rawId || req.body.id;
    const cred = await db
      .prepare('SELECT * FROM webauthn_credentials WHERE credential_id=?')
      .get(credentialId);
    if (!cred) return res.status(401).json({ error: 'Biometric not registered on this device' });

    const user = await db
      .prepare('SELECT * FROM users WHERE id=? AND active=1')
      .get(cred.user_id);
    if (!user) return res.status(401).json({ error: 'Account not found or disabled' });

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response:                req.body,
        expectedChallenge,
        expectedOrigin:          getOrigin(req),
        expectedRPID:            getRpId(req),
        requireUserVerification: true,
        credential: {
          id:        Buffer.from(cred.credential_id, 'base64'),
          publicKey: Buffer.from(cred.public_key, 'base64'),
          counter:   cred.counter || 0,
        },
      });
    } catch (verifyErr) {
      console.error('WebAuthn auth verification failed:', verifyErr.message);
      return res.status(401).json({ error: 'Biometric verification failed — please try again' });
    }

    const { verified, authenticationInfo } = verification;
    if (!verified) return res.status(401).json({ error: 'Biometric not verified' });

    // Update counter to prevent replay attacks
    await db
      .prepare('UPDATE webauthn_credentials SET counter=? WHERE id=?')
      .run(authenticationInfo.newCounter, cred.id);

    delete req.session.webauthnChallenge;

    req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
    req.session.user = {
      id:           user.id,
      username:     user.username,
      email:        user.email,
      role:         user.role,
      name:         user.full_name,
      truck_model:  user.truck_model,
      truck_number: user.truck_number,
    };
    req.session.save();

    res.json({ role: user.role, name: user.full_name });
  } catch (e) {
    console.error('WebAuthn login error:', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Check if current user has a registered credential
router.get('/webauthn/has-credential', auth, async (req, res) => {
  try {
    const cred = await db
      .prepare('SELECT id FROM webauthn_credentials WHERE user_id=?')
      .get(req.session.user.id);
    res.json({ registered: !!cred });
  } catch (e) {
    res.json({ registered: false });
  }
});

module.exports = router;
