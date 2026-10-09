process.env.LICENSE_SEED = process.env.LICENSE_SEED || 'test-seed-for-ci-only';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-ci-only';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { app } = require('./server');

let server;
let port;

before(() => {
  return new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      resolve();
    });
  });
});

after(() => {
  return new Promise((resolve) => {
    server.close(resolve);
  });
});

async function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      let responseData = '';
      res.on('data', (chunk) => responseData += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          body: JSON.parse(responseData),
        });
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

describe('POST /api/v1/activate', () => {
  it('should reject invalid code', async () => {
    const res = await post('/api/v1/activate', {
      code: 'INVALID-CODE-1234-5678',
      fingerprint: 'abc123',
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'INVALID_CODE');
  });
});

describe('POST /api/v1/claim-request', () => {
  it('should create a new claim request and return token', async () => {
    const res = await post('/api/v1/claim-request', {
      deviceFingerprint: 'abc123def456',
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.token);
    assert.strictEqual(res.body.status, 'pending');
  });

  it('should reuse existing request for same fingerprint', async () => {
    const first = await post('/api/v1/claim-request', {
      deviceFingerprint: 'reuse-fingerprint-001',
    });
    const second = await post('/api/v1/claim-request', {
      deviceFingerprint: 'reuse-fingerprint-001',
    });
    assert.strictEqual(first.body.token, second.body.token);
    assert.strictEqual(second.body.status, 'pending');
  });
});

describe('GET /api/v1/claim-code', () => {
  it('should return pending for a new request', async () => {
    const createRes = await post('/api/v1/claim-request', {
      deviceFingerprint: 'claim-code-test-001',
    });
    const token = createRes.body.token;

    const getRes = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: `/api/v1/claim-code?token=${token}`,
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
      });
      req.on('error', reject);
      req.end();
    });

    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.body.status, 'pending');
    assert.strictEqual(getRes.body.code, null);
  });

  it('should return 404 for unknown token', async () => {
    const res = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/api/v1/claim-code?token=unknown-token-123',
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
      });
      req.on('error', reject);
      req.end();
    });

    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.error, 'NOT_FOUND');
  });
});

const db = require('./db');
const bcrypt = require('bcrypt');
const { generateCodeForIndex } = require('./routes/api');

describe('Admin claim endpoints', () => {
  let adminAuth;

  before(() => {
    const hash = bcrypt.hashSync('testpass', 10);
    db.prepare('INSERT OR REPLACE INTO admin_users (username, password_hash) VALUES (?, ?)').run('testadmin', hash);
    adminAuth = 'Basic ' + Buffer.from('testadmin:testpass').toString('base64');
  });

  it('should list pending claims', async () => {
    db.prepare('DELETE FROM claim_requests WHERE device_fingerprint = ?').run('pending-list-test');
    db.prepare('INSERT INTO claim_requests (token, device_fingerprint) VALUES (?, ?)').run('pending-token-001', 'pending-list-test');

    const res = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/admin/api/pending-claims',
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': adminAuth,
        },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
      });
      req.on('error', reject);
      req.end();
    });

    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.claims));
    const found = res.body.claims.find(c => c.token === 'pending-token-001');
    assert.ok(found);
    assert.strictEqual(found.deviceFingerprint, 'pending-list-test');
  });

  it('should approve a claim and assign an unused code', async () => {
    // Seed a code explicitly: a clean test database has no production data.
    const availableCode = generateCodeForIndex(1);
    db.prepare("INSERT OR REPLACE INTO license_codes (code, status) VALUES (?, 'unused')").run(availableCode);
    db.prepare('DELETE FROM claim_requests WHERE device_fingerprint = ?').run('approve-test-001');
    db.prepare('INSERT INTO claim_requests (token, device_fingerprint) VALUES (?, ?)').run('approve-token-001', 'approve-test-001');

    const res = await new Promise((resolve, reject) => {
      const data = JSON.stringify({ token: 'approve-token-001' });
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/admin/api/approve-claim',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': adminAuth,
          'Content-Length': Buffer.byteLength(data),
        },
      }, (res) => {
        let responseData = '';
        res.on('data', (chunk) => responseData += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(responseData) }));
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.code);
    assert.ok(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(res.body.code));
  });
});
