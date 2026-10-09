import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as aiModule from '@/lib/ai';

vi.mock('@/lib/ai', () => ({
  callAI: vi.fn(),
}));

// Import agent after mocks are set up
import { runLayoutAgent, classifyFeedbackIntent, refineLayout } from '@/lib/layoutAgent';
import type { StyleSpec, LayoutDirection } from '@/types/layout';

const mockSpec: StyleSpec = {
  articleType: '活动通知',
  emotionTone: '正式庄重',
  primaryColor: '#8B1A1A',
  secondaryColor: '#D4A574',
  accentColor: '#2C3E50',
  density: 'normal',
  forbidden: [],
  keywords: ['教育', '学术论坛', '未来'],
  reasoning: '适合教育学部的正式通知风格',
};

const mockDirection: LayoutDirection = {
  id: 'dir-1',
  name: '学术严谨型',
  description: '采用简洁的学术风格排版',
  features: ['结构清晰', '装饰克制'],
  whyFit: '适合学术活动通知',
  philosophy: '少即是多，信息层级清晰',
};

const articleContent = '华东师范大学教育学部将于2026年5月15日举办"未来教育"学术论坛。欢迎各位师生参加。';

function finalResponse(html: string) {
  return `自审：阅读体验 pass / 视觉结构 pass / 记忆点 pass。排版完成，可以定稿。

${html}`;
}

function failResponse(html: string) {
  return `自审：阅读体验 warn / 视觉结构 fail / 记忆点 warn。需要修复。

${html}`;
}

const sampleHtml = `<section data-role="outer" style="width:100%;max-width:640px;margin:0 auto;">
  <section data-role="title" style="padding:20px;background:#8B1A1A;color:#fff;">
    <h1>未来教育学术论坛</h1>
  </section>
  <section style="padding:16px;background:#fff;">
    <p style="text-indent:2em;line-height:2;">华东师范大学教育学部将于2026年5月15日举办"未来教育"学术论坛。</p>
  </section>
</section>`;

const sampleHtmlV2 = `<section data-role="outer" style="width:100%;max-width:640px;margin:0 auto;">
  <section data-role="title" style="padding:24px;background:#8B1A1A;color:#fff;">
    <h1>未来教育学术论坛邀请函</h1>
  </section>
  <section style="padding:20px;background:#fafaf9;">
    <p style="text-indent:2em;line-height:2;">华东师范大学教育学部将于2026年5月15日举办"未来教育"学术论坛。欢迎各位师生参加。</p>
  </section>
</section>`;

const analyzeResponse = '本文为活动通知，建议三卡片结构：Banner突出标题和时间、正文卡片承载活动详情、结尾卡片呼吁报名。';

