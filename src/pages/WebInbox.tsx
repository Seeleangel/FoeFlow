import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Inbox, Loader2, Mail, RefreshCw, Settings2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MailApiError, mailRequest, type MailSession, type MailInbox } from '@/lib/webMail';

type Action = 'mailbox' | 'sync' | 'disconnect';
type InboxReply = { email: string; inbox: MailInbox };
const getInbox = (page: number, signal: AbortSignal) =>
  mailRequest<InboxReply>('inbox', { method: 'POST', body: { page }, signal });
const formatDate = (iso: string) => new Date(iso).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>{children}</div>;
}

export default function WebInbox() {
  const [session, setSession] = useState<MailSession>();
  const [inbox, setInbox] = useState<MailInbox>();
  const [configOpen, setConfigOpen] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<Action | 'load' | null>('load');
  const inboxHeading = useRef<HTMLHeadingElement>(null);
  const requestRef = useRef<AbortController | null>(null);

  function showError(err: unknown) {
    setError(err instanceof MailApiError ? err.message : '无法连接邮件服务，请稍后重试。');
  }

  async function load() {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setPending('load');
    setError('');
    try {
      const current = await mailRequest<MailSession>('session', { signal: controller.signal });
      if (controller.signal.aborted) return;
      setSession(current);
      setConfigOpen(!current.email);
      if (current.email) {
        const reply = await getInbox(1, controller.signal);
        if (!controller.signal.aborted) setInbox(reply.inbox);
      }
    } catch (err) {
      if (!controller.signal.aborted) showError(err);
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setPending(null);
      }
    }
  }

  useEffect(() => {
    void load();
    return () => { requestRef.current?.abort(); requestRef.current = null; };
  }, []);

  async function run(action: Action, execute: (signal: AbortSignal) => Promise<void>) {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setPending(action);
    setError('');
    try {
      await execute(controller.signal);
    } catch (err) {
      if (!controller.signal.aborted) showError(err);
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setPending(null);
      }
    }
  }

  function connectMailbox(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    void run('mailbox', async (signal) => {
      const reply = await mailRequest<InboxReply>('mailbox', {
        method: 'POST', signal, body: { email: String(values.get('email')), authCode: String(values.get('authCode')), view: 'all' },
      });
      if (signal.aborted) return;
      form.reset();
      setSession((current) => current ? { ...current, email: reply.email } : current);
      setInbox(reply.inbox);
      setConfigOpen(false);
      setConfirmDisconnect(false);
    });
  }

  function refresh(page: number, moveFocus = false) {
    void run('sync', async (signal) => {
      const reply = await getInbox(page, signal);
      if (!signal.aborted) {
        setSession((current) => current ? { ...current, email: reply.email } : current);
        setInbox(reply.inbox);
        if (moveFocus) inboxHeading.current?.focus();
      }
    });
  }

  function disconnect() {
    void run('disconnect', async (signal) => {
      await mailRequest('mailbox', { method: 'DELETE', signal });
      if (signal.aborted) return;
      setSession((current) => current ? { ...current, email: null } : current);
      setInbox(undefined);
      setConfirmDisconnect(false);
      setConfigOpen(true);
    });
  }

  const busy = pending !== null;
  const totalPages = inbox ? Math.max(1, Math.ceil(inbox.total / inbox.pageSize)) : 1;

  return (
    <div className="max-w-5xl mx-auto px-5 py-8 sm:px-9 sm:py-12">
      <header className="mb-7 flex flex-wrap justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-red-800"><Mail className="size-4" aria-hidden="true" /> 163 邮箱</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-stone-900">邮件收件箱</h1>
          <p className="mt-2 text-sm leading-relaxed text-stone-600">查看全部收件。已读邮件置灰，正文和附件请在 163 邮箱查看。</p>
        </div>
      </header>

      {error && <p role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}

      {!session && (pending === 'load'
        ? <p role="status" className="text-sm text-stone-500">正在检查登录状态…</p>
        : <Button variant="outline" onClick={() => void load()}>重试</Button>)}

      {session?.username && (
        <>
          <section className="rounded-xl border border-stone-200 bg-white p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-base font-semibold text-stone-900">
                  <ShieldCheck className="size-4 text-red-800" aria-hidden="true" />邮箱配置
                </h2>
                <p className="mt-1 break-all text-sm text-stone-600">{session.email ?? '尚未连接邮箱'}</p>
              </div>
              {session.email && <Button variant="outline" disabled={busy} aria-expanded={configOpen} onClick={() => { setConfigOpen(!configOpen); setConfirmDisconnect(false); }}>
                <Settings2 className="size-4" />{configOpen ? '收起设置' : '管理邮箱'}
              </Button>}
            </div>
            {configOpen && (
              <form className="mt-5 max-w-md space-y-4" onSubmit={connectMailbox}>
                <Field id="mail-address" label="163 邮箱地址"><Input id="mail-address" name="email" type="email" autoComplete="off" required maxLength={120} defaultValue={session.email ?? ''} placeholder="name@163.com" /></Field>
                <Field id="mail-code" label="IMAP 授权码"><Input id="mail-code" name="authCode" type="password" autoComplete="off" required maxLength={128} /></Field>
                <p className="text-xs leading-relaxed text-stone-600">请在 163 邮箱设置中开启 IMAP 并生成授权码。授权码加密保存在服务器，网页只读取收件箱的基本信息，不改动已读状态。</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={busy} className="bg-red-700 text-white hover:bg-red-800">
                    {pending === 'mailbox' && <Loader2 className="size-4 animate-spin" />}{pending === 'mailbox' ? '正在连接…' : '连接并同步'}
                  </Button>
                  {session.email && !confirmDisconnect && <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirmDisconnect(true)}>解除连接</Button>}
                </div>
                {confirmDisconnect && <div className="rounded-lg bg-stone-50 p-3 text-sm text-stone-700">
                  <p>移除服务器上保存的邮箱授权，不会删除 163 邮件。</p>
                  <div className="mt-2 flex gap-2">
                    <Button type="button" variant="destructive" disabled={busy} onClick={disconnect}>确认解除</Button>
                    <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirmDisconnect(false)}>取消</Button>
                  </div>
                </div>}
              </form>
            )}
          </section>

          {session.email && (
            <section className="mt-7" aria-labelledby="web-mail-inbox-heading" aria-busy={busy}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 id="web-mail-inbox-heading" ref={inboxHeading} tabIndex={-1} className="text-lg font-semibold text-stone-900">全部收件{inbox ? ` · ${inbox.total} 封` : ''}</h2>
                  {inbox && <p className="mt-1 text-xs text-stone-500">上次同步 {formatDate(inbox.syncedAt)}</p>}
                </div>
                <Button variant="outline" onClick={() => refresh(1)} disabled={busy}><RefreshCw className={`size-4 ${busy ? 'animate-spin' : ''}`} />立即同步</Button>
              </div>
              {inbox?.messages.length ? <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 bg-white">
                {inbox.messages.map((message) => <li key={message.uid} className={`px-4 py-4 sm:px-6 ${message.isRead ? 'bg-stone-50 text-stone-600' : 'bg-white text-stone-900'}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <div className="flex min-w-0 flex-1 items-baseline gap-2">
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${message.isRead ? 'bg-stone-100 text-stone-600' : 'bg-red-50 font-medium text-red-800'}`}>{message.isRead ? '已读' : '未读'}</span>
                      <p className={`min-w-0 break-words ${message.isRead ? '' : 'font-semibold'}`}>{message.subject}</p>
                    </div>
                    {message.date && <time dateTime={message.date} className="text-xs text-stone-500">{formatDate(message.date)}</time>}
                  </div>
                  <p className="mt-1 break-words text-sm text-stone-600">{message.sender}</p>
                </li>)}
              </ul> : <div className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-6 text-sm text-stone-600">
                <Inbox className="size-5 text-stone-400" aria-hidden="true" />
                <span role="status">{busy ? '正在同步邮件…' : inbox ? '收件箱没有邮件' : '等待同步'}</span>
              </div>}
              {inbox && totalPages > 1 && (
                <nav aria-label="邮件分页" className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-stone-600">第 {inbox.page} / {totalPages} 页</p>
                  <div className="flex gap-2">
                    <Button variant="outline" disabled={busy || inbox.page <= 1} onClick={() => refresh(inbox.page - 1, true)}><ChevronLeft className="size-4" />上一页</Button>
                    <Button variant="outline" disabled={busy || inbox.page >= totalPages} onClick={() => refresh(inbox.page + 1, true)}>下一页<ChevronRight className="size-4" /></Button>
                  </div>
                </nav>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
