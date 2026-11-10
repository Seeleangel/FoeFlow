import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Inbox, Loader2, LogOut, Mail, RefreshCw, Settings2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MailApiError, mailRequest, type MailSession, type UnreadInbox } from '@/lib/webMail';

type Action = 'login' | 'register' | 'logout' | 'mailbox' | 'sync' | 'disconnect';
type InboxReply = { email: string; inbox: UnreadInbox };
const formatDate = (iso: string) => new Date(iso).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>{children}</div>;
}

export default function WebInbox() {
  const [session, setSession] = useState<MailSession>();
  const [inbox, setInbox] = useState<UnreadInbox>();
  const [register, setRegister] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<Action | 'load' | null>('load');
  const requestRef = useRef<AbortController | null>(null);

  function showError(err: unknown) {
    if (err instanceof MailApiError && err.status === 401 && err.code === 'sign_in_required') {
      setSession({ username: null, email: null });
      setInbox(undefined);
    }
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
        const reply = await mailRequest<InboxReply>('sync', { method: 'POST', signal: controller.signal });
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

  function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const action = register ? 'register' : 'login';
    void run(action, async (signal) => {
      const body = { username: String(values.get('username')), password: String(values.get('password')) };
      await mailRequest(action, {
        method: 'POST', signal,
        body: register ? { ...body, invite: String(values.get('invite')).trim() } : body,
      });
      form.reset();
      const current = await mailRequest<MailSession>('session', { signal });
      if (signal.aborted) return;
      setSession(current);
      setInbox(undefined);
      setConfigOpen(!current.email);
      if (current.email) {
        const reply = await mailRequest<InboxReply>('sync', { method: 'POST', signal });
        if (!signal.aborted) setInbox(reply.inbox);
      }
    });
  }

  function connectMailbox(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    void run('mailbox', async (signal) => {
      const reply = await mailRequest<InboxReply>('mailbox', {
        method: 'POST', signal, body: { email: String(values.get('email')), authCode: String(values.get('authCode')) },
      });
      if (signal.aborted) return;
      form.reset();
      setSession((current) => current ? { ...current, email: reply.email } : current);
      setInbox(reply.inbox);
      setConfigOpen(false);
      setConfirmDisconnect(false);
    });
  }

  function refresh() {
    void run('sync', async (signal) => {
      const reply = await mailRequest<InboxReply>('sync', { method: 'POST', signal });
      if (!signal.aborted) {
        setSession((current) => current ? { ...current, email: reply.email } : current);
        setInbox(reply.inbox);
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

  function signOut() {
    void run('logout', async (signal) => {
      await mailRequest('logout', { method: 'POST', signal });
      if (signal.aborted) return;
      setSession({ username: null, email: null });
      setInbox(undefined);
      setConfigOpen(false);
      setConfirmDisconnect(false);
      setRegister(false);
    });
  }

  const busy = pending !== null;

  return (
    <div className="max-w-5xl mx-auto px-5 py-8 sm:px-9 sm:py-12">
      <header className="mb-7 flex flex-wrap justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-red-800"><Mail className="size-4" aria-hidden="true" /> 163 邮箱</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-stone-900">邮件收件箱</h1>
          <p className="mt-2 text-sm leading-relaxed text-stone-600">查看未读投稿；正文与附件在 163 邮箱中打开。</p>
        </div>
        {session?.username && (
          <div className="flex flex-wrap items-center gap-2 self-start">
            <span className="mr-1 max-w-40 truncate text-xs text-stone-500">{session.username}</span>
            <Button variant="outline" onClick={signOut} disabled={busy}><LogOut className="size-4" />退出登录</Button>
          </div>
        )}
      </header>

      {error && <p role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}

      {!session && (pending === 'load'
        ? <p role="status" className="text-sm text-stone-500">正在检查登录状态…</p>
        : <Button variant="outline" onClick={() => void load()}>重试</Button>)}

      {session && !session.username && (
        <section className="max-w-md rounded-xl border border-stone-200 bg-white p-5 sm:p-7">
          <h2 className="text-xl font-semibold text-stone-900">{register ? '创建邮件账号' : '登录邮件账号'}</h2>
          <p className="mt-2 text-sm leading-relaxed text-stone-600">{register ? '使用管理员提供的一次性邀请码设置账号和密码。' : '邮件账号与 163 邮箱分开。登录后才能连接邮箱和查看投稿。'}</p>
          <form key={String(register)} className="mt-6 space-y-4" onSubmit={signIn}>
            <Field id="mail-username" label="用户名"><Input id="mail-username" name="username" autoComplete="username" autoCapitalize="none" required minLength={3} maxLength={32} /></Field>
            <Field id="mail-password" label="密码"><Input id="mail-password" name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={12} maxLength={128} /></Field>
            {register && <Field id="mail-invite" label="邀请码"><Input id="mail-invite" name="invite" type="password" autoComplete="off" required maxLength={64} /></Field>}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button type="submit" disabled={busy} className="bg-red-700 text-white hover:bg-red-800">{busy && <Loader2 className="size-4 animate-spin" />}{register ? '创建账号' : '登录'}</Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => { setRegister(!register); setError(''); }}>{register ? '返回登录' : '使用邀请码创建账号'}</Button>
            </div>
          </form>
        </section>
      )}

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
                <p className="text-xs leading-relaxed text-stone-600">请在 163 邮箱设置中开启 IMAP 并生成授权码。授权码加密保存在服务器，网页只读取未读邮件的基本信息。</p>
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
            <section className="mt-7" aria-label="未读投稿">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-stone-900">未读投稿{inbox ? ` · ${inbox.total} 封` : ''}</h2>
                  {inbox && <p className="mt-1 text-xs text-stone-500">上次同步 {formatDate(inbox.syncedAt)}{inbox.total > 100 ? ' · 显示最新 100 封' : ''}</p>}
                </div>
                <Button variant="outline" onClick={refresh} disabled={busy}><RefreshCw className={`size-4 ${busy ? 'animate-spin' : ''}`} />立即同步</Button>
              </div>
              {inbox?.messages.length ? <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
                {inbox.messages.map((message) => <li key={message.uid} className="px-4 py-4 sm:px-6">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p className="min-w-0 break-words font-medium text-stone-900">{message.subject}</p>
                    {message.date && <time dateTime={message.date} className="text-xs text-stone-500">{formatDate(message.date)}</time>}
                  </div>
                  <p className="mt-1 break-words text-sm text-stone-600">{message.sender}</p>
                </li>)}
              </ul> : <div className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-6 text-sm text-stone-600">
                <Inbox className="size-5 text-stone-400" aria-hidden="true" />
                <span role="status">{busy ? '正在同步未读投稿…' : inbox ? '没有未读投稿' : '等待同步'}</span>
              </div>}
            </section>
          )}
        </>
      )}
    </div>
  );
}
