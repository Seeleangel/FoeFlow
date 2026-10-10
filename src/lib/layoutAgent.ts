import { callAI } from './ai';
import { runAgent, abortable, isAbortError, throwIfAborted, type AgentRunOptions, type AgentTermination } from './agentRuntime';
import type { StyleSpec, LayoutDirection, LayoutReview, ReviewVerdict } from '@/types/layout';
import { loadPromptTemplates, LAYOUT_AGENT_SYSTEM_PROMPT } from './promptStorage';
import { PLACEHOLDER_IMG_DATA_URI } from './placeholders';
export { LAYOUT_AGENT_SYSTEM_PROMPT };

export interface LayoutAgentResult {
  html: string;
  review: LayoutReview;
  fixRounds: number;
  termination?: AgentTermination;
}

const MAX_RETRIES = 2;

function stripMarkdownFences(text: string): string {
  const fenced = text.match(/```(?:html|HTML)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  return text;
}

function extractHtmlFromResponse(response: string): string {
  const cleaned = stripMarkdownFences(response);

  let match = cleaned.match(/<section[\s\S]*<\/section>/i);
  if (match) return match[0];

  match = cleaned.match(/<div[^>]*data-role\s*=\s*"outer"[^>]*>[\s\S]*<\/div>/i);
  if (match) {
    console.warn('[layoutAgent] AI returned div[data-role="outer"] instead of <section>, accepting');
    return match[0];
  }

  return '';
}

/** Validate structure before a model-generated layout can replace the preview. */
export function validateLayoutHtml(html: string): string[] {
  if (!html.trim()) return ['未输出完整 HTML'];
  if (!/<(section|div)\b[^>]*data-role\s*=\s*["']outer["'][^>]*>/i.test(html)) return ['缺少 data-role="outer" 外层'];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root || doc.body.children.length !== 1 || root.getAttribute('data-role') !== 'outer') return ['必须为单一外层容器'];
  if (!new RegExp(`</${root.tagName}>\\s*$`, 'i').test(html)) return ['外层 HTML 未闭合'];
  const issues: string[] = [];
  if (doc.querySelector('script,iframe,object,embed,form,input,link,meta,foreignObject')) issues.push('包含不适用于文章排版的活动元素');
  for (const node of doc.querySelectorAll('*')) {
    for (const attr of node.attributes) {
      if (/^on/i.test(attr.name) || /(?:javascript|vbscript)\s*:/i.test(attr.value)) issues.push('包含事件处理或脚本地址');
    }
  }
  return [...new Set(issues)];
}

function parseVerdict(v: string): ReviewVerdict {
  const valid: ReviewVerdict[] = ['pass', 'warn', 'fail'];
  return valid.includes(v.toLowerCase() as ReviewVerdict) ? (v.toLowerCase() as ReviewVerdict) : 'warn';
}

function parseSelfReview(response: string): LayoutReview {
  response = response.split(/<(?:section|div)\b/i)[0];
  const readingMatch = response.match(/阅读体验[：:\s]*(pass|warn|fail)/i);
  const visualMatch = response.match(/视觉结构[：:\s]*(pass|warn|fail)/i);
  const memoryMatch = response.match(/记忆点[：:\s]*(pass|warn|fail)/i);

  const dims = {
    readingExperience: parseVerdict(readingMatch?.[1] || 'warn'),
    visualStructure: parseVerdict(visualMatch?.[1] || 'warn'),
    memorability: parseVerdict(memoryMatch?.[1] || 'warn'),
  };

  const allPass = Object.values(dims).every((v) => v === 'pass');

  return {
    dimensions: dims,
    issues: [],
    passed: allPass,
    overallFeedback: response.split('\n')[0] || '',
  };
}

function buildStylePrompt(spec: StyleSpec, direction: LayoutDirection): string {
  return [
    '## 风格规格',
    `- 文章类型：${spec.articleType}`,
    `- 情感基调：${spec.emotionTone}`,
    `- 主色：${spec.primaryColor}`,
    `- 辅色：${spec.secondaryColor}`,
    spec.accentColor ? `- 强调色：${spec.accentColor}` : '',
    `- 装饰密度：${spec.density}`,
    `- 关键词：${spec.keywords.join('、')}`,
    spec.forbidden.length > 0 ? `- 禁止：${spec.forbidden.join('、')}` : '',
    '',
    '## 排版方向',
    `- 名称：${direction.name}`,
    direction.description ? `- 描述：${direction.description}` : '',
    direction.philosophy ? `- 设计哲学：${direction.philosophy}` : '',
    direction.features.length > 0 ? `- 特征：${direction.features.join('、')}` : '',
  ].filter((l) => l !== '').join('\n');
}

export interface RunLayoutAgentOptions extends AgentRunOptions {
  skipAnalyze?: boolean;
}

export async function runLayoutAgent(
  articleContent: string,
  spec: StyleSpec,
  direction: LayoutDirection,
  options?: RunLayoutAgentOptions,
): Promise<LayoutAgentResult> {
  throwIfAborted(options?.signal);
  const templates = await abortable(loadPromptTemplates(), options?.signal);
  const styleBlock = buildStylePrompt(spec, direction);
  let styleAnalysis = '';
  if (!options?.skipAnalyze) {
    const analyzeResp = await abortable(callAI({
      messages: [
        { role: 'system', content: templates.layoutAnalyzePrompt },
        { role: 'user', content: `${styleBlock}\n\n## 文章内容\n${articleContent}` },
      ],
      temperature: 0.5, purpose: 'layoutAnalyze', signal: options?.signal,
    }), options?.signal);
    throwIfAborted(options?.signal);
    styleAnalysis = analyzeResp.content;
  }
  const userContent = [
    '请为以下文章生成完整排版 HTML。', styleBlock,
    styleAnalysis ? `## 风格分析\n${styleAnalysis}` : '',
    '## 文章内容', articleContent,
    '请输出自审结果和完整 HTML，以 <section data-role="outer"> 开始。',
  ].filter(Boolean).join('\n');
  const result = await runAgent<{ html: string; review: LayoutReview }>({
    ...options,
    maxTurns: MAX_RETRIES + 1,
    request: {
      messages: [
        { role: 'system', content: templates.layoutAgentPrompt },
        { role: 'user', content: userContent },
      ],
      temperature: 0.7, purpose: 'layoutGeneration',
    },
    evaluate: content => {
      const html = extractHtmlFromResponse(content);
      const problems = validateLayoutHtml(html);
      const review = parseSelfReview(content);
      return {
        value: problems.length ? undefined : { html, review },
        done: !problems.length && !Object.values(review.dimensions).includes('fail'),
        feedback: problems.length
          ? `HTML 检查发现：${problems.join('；')}。请修复并输出自审与完整 HTML。`
          : `上版自审：${review.overallFeedback}。请针对 fail 项修改，保留文章原文与其他样式，输出完整 HTML。`,
      };
    },
  });
  if (!result.value) throw new Error('未能生成有效排版，已保留现有内容，请重试');
  if (result.termination !== 'completed') {
    result.value.review.passed = false;
    result.value.review.overallFeedback = result.feedback || '自动修改达到轮次上限，请人工检查';
  }
  return {
    html: result.value.html.replace(/__PLACEHOLDER_IMG__/g, PLACEHOLDER_IMG_DATA_URI),
    review: result.value.review,
    fixRounds: Math.max(0, result.turns - 1),
    termination: result.termination,
  };
}

