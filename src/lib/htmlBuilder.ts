/**
 * HTML Builder for FOE Publicity
 *
 * Converts markdown-style text to HTML with theme styling.
 * Supports container syntax and theme-based inline styles.
 */

import type { Theme } from '@/types';
import { transformContainers } from './containerParser';
import { PLACEHOLDER_IMG_DATA_URI } from './placeholders';

/**
 * Escape HTML special characters.
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

/**
 * Resolve a color reference to its actual value from theme.
 */
function resolveColor(value: string, theme: Theme): string {
  if (!value) return '';
  const key = value as keyof Theme['colors'];
  if (key in theme.colors) {
    return theme.colors[key];
  }
  return value;
}

/**
 * Convert style object to CSS string using theme colors.
 */
function buildStyleString(
  style: Record<string, string>,
  theme: Theme
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(style)) {
    const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
    const cssValue = resolveColor(value, theme);
    if (cssValue) {
      parts.push(`${cssKey}: ${cssValue}`);
    }
  }
  return parts.join('; ');
}

/**
 * Get inline style for an element from theme.
 */
function getElementStyle(element: string, theme: Theme): string {
  const style = theme.styles[element];
  if (!style) return '';
  return buildStyleString(style, theme);
}

/**
 * Build HTML article from markdown-style paragraphs.
 *
 * @param title - Article title
 * @param paragraphs - Array of paragraph strings (markdown-style)
 * @param theme - Theme to apply
 * @returns HTML string with inline styles
 */
export function buildHtmlArticle(
  title: string,
  paragraphs: string[],
  theme: Theme
): string {
  // Join paragraphs and process containers
  const text = paragraphs.join('\n');
  const processedText = transformContainers(text);

  // Split back into lines for processing
  const lines = processedText.split('\n');

  const bodyParts: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) continue;

    // Check for container placeholder (already converted HTML)
    if (trimmed.startsWith('<div class="container')) {
      bodyParts.push(trimmed);
      continue;
    }

    // Parse markdown-style elements
    if (trimmed.startsWith('## ')) {
      const content = escapeHtml(trimmed.slice(3));
      const style = getElementStyle('h2', theme);
      bodyParts.push(`<h2 style="${style}">${content}</h2>`);
    } else if (trimmed.startsWith('# ')) {
      const content = escapeHtml(trimmed.slice(2));
      const style = getElementStyle('h1', theme);
      bodyParts.push(`<h1 style="${style}">${content}</h1>`);
    } else if (trimmed.startsWith('### ')) {
      const content = escapeHtml(trimmed.slice(4));
      const style = getElementStyle('h3', theme);
      bodyParts.push(`<h3 style="${style}">${content}</h3>`);
    } else if (trimmed.startsWith('#### ')) {
      const content = escapeHtml(trimmed.slice(5));
      const style = getElementStyle('h4', theme);
      bodyParts.push(`<h4 style="${style}">${content}</h4>`);
    } else if (trimmed.startsWith('【此处配图')) {
      // Image placeholder — extract alt text from 【此处配图：说明】
      const altMatch = trimmed.match(/【此处配图[：:]\s*(.*?)】/);
      const alt = altMatch ? altMatch[1] : '配图';
      bodyParts.push(
        `<img src="${PLACEHOLDER_IMG_DATA_URI}" alt="${alt}" style="display:block;max-width:100%;height:auto;margin:20px auto;border-radius:4px;">`
      );
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      // List item (simplified - wraps each in li, should be in ul)
      const content = escapeHtml(trimmed.slice(2));
      const liStyle = getElementStyle('li', theme);
      bodyParts.push(`<li style="${liStyle}">${content}</li>`);
    } else if (/^\d+\.\s/.test(trimmed)) {
      // Numbered list item
      const content = escapeHtml(trimmed.replace(/^\d+\.\s/, ''));
      const style = getElementStyle('li', theme);
      bodyParts.push(`<li style="${style}">${content}</li>`);
    } else if (trimmed.startsWith('> ')) {
      // Blockquote line
      const content = escapeHtml(trimmed.slice(2));
      const style = getElementStyle('blockquote', theme);
      bodyParts.push(`<blockquote style="${style}">${content}</blockquote>`);
    } else {
      // Regular paragraph
      // Apply basic text formatting (bold, italic)
      let content = escapeHtml(trimmed);
      content = content
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code>$1</code>');

      const style = getElementStyle('p', theme);
      bodyParts.push(`<p style="${style}">${content}</p>`);
    }
  }

  // Build container style
  const containerStyle = `font-family: ${theme.typography.fontFamily}; font-size: ${theme.typography.fontSize}; line-height: ${theme.typography.lineHeight}; color: ${theme.colors.text}; background: ${theme.colors.background};`;

  return `<article style="${containerStyle}; max-width: 680px; margin: 0 auto; padding: 16px;">
  <h1 style="${getElementStyle('h1', theme)}">${escapeHtml(title)}</h1>
  ${bodyParts.join('\n')}
</article>`;
}

/**
 * Build minimal HTML without theme (legacy compatibility).
 * @deprecated Use buildHtmlArticle with theme instead.
 */
export function buildHtmlArticleLegacy(
  title: string,
  paragraphs: string[],
  brandColor: string
): string {
  const body = paragraphs
    .map((p) => {
      if (p.startsWith('【此处配图')) {
        const altMatch = p.match(/【此处配图[：:]\s*(.*?)】/);
        const alt = altMatch ? altMatch[1] : '配图';
        return `<img src="${PLACEHOLDER_IMG_DATA_URI}" alt="${alt}" style="display:block;max-width:100%;height:auto;margin:16px auto;border-radius:4px;">`;
      }
      if (p.startsWith('## ')) {
        return `<h3 style="color:${brandColor};margin:20px 0 10px;font-size:18px;font-weight:bold;">${p.slice(3)}</h3>`;
      }
      if (p.startsWith('# ')) {
        return `<h2 style="color:${brandColor};margin:24px 0 12px;font-size:22px;font-weight:bold;text-align:center;">${p.slice(2)}</h2>`;
      }
      return `<p style="margin:12px 0;line-height:1.8;text-align:justify;">${p}</p>`;
    })
    .join('\n');

  return `<article style="font-family:system-ui,-apple-system,sans-serif;font-size:16px;color:#333;max-width:680px;margin:0 auto;padding:16px;">
  <h1 style="color:${brandColor};font-size:26px;font-weight:bold;text-align:center;margin-bottom:24px;">${title}</h1>
  ${body}
</article>`;
}
