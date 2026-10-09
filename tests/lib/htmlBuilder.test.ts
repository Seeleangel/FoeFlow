import { describe, it, expect } from 'vitest';
import { buildHtmlArticle } from '../../src/lib/htmlBuilder';
import type { Theme } from '../../src/types';

const mockTheme: Theme = {
  name: 'test-theme',
  description: 'Test theme for unit tests',
  colors: {
    primary: '#8B1A1A',
    secondary: '#6B7280',
    text: '#1F2937',
    textLight: '#6B7280',
    background: '#FFFFFF',
    codeBg: '#F3F4F6',
    codeColor: '#1F2937',
    quoteBorder: '#D1D5DB',
    quoteBg: '#F9FAFB',
    border: '#E5E7EB',
  },
  typography: {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '16px',
    lineHeight: 1.8,
  },
  styles: {
    h1: { fontSize: '24px', fontWeight: 'bold', color: 'primary', textAlign: 'center' },
    h2: { fontSize: '20px', fontWeight: 'bold', color: 'primary', marginTop: '20px' },
    h3: { fontSize: '18px', fontWeight: 'bold', color: 'secondary' },
    h4: { fontSize: '16px', fontWeight: 'bold' },
    p: { fontSize: '16px', lineHeight: '1.8', marginBottom: '12px' },
    li: { marginLeft: '20px' },
    blockquote: { borderLeft: '4px solid quoteBorder', paddingLeft: '16px', color: 'textLight' },
  },
};

describe('buildHtmlArticle', () => {
  it('should wrap title and paragraphs', () => {
    const html = buildHtmlArticle('测试标题', ['正文第一段', '正文第二段'], mockTheme);
    expect(html).toContain('测试标题');
    expect(html).toContain('正文第一段');
    expect(html).toContain('</article>');
  });

  it('should format heading markers', () => {
    const html = buildHtmlArticle('标题', ['# 大标题', '## 小标题'], mockTheme);
    expect(html).toContain('<h1');
    expect(html).toContain('大标题');
    expect(html).toContain('<h2');
    expect(html).toContain('小标题');
  });

  it('should render image placeholder as img tag', () => {
    const html = buildHtmlArticle('标题', ['【此处配图：封面图】'], mockTheme);
    expect(html).toContain('封面图');
    expect(html).toContain('<img');
    expect(html).toContain('image/svg+xml');
  });
});
