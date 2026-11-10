import { useEffect, useMemo, useRef } from 'react';
import DOMPurify from 'dompurify';
import { ChevronLeft, Download, Eye, File, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { MailAttachment, MailDetail, MailHeader } from '@/lib/webMail';
import { formatBytes } from '@/lib/imageCompress';

export const previewImageTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const dateFormat = (iso: string) => new Date(iso).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });

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

export default function MailMessageView({ header, detail, loading, busy, error, preview, onBack, onRetry, onAttachment, onClosePreview }: {
  header: MailHeader;
  detail?: MailDetail;
  loading: boolean;
  busy: boolean;
  error: string;
  preview?: { url: string; name: string };
  onBack: () => void;
  onRetry: () => void;
  onAttachment: (attachment: MailAttachment, preview?: boolean) => void;
  onClosePreview: () => void;
}) {
  const message = detail ?? header;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [header.uid]);
  const html = useMemo(() => detail?.body?.format === 'html' ? safeMailHtml(detail.body.content) : '', [detail]);
  return (
    <section className="mt-7" aria-labelledby="mail-message-title">
      <Button variant="outline" onClick={onBack} className="mb-4"><ChevronLeft className="size-4" />返回收件箱</Button>
      <article className="overflow-hidden rounded-xl border border-stone-200 bg-white">
        <header className="border-b border-stone-100 px-5 py-5 sm:px-7">
          <h2 id="mail-message-title" ref={heading} tabIndex={-1} className="break-words text-xl font-semibold text-stone-900">{message.subject}</h2>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-stone-600">
            <span className="break-all">{message.sender}</span>
            {message.date && <time dateTime={message.date}>{dateFormat(message.date)}</time>}
          </div>
        </header>
        <div className="px-5 py-5 sm:px-7">
          {error && <p role="alert" className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          {loading && <p role="status" className="flex items-center gap-2 text-sm text-stone-600"><Loader2 className="size-4 animate-spin" />正在打开邮件…</p>}
          {!loading && !detail && <Button variant="outline" onClick={onRetry}>重新打开</Button>}
          {detail && <>
            {!detail.isRead && <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-stone-600">
              <span>正文已打开，但已读状态还未同步。</span>
              <Button variant="outline" size="sm" disabled={busy} onClick={onRetry}>重试标为已读</Button>
            </div>}
            {detail.body?.truncated && <p className="mb-4 text-sm text-stone-600">正文较长，仅显示前 1 MB。</p>}
            {detail.body?.format === 'text' ? <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-stone-800">{detail.body.content || '此邮件没有正文。'}</div>
              : html.trim() ? <div className="overflow-auto break-words text-sm leading-relaxed text-stone-800 [&_a]:text-red-800 [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_p]:my-2 [&_li]:ml-5 [&_li]:list-disc [&_td]:border [&_td]:px-2 [&_th]:border [&_th]:px-2" dangerouslySetInnerHTML={{ __html: html }} />
              : <p className="text-sm text-stone-600">此邮件没有可显示的正文。</p>}
            {detail.body?.format === 'html' && <p className="mt-3 text-xs text-stone-500">为保护隐私，正文不加载远程图片。</p>}
            {detail.attachments.length > 0 && <section aria-label="附件" className="mt-6 border-t border-stone-100 pt-4">
              <h3 className="mb-3 text-sm font-semibold text-stone-900">附件 · {detail.attachments.length}</h3>
              <ul className="space-y-2">
                {detail.attachments.map((attachment) => <li key={attachment.part} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-stone-200 px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <File className="size-4 shrink-0 text-stone-500" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="break-all text-sm text-stone-800">{attachment.name}</p>
                      {attachment.size !== null && <p className="text-xs text-stone-500">{formatBytes(attachment.size)}</p>}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {previewImageTypes.has(attachment.type) && <Button variant="outline" size="sm" disabled={busy} onClick={() => onAttachment(attachment, true)}><Eye className="size-4" />预览图片</Button>}
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => onAttachment(attachment)}><Download className="size-4" />下载</Button>
                  </div>
                </li>)}
              </ul>
            </section>}
            {preview && <div className="mt-4 rounded-lg border border-stone-200 p-3">
              <div className="mb-3 flex items-center justify-between gap-3"><p className="break-all text-sm text-stone-700">{preview.name}</p><Button variant="ghost" size="sm" onClick={onClosePreview}>关闭预览</Button></div>
              <img src={preview.url} alt={preview.name} className="max-h-[65vh] max-w-full rounded object-contain" />
            </div>}
          </>}
        </div>
      </article>
    </section>
  );
}
