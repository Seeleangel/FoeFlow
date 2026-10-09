import { describe, it, expect } from 'vitest';
import { isArticle } from '../../src/lib/articleDetector';

describe('isArticle', () => {
  it('returns true for text starting with "# "', () => {
    expect(isArticle('# 春季读书会活动通知\n\n正文内容')).toBe(true);
  });

  it('returns false for plain text without heading', () => {
    expect(isArticle('你好，我想写一篇推文')).toBe(false);
  });

  it('returns false for markdown h2 only', () => {
    expect(isArticle('## 副标题')).toBe(false);
  });

  it('handles leading whitespace', () => {
    expect(isArticle('  \n# 标题\n\n正文')).toBe(true);
  });
});
