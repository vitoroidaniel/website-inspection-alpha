// Kurtex - Login Application
// Designed by Rekka Software

const API = {
  login: '/api/login',
  webAuthnLoginOptions: '/api/auth/webauthn/login-options',
  webAuthnLogin: '/api/auth/webauthn/login',
  hasCredential: '/api/auth/webauthn/has-credential'
};

let currentTab = 'driver';

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  initBiometricLogin();
  setupEnterKeySupport();
});

// Tab switching
function setTab(t) {
  currentTab = t;
  document.getElementById('tabDriver').classList.toggle('active', t === 'driver');
  document.getElementById('tabAgent').classList.toggle('active', t === 'agent');
  document.getElementById('panelDriver').classList.toggle('active', t === 'driver');
  document.getElementById('panelAgent').classList.toggle('active', t === 'agent');
}

// Enter key support
function setupEnterKeySupport() {
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if (document.getElementById('panelDriver').classList.contains('active')) loginDriver();
    else loginAgent();
  });
}

// Main login function
async function doLogin(username, password, keepSignedIn, errEl, btnEl, txtEl) {
  btnEl.disabled = true;
  txtEl.textContent = 'Signing in…';
  errEl.style.display = 'none';
  
  try {
    const r = await fetch(API.login, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, keepSignedIn })
    });
    const d = await r.json();
    
    if (!r.ok) {
      showErr(errEl, d.error || 'Invalid credentials');
      btnEl.disabled = false;
      txtEl.textContent = 'Sign In';
      return;
    }
    
    window.location.href = d.role === 'driver' ? '/driver/inspect' : '/agent/dashboard';
  } catch (e) {
    showErr(errEl, 'Connection error. Try again.');
    btnEl.disabled = false;
    txtEl.textContent = 'Sign In';
  }
}

function loginDriver() {
  doLogin(
    document.getElementById('dUser').value.trim(),
    document.getElementById('dPass').value,
    document.getElementById('dKeep').checked,
    document.getElementById('dErr'),
    document.getElementById('dLoginBtn'),
    document.getElementById('dLoginTxt')
  );
}

function loginAgent() {
  doLogin(
    document.getElementById('aUser').value.trim(),
    document.getElementById('aPass').value,
    document.getElementById('aKeep').checked,
    document.getElementById('aErr'),
    document.getElementById('aLoginBtn'),
    document.getElementById('aLoginTxt')
  );
}

// ============================================
// BIOMETRIC LOGIN (Face ID / Fingerprint)
// ============================================

const bioSupported = window.PublicKeyCredential && 
                     typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function';

// Check if biometric is available
async function initBiometricLogin() {
  if (!bioSupported) return;
  
  try {
    const ok = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!ok) return;
    
    // Detect platform for label
    const ua = navigator.userAgent;
    const isIOS = /iPhone|iPad|iPod/.test(ua);
    const isMac = /Mac/.test(ua) && !isIOS;
    const label = isIOS || isMac ? 'Face ID / Touch ID' : 'Fingerprint / Face Unlock';
    
    ['dBioLabel', 'aBioLabel'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = label;
    });
    
    // Show biometric buttons
    document.getElementById('dBioBtn').style.display = 'flex';
    document.getElementById('aBioBtn').style.display = 'flex';
  } catch (e) {
    console.log('Biometric not available');
  }
}

// Perform biometric login
async function biometricLogin(panel) {
  const errEl = document.getElementById(panel === 'driver' ? 'dErr' : 'aErr');
  errEl.style.display = 'none';
  
  try {
    // Get login options
    const optRes = await fetch(API.webAuthnLoginOptions, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '' })
    });
    
    if (!optRes.ok) {
      showErr(errEl, 'Biometric not configured. Please login with password first, then set up in Settings.');
      return;
    }
    
    const opts = await optRes.json();

    // Convert challenge to Uint8Array (must match how setup encoded it)
    opts.challenge = new TextEncoder().encode(opts.challenge);

    // Convert allowCredentials IDs from base64 to Uint8Array
    if (opts.allowCredentials && opts.allowCredentials.length > 0) {
      opts.allowCredentials = opts.allowCredentials.map(c => ({
        ...c,
        id: Uint8Array.from(atob(c.id), x => x.charCodeAt(0))
      }));
    }

    // Request Face ID / Touch ID scan on device
    const assertion = await navigator.credentials.get({ publicKey: opts });
    
    // Convert credential ID to base64
    const credId = btoa(String.fromCharCode(...new Uint8Array(assertion.rawId)));
    
    // Send to server
    const r = await fetch(API.webAuthnLogin, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credentialId: credId })
    });
    
    const d = await r.json();
    
    if (!r.ok) {
      showErr(errEl, d.error || 'Biometric login failed');
      return;
    }
    
    // Redirect based on role
    window.location.href = d.role === 'driver' ? '/driver/inspect' : '/agent/dashboard';
    
  } catch (e) {
    if (e.name === 'NotAllowedError') {
      // User cancelled — no error shown
    } else if (e.name === 'NotSupportedError') {
      showErr(errEl, 'Face ID is not supported on this device.');
    } else {
      showErr(errEl, 'Face ID login failed. Please use your password.');
    }
  }
}

// Show error message
function showErr(el, msg) {
  el.textContent = msg;
  el.style.display = 'block';
}

// Export for HTML
window.setTab = setTab;
window.loginDriver = loginDriver;
window.loginAgent = loginAgent;
window.biometricLogin = biometricLogin;

