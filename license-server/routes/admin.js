const express = require('express');
const path = require('path');
const { requireAuth } = require('../auth');
const db = require('../db');
const { generateCodeForIndex } = require('./api');

const router = express.Router();

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/login.html'));
});

router.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../views/dashboard.html'));
});

router.get('/api/stats', requireAuth, (req, res) => {
  try {
    const total = db.prepare('SELECT COUNT(*) as count FROM license_codes').get().count;
    const used = db.prepare("SELECT COUNT(*) as count FROM license_codes WHERE status = 'used'").get().count;
    const revoked = db.prepare("SELECT COUNT(*) as count FROM license_codes WHERE status = 'revoked'").get().count;
    const unused = total - used - revoked;
    res.json({ total, used, unused, revoked });
  } catch (err) {
    console.error('Stats error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

router.get('/api/codes', requireAuth, (req, res) => {
  try {
    const codes = db.prepare(`
      SELECT c.code, c.status, c.created_at,
             a.machine_fingerprint, a.activated_at, a.last_verified_at
      FROM license_codes c
      LEFT JOIN activations a ON c.code = a.code
      ORDER BY c.created_at DESC
    `).all();
    res.json(codes);
  } catch (err) {
    console.error('Codes error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

const CODE_PATTERN = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

function isValidCode(code) {
  return typeof code === 'string' && code.length <= 32 && CODE_PATTERN.test(code);
}

router.post('/api/revoke', requireAuth, (req, res) => {
  const { code } = req.body;
  if (!isValidCode(code)) {
    return res.status(400).json({ error: 'INVALID_CODE' });
  }

  try {
    const existing = db.prepare('SELECT 1 FROM license_codes WHERE code = ?').get(code);
    if (!existing) {
      return res.status(404).json({ error: 'CODE_NOT_FOUND' });
    }
    db.prepare("UPDATE license_codes SET status = 'revoked' WHERE code = ?").run(code);
    res.json({ success: true });
  } catch (err) {
    console.error('Revoke error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

router.post('/api/restore', requireAuth, (req, res) => {
  const { code } = req.body;
  if (!isValidCode(code)) {
    return res.status(400).json({ error: 'INVALID_CODE' });
  }

  try {
    const existing = db.prepare('SELECT 1 FROM license_codes WHERE code = ?').get(code);
    if (!existing) {
      return res.status(404).json({ error: 'CODE_NOT_FOUND' });
    }
    const hasActivation = db.prepare('SELECT 1 FROM activations WHERE code = ?').get(code);
    const status = hasActivation ? 'used' : 'unused';
    db.prepare('UPDATE license_codes SET status = ? WHERE code = ?').run(status, code);
    res.json({ success: true });
  } catch (err) {
    console.error('Restore error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

router.get('/api/pending-claims', requireAuth, (req, res) => {
  try {
    const claims = db.prepare(`
      SELECT token, device_fingerprint as deviceFingerprint, created_at as createdAt
      FROM claim_requests
      WHERE status = 'pending'
      ORDER BY created_at DESC
    `).all();
    res.json({ claims });
  } catch (err) {
    console.error('Pending claims error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

router.post('/api/approve-claim', requireAuth, (req, res) => {
  const { token } = req.body;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'MISSING_PARAMS' });
  }

  try {
    const claim = db.prepare('SELECT * FROM claim_requests WHERE token = ?').get(token);
    if (!claim) {
      return res.status(404).json({ error: 'CLAIM_NOT_FOUND' });
    }
    if (claim.status !== 'pending') {
      return res.status(400).json({ error: 'NOT_PENDING' });
    }

    const unusedCode = db.prepare(
      "SELECT code FROM license_codes WHERE status = 'unused' LIMIT 1"
    ).get();
    if (!unusedCode) {
      return res.status(409).json({ error: 'NO_CODES_AVAILABLE' });
    }

    db.prepare('UPDATE claim_requests SET status = ?, license_code = ?, approved_at = unixepoch() WHERE token = ?')
      .run('approved', unusedCode.code, token);
    db.prepare("UPDATE license_codes SET status = 'used' WHERE code = ?")
      .run(unusedCode.code);

    res.json({ success: true, code: unusedCode.code });
  } catch (err) {
    console.error('Approve claim error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

module.exports = { router };
