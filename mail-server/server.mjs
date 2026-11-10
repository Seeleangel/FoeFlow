import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { digest, hashPassword, openMailbox, openStore, passwordMatches, sealMailbox, SESSION_SECONDS } from './store.mjs';
import { fetchInbox163 } from './imap.mjs';

const PREFIX = '/foeflow/mail/';
const COOKIE = 'foeflow_session';
const LEGACY_COOKIE = 'foeflow_mail_session';

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
}
const fail = (status, code) => { throw new HttpError(status, code); };

async function jsonBody(req) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') fail(415, 'json_required');
  if (Number(req.headers['content-length']) > 8192) fail(413, 'too_large');
  let size = 0;
  const parts = [];
  for await (const part of req) {
    size += part.length;
    if (size > 8192) fail(413, 'too_large');
    parts.push(part);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { fail(400, 'invalid_request'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'invalid_request');
  return body;
}

export function createMailServer({ dbPath, key, origin, fetchMail = fetchInbox163 }) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('A 32-byte mailbox encryption key is required');
  const site = new URL(origin);
  if (site.origin !== origin || (site.protocol !== 'https:' && !(site.protocol === 'http:' && site.hostname === '127.0.0.1'))) {
    throw new Error('Set an HTTPS origin (HTTP is only allowed on loopback for development)');
  }
  const db = openStore(dbPath);
  const rate = new Map();
  let nextSweep = 0;
  let authInFlight = 0;
  const mailboxInFlight = new Set();

  function takeRate(key, count, window) {
    const now = Date.now();
    if (now >= nextSweep) {
      for (const [id, bucket] of rate) if (bucket.until <= now) rate.delete(id);
      nextSweep = now + 60_000;
    }
    let bucket = rate.get(key);
    if (!bucket || bucket.until <= now) {
      if (rate.size >= 2048 && !bucket) fail(429, 'slow_down');
      rate.set(key, bucket = { used: 0, until: now + window });
    }
    if (++bucket.used > count) fail(429, 'slow_down');
  }

  function session(req) {
    const cookies = req.headers.cookie?.split(/; */) ?? [];
    const findToken = (name) => cookies.find((item) => item.startsWith(name + '='))?.slice(name.length + 1);
    const currentToken = findToken(COOKIE);
    const token = currentToken ?? findToken(LEGACY_COOKIE);
    if (!token || !/^[\w-]{43}$/.test(token)) return null;
    const account = db.prepare(`SELECT a.*, s.hash AS session_hash, s.expires AS session_expires FROM sessions s
      JOIN accounts a ON a.id = s.account_id WHERE s.hash = ? AND s.expires > ?`).get(digest(token), Date.now());
    return account ? { ...account, legacyToken: currentToken ? null : token } : null;
  }

  function sessionCookie(res, value, age) {
    const flags = 'HttpOnly; SameSite=Strict' + (site.protocol === 'https:' ? '; Secure' : '');
    res.setHeader('Set-Cookie', [
      `${COOKIE}=${value}; Path=/foeflow/; ${flags}; Max-Age=${age}`,
      `${LEGACY_COOKIE}=; Path=${PREFIX}; ${flags}; Max-Age=0`,
    ]);
  }

  function startSession(res, accountId) {
    const token = randomBytes(32).toString('base64url');
    db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now());
    // Keep only the five most recent sessions per account after issuing one.
    db.prepare(`DELETE FROM sessions WHERE account_id=? AND hash NOT IN (
      SELECT hash FROM sessions WHERE account_id=? ORDER BY expires DESC LIMIT 4
    )`).run(accountId, accountId);
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(digest(token), accountId, Date.now() + SESSION_SECONDS * 1000);
    sessionCookie(res, token, SESSION_SECONDS);
  }

  async function readMailbox(account, config, page = null, isConfiguration = false) {
    if (mailboxInFlight.has(account.id)) fail(409, 'mailbox_busy');
    if (mailboxInFlight.size >= 8) fail(429, 'slow_down');
    takeRate((isConfiguration ? 'mail-config:' : 'mail-read:') + account.id, isConfiguration ? 6 : 20, 60_000);
    mailboxInFlight.add(account.id);
    try {
      try {
        return { ...await fetchMail(config, page), syncedAt: new Date().toISOString() };
      } catch {
        fail(502, 'imap_failed');
      }
    } finally {
      mailboxInFlight.delete(account.id);
    }
  }

  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    const reply = (status, body) => { res.writeHead(status); res.end(JSON.stringify(body)); };
    try {
      const path = req.url;
      if (typeof path !== 'string' || !path.startsWith(PREFIX)) fail(404, 'not_found');
      if (!['GET', 'POST', 'DELETE'].includes(req.method)) fail(405, 'method_not_allowed');
      if (req.method !== 'GET' && req.headers.origin !== origin) fail(403, 'origin_denied');
      const action = path.slice(PREFIX.length);
      const account = session(req);

      const expectedWorkspace = req.headers['x-foeflow-workspace'];
      if (expectedWorkspace && expectedWorkspace !== account?.workspace_id) fail(401, 'sign_in_required');

      if (req.method === 'GET' && action === 'auth') {
        if (!account) fail(401, 'sign_in_required');
        res.writeHead(204);
        return res.end();
      }

      if (req.method === 'GET' && action === 'session') {
        if (account?.legacyToken) sessionCookie(res, account.legacyToken, Math.ceil((account.session_expires - Date.now()) / 1000));
        return reply(200, {
          username: account?.username ?? null,
          workspaceId: account?.workspace_id ?? null,
          email: account ? openMailbox(key, account.id, account.mailbox)?.email ?? null : null,
        });
      }

      if (req.method === 'POST' && (action === 'login' || action === 'register')) {
        takeRate('auth:all', 48, 60_000);
        const ip = req.headers['x-foeflow-client'] || req.socket.remoteAddress || 'local';
        takeRate('auth:ip:' + ip, 10, 60_000);
        const body = await jsonBody(req);
        const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
        const password = typeof body.password === 'string' ? body.password : '';
        if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(username) || password.length < 12 || password.length > 128) fail(400, 'invalid_login');
        if (authInFlight >= 4) fail(429, 'slow_down');
        authInFlight++;
        try {
          let id;
          if (action === 'register') {
            takeRate('signup:all', 80, 60 * 60_000);
            takeRate('signup:ip:' + ip, 4, 60 * 60_000);
            const passwordHash = await hashPassword(password);
            const created = db.prepare(`INSERT INTO accounts (username,password_hash,workspace_id)
              VALUES (?,?,?) ON CONFLICT(username) DO NOTHING RETURNING id`).get(username, passwordHash, randomBytes(16).toString('hex'));
            if (!created) fail(409, 'username_taken');
            id = created.id;
          } else {
            takeRate('auth:user:' + username, 10, 60_000);
            const saved = db.prepare('SELECT id, password_hash FROM accounts WHERE username=?').get(username);
            if (!await passwordMatches(password, saved?.password_hash)) fail(401, 'login_failed');
            id = saved.id;
          }
          if (account) db.prepare('DELETE FROM sessions WHERE hash=?').run(account.session_hash);
          startSession(res, id);
          return reply(200, { username });
        } finally {
          authInFlight--;
        }
      }

      if (req.method === 'POST' && action === 'logout') {
        if (account) db.prepare('DELETE FROM sessions WHERE hash=?').run(account.session_hash);
        sessionCookie(res, '', 0);
        return reply(200, { ok: true });
      }

      if (!account) fail(401, 'sign_in_required');

      if (action === 'mailbox' && req.method === 'DELETE') {
        if (mailboxInFlight.has(account.id)) fail(409, 'mailbox_busy');
        db.prepare('UPDATE accounts SET mailbox=NULL WHERE id=?').run(account.id);
        return reply(200, { ok: true });
      }

      if (action === 'mailbox' && req.method === 'POST') {
        const body = await jsonBody(req);
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        const authCode = typeof body.authCode === 'string' ? body.authCode.trim() : '';
        if (email.length > 120 || !/^[a-z0-9][a-z0-9._-]*@163\.com$/.test(email) ||
            !/^[\x21-\x7e]{6,128}$/.test(authCode)) fail(400, 'invalid_mailbox');
        const config = { email, authCode };
        const inbox = await readMailbox(account, config, body.view === 'all' ? 1 : null, true);
        if (!session(req)) fail(401, 'sign_in_required');
        db.prepare('UPDATE accounts SET mailbox=? WHERE id=?').run(sealMailbox(key, account.id, config), account.id);
        return reply(200, { email, inbox });
      }

      if ((action === 'sync' || action === 'inbox') && req.method === 'POST') {
        let page = null;
        if (action === 'inbox') {
          const body = await jsonBody(req);
          if (!Number.isSafeInteger(body.page) || body.page < 1) fail(400, 'invalid_page');
          page = body.page;
        }
        const config = openMailbox(key, account.id, account.mailbox);
        if (!config) fail(409, 'mailbox_required');
        const inbox = await readMailbox(account, config, page);
        if (!session(req)) fail(401, 'sign_in_required');
        return reply(200, { email: config.email, inbox });
      }
      fail(404, 'not_found');
    } catch (err) {
      if (err instanceof HttpError) return reply(err.status, { error: err.message });
      // Do not print request fields, SQL bindings or errors from upstream providers.
      console.error('Mail request failed unexpectedly');
      return reply(500, { error: 'service_error' });
    }
  });
  server.requestTimeout = 25_000;
  server.headersTimeout = 8000;
  server.on('close', () => db.close());
  return server;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  const { FOEFLOW_MAIL_DB, FOEFLOW_MAIL_ORIGIN, FOEFLOW_MAIL_PORT, FOEFLOW_MAIL_KEY_FILE, CREDENTIALS_DIRECTORY } = process.env;
  const port = Number(FOEFLOW_MAIL_PORT);
  if (!FOEFLOW_MAIL_DB || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Set the database path and an available loopback port');
  const keyFile = FOEFLOW_MAIL_KEY_FILE || (CREDENTIALS_DIRECTORY && CREDENTIALS_DIRECTORY + '/mail-key');
  if (!keyFile) throw new Error('A separate mailbox encryption key file is required');
  const keyText = readFileSync(keyFile, 'utf8').trim();
  if (!/^[0-9a-f]{64}$/i.test(keyText)) throw new Error('Expected a 32-byte hex key');
  createMailServer({ dbPath: FOEFLOW_MAIL_DB, key: Buffer.from(keyText, 'hex'), origin: FOEFLOW_MAIL_ORIGIN })
    .listen(port, '127.0.0.1', () => console.log('FoeFlow mail service ready'));
}