export async function refineLayout(
  currentHtml: string,
  feedback: string,
  spec: StyleSpec,
  direction: LayoutDirection,
  options: AgentRunOptions = {},
): Promise<LayoutAgentResult> {
  const styleBlock = buildStylePrompt(spec, direction);

  const userContent = [
    '## 任务：精修排版',
    '只修改用户提到的具体问题。保持其他部分完全不变。保持 HTML 结构和 class 命名不变。',
    '',
    styleBlock,
    '',
    '## 用户反馈',
    feedback,
    '',
    '## 当前排版 HTML',
    currentHtml,
    '',
    '请直接输出修改后的完整 HTML，以 <section data-role="outer"> 开始。',
  ].join('\n');

  try {
    const response = await callAI({
      messages: [
        {
          role: 'system',
          content: '你是一个排版精修助手。根据用户反馈定向修改排版 HTML。只改用户提到的部分，不动其他。',
        },
        { role: 'user', content: userContent },
      ],
      temperature: 0.3,
      purpose: 'layoutGeneration',
      signal: options.signal,
    });

    const extracted = extractHtmlFromResponse(response.content);
    throwIfAborted(options.signal);
    if (extracted && validateLayoutHtml(extracted).length === 0) {
      const cleaned = extracted.replace(/__PLACEHOLDER_IMG__/g, PLACEHOLDER_IMG_DATA_URI);
      return {
        html: cleaned,
        review: {
          dimensions: { readingExperience: 'warn', visualStructure: 'pass', memorability: 'warn' },
          issues: [],
          passed: false,
          overallFeedback: '局部精修已生成，请检查修改效果',
        },
        fixRounds: 0,
      };
    }
  } catch (err) {
    throwIfAborted(options.signal);
    if (isAbortError(err)) throw err;
    console.warn('[refineLayout] AI call failed:', err);
  }

  return {
    html: currentHtml,
    review: {
      dimensions: { readingExperience: 'warn', visualStructure: 'warn', memorability: 'warn' },
      issues: [{
        dimension: 'visualStructure',
        severity: 'important',
        message: '精修失败，保留原排版',
        fixHint: '请重试',
      }],
      passed: false,
      overallFeedback: '精修失败，保留原排版',
    },
    fixRounds: 0,
  };
}

export async function classifyFeedbackIntent(feedback: string, signal?: AbortSignal): Promise<'refine' | 'redo'> {
  try {
    const response = await callAI({
      messages: [
        {
          role: 'system',
          content: `你是一个意图分类器。分析用户对排版的不满反馈，判断属于"refine"还是"redo"。

- "refine"：用户提出了一个或多个具体问题（如颜色、字号、间距、某个元素的样式），可以局部修改解决
- "redo"：用户表达了整体不满（如"整个感觉不对"、"风格不合适"、"全都不满意"），需要重新设计

只输出 JSON：{"action":"refine"} 或 {"action":"redo"}`,
        },
        { role: 'user', content: feedback },
      ],
      temperature: 0.1,
      signal,
      purpose: 'general',
    });

    const cleaned = response.content.trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*"action"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.action === 'redo') return 'redo';
    }
    return 'refine';
  } catch (error) {
    throwIfAborted(signal);
    if (isAbortError(error)) throw error;
    return 'refine';
  }
}
