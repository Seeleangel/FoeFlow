import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as aiModule from '@/lib/ai';
import * as articleSearchModule from '@/lib/articleSearch';

vi.mock('@/lib/ai', () => ({
  callAI: vi.fn(),
}));

vi.mock('@/lib/articleSearch', () => ({
  searchArticleLibrary: vi.fn(),
  formatArticleExamples: vi.fn(),
}));

// We import the agent after mocks are set up
import { runArticleAgent } from '@/lib/articleAgent';

const mockDirection = {
  id: 'dir-1',
  name: '稳妥保守型',
  angle: '正面直叙',
  structure: '总分总',
  tone: '正式庄重',
  features: ['结构清晰', '逻辑严密'],
  whyFit: '适合正式场合',
};

const articleContent = '华东师范大学教育学部将于2026年5月15日举办"未来教育"学术论坛。';

/** Helper to create a "final" assistant response with article and self-review */
function finalResponse(title: string, body: string) {
  return `本文结构清晰，信息准确，42/50分，可以定稿。

# ${title}

${body}`;
}

/** Helper to create a "revising" assistant response with article and self-review */
function revisingResponse(title: string, body: string) {
  return `XX部分需要调整，正在修改。

# ${title}

${body}`;
}

describe('runArticleAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mocks: article search returns examples
    vi.mocked(articleSearchModule.searchArticleLibrary).mockResolvedValue([
      { title: '示例范文', snippet: '这是一篇范文的摘要...' },
    ]);
    vi.mocked(articleSearchModule.formatArticleExamples).mockReturnValue(
      '1. 【示例范文】\n   这是一篇范文的摘要......',
    );
  });

  // --- Test 1: Agent completes with article output ---
  it('completes with article output when self-review says 可以定稿', async () => {
    vi.mocked(aiModule.callAI).mockResolvedValueOnce({
      content: finalResponse('未来教育学术论坛即将举办', '## 论坛详情\n\n论坛将于5月15日举行。'),
    });

    const result = await runArticleAgent(articleContent, mockDirection, '');

    expect(result.article).toContain('# 未来教育学术论坛即将举办');
    expect(result.article).toContain('论坛将于5月15日举行');
    expect(result.review.passed).toBe(true);
    expect(result.fixRounds).toBe(0);
    expect(aiModule.callAI).toHaveBeenCalledTimes(1);
    expect(articleSearchModule.searchArticleLibrary).toHaveBeenCalledWith(articleContent);
  });

  // --- Test 2: Agent iterates when self-review shows issues ---
  it('iterates when first output says 需要调整, then completes on 可以定稿', async () => {
    vi.mocked(aiModule.callAI)
      .mockResolvedValueOnce({
        content: revisingResponse('未来教育论坛通知', '## 第一版\n\n内容需要改进...'),
      })
      .mockResolvedValueOnce({
        content: finalResponse('未来教育学术论坛邀请函', '## 第二版\n\n修改后的内容，更加完整。'),
      });

    const result = await runArticleAgent(articleContent, mockDirection, '');

    expect(result.article).toContain('# 未来教育学术论坛邀请函');
    expect(result.review.passed).toBe(true);
    expect(result.fixRounds).toBe(1);
    expect(aiModule.callAI).toHaveBeenCalledTimes(2);
  });

  // --- Test 3: Agent stops after 8 rounds maximum ---
  it('stops after 8 rounds even if always says 需要修改', async () => {
    vi.mocked(aiModule.callAI).mockResolvedValue({
      content: '需要修改，正在调整。\n\n# 第N版文章\n\n文章内容...',
    });

    const result = await runArticleAgent(articleContent, mockDirection, '');

    // Should have called exactly 8 times (MAX_ROUNDS)
    expect(aiModule.callAI).toHaveBeenCalledTimes(8);
    expect(result.fixRounds).toBe(8);
    // Should still extract the article even though not "final"
    expect(result.article).toContain('# 第N版文章');
  });

  // --- Test 4: Agent handles missing markdown headers ---
  it('handles responses without markdown headers', async () => {
    vi.mocked(aiModule.callAI).mockResolvedValueOnce({
      content: '可以定稿，本文已经完成。\n\n这里是正文内容，但没有markdown标题。',
    });

    const result = await runArticleAgent(articleContent, mockDirection, '');

    // Should still return something
    expect(result.article).toBeDefined();
    expect(result.article.length).toBeGreaterThan(0);
  });

  // --- Test 5: Agent handles AI errors gracefully ---
  it('handles AI errors gracefully', async () => {
    vi.mocked(aiModule.callAI).mockRejectedValue(new Error('API timeout'));

    // Should not throw
    const result = await runArticleAgent(articleContent, mockDirection, '');

    expect(result).toBeDefined();
    expect(result.article).toBeDefined();
    expect(result.article.length).toBeGreaterThan(0);
    expect(result.review).toBeDefined();
  });

  // --- Test 6: Extracts article from last assistant message when loop exceeds ---
  it('includes conversation history in the user message', async () => {
    vi.mocked(aiModule.callAI).mockResolvedValueOnce({
      content: finalResponse('测试标题', '测试正文。'),
    });

    const history = '用户之前讨论了活动主题和受众。';
    await runArticleAgent(articleContent, mockDirection, history);

    const callArgs = vi.mocked(aiModule.callAI).mock.calls[0][0];
    expect(callArgs.messages[1].content).toContain(history);
    expect(callArgs.messages[1].content).toContain('用户素材');
  });

  // --- Test 7: Builds review with score parsing ---
  it('parses self-review score and builds review correctly', async () => {
    vi.mocked(aiModule.callAI).mockResolvedValueOnce({
      content: '本文各项指标达标，45/50分，可以定稿。\n\n# 优秀文章\n\n正文内容。',
    });

    const result = await runArticleAgent(articleContent, mockDirection, '');

    expect(result.review.passed).toBe(true);
    expect(result.review.dimensions.structureClarity.score).toBe(9); // 45/5 = 9
    expect(result.review.dimensions.infoAccuracy.maxScore).toBe(10);
    expect(result.review.issues).toHaveLength(0);
  });

  // --- Test 8: Builds review with issues when not passed ---
  it('builds review with fallback scores when self-review is negative', async () => {
    vi.mocked(aiModule.callAI).mockResolvedValueOnce({
      content: '需要调整，信息不够完整，30/50分。\n\n# 草稿文章\n\n内容。',
    });

    const result = await runArticleAgent(articleContent, mockDirection, '');

    expect(result.review.passed).toBe(false);
    expect(result.review.issues.length).toBeGreaterThan(0);
    expect(result.review.issues[0].severity).toBe('minor');
    expect(result.review.dimensions.structureClarity.score).toBe(6); // 30/5 = 6
  });

  // --- Test 9: Uses the generated purpose parameter ---
  it('passes purpose: general to callAI', async () => {
    vi.mocked(aiModule.callAI).mockResolvedValueOnce({
      content: finalResponse('标题', '正文'),
    });

    await runArticleAgent(articleContent, mockDirection, '');

    const callArgs = vi.mocked(aiModule.callAI).mock.calls[0][0];
    expect(callArgs.purpose).toBe('general');
    expect(callArgs.temperature).toBe(0.7);
  });

  // --- Test 10: Uses system prompt with examples ---
  it('includes retrieved examples in the system prompt', async () => {
    vi.mocked(articleSearchModule.formatArticleExamples).mockReturnValue(
      '1. 【活动通知范文】\n   这是一篇活动通知的摘要...',
    );
    vi.mocked(aiModule.callAI).mockResolvedValueOnce({
      content: finalResponse('标题', '正文'),
    });

    await runArticleAgent(articleContent, mockDirection, '');

    const callArgs = vi.mocked(aiModule.callAI).mock.calls[0][0];
    expect(callArgs.messages[0].role).toBe('system');
    expect(callArgs.messages[0].content).toContain('活动通知范文');
  });

  // --- Test 11: Merges direction info into user message ---
  it('includes direction name, angle, structure, and tone in user message', async () => {
    vi.mocked(aiModule.callAI).mockResolvedValueOnce({
      content: finalResponse('标题', '正文'),
    });

    await runArticleAgent(articleContent, mockDirection, '');

    const callArgs = vi.mocked(aiModule.callAI).mock.calls[0][0];
    const userContent = callArgs.messages[1].content;
    expect(userContent).toContain(mockDirection.name);
    expect(userContent).toContain(mockDirection.angle);
    expect(userContent).toContain(mockDirection.structure);
    expect(userContent).toContain(mockDirection.tone);
  });
});
