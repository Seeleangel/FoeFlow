import { ImapFlow } from 'imapflow';

export const MAIL_PAGE_SIZE = 30;
const LEGACY_UNREAD_LIMIT = 100;
const CLIENT = { name: 'FoeFlow', vendor: 'FoeFlow', version: '1.0' };
const clean = (value, max) => String(value ?? '').replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, ' ').trim().slice(0, max);

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_BODY_BYTES = 1024 * 1024;
const newClient = (options) => new ImapFlow(options);

export class MailboxError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
}

async function withInbox({ email, authCode }, { readOnly, timeout = 20_000, createClient = newClient }, operation) {
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
        // Coremail expects client identification after LOGIN.
        await client.run('ID', CLIENT);
        const lock = await client.getMailboxLock('INBOX', { readOnly });
        try {
          return await operation(client);
        } finally {
          lock.release();
        }
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('imap_timeout')), timeout); }),
    ]);
  } finally {
    clearTimeout(timer);
    client.close();
  }
}

function messageHeader({ uid, envelope, flags, internalDate }) {
  const from = envelope?.from?.[0];
  const date = new Date(envelope?.date ?? internalDate ?? 0);
  return {
    uid,
    subject: clean(envelope?.subject, 300) || '（无主题）',
    sender: clean(from?.name && from?.address ? `${from.name} <${from.address}>` : from?.address ?? from?.name, 320) || '未知发件人',
    date: Number.isFinite(date.getTime()) && date.getTime() > 0 ? date.toISOString() : null,
    isRead: flags?.has('\\Seen') ?? false,
  };
}

export async function fetchInbox163(config, requestedPage = null, createClient = newClient) {
  return withInbox(config, { readOnly: true, createClient }, async (client) => {
    let total, page, range, useUid;
    if (requestedPage === null) {
      // Keep the old unread endpoint working for tabs opened before an upgrade.
      const uids = await client.search({ seen: false }, { uid: true });
      const unread = Array.isArray(uids) ? uids.sort((a, b) => b - a) : [];
      total = unread.length;
      range = unread.slice(0, LEGACY_UNREAD_LIMIT);
      useUid = true;
    } else {
      total = client.mailbox.exists;
      page = Math.min(requestedPage, Math.max(1, Math.ceil(total / MAIL_PAGE_SIZE)));
      const end = total - (page - 1) * MAIL_PAGE_SIZE;
      range = end > 0 ? `${Math.max(1, end - MAIL_PAGE_SIZE + 1)}:${end}` : null;
      useUid = false;
    }

    const messages = [];
    if (range?.length) {
      for await (const { uid, envelope, flags, internalDate } of client.fetch(
        range, { envelope: true, uid: true, internalDate: true, flags: true }, { uid: useUid },
      )) {
        messages.push(messageHeader({ uid, envelope, flags, internalDate }));
      }
    }
    return {
      total,
      ...(page === undefined ? {} : { page, pageSize: MAIL_PAGE_SIZE, uidValidity: String(client.mailbox.uidValidity) }),
      messages: messages.sort((a, b) => b.uid - a.uid),
    };
  });
}

const PART = /^[1-9]\d*(?:\.[1-9]\d*)*$/;

function messageParts(tree) {
  let text, html;
  const attachments = [];
  function visit(node, depth = 0) {
    if (!node || depth > 30 || attachments.length >= 150) return;
    const part = node.part || '1';
    if (part.length > 120 || !PART.test(part)) return;
    const name = node.dispositionParameters?.filename ?? node.parameters?.name;
    const type = String(node.type ?? '').toLowerCase();
    if (node.childNodes?.length && node.disposition !== 'attachment' && !name && type !== 'message/rfc822') {
      for (const child of node.childNodes) visit(child, depth + 1);
      return;
    }
    const isFile = node.disposition === 'attachment' || Boolean(name) || !['text/plain', 'text/html'].includes(type);
    if (!isFile) {
      if (type === 'text/plain') text ??= part;
      if (type === 'text/html') html ??= part;
      return;
    }
    const filename = clean(name, 180).replace(/[\\/:]/g, '_').replace(/^\.+$/, '').toWellFormed();
    const size = Number.isSafeInteger(node.size) && node.size >= 0 ? node.size : null;
    const estimated = size === null ? null : node.encoding === 'base64' ? Math.floor(size * 0.75) : size;
    attachments.push({ part, name: filename || `附件-${part}`, type, size: estimated });
  }
  visit(tree);
  return { text, html, attachments };
}

async function findMessage(client, { uid, uidValidity }) {
  if (String(client.mailbox.uidValidity) !== uidValidity) throw new MailboxError(409, 'stale_message');
  const message = await client.fetchOne(uid, { uid: true, envelope: true, flags: true, internalDate: true, bodyStructure: true }, { uid: true });
  if (!message || message.uid !== uid) throw new MailboxError(404, 'message_missing');
  return message;
}

async function readPart(client, uid, part, limit, decodeText) {
  const { content } = await client.download(uid, part, { uid: true, maxBytes: limit + 1, chunkSize: 256 * 1024, decodeText });
  if (!content) throw new MailboxError(404, 'message_missing');
  const chunks = [];
  let total = 0;
  for await (const chunk of content) {
    total += chunk.length;
    chunks.push(chunk);
    if (total > limit + 1) throw new MailboxError(413, 'attachment_too_large');
  }
  return { bytes: Buffer.concat(chunks, total).subarray(0, limit), truncated: total > limit };
}

export async function openMessage163(config, reference, canMark, createClient = newClient) {
  return withInbox(config, { readOnly: false, createClient }, async (client) => {
    const message = await findMessage(client, reference);
    if (!message.bodyStructure) throw new MailboxError(502, 'imap_failed');
    const header = messageHeader(message);
    const { text, html, attachments } = messageParts(message.bodyStructure);
    const part = text ?? html;
    const body = part ? await readPart(client, header.uid, part, MAX_BODY_BYTES, true) : null;
    // BODY.PEEK retrieves the content without side effects. Only an explicit
    // open that has successfully loaded the body may add \Seen.
    if (!header.isRead && canMark()) {
      try {
        header.isRead = await client.messageFlagsAdd(header.uid, ['\\Seen'], { uid: true, silent: true }) === true;
      } catch {
        // A provider may allow reading but reject STORE. Keep the body usable
        // and leave the unread badge in place until the flag is confirmed.
      }
    }
    return {
      ...header,
      body: body ? { format: text ? 'text' : 'html', content: body.bytes.toString('utf8'), truncated: body.truncated } : null,
      attachments,
    };
  });
}

export async function downloadAttachment163(config, reference, createClient = newClient) {
  return withInbox(config, { readOnly: true, timeout: 60_000, createClient }, async (client) => {
    const message = await findMessage(client, reference);
    const attachment = messageParts(message.bodyStructure).attachments.find(({ part }) => part === reference.part);
    if (!attachment) throw new MailboxError(404, 'attachment_missing');
    const { bytes, truncated } = await readPart(client, message.uid, attachment.part, MAX_ATTACHMENT_BYTES, false);
    if (truncated) throw new MailboxError(413, 'attachment_too_large');
    return { bytes, name: attachment.name };
  });
}
