import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createMailServer } from '../server.mjs';
import { digest, openMailbox, openStore } from '../store.mjs';

test('registration, account-scoped mailbox, encrypted storage, and logout', async (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'foeflow-mail-test-'));
  const dbPath = join(folder, 'mail.sqlite');
  const key = randomBytes(32);
  const db = openStore(dbPath);
  const calls = [];
  const origin = 'https://foeflow.test';
  const server = createMailServer({ dbPath, key, origin, fetchMail: async (config, page) => {
    calls.push(config);
    if (config.authCode === 'invalid-test-code') throw new Error('provider error that must not escape');
    return { total: 1, ...(page === null ? {} : { page, pageSize: 30 }), messages: [{ uid: 7, subject: config.email, sender: 'Mock Sender', date: null }] };
  } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    rmSync(folder, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}/foeflow/mail/`;
  const request = (route, { method = 'POST', body, cookie, requestOrigin = origin, workspace } = {}) => fetch(base + route, {
    method, headers: { Origin: requestOrigin, ...(workspace ? { 'X-FoeFlow-Workspace': workspace } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const account = { username: 'alice', password: 'fixture-password-only' };
  const config = { email: 'alice@163.com', authCode: 'fixture-mail-code' };
  assert.equal((await request('sync')).status, 401);
  assert.equal((await request('mailbox', { body: config })).status, 401);
  const signup = await request('register', { body: account });
  assert.equal(signup.status, 200);
  const header = signup.headers.getSetCookie()[0];
  assert.match(header, /Path=\/foeflow\/; HttpOnly; SameSite=Strict; Secure;/);
  const alice = header.split(';')[0];
  assert.equal((await request('register', { body: account })).status, 409);
  const bobResponse = await request('register', { body: { ...account, username: 'bob' } });
  const bob = bobResponse.headers.getSetCookie()[0].split(';')[0];

  assert.equal((await request('mailbox', { cookie: alice, body: config, requestOrigin: 'https://foreign.example' })).status, 403);
  assert.equal((await request('mailbox', { cookie: alice, body: { ...config, email: 'alice@other.example' } })).status, 400);
  assert.equal(calls.length, 0);
  const connected = await request('mailbox', { cookie: alice, body: { ...config, host: 'localhost', accountId: 2 } });
  assert.equal(connected.status, 200);
  const connectedText = await connected.text();
  assert.match(connectedText, /alice@163\.com/);
  assert.doesNotMatch(connectedText, /fixture-mail-code/);
  assert.deepEqual(calls, [config]);
  const rows = db.prepare('SELECT * FROM accounts ORDER BY id').all();
  assert.equal(rows[1].mailbox, null);
  assert.doesNotMatch(JSON.stringify(rows[0]), /alice@163\.com|fixture-password-only|fixture-mail-code/);
  assert.deepEqual(openMailbox(key, rows[0].id, rows[0].mailbox), config);
  assert.throws(() => openMailbox(key, rows[1].id, rows[0].mailbox));

  const bobSession = await request('session', { method: 'GET', cookie: bob });
  assert.equal(bobSession.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await bobSession.json(), { username: 'bob', workspaceId: rows[1].workspace_id, email: null });
  assert.notEqual(rows[0].workspace_id, rows[1].workspace_id);
  assert.equal((await request('auth', { method: 'GET' })).status, 401);
  assert.equal((await request('auth', { method: 'GET', cookie: alice, workspace: rows[0].workspace_id })).status, 204);
  assert.equal((await request('auth', { method: 'GET', cookie: bob, workspace: rows[0].workspace_id })).status, 401);
  assert.equal((await request('inbox', { cookie: alice, body: { page: -1 } })).status, 400);
  assert.equal((await request('inbox', { cookie: bob, workspace: rows[0].workspace_id, body: { page: 1 } })).status, 401);
  assert.equal((await (await request('inbox', { cookie: alice, body: { page: 2 } })).json()).inbox.page, 2);
  assert.equal((await request('sync', { cookie: bob, body: { accountId: rows[0].id } })).status, 409);
  const bobConfig = { email: 'bob@163.com', authCode: 'bob-only-code' };
  assert.equal((await request('mailbox', { cookie: bob, body: bobConfig })).status, 200);
  assert.deepEqual((await (await request('sync', { cookie: bob })).json()).inbox.messages.map((m) => m.subject), ['bob@163.com']);
  const failed = await request('mailbox', { cookie: alice, body: { email: 'replacement@163.com', authCode: 'invalid-test-code' } });
  assert.equal(failed.status, 502);
  assert.deepEqual(await failed.json(), { error: 'imap_failed' });
  assert.deepEqual((await (await request('sync', { cookie: alice })).json()).inbox.messages.map((m) => m.subject), ['alice@163.com']);

  assert.equal((await request('mailbox', { method: 'DELETE', cookie: bob })).status, 200);
  assert.equal((await request('sync', { cookie: bob })).status, 409);
  assert.equal((await request('logout', { cookie: alice })).status, 200);
  assert.equal((await request('sync', { cookie: alice })).status, 401);
  assert.equal((await request('login', { body: { ...account, password: 'wrong-password-fixture' } })).status, 401);
  assert.equal((await request('login', { body: account })).status, 200);
});

test('upgrade keeps existing credentials and migrates the mail-only session cookie', async (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'foeflow-mail-upgrade-'));
  const dbPath = join(folder, 'legacy.sqlite');
  const old = new DatabaseSync(dbPath);
  old.exec(`CREATE TABLE accounts (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, mailbox TEXT) STRICT;
    CREATE TABLE sessions (hash TEXT PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id), expires INTEGER NOT NULL) STRICT;
    INSERT INTO accounts VALUES (1, 'legacy_user', 'legacy-password-hash', NULL);`);
  const token = randomBytes(32).toString('base64url');
  old.prepare('INSERT INTO sessions VALUES (?, 1, ?)').run(digest(token), Date.now() + 100_000);
  old.close();
  const server = createMailServer({ dbPath, key: randomBytes(32), origin: 'https://foeflow.test' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(folder, { recursive: true, force: true });
  });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/foeflow/mail/session`, {
    headers: { Cookie: 'foeflow_mail_session=' + token },
  });
  const data = await response.json();
  assert.equal(data.username, 'legacy_user');
  assert.match(data.workspaceId, /^[a-f0-9]{32}$/);
  assert.equal(data.email, null);
  const cookies = response.headers.getSetCookie();
  assert.ok(cookies[0].startsWith('foeflow_session=' + token + '; Path=/foeflow/;'));
  assert.match(cookies[1], /^foeflow_mail_session=; Path=\/foeflow\/mail\/;.*Max-Age=0/);
});