describe('runLayoutAgent', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // --- Test 1: Generates HTML after analyze + single generate ---
  it('generates HTML after analyze + single generate pass', async () => {
    vi.mocked(aiModule.callAI)
      .mockResolvedValueOnce({ content: analyzeResponse })   // analyze pass
      .mockResolvedValueOnce({ content: finalResponse(sampleHtml) }); // generate pass

    const result = await runLayoutAgent(articleContent, mockSpec, mockDirection);

    expect(result.html).toContain('<section data-role="outer"');
    expect(result.html).toContain('未来教育学术论坛');
    expect(result.review.passed).toBe(true);
    expect(result.review.dimensions.readingExperience).toBe('pass');
    expect(result.review.dimensions.visualStructure).toBe('pass');
    expect(result.review.dimensions.memorability).toBe('pass');
    expect(result.fixRounds).toBe(0);
    expect(aiModule.callAI).toHaveBeenCalledTimes(2); // analyze + generate
  });

  // --- Test 2: Retries when self-review finds issues ---
  it('retries when first generate has visual structure fail, then passes on retry', async () => {
    vi.mocked(aiModule.callAI)
      .mockResolvedValueOnce({ content: analyzeResponse })              // analyze
      .mockResolvedValueOnce({ content: failResponse(sampleHtml) })     // generate (fail)
      .mockResolvedValueOnce({ content: finalResponse(sampleHtmlV2) }); // retry (pass)

    const result = await runLayoutAgent(articleContent, mockSpec, mockDirection);

    expect(result.html).toContain('未来教育学术论坛邀请函');
    expect(result.review.passed).toBe(true);
    expect(result.review.dimensions.visualStructure).toBe('pass');
    expect(result.fixRounds).toBe(1);
    expect(aiModule.callAI).toHaveBeenCalledTimes(3); // analyze + 2 generates
  });

  // --- Test 3: Stops after MAX_RETRIES (2) ---
  it('stops after MAX_RETRIES when self-review always says fail', async () => {
    vi.mocked(aiModule.callAI)
      .mockResolvedValueOnce({ content: analyzeResponse })  // analyze
      .mockResolvedValue({ content: failResponse(sampleHtml) }); // all generates fail

    const result = await runLayoutAgent(articleContent, mockSpec, mockDirection);

    // analyze + 3 generates (initial + 2 retries) = 4 calls
    expect(aiModule.callAI).toHaveBeenCalledTimes(4);
    expect(result.fixRounds).toBe(3);
    expect(result.html).toContain('<section data-role="outer"');
    expect(result.review.passed).toBe(false);
  });

  // --- Test 4: Handles no HTML in response ---
  it('handles responses without <section> tags and falls back after retries', async () => {
    vi.mocked(aiModule.callAI)
      .mockResolvedValueOnce({ content: analyzeResponse })  // analyze
      .mockResolvedValue({ content: '自审：阅读体验 pass / 视觉结构 pass / 记忆点 pass。排版完成，可以定稿。\n\n这是一段没有HTML标签的普通文本。' });

    const result = await runLayoutAgent(articleContent, mockSpec, mockDirection);

    // Should fall back after retries
    expect(result.html).toBeDefined();
    expect(result.html.length).toBeGreaterThan(0);
    expect(result.html).toContain('data-role="outer"');
    expect(result.review.passed).toBe(false);
    expect(result.review.issues.length).toBeGreaterThan(0);
  });

  // --- Test 5: Parses self-review verdicts ---
  it('correctly parses 自审 verdicts from the response', async () => {
    vi.mocked(aiModule.callAI)
      .mockResolvedValueOnce({ content: analyzeResponse })  // analyze
      .mockResolvedValueOnce({
        content: `自审：阅读体验 pass / 视觉结构 fail / 记忆点 warn。需要修复。

${sampleHtml}`,
      });

    const result = await runLayoutAgent(articleContent, mockSpec, mockDirection);

    expect(result.review.dimensions.readingExperience).toBe('pass');
    expect(result.review.dimensions.visualStructure).toBe('fail');
    expect(result.review.dimensions.memorability).toBe('warn');
    expect(result.review.passed).toBe(false);
  });

  // --- Test 6: Includes spec and direction info in generate message ---
  it('includes spec colors, density, and direction name in generate user message', async () => {
    vi.mocked(aiModule.callAI)
      .mockResolvedValueOnce({ content: analyzeResponse })   // analyze
      .mockResolvedValueOnce({ content: finalResponse(sampleHtml) }); // generate

    await runLayoutAgent(articleContent, mockSpec, mockDirection);

    // Second call is the generate pass
    const callArgs = vi.mocked(aiModule.callAI).mock.calls[1][0];
    const userContent = callArgs.messages[1].content as string;
    expect(userContent).toContain(mockSpec.primaryColor);
    expect(userContent).toContain(mockSpec.secondaryColor);
    expect(userContent).toContain(mockSpec.accentColor!);
    expect(userContent).toContain(mockSpec.density);
    expect(userContent).toContain(mockDirection.name);
    expect(userContent).toContain(mockDirection.description);
    expect(userContent).toContain(mockDirection.philosophy!);
  });

  // --- Test 7: First call is layoutAnalyze, generate call is layoutGeneration ---
  it('uses layoutAnalyze for first pass and layoutGeneration for generate', async () => {
    vi.mocked(aiModule.callAI)
      .mockResolvedValueOnce({ content: analyzeResponse })
      .mockResolvedValueOnce({ content: finalResponse(sampleHtml) });

    await runLayoutAgent(articleContent, mockSpec, mockDirection);

    const analyzeCall = vi.mocked(aiModule.callAI).mock.calls[0][0];
    expect(analyzeCall.purpose).toBe('layoutAnalyze');

    const generateCall = vi.mocked(aiModule.callAI).mock.calls[1][0];
    expect(generateCall.purpose).toBe('layoutGeneration');
    expect(generateCall.temperature).toBe(0.7);
  });

  // --- Test 8: Handles API errors gracefully ---
  it('handles callAI errors gracefully and returns fallback HTML', async () => {
    vi.mocked(aiModule.callAI).mockRejectedValue(new Error('API timeout'));

    const result = await runLayoutAgent(articleContent, mockSpec, mockDirection);

    expect(result).toBeDefined();
    expect(result.html).toBeDefined();
    expect(result.html.length).toBeGreaterThan(0);
    expect(result.html).toContain('data-role="outer"');
    expect(result.review).toBeDefined();
    expect(result.review.passed).toBe(false);
  });

  // --- Test 9: Skips analyze pass when skipAnalyze is true ---
  it('skips the analyze pass and only runs generate when skipAnalyze is true', async () => {
    vi.mocked(aiModule.callAI)
      .mockResolvedValueOnce({ content: finalResponse(sampleHtml) }); // only generate

    const result = await runLayoutAgent(articleContent, mockSpec, mockDirection, { skipAnalyze: true });

    expect(result.html).toContain('<section data-role="outer"');
    expect(result.review.passed).toBe(true);
    expect(aiModule.callAI).toHaveBeenCalledTimes(1); // generate only, no analyze
    const generateCall = vi.mocked(aiModule.callAI).mock.calls[0][0];
    expect(generateCall.purpose).toBe('layoutGeneration');
  });
});

