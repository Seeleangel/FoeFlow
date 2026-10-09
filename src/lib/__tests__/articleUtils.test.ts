import { describe, it, expect } from 'vitest';
import { stripCodeBlocks, removeEmoji } from '@/lib/articleUtils';

describe('stripCodeBlocks', () => {
  it('strips markdown code block with language tag', () => {
    const input = '```markdown\n# Title\nContent\n```';
    expect(stripCodeBlocks(input)).toBe('# Title\nContent');
  });

  it('strips markdown code block without language tag', () => {
    const input = '```\n# Title\nContent\n```';
    expect(stripCodeBlocks(input)).toBe('# Title\nContent');
  });

  it('returns original content when no code block', () => {
    expect(stripCodeBlocks('# Title\nContent')).toBe('# Title\nContent');
  });

  it('returns trimmed content', () => {
    expect(stripCodeBlocks('  # Title  ')).toBe('# Title');
  });

  it('handles empty string', () => {
    expect(stripCodeBlocks('')).toBe('');
  });
});

describe('removeEmoji', () => {
  it('removes emoji characters', () => {
    const input = 'Hello 😀 World 🎉!';
    const result = removeEmoji(input);
    expect(result).not.toContain('😀');
    expect(result).not.toContain('🎉');
  });

  it('preserves normal text', () => {
    const input = '这是一段正常的文本。';
    expect(removeEmoji(input)).toBe('这是一段正常的文本。');
  });

  it('collapses multiple spaces left by removed emoji', () => {
    const input = 'Hello 😀 🎉 World';
    expect(removeEmoji(input)).toBe('Hello World');
  });

  it('handles text with no emoji', () => {
    const input = '# 标题\n\n正文内容';
    expect(removeEmoji(input)).toBe('# 标题\n\n正文内容');
  });
});
