import { runAgent, type AgentRunOptions } from './agentRuntime';
import { parseArticleAnalysis, parseLayoutAnalysis } from './agentValidation';
import type { ArticleStyleSpec, WritingDirection } from '@/types/article';

export async function analyzeViaAgent(content: string, conversationHistory: string, options: AgentRunOptions = {}): Promise<{
  spec: ArticleStyleSpec;
  directions: WritingDirection[];
}> {
  const buildPrompt = (retry: boolean) => [
    '分析以下素材的文体特征和读者需求，只输出纯 JSON（不要 markdown 代码块、不要解释）：',
    '{',
    '  "spec": {',
    '    "articleType": "用你自己的话描述这是什么类型的文章（如：活动通知、学术讲座回顾、人物访谈侧记、政策解读、招新启事等）",',
    '    "tone": "描述整体语气（如：正式庄重、亲切温暖、学术严谨、轻松活泼等）",',
    '    "structure": "推荐的文章结构（如：倒金字塔、时间线叙事、问题-方案-结论、三段式引入-展开-收尾等）",',
    '    "presentation": "推荐的呈现方式（如：图文叙事、数据驱动、故事引导、要点速览等）",',
    '    "keywords": ["从素材中提取3-5个核心关键词"],',
    '    "reasoning": "30字以内简述你的分析依据"',
    '  },',
    '  "directions": [',
    '    { "id": "d1", "name": "方向名（6字以内）", "angle": "切入角度（10字以内）", "structure": "结构", "tone": "语气", "features": ["特征1","特征2"], "whyFit": "为什么适合（15字以内）" },',
    '    { "id": "d2", "name": "方向名（6字以内）", "angle": "切入角度（10字以内）", "structure": "结构", "tone": "语气", "features": ["特征1","特征2"], "whyFit": "为什么适合（15字以内）" },',
    '    { "id": "d3", "name": "方向名（6字以内）", "angle": "切入角度（10字以内）", "structure": "结构", "tone": "语气", "features": ["特征1","特征2"], "whyFit": "为什么适合（15字以内）" }',
    '  ]',
    '}',
    '',
    '要求：3个方向必须各有侧重（如分别侧重信息传达、情感共鸣、行动号召），不可雷同。',
    retry ? '请确保输出有效的 JSON，不要遗漏任何字段。' : '',
    conversationHistory ? `\n对话历史：${conversationHistory}` : '',
    `\n素材：${content}`,
  ].filter(l => l !== '').join('\n');

  const result = await runAgent({
    ...options, maxTurns: 2,
    request: {
      messages: [
        { role: 'system', content: '你是一个文章分析器，根据素材判断文体特征和写作方向。只输出纯 JSON。' },
        { role: 'user', content: buildPrompt(false) },
      ],
      temperature: 0.3, purpose: 'general', maxTokens: 2048,
    },
    evaluate: raw => ({ value: parseArticleAnalysis(raw), done: true, feedback: '' }),
  });
  if (result.value) return result.value;
  throw new Error('文章分析结果格式无效，请重试');
}

export async function analyzeLayout(content: string, options: AgentRunOptions = {}) {
  const analysisPrompt = `分析以下文章，输出一个纯 JSON 对象（只输出 JSON，不要其他文字、不要问候、不要 markdown 代码块）：

{
  "spec": {
    "articleType": "文章类型",
    "emotionTone": "情感基调",
    "primaryColor": "#主色",
    "secondaryColor": "#辅色",
    "density": "装饰密度 sparse/normal/rich",
    "forbidden": ["禁止元素"],
    "keywords": ["关键词"],
    "reasoning": "分析理由"
  },
  "directions": [{ "id": "d1", "name": "方向名", "description": "描述", "features": [], "whyFit": "理由", "philosophy": "设计哲学" }]
}

输出3个差异化方向，配色贴合文章类型和情感基调。

文章内容：
${content}`;

  const result = await runAgent({
    ...options, maxTurns: 2,
    request: {
      messages: [
        { role: 'system', content: '你是排版风格分析器，只输出符合字段要求的 JSON 对象。' },
        { role: 'user', content: analysisPrompt },
      ],
      temperature: 0.3, purpose: 'general', maxTokens: 2048,
    },
    evaluate: raw => ({ value: parseLayoutAnalysis(raw), done: true, feedback: '' }),
  });
  if (!result.value) throw new Error('风格分析结果格式无效，请重试');
  return result.value;
}