describe('classifyFeedbackIntent', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns "refine" when user mentions a specific issue like color', async () => {
    vi.mocked(aiModule.callAI).mockResolvedValueOnce({ content: '{"action":"refine"}' });

    const result = await classifyFeedbackIntent('标题颜色太暗了');

    expect(result).toBe('refine');
    expect(aiModule.callAI).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(aiModule.callAI).mock.calls[0][0];
    expect(callArgs.temperature).toBe(0.1);
    expect(callArgs.purpose).toBe('general');
    const userContent = callArgs.messages[1].content as string;
    expect(userContent).toContain('标题颜色太暗了');
  });

  it('returns "redo" when user expresses overall dissatisfaction', async () => {
    vi.mocked(aiModule.callAI).mockResolvedValueOnce({ content: '{"action":"redo"}' });

    const result = await classifyFeedbackIntent('整个感觉不对，换个风格吧');

    expect(result).toBe('redo');
  });

  it('handles malformed AI response and defaults to "refine"', async () => {
    vi.mocked(aiModule.callAI).mockResolvedValueOnce({ content: 'garbled response without json' });

    const result = await classifyFeedbackIntent('some feedback');

    expect(result).toBe('refine');
  });

  it('handles API error and defaults to "refine"', async () => {
    vi.mocked(aiModule.callAI).mockRejectedValueOnce(new Error('API timeout'));

    const result = await classifyFeedbackIntent('some feedback');

    expect(result).toBe('refine');
  });
});

describe('refineLayout', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const currentHtml = `<section data-role="outer" style="width:100%;max-width:640px;margin:0 auto;">
  <section data-role="title" style="padding:20px;background:#8B1A1A;color:#fff;">
    <h1>未来教育学术论坛</h1>
  </section>
  <section style="padding:16px;background:#fff;">
    <p style="text-indent:2em;line-height:2;color:#999;">欢迎各位师生参加。</p>
  </section>
</section>`;

  const feedbackText = '正文文字颜色太浅了，改成深色';

  it('sends current HTML and feedback to AI and returns modified HTML', async () => {
    const refinedHtml = currentHtml.replace('color:#999', 'color:#333');
    vi.mocked(aiModule.callAI).mockResolvedValueOnce({ content: refinedHtml });

    const result = await refineLayout(currentHtml, feedbackText, mockSpec, mockDirection);

    expect(result.html).toContain('color:#333');
    expect(result.html).toContain('<section data-role="outer"');
    expect(aiModule.callAI).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(aiModule.callAI).mock.calls[0][0];
    expect(callArgs.purpose).toBe('layoutGeneration');
    const userContent = callArgs.messages[1].content as string;
    expect(userContent).toContain(currentHtml);
    expect(userContent).toContain(feedbackText);
    expect(userContent).toContain('只修改用户提到的具体问题');
  });

  it('returns fallback HTML when AI returns empty response', async () => {
    vi.mocked(aiModule.callAI).mockResolvedValueOnce({ content: 'no html here' });

    const result = await refineLayout(currentHtml, feedbackText, mockSpec, mockDirection);

    expect(result.html).toBe(currentHtml);
    expect(result.review.passed).toBe(false);
  });

  it('handles API error and returns original HTML', async () => {
    vi.mocked(aiModule.callAI).mockRejectedValueOnce(new Error('API timeout'));

    const result = await refineLayout(currentHtml, feedbackText, mockSpec, mockDirection);

    expect(result.html).toBe(currentHtml);
    expect(result.review.passed).toBe(false);
  });
});
