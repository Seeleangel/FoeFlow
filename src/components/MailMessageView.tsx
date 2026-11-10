import { useEffect, useMemo, useRef } from 'react';
import DOMPurify from 'dompurify';
import { ChevronLeft, Download, Eye, File, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { canPreviewMailAttachment, formatMailDate, type MailAttachment, type MailDetail, type MailHeader } from '@/lib/webMail';
import { formatBytes } from '@/lib/imageCompress';

function safeMailHtml(html: string) {
  const fragment = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a'],
    ALLOWED_ATTR: ['href', 'title', 'colspan', 'rowspan', 'scope'],
    ALLOWED_URI_REGEXP: /^(?:https?:\/\/|mailto:)/i,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  });
  for (const link of fragment.querySelectorAll('a')) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
  const wrapper = document.createElement('div');
  wrapper.append(fragment);
  return wrapper.innerHTML;
}

export default function MailMessageView({ header, detail, loading, busy, error, preview, attachmentProgress, attachmentError, onBack, onRetry, onAttachment, onClosePreview }: {
  header: MailHeader;
  detail?: MailDetail;
  loading: boolean;
  busy: boolean;
  error: string;
  preview?: { url: string; part: string };
  attachmentProgress?: { part: string; preview: boolean };
  attachmentError?: { part: string; message: string };
  onBack: () => void;
  onRetry: () => void;
  onAttachment: (attachment: MailAttachment, preview?: boolean) => void;
  onClosePreview: () => void;
}) {
  const message = detail ?? header;
  const date = message.date ?? header.date;
  const heading = useRef<HTMLHeadingElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const previewTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { heading.current?.focus(); }, [header.uid]);
  useEffect(() => { if (preview) closeButton.current?.focus(); }, [preview]);
  const html = useMemo(() => detail?.body?.format === 'html' ? safeMailHtml(detail.body.content) : '', [detail]);

  function closePreview() {
    onClosePreview();
    previewTrigger.current?.focus();
  }

  return (
    <section className="mx-auto max-w-4xl" aria-labelledby="mail-message-title">
      <Button variant="ghost" onClick={onBack} className="mb-3 -ml-2 text-stone-700">
        <ChevronLeft className="size-4" aria-hidden="true" />返回收件箱
      </Button>
      <article className="rounded-xl border border-stone-200 bg-white">
        <header className="border-b border-stone-200 px-4 py-5 md:px-7 md:py-6">
          <h1 id="mail-message-title" ref={heading} tabIndex={-1} className="break-words rounded-sm text-xl font-semibold leading-snug text-stone-900 md:text-2xl">{message.subject}</h1>
          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm text-stone-600">
            <span className="min-w-0 break-words">{message.sender}</span>
            {date && <time dateTime={date} className="tabular-nums">{formatMailDate(date)}</time>}
          </div>
        </header>
        <div className="px-4 py-5 md:px-7 md:py-6">
          {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          {loading && <div role="status" className="text-sm text-stone-600">
            <p>正在打开邮件…</p>
            <div className="mt-4 max-w-md space-y-3" aria-hidden="true">
              <div className="h-3 rounded bg-stone-100" />
              <div className="h-3 w-2/3 rounded bg-stone-100" />
            </div>
          </div>}
          {!loading && !detail && <Button variant="outline" onClick={onRetry}>重新打开</Button>}
          {detail && <>
            {!detail.isRead && <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700">
              <span>正文已打开，已读状态尚未同步。</span>
              <Button variant="outline" disabled={busy} onClick={onRetry}>重试标为已读</Button>
            </div>}
            {detail.body?.truncated && <p className="mb-4 text-sm text-stone-600">正文较长，仅显示前 1 MB。</p>}
            {detail.body?.format === 'text' && detail.body.content ? <div className="mail-message-body whitespace-pre-wrap">{detail.body.content}</div>
              : html.trim() ? <div className="mail-message-body" dangerouslySetInnerHTML={{ __html: html }} />
              : <p className="text-sm text-stone-600">此邮件没有可显示的正文。</p>}
            {detail.body?.format === 'html' && <p className="mt-4 text-sm text-stone-600">为保护隐私，正文不加载远程图片。</p>}
            {detail.attachments.length > 0 && <section aria-labelledby="mail-attachments-heading" className="mt-6 border-t border-stone-200 pt-4">
              <h2 id="mail-attachments-heading" className="mb-2 text-base font-semibold text-stone-900">附件 <span className="text-sm font-normal text-stone-600">· {detail.attachments.length}</span></h2>
              <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200">
                {detail.attachments.map((attachment) => {
                  const progress = attachmentProgress?.part === attachment.part ? attachmentProgress : undefined;
                  const previewOpen = preview?.part === attachment.part;
                  return <li key={attachment.part} className="px-3 py-2.5 md:px-4">
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <File className="mt-0.5 size-4 shrink-0 text-stone-600" aria-hidden="true" />
                        <div className="min-w-0">
                          <p className="break-words text-sm font-medium text-stone-900">{attachment.name}</p>
                          {attachment.size !== null && <p className="mt-0.5 text-sm tabular-nums text-stone-600">{formatBytes(attachment.size)}</p>}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {canPreviewMailAttachment(attachment) && <Button variant="outline" disabled={busy} focusableWhenDisabled aria-expanded={previewOpen}
                          aria-label={`${previewOpen ? '收起预览' : '预览图片'} ${attachment.name}`}
                          ref={previewOpen ? previewTrigger : undefined}
                          onClick={() => {
                            if (previewOpen) {
                              closePreview();
                              return;
                            }
                            onAttachment(attachment, true);
                          }}
                        >
                          {progress?.preview ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                          {progress?.preview ? '加载中…' : previewOpen ? '收起预览' : '预览图片'}
                        </Button>}
                        <Button variant="outline" disabled={busy} focusableWhenDisabled aria-label={`下载 ${attachment.name}`} onClick={() => onAttachment(attachment)}>
                          {progress && !progress.preview ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />}
                          {progress && !progress.preview ? '下载中…' : '下载'}
                        </Button>
                      </div>
                    </div>
                    {attachmentError?.part === attachment.part && <p role="alert" className="mt-2 text-sm text-red-800">{attachmentError.message}</p>}
                    {progress && <span role="status" className="sr-only">{progress.preview ? '正在加载预览' : '正在下载'} {attachment.name}</span>}
                    {preview?.part === attachment.part && <div className="mt-3 rounded-md bg-stone-50 p-3"
                      onKeyDown={(event) => { if (event.key === 'Escape') closePreview(); }}
                    >
                      <div className="mb-2 flex justify-end">
                        <Button ref={closeButton} variant="ghost" onClick={closePreview}><X className="size-4" aria-hidden="true" />关闭预览</Button>
                      </div>
                      <img src={preview.url} alt={attachment.name} className="mx-auto max-h-[60vh] max-w-full rounded object-contain" />
                    </div>}
                  </li>;
                })}
              </ul>
            </section>}
          </>}
        </div>
      </article>
    </section>
  );
}
