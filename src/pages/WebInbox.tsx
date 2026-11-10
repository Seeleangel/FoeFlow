import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Inbox, Loader2, RefreshCw, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { canPreviewMailAttachment, formatMailDate, MailApiError, mailAttachment, mailRequest, type MailSession, type MailInbox, type MailHeader, type MailDetail, type MailAttachment } from '@/lib/webMail';
import MailMessageView from '@/components/MailMessageView';
import { downloadBlob } from '@/lib/browserImage';
import './web-mail.css';

type Action = 'mailbox' | 'sync' | 'disconnect' | 'message' | 'attachment';
type InboxReply = { email: string; inbox: MailInbox };
const getInbox = (page: number, signal: AbortSignal) =>
  mailRequest<InboxReply>('inbox', { method: 'POST', body: { page }, signal });
const mailError = (err: unknown) => err instanceof MailApiError ? err.message : '无法连接邮件服务，请稍后重试。';

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>{children}</div>;
}

export default function WebInbox() {
  const [session, setSession] = useState<MailSession>();
  const [inbox, setInbox] = useState<MailInbox>();
  const [configOpen, setConfigOpen] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [opened, setOpened] = useState<MailHeader>();
  const [detail, setDetail] = useState<MailDetail>();
  const [preview, setPreview] = useState<{ url: string; part: string }>();
  const [attachmentProgress, setAttachmentProgress] = useState<{ part: string; preview: boolean }>();
  const [attachmentError, setAttachmentError] = useState<{ part: string; message: string }>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState<Action | 'load' | null>('load');
  const inboxHeading = useRef<HTMLHeadingElement>(null);
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
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
      if (!controller.signal.aborted) setError(mailError(err));
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setPending(null);
      }
    }
  }, []);

  useEffect(() => {
    void load();
    return () => { requestRef.current?.abort(); requestRef.current = null; };
  }, [load]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  async function run(action: Action, execute: (signal: AbortSignal) => Promise<void>, reportError: (message: string) => void = setError) {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setPending(action);
    setError('');
    try {
      await execute(controller.signal);
    } catch (err) {
      if (!controller.signal.aborted) reportError(mailError(err));
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
      requestAnimationFrame(() => inboxHeading.current?.focus());
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

  function reference(uid: number) {
    if (!inbox) throw new Error('收件箱尚未同步');
    return { uid, uidValidity: inbox.uidValidity, mailboxVersion: inbox.mailboxVersion };
  }

  function openMessage(message: MailHeader) {
    if (!inbox || requestRef.current) return;
    setOpened(message);
    setAttachmentError(undefined);
    setDetail(undefined);
    setPreview(undefined);
    void run('message', async (signal) => {
      const reply = await mailRequest<{ message: MailDetail }>('message', {
        method: 'POST', signal, body: reference(message.uid),
      });
      if (signal.aborted) return;
      setDetail(reply.message);
      setInbox((current) => current ? {
        ...current,
        messages: current.messages.map((header) => header.uid === message.uid ? { ...header, isRead: reply.message.isRead } : header),
      } : current);
    });
  }

  function backToInbox() {
    requestRef.current?.abort();
    requestRef.current = null;
    setPending(null);
    setOpened(undefined);
    setDetail(undefined);
    setPreview(undefined);
    setError('');
    const rowId = opened && `web-mail-row-${opened.uid}`;
    requestAnimationFrame(() => {
      const row = rowId ? document.getElementById(rowId) : null;
      (row ?? inboxHeading.current)?.focus();
    });
  }

  function getAttachment(attachment: MailAttachment, previewOnly = false) {
    if (!detail || !inbox || requestRef.current) return;
    setAttachmentError(undefined);
    setAttachmentProgress({ part: attachment.part, preview: previewOnly });
    void run('attachment', async (signal) => {
      const blob = await mailAttachment({ signal, body: { ...reference(detail.uid), part: attachment.part } });
      if (signal.aborted) return;
      if (previewOnly && canPreviewMailAttachment(attachment)) {
        setPreview({ url: URL.createObjectURL(blob.slice(0, blob.size, attachment.type)), part: attachment.part });
      } else downloadBlob(blob, attachment.name);
    }, (message) => setAttachmentError({ part: attachment.part, message }));
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
    <div className="web-mail mx-auto max-w-5xl px-4 pb-8 pt-5 md:px-8 md:pt-8">
      {opened ? <MailMessageView
        header={opened} detail={detail} loading={pending === 'message'} busy={busy} error={error} preview={preview}
        attachmentProgress={pending === 'attachment' ? attachmentProgress : undefined} attachmentError={attachmentError}
        onBack={backToInbox} onRetry={() => openMessage(opened)} onAttachment={getAttachment}
        onClosePreview={() => setPreview(undefined)}
      /> : <>
        <header className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-stone-900">邮件收件箱</h1>
            {session?.email && <p className="mt-1 break-words text-sm text-stone-600">{session.email}</p>}
          </div>
          {session?.email && <Button
            variant="outline" disabled={busy} aria-expanded={configOpen}
            aria-controls={configOpen ? 'web-mail-settings' : undefined}
            onClick={() => { setConfigOpen(!configOpen); setConfirmDisconnect(false); }}
          >
            <Settings2 className="size-4" aria-hidden="true" />{configOpen ? '收起设置' : '管理邮箱'}
          </Button>}
        </header>

        {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}

        {!session && (pending === 'load'
          ? <p role="status" className="text-sm text-stone-600">正在连接邮件服务…</p>
          : <Button variant="outline" onClick={() => void load()}>重试</Button>)}

        {session?.username && configOpen && (
          <section id="web-mail-settings" aria-labelledby="web-mail-settings-heading" className="mb-5 rounded-xl border border-stone-200 bg-white p-4 md:p-5">
            <h2 id="web-mail-settings-heading" className="text-base font-semibold text-stone-900">{session.email ? '邮箱配置' : '尚未连接邮箱'}</h2>
            <p className="mt-1 text-sm leading-relaxed text-stone-600">在 163 邮箱设置中开启 IMAP 并生成授权码，即可在这里阅读投稿。</p>
            <form className="mt-4 max-w-md space-y-4" onSubmit={connectMailbox}>
              <Field id="mail-address" label="163 邮箱地址"><Input id="mail-address" name="email" type="email" autoComplete="off" required maxLength={120} defaultValue={session.email ?? ''} placeholder="name@163.com" /></Field>
              <Field id="mail-code" label="IMAP 授权码"><Input id="mail-code" name="authCode" type="password" autoComplete="off" required maxLength={128} /></Field>
              <p className="text-sm leading-relaxed text-stone-600">授权码加密保存。打开邮件会同步标为已读。</p>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={busy} className="bg-red-700 text-white hover:bg-red-800">
                  {pending === 'mailbox' && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}{pending === 'mailbox' ? '正在连接…' : '连接并同步'}
                </Button>
                {session.email && !confirmDisconnect && <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirmDisconnect(true)}>解除连接</Button>}
              </div>
              {confirmDisconnect && <div className="rounded-lg bg-stone-50 p-3 text-sm text-stone-700">
                <p>解除后会移除已保存的授权码，邮件仍保留在 163 邮箱。</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button type="button" variant="outline" className="text-red-800" disabled={busy} onClick={disconnect}>{pending === 'disconnect' ? '正在解除…' : '确认解除'}</Button>
                  <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirmDisconnect(false)}>取消</Button>
                </div>
              </div>}
            </form>
          </section>
        )}

        {session?.email && (
          <section aria-labelledby="web-mail-inbox-heading">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <div>
                <h2 id="web-mail-inbox-heading" ref={inboxHeading} tabIndex={-1} className="rounded-sm text-base font-semibold text-stone-900">全部收件{inbox ? ` · ${inbox.total} 封` : ''}</h2>
                {inbox && <p role="status" className="mt-1 text-sm text-stone-600">上次同步 <time dateTime={inbox.syncedAt}>{formatMailDate(inbox.syncedAt)}</time></p>}
              </div>
              <Button variant="outline" onClick={() => refresh(1)} disabled={busy} focusableWhenDisabled>
                <RefreshCw className={`size-4 ${pending === 'sync' ? 'animate-spin' : ''}`} aria-hidden="true" />
                {pending === 'sync' ? '正在同步…' : '立即同步'}
              </Button>
            </div>
            {inbox?.messages.length ? <ul aria-busy={pending === 'sync'} className="divide-y divide-stone-200 overflow-hidden rounded-xl border border-stone-200 bg-white">
              {inbox.messages.map((message) => <li key={message.uid} className={message.isRead ? 'bg-stone-50 text-stone-700' : 'bg-white text-stone-900'}>
                <button
                  id={`web-mail-row-${message.uid}`} type="button" onClick={() => openMessage(message)} disabled={busy}
                  className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-stone-100 active:bg-stone-200 disabled:cursor-wait md:gap-3 md:px-4"
                >
                  <span className={`rounded px-1.5 text-sm leading-6 ${message.isRead ? 'bg-stone-200 text-stone-700' : 'bg-red-50 font-medium text-red-800'}`}>{message.isRead ? '已读' : '未读'}</span>
                  <span className="min-w-0">
                    <span className={`line-clamp-2 break-words text-sm leading-6 md:text-base ${message.isRead ? '' : 'font-semibold'}`}>{message.subject}</span>
                    <span className="flex flex-wrap items-baseline gap-x-3 text-sm leading-5 text-stone-600">
                      <span className="min-w-0 max-w-full truncate md:flex-1">{message.sender}</span>
                      {message.date && <time dateTime={message.date} className="tabular-nums">{formatMailDate(message.date)}</time>}
                    </span>
                  </span>
                  <ChevronRight className="size-4 self-center text-stone-500" aria-hidden="true" />
                </button>
              </li>)}
            </ul> : <div role="status" className="rounded-xl border border-stone-200 bg-white p-5 text-sm text-stone-600">
              <div className="flex items-center gap-2 font-medium text-stone-800">
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Inbox className="size-4" aria-hidden="true" />}
                {busy ? '正在同步邮件…' : inbox ? '收件箱暂时没有邮件' : '尚未同步收件箱'}
              </div>
              {!busy && <p className="mt-1">{inbox ? '收到新邮件后，可用「立即同步」更新列表。' : '选择「立即同步」重试。'}</p>}
            </div>}
            {inbox && totalPages > 1 && (
              <nav aria-label="邮件分页" className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm tabular-nums text-stone-600">第 {inbox.page} / {totalPages} 页</p>
                <div className="flex gap-2">
                  <Button variant="outline" disabled={busy || inbox.page <= 1} onClick={() => refresh(inbox.page - 1, true)}><ChevronLeft className="size-4" aria-hidden="true" />上一页</Button>
                  <Button variant="outline" disabled={busy || inbox.page >= totalPages} onClick={() => refresh(inbox.page + 1, true)}>下一页<ChevronRight className="size-4" aria-hidden="true" /></Button>
                </div>
              </nav>
            )}
          </section>
        )}
      </>}
    </div>
  );
}
