import DOMPurify from 'dompurify'
import { isWebApp } from './platform'

// Articles and model replies are untrusted HTML. Preserve inline layout styles,
// while keeping active content out of the workspace and copied drafts.
export function safeArticleHtml(html: string): string {
  return isWebApp ? DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'button', 'input', 'select', 'textarea', 'iframe', 'base'],
    FORBID_ATTR: ['srcset', 'ping', 'autofocus', 'name'],
    SANITIZE_NAMED_PROPS: true,
  }) : html
}
