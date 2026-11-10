import { publicAsset } from './platform';
import { currentWebWorkspace, reloadForSessionChange } from './webWorkspace';

export interface MailSession {
  username: string | null;
  workspaceId: string | null;
  email: string | null;
}

export interface MailInbox {
  total: number;
  page: number;
  pageSize: number;
  mailboxVersion: string;
  uidValidity: string;
  messages: MailHeader[];
  syncedAt: string;
}

export interface MailHeader {
  uid: number;
  subject: string;
  sender: string;
  date: string | null;
  isRead: boolean;
}

export interface MailAttachment {
  part: string;
  name: string;
  type: string;
  size: number | null;
}

export interface MailDetail extends MailHeader {
  body: { format: 'text' | 'html'; content: string; truncated: boolean } | null;
  attachments: MailAttachment[];
}

const mailDate = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
const previewImageTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

export const formatMailDate = (iso: string) => mailDate.format(new Date(iso));
export const canPreviewMailAttachment = (attachment: MailAttachment) => previewImageTypes.has(attachment.type);

const messages: Record<string, string> = {
  invalid_login: '用户名使用 3–32 位字母、数字、下划线或连字符，密码至少 12 位。',
  username_taken: '这个用户名已被使用，请换一个。',
  login_failed: '用户名或密码不正确。',
  invalid_mailbox: '请输入 163 邮箱地址和有效的 IMAP 授权码。',
  invalid_message: '邮件链接无效，请刷新收件箱后重试。',
  stale_message: '邮箱或邮件列表已更新，请重新同步后再打开。',
  message_missing: '邮件已不在收件箱，请重新同步。',
  attachment_missing: '附件不可用。',
  attachment_too_large: '附件超过 20 MB，无法在 FoeFlow 下载。',
  invalid_page: '邮件页码无效，请回到第一页重试。',
  mailbox_required: '请先连接 163 邮箱。',
  imap_failed: '未能连接 163 邮箱。请确认已开启 IMAP，并检查邮箱地址和授权码。',
  mailbox_busy: '正在同步，请稍后再试。',
  slow_down: '操作过于频繁，请稍后再试。',
  sign_in_required: '登录已失效，请重新登录。',
};

export class MailApiError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(messages[code] ?? '邮件服务暂不可用，请稍后再试。');
  }
}

type MailRequestOptions = { method?: 'GET' | 'POST' | 'DELETE'; body?: Record<string, string | number>; signal?: AbortSignal };

async function fetchMail(action: string, options: MailRequestOptions): Promise<Response> {
  const workspace = currentWebWorkspace();
  const response = await fetch(publicAsset('mail/' + action), {
    method: options.method,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(workspace ? { 'X-FoeFlow-Workspace': workspace } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin',
    cache: 'no-store',
    signal: options.signal,
  });
  if (response.ok) return response;
  const data = await response.json().catch(() => null);
  if (response.status === 401 && data?.error === 'sign_in_required' && workspace) reloadForSessionChange();
  throw new MailApiError(response.status, data?.error);
}

export async function mailRequest<T>(action: string, options: MailRequestOptions = {}): Promise<T> {
  const response = await fetchMail(action, options);
  const data = await response.json().catch(() => null);
  if (!data) throw new MailApiError(response.status, '');
  return data;
}

export async function mailAttachment(options: MailRequestOptions): Promise<Blob> {
  const response = await fetchMail('attachment', { ...options, method: 'POST' });
  if (response.headers.get('Content-Type') !== 'application/octet-stream') throw new MailApiError(response.status, '');
  return response.blob();
}
