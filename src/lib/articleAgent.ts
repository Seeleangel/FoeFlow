import { callAI } from './ai';
import { searchArticleLibrary, formatArticleExamples } from './articleSearch';
import type { WritingDirection, ArticleReview, ArticleReviewDimension } from '@/types/article';
import { ARTICLE_AGENT_SYSTEM_PROMPT } from './promptStorage';
export { ARTICLE_AGENT_SYSTEM_PROMPT };

export interface ArticleAgentResult {
  article: string;
  review: ArticleReview;
  fixRounds: number;
}

const MAX_ROUNDS = 8;

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
    !/修改中|revising|需要调整|还需/i.test(selfReview)
  );
}

function parseScoreFromSelfReview(response: string): number | null {
  const match = response.match(/(\d+)\s*\/\s*50/);
  if (match) return parseInt(match[1], 10);
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
  const passed = isFinalOutput(response);
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
): Promise<ArticleAgentResult> {
  const examples = await searchArticleLibrary(articleContent);
  const exampleText = formatArticleExamples(examples);

  const systemPrompt = ARTICLE_AGENT_SYSTEM_PROMPT.replace(
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

  let article = '';
  let review: ArticleReview = buildReviewFromSelfReview('Agent 未返回内容');
  let fixRounds = 0;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let response: { content: string };
    try {
      response = await callAI({
        messages,
        temperature: 0.7,
        purpose: 'general',
      });
    } catch (err) {
      console.error('[articleAgent] callAI failed:', err);
      break;
    }

    const content = response.content;
    messages.push({ role: 'assistant', content });

    const extracted = extractArticleFromResponse(content);
    if (extracted) {
      article = extracted;
      review = buildReviewFromSelfReview(content);
    }

    if (isFinalOutput(content) && extracted) {
      break;
    }

    if (extracted && !isFinalOutput(content)) {
      fixRounds++;
      messages.push({
        role: 'user',
        content: '请继续完成你的工作。如果已经完成，请用"可以定稿"确认。',
      });
    } else if (!extracted) {
      messages.push({
        role: 'user',
        content: '请输出文章内容，以 # 标题开始。',
      });
    }
  }

  // Fallback: extract last assistant message with markdown
  if (!article) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === 'assistant' && m.content.includes('# ')) {
        article = extractArticleFromResponse(m.content);
        break;
      }
    }
    if (!article) {
      article = `# 文章生成\n\n未能成功生成文章，请重试。\n\n${articleContent}`;
    }
  }

  return { article, review, fixRounds };
}
