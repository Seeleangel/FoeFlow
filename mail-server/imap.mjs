import { ImapFlow } from 'imapflow';

export const MAX_UNREAD = 100;
const CLIENT = { name: 'FoeFlow', vendor: 'FoeFlow', version: '1.0' };
const clean = (value, max) => String(value ?? '').replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, ' ').trim().slice(0, max);

export async function fetchUnread163({ email, authCode }, createClient = (options) => new ImapFlow(options)) {
  const client = createClient({
    host: 'imap.163.com', port: 993, secure: true,
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    auth: { user: email, pass: authCode, loginMethod: 'LOGIN' },
    clientInfo: CLIENT,
    logger: false, disableAutoIdle: true, disableCompression: true, disableAutoEnable: true,
    connectionTimeout: 6500, greetingTimeout: 5000, socketTimeout: 9000,
    maxLineLength: 1024 * 1024, maxLiteralSize: 1024 * 1024, maxResponseSize: 4 * 1024 * 1024,
  });
  client.on('error', () => { /* Request errors are returned to the caller, never logged with mailbox data. */ });
  let timer;
  try {
    return await Promise.race([
      (async () => {
        await client.connect();
        // Coremail expects client identification after LOGIN, even when ID
        // was already sent before authentication. Keep this before EXAMINE.
        await client.run('ID', CLIENT);
        const lock = await client.getMailboxLock('INBOX', { readOnly: true });
        try {
          const uids = await client.search({ seen: false }, { uid: true });
          const unread = Array.isArray(uids) ? uids.sort((a, b) => b - a) : [];
          const messages = [];
          if (unread.length) {
            for await (const { uid, envelope, internalDate } of client.fetch(
              unread.slice(0, MAX_UNREAD), { envelope: true, uid: true, internalDate: true }, { uid: true },
            )) {
              const from = envelope?.from?.[0];
              const date = new Date(envelope?.date ?? internalDate ?? 0);
              messages.push({
                uid,
                subject: clean(envelope?.subject, 300) || '（无主题）',
                sender: clean(from?.name && from?.address ? `${from.name} <${from.address}>` : from?.address ?? from?.name, 320) || '未知发件人',
                date: Number.isFinite(date.getTime()) && date.getTime() > 0 ? date.toISOString() : null,
              });
            }
          }
          return { total: unread.length, messages: messages.sort((a, b) => b.uid - a.uid) };
        } finally {
          lock.release();
        }
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('imap_timeout')), 20_000); }),
    ]);
  } finally {
    clearTimeout(timer);
    client.close();
  }
}
