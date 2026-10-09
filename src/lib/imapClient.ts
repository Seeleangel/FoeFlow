import { invoke } from '@tauri-apps/api/core';
import type { EmailMessage, ImapConfig } from '@/types';

interface RustEmailMessage {
  uid: number;
  subject: string;
  from: string;
  date: string;
}

export async function fetchImapEmails(
  config: ImapConfig,
  lastUid?: number
): Promise<Omit<EmailMessage, 'id' | 'createdAt' | 'isRead'>[]> {
  const emails = await invoke<RustEmailMessage[]>('fetch_imap_emails', {
    config: {
      email: config.email,
      auth_code: config.authCode,
      server: config.server,
      port: config.port,
    },
    lastUid: lastUid ?? null,
  });

  return emails.map((e) => ({
    uid: e.uid,
    subject: e.subject || '（无主题）',
    sender: e.from || '未知发件人',
    date: e.date || '',
  }));
}
