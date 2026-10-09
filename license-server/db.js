require('dotenv').config();

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'licenses.db');

// Ensure parent directory exists before opening database
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let db;
try {
  db = new Database(DB_PATH);
} catch (err) {
  console.error('Failed to open database at', DB_PATH, err.message);
  process.exit(1);
}

try {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS license_codes (
      code TEXT PRIMARY KEY,
      status TEXT DEFAULT 'unused',
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS activations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      machine_fingerprint TEXT NOT NULL,
      activated_at INTEGER DEFAULT (unixepoch()),
      last_verified_at INTEGER DEFAULT (unixepoch()),
      token TEXT NOT NULL,
      FOREIGN KEY (code) REFERENCES license_codes(code),
      UNIQUE(code, machine_fingerprint)
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      username TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS claim_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT UNIQUE NOT NULL,
      device_fingerprint TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      license_code TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      approved_at INTEGER
    );
  `);
} catch (err) {
  console.error('Failed to initialize database schema:', err.message);
  process.exit(1);
}

module.exports = db;
