import { publicAsset } from './platform';

export interface MailSession {
  username: string | null;
  email: string | null;
}

export interface UnreadInbox {
  total: number;
  messages: Array<{ uid: number; subject: string; sender: string; date: string | null }>;
  syncedAt: string;
}

const messages: Record<string, string> = {
  invalid_invite: '邀请码无效、已使用或已过期。',
  invalid_login: '用户名使用 3–32 位字母、数字、下划线或连字符，密码至少 12 位。',
  username_taken: '这个用户名已被使用，请换一个。',
  login_failed: '用户名或密码不正确。',
  invalid_mailbox: '请输入 163 邮箱地址和有效的 IMAP 授权码。',
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

export async function mailRequest<T>(
  action: string,
  options: { method?: 'GET' | 'POST' | 'DELETE'; body?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(publicAsset('mail/' + action), {
    method: options.method,
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin',
    cache: 'no-store',
    signal: options.signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new MailApiError(response.status, data?.error);
  return data;
}
