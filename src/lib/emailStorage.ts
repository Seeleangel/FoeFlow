import { getDb } from '@/hooks/useDb';
import type { EmailMessage } from '@/types';

export async function getAllEmails(): Promise<EmailMessage[]> {
  const db = await getDb();
  const rows = await db.select<
    Array<{
      id: string;
      uid: number;
      subject: string;
      sender: string;
      date: string;
      is_read: number;
      created_at: number;
    }>
  >('SELECT * FROM imap_emails ORDER BY uid DESC');

  return rows.map((r) => ({
    id: r.id,
    uid: r.uid,
    subject: r.subject,
    sender: r.sender,
    date: r.date,
    isRead: !!r.is_read,
    createdAt: r.created_at,
  }));
}

export async function getUnreadEmails(): Promise<EmailMessage[]> {
  const db = await getDb();
  const rows = await db.select<
    Array<{
      id: string;
      uid: number;
      subject: string;
      sender: string;
      date: string;
      is_read: number;
      created_at: number;
    }>
  >('SELECT * FROM imap_emails WHERE is_read = 0 ORDER BY uid DESC');

  return rows.map((r) => ({
    id: r.id,
    uid: r.uid,
    subject: r.subject,
    sender: r.sender,
    date: r.date,
    isRead: !!r.is_read,
    createdAt: r.created_at,
  }));
}

export async function saveEmails(emails: Omit<EmailMessage, 'id' | 'createdAt' | 'isRead'>[]): Promise<void> {
  const db = await getDb();
  const now = Date.now();

  for (const email of emails) {
    const id = `email_${email.uid}`;
    await db.execute(
      'INSERT OR IGNORE INTO imap_emails (id, uid, subject, sender, date, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, email.uid, email.subject, email.sender, email.date, 0, now]
    );
  }
}

export async function markEmailAsRead(id: string): Promise<void> {
  const db = await getDb();
  await db.execute('UPDATE imap_emails SET is_read = 1 WHERE id = ?', [id]);
}

export async function getMaxUid(): Promise<number | undefined> {
  const db = await getDb();
  const rows = await db.select<Array<{ max_uid: number | null }>>(
    'SELECT MAX(uid) as max_uid FROM imap_emails'
  );
  const max = rows[0]?.max_uid;
  return max ?? undefined;
}

export async function deduplicateEmails(): Promise<number> {
  const db = await getDb();
  // Keep the oldest record for each uid (smallest rowid)
  await db.execute(`
    DELETE FROM imap_emails
    WHERE rowid NOT IN (
      SELECT MIN(rowid) FROM imap_emails GROUP BY uid
    )
  `);
  // Also fix any ids that still contain timestamps by normalizing to email_${uid}
  const rows = await db.select<Array<{ rowid: number; uid: number }>>(
    'SELECT rowid, uid FROM imap_emails'
  );
  for (const r of rows) {
    const normalizedId = `email_${r.uid}`;
    await db.execute(
      'UPDATE imap_emails SET id = ? WHERE rowid = ?',
      [normalizedId, r.rowid]
    );
  }
  return rows.length;
}

export async function clearAllEmails(): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM imap_emails');
}
