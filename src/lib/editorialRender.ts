import DOMPurify from 'dompurify';
import type { Theme } from '@/types';
import { buildHtmlArticle } from './htmlBuilder';
import { safeArticleHtml } from './safeArticleHtml';
import { hashText, stableJson, type PublicDocument, type LayoutStamp } from './editorialTypes';
/** Narrow adapter: legacy renderer stays unchanged; metadata is never a renderer argument. */
export function renderPublicDocument(document: PublicDocument, theme: Theme): LayoutStamp {
  const html = buildHtmlArticle(document.title, document.blocks.filter(b => b.kind !== 'asset_slot').map(b => b.text), theme);
  const root = new DOMParser().parseFromString(DOMPurify.sanitize(html), 'text/html'); const article = root.querySelector('article');
  if (!article) throw new Error('invalid_layout');
  const nodes = [...article.children].slice(1);
  if (nodes.length !== document.blocks.filter(b => b.kind !== 'asset_slot').length) throw new Error('layout_block_mismatch');
  nodes.forEach(node => node.remove());
  for (const block of document.blocks) {
    const node = block.kind === 'asset_slot' ? root.createElement('figure') : nodes.shift()!;
    if (block.kind === 'asset_slot') node.textContent = block.text;
    node.setAttribute('data-editorial-block', block.id); article.append(node);
  }
  const result = safeArticleHtml(article.outerHTML);
  return { contentHash: document.contentHash, themeId: theme.name, themeVersion: hashText(stableJson(theme)), html: result, htmlHash: hashText(result) };
}
