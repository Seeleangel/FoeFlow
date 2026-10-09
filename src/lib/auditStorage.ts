import { getDb } from '@/hooks/useDb';
import type { AuditRecord } from '@/types';

export interface AuditRecordRow {
  id: string;
  input_type: string;
  input_content: string;
  result_json: string;
  created_at: number;
}

function mapRowToRecord(row: AuditRecordRow): AuditRecord {
  let resultJson: { issues: unknown[] } = { issues: [] };
  try {
    const parsed = JSON.parse(row.result_json || '{"issues":[]}');
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.issues)) {
      resultJson = parsed;
    }
  } catch {
    // ignore parse error, use default
  }
  return {
    id: row.id,
    inputType: row.input_type as AuditRecord['inputType'],
    inputContent: row.input_content,
    resultJson: resultJson as AuditRecord['resultJson'],
    createdAt: row.created_at,
  };
}

export async function getAllAuditRecords(): Promise<AuditRecord[]> {
  const db = await getDb();
  const rows = await db.select<AuditRecordRow[]>(
    'SELECT * FROM audit_records ORDER BY created_at DESC'
  );
  return rows.map(mapRowToRecord);
}

export async function saveAuditRecord(record: AuditRecord): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO audit_records (id, input_type, input_content, result_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      record.id,
      record.inputType,
      record.inputContent,
      JSON.stringify(record.resultJson),
      record.createdAt,
    ]
  );
}

export async function deleteAuditRecord(id: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM audit_records WHERE id = ?', [id]);
}

// ── 审核输入草稿（切换页面后恢复） ──

export interface AuditDraft {
  inputMode: 'text' | 'xiemi' | 'screenshot';
  textContent: string;
  xiemiUrl: string;
}

const DRAFT_KEY = 'audit_draft';

export async function loadAuditDraft(): Promise<AuditDraft | null> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    'SELECT value FROM settings WHERE key = ?',
    [DRAFT_KEY]
  );
  if (rows.length === 0) return null;
  try {
    return JSON.parse(rows[0].value) as AuditDraft;
  } catch {
    return null;
  }
}

export async function saveAuditDraft(draft: AuditDraft): Promise<void> {
  const db = await getDb();
  await db.execute(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    [DRAFT_KEY, JSON.stringify(draft)]
  );
}
