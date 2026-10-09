import { describe, it, expect, vi } from 'vitest';
import { detectWritingIntent } from '../../src/lib/intentDetector';
import { callAI } from '../../src/lib/ai';

vi.mock('../../src/lib/ai', () => ({
  callAI: vi.fn(),
}));

describe('detectWritingIntent', () => {
  it('returns generate_article for explicit article generation request', async () => {
    vi.mocked(callAI).mockResolvedValue({ content: 'generate_article' });
    const result = await detectWritingIntent('帮我写篇推文', '');
    expect(result).toBe('generate_article');
  });

  it('returns chat for revision request', async () => {
    vi.mocked(callAI).mockResolvedValue({ content: 'chat' });
    const result = await detectWritingIntent('把这段改短一点', '');
    expect(result).toBe('chat');
  });

  it('returns chat for casual question', async () => {
    vi.mocked(callAI).mockResolvedValue({ content: 'chat' });
    const result = await detectWritingIntent('你觉得这个选题怎么样', '');
    expect(result).toBe('chat');
  });

  it('fallbacks to chat on API error', async () => {
    vi.mocked(callAI).mockRejectedValue(new Error('API error'));
    const result = await detectWritingIntent('帮我写篇文章', '');
    expect(result).toBe('chat');
  });

  it('passes pipeline stage to prompt when provided', async () => {
    vi.mocked(callAI).mockClear();
    vi.mocked(callAI).mockResolvedValue({ content: 'chat' });
    await detectWritingIntent('把守夜人改成城市清洁工', '', 'styleConfirm');
    const lastCall = vi.mocked(callAI).mock.calls.at(-1);
    const prompt = lastCall![0].messages[0].content;
    expect(prompt).toContain('styleConfirm');
    expect(prompt).toContain('更可能是修改建议');
  });
});
