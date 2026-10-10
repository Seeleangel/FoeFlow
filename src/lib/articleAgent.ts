import { runAgent, abortable, throwIfAborted, type AgentRunOptions, type AgentTermination } from './agentRuntime';
import { searchArticleLibrary, formatArticleExamples } from './articleSearch';
import type { WritingDirection, ArticleReview, ArticleReviewDimension } from '@/types/article';
import { loadPromptTemplates, ARTICLE_AGENT_SYSTEM_PROMPT } from './promptStorage';
export { ARTICLE_AGENT_SYSTEM_PROMPT };

export interface ArticleAgentResult {
  article: string;
  review: ArticleReview;
  fixRounds: number;
  termination: AgentTermination;
}

const MAX_ROUNDS = 4;

function extractArticleFromResponse(response: string): string {
  const lines = response.split('\n');
  const markdownStart = lines.findIndex((l) => l.startsWith('# '));
  if (markdownStart >= 0) {
    return lines.slice(markdownStart).join('\n').trim();
  }
  return '';
}

function isFinalOutput(response: string): boolean {
  const selfReview = response.split('\n')[0] || '';
  return (
    /可以定稿|定稿|完成|通过/i.test(selfReview) &&
    !/修改中|revising|需要(?:调整|修改|修复)|还需|不(?:能|可|通过)|未(?:能)?(?:完成|通过|达标)|待(?:修改|调整)/i.test(selfReview)
  );
}

function parseScoreFromSelfReview(response: string): number | null {
  const match = response.match(/(\d+)\s*\/\s*50/);
  if (match) return Math.max(0, Math.min(50, parseInt(match[1], 10)));
  return null;
}

function makeDim(score: number, passed: boolean): ArticleReviewDimension {
  return {
    score: Math.round(score / 5),
    maxScore: 10,
    feedback: passed ? '达标' : '需改进',
  };
}

function buildReviewFromSelfReview(response: string): ArticleReview {
  const score = parseScoreFromSelfReview(response);
  const passed = isFinalOutput(response) && (score ?? 40) >= 38;
  const totalScore = score ?? (passed ? 40 : 25);

  return {
    dimensions: {
      structureClarity: makeDim(totalScore, passed),
      infoAccuracy: makeDim(totalScore, passed),
      toneConsistency: makeDim(totalScore, passed),
      mobileReadability: makeDim(totalScore, passed),
      audienceImpact: makeDim(totalScore, passed),
    },
    totalScore,
    issues: passed
      ? []
      : [
        {
          dimension: 'structureClarity',
          severity: 'minor' as const,
          message: 'Agent 自审认为还需改进',
          fixHint: '',
        },
      ],
    passed,
    overallFeedback: response.split('\n')[0] || '',
  };
}

export async function runArticleAgent(
  articleContent: string,
  direction: WritingDirection,
  conversationHistory: string,
  options: AgentRunOptions = {},
): Promise<ArticleAgentResult> {
  throwIfAborted(options.signal);
  const examples = await abortable(searchArticleLibrary(articleContent), options.signal);
  const templates = await abortable(loadPromptTemplates(), options.signal);
  const exampleText = formatArticleExamples(examples);

  const systemPrompt = templates.articleAgentPrompt.replace(
    '{retrievedExamples}',
    exampleText,
  );

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        '请根据以下素材撰写一篇公众号推文。',
        '',
        '## 写作方向',
        `- 名称：${direction.name}`,
        direction.angle ? `- 角度：${direction.angle}` : '',
        direction.structure ? `- 结构：${direction.structure}` : '',
        direction.tone ? `- 语调：${direction.tone}` : '',
        '',
        conversationHistory ? `## 对话历史\n${conversationHistory}\n` : '',
        '## 用户素材',
        articleContent,
        '',
        '请开始你的工作流程：先分析素材，然后逐步执行。',
      ]
        .filter((l) => l !== '')
        .join('\n'),
    },
  ];

  const result = await runAgent<{ article: string; review: ArticleReview }>({
    ...options,
    maxTurns: MAX_ROUNDS,
    request: { messages, temperature: 0.7, purpose: 'general', maxTokens: 8192 },
    evaluate: content => {
      const article = extractArticleFromResponse(content);
      const review = buildReviewFromSelfReview(content);
      const passed = review.passed && (parseScoreFromSelfReview(content) ?? 40) >= 38;
      review.passed = passed;
      return {
        value: article ? { article, review } : undefined,
        done: !!article && passed,
        feedback: article
          ? `上版自审：${review.overallFeedback}。请针对未达标之处修改，保留原始素材中的事实；输出一句自评和以 # 标题开始的完整正文。`
          : '未找到文章主标题。请输出一句自评，然后输出以 # 标题开始的完整 Markdown 正文。',
      };
    },
  });
  if (!result.value) throw new Error('未能生成有效文章，请检查 API 配置或素材后重试');
  if (result.termination !== 'completed') {
    result.value.review.passed = false;
    result.value.review.overallFeedback = result.feedback || '自动修改达到轮次上限，请人工检查';
  }
  return { ...result.value, fixRounds: Math.max(0, result.turns - 1), termination: result.termination };
}
