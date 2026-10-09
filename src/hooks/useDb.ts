import Database from '@tauri-apps/plugin-sql';
import { seedBuiltinTemplates } from '@/lib/seedTemplates';

let dbInstance: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!dbInstance) {
    console.log('[DB] Loading database...');
    dbInstance = await Database.load('sqlite:foe_publicity.db');
    console.log('[DB] Database loaded successfully, path:', dbInstance.path);
  }
  return dbInstance;
}

export async function initDb(): Promise<void> {
  try {
    console.log('[DB] Starting initialization...');
    const db = await getDb();
    console.log('[DB] Running migrations...');
    const migrations = [
      `CREATE TABLE IF NOT EXISTS style_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        source_type TEXT NOT NULL,
        structure_json TEXT,
        form_schema TEXT,
        co_creation_prompt TEXT,
        sample_snippets TEXT,
        created_at INTEGER,
        updated_at INTEGER
      )`,
      `CREATE TABLE IF NOT EXISTS user_articles (
        id TEXT PRIMARY KEY,
        title TEXT,
        source_url TEXT,
        content TEXT,
        template_id TEXT,
        tags TEXT,
        created_at INTEGER
      )`,
      `CREATE TABLE IF NOT EXISTS audit_records (
        id TEXT PRIMARY KEY,
        input_type TEXT NOT NULL,
        input_content TEXT,
        result_json TEXT,
        created_at INTEGER
      )`,
      `CREATE TABLE IF NOT EXISTS generated_drafts (
        id TEXT PRIMARY KEY,
        template_id TEXT,
        mode TEXT NOT NULL,
        params_json TEXT,
        content_html TEXT,
        content_text TEXT,
        created_at INTEGER
      )`,
      `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS imap_emails (
        id TEXT PRIMARY KEY,
        uid INTEGER NOT NULL,
        subject TEXT,
        sender TEXT,
        date TEXT,
        is_read INTEGER DEFAULT 0,
        created_at INTEGER
      )`,
    ];
    for (const migration of migrations) {
      await db.execute(migration);
    }
    console.log('[DB] Migrations complete, seeding templates...');
    await seedBuiltinTemplates();
    console.log('[DB] Initialization complete!');
  } catch (error) {
    console.error('[DB] Initialization failed:', error);
    throw error;
  }
}
