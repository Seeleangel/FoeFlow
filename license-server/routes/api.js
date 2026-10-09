const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const router = express.Router();
const db = require('../db');

const LICENSE_SEED = process.env.LICENSE_SEED;
const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_DAYS = 30;

if (!LICENSE_SEED || !JWT_SECRET) {
  throw new Error('LICENSE_SEED and JWT_SECRET environment variables must be set');
}

function generateCodeForIndex(index) {
  const hmac = crypto.createHmac('sha256', LICENSE_SEED);
  hmac.update(String(index));
  const raw = hmac.digest();
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 16; i++) {
    result += alphabet[raw[i] % alphabet.length];
  }
  return `${result.slice(0,4)}-${result.slice(4,8)}-${result.slice(8,12)}-${result.slice(12,16)}`;
}

function validateCode(inputCode) {
  const normalized = inputCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (normalized.length !== 16) return null;
  const formatted = `${normalized.slice(0,4)}-${normalized.slice(4,8)}-${normalized.slice(8,12)}-${normalized.slice(12,16)}`;
  for (let i = 1; i <= 1000; i++) {
    if (generateCodeForIndex(i) === formatted) {
      return formatted;
    }
  }
  return null;
}

function isValidFingerprint(fp) {
  return typeof fp === 'string' && /^[a-z0-9-]{1,256}$/i.test(fp);
}

function generateToken(code, fingerprint) {
  return jwt.sign(
    { code, fingerprint },
    JWT_SECRET,
    { expiresIn: `${TOKEN_DAYS}d` }
  );
}

router.post('/activate', (req, res) => {
  const { code, fingerprint } = req.body;
  if (!code || !fingerprint || !isValidFingerprint(fingerprint)) {
    return res.status(400).json({ error: 'MISSING_PARAMS' });
  }

  const validCode = validateCode(code);
  if (!validCode) {
    return res.status(400).json({ error: 'INVALID_CODE' });
  }

  const codeRow = db.prepare('SELECT status FROM license_codes WHERE code = ?').get(validCode);
  if (!codeRow) {
    return res.status(400).json({ error: 'INVALID_CODE' });
  }
  if (codeRow.status === 'revoked') {
    return res.status(400).json({ error: 'REVOKED_CODE' });
  }

  const existing = db.prepare('SELECT machine_fingerprint FROM activations WHERE code = ?').get(validCode);
  if (existing) {
    if (existing.machine_fingerprint !== fingerprint) {
      return res.status(400).json({ error: 'ALREADY_BOUND' });
    }
    const token = generateToken(validCode, fingerprint);
    db.prepare('UPDATE activations SET token = ?, last_verified_at = unixepoch() WHERE code = ? AND machine_fingerprint = ?')
      .run(token, validCode, fingerprint);
    return res.json({
      success: true,
      token,
      expires_at: Math.floor(Date.now() / 1000) + TOKEN_DAYS * 86400,
    });
  }

  const token = generateToken(validCode, fingerprint);
  db.prepare('INSERT INTO activations (code, machine_fingerprint, token) VALUES (?, ?, ?)')
    .run(validCode, fingerprint, token);
  db.prepare("UPDATE license_codes SET status = 'used' WHERE code = ?").run(validCode);

  res.json({
    success: true,
    token,
    expires_at: Math.floor(Date.now() / 1000) + TOKEN_DAYS * 86400,
  });
});

router.post('/verify', (req, res) => {
  const { code, fingerprint, token } = req.body;
  if (!code || !fingerprint || !token || !isValidFingerprint(fingerprint)) {
    return res.status(400).json({ error: 'MISSING_PARAMS' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.code !== code || decoded.fingerprint !== fingerprint) {
      return res.status(400).json({ error: 'INVALID_TOKEN' });
    }
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(400).json({ error: 'EXPIRED_TOKEN' });
    }
    return res.status(400).json({ error: 'INVALID_TOKEN' });
  }

  const activation = db.prepare(
    'SELECT * FROM activations WHERE code = ? AND machine_fingerprint = ? AND token = ?'
  ).get(code, fingerprint, token);

  if (!activation) {
    return res.status(400).json({ error: 'NOT_FOUND' });
  }

  const newToken = generateToken(code, fingerprint);
  db.prepare('UPDATE activations SET token = ?, last_verified_at = unixepoch() WHERE id = ?')
    .run(newToken, activation.id);

  res.json({
    success: true,
    token: newToken,
    expires_at: Math.floor(Date.now() / 1000) + TOKEN_DAYS * 86400,
  });
});

function generateClaimToken() {
  return crypto.randomBytes(16).toString('hex');
}

router.post('/claim-request', (req, res) => {
  const { deviceFingerprint } = req.body;
  if (!deviceFingerprint || !isValidFingerprint(deviceFingerprint)) {
    return res.status(400).json({ error: 'MISSING_PARAMS' });
  }

  try {
    const existing = db.prepare(
      "SELECT token, status, license_code FROM claim_requests WHERE device_fingerprint = ? AND status IN ('pending', 'approved')"
    ).get(deviceFingerprint);

    if (existing) {
      return res.json({
        token: existing.token,
        status: existing.status,
        code: existing.license_code || null,
      });
    }

    const token = generateClaimToken();
    db.prepare(
      'INSERT INTO claim_requests (token, device_fingerprint) VALUES (?, ?)'
    ).run(token, deviceFingerprint);

    res.json({ token, status: 'pending', code: null });
  } catch (err) {
    console.error('Claim request error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

router.get('/claim-code', (req, res) => {
  const { token } = req.query;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'MISSING_PARAMS' });
  }

  try {
    const row = db.prepare(
      'SELECT status, license_code FROM claim_requests WHERE token = ?'
    ).get(token);

    if (!row) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }

    if (row.status === 'approved' && row.license_code) {
      db.prepare("UPDATE claim_requests SET status = 'claimed' WHERE token = ?").run(token);
      return res.json({ status: 'approved', code: row.license_code });
    }

    res.json({ status: row.status, code: null });
  } catch (err) {
    console.error('Claim code error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

module.exports = { router, validateCode, generateCodeForIndex };
