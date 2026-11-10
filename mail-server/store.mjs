import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
export const digest = (token) => createHash('sha256').update(token).digest('hex');
export const SESSION_SECONDS = 7 * 24 * 60 * 60;

export function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, mailbox TEXT
    ) STRICT;
    CREATE TABLE IF NOT EXISTS invites (
      hash TEXT PRIMARY KEY, expires INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS sessions (
      hash TEXT PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      expires INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id);
  `);
  return db;
}

export async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = await derive(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return salt + ':' + hash.toString('hex');
}

export async function passwordMatches(password, saved) {
  // Use an equal-cost derivation for unknown users.
  const expected = saved ?? '0'.repeat(32) + ':' + '0'.repeat(64);
  const actual = await hashPassword(password, expected.split(':')[0]);
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected)) && Boolean(saved);
}

export function issueInvite(db) {
  db.prepare('DELETE FROM invites WHERE expires <= ?').run(Date.now());
  const code = randomBytes(24).toString('base64url');
  db.prepare('INSERT INTO invites VALUES (?, ?)').run(digest(code), Date.now() + SESSION_SECONDS * 1000);
  return code;
}

export function sealMailbox(key, accountId, config) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(String(accountId)));
  const data = Buffer.concat([cipher.update(JSON.stringify(config)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

export function openMailbox(key, accountId, sealed) {
  if (!sealed) return null;
  const data = Buffer.from(sealed, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  decipher.setAAD(Buffer.from(String(accountId)));
  decipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8'));
}
