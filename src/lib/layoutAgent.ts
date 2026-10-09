import { callAI } from './ai';
import type { StyleSpec, LayoutDirection, LayoutReview, ReviewVerdict } from '@/types/layout';
import { LAYOUT_AGENT_SYSTEM_PROMPT, LAYOUT_ANALYZE_PROMPT } from './promptStorage';
import { PLACEHOLDER_IMG_DATA_URI } from './placeholders';
export { LAYOUT_AGENT_SYSTEM_PROMPT };

export interface LayoutAgentResult {
  html: string;
  review: LayoutReview;
  fixRounds: number;
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

  console.warn('[layoutAgent] extractHtmlFromResponse failed — preview (first 300 chars):',
    cleaned.substring(0, 300));
  return '';
}

function parseVerdict(v: string): ReviewVerdict {
  const valid: ReviewVerdict[] = ['pass', 'warn', 'fail'];
  return valid.includes(v as ReviewVerdict) ? (v as ReviewVerdict) : 'warn';
}

function parseSelfReview(response: string): LayoutReview {
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

export interface RunLayoutAgentOptions {
  skipAnalyze?: boolean;
}

export async function runLayoutAgent(
  articleContent: string,
  spec: StyleSpec,
  direction: LayoutDirection,
  options?: RunLayoutAgentOptions,
): Promise<LayoutAgentResult> {
  const styleBlock = buildStylePrompt(spec, direction);

  // ── Pass 1: Analyze ──
  let styleAnalysis = '';
  if (!options?.skipAnalyze) {
    console.log('[layoutAgent] Pass 1: Analyzing article style...');
    try {
      const analyzeResp = await callAI({
        messages: [
          { role: 'system', content: LAYOUT_ANALYZE_PROMPT },
          { role: 'user', content: `${styleBlock}\n\n## 文章内容\n${articleContent}` },
        ],
        temperature: 0.5,
        purpose: 'layoutAnalyze',
      });
      styleAnalysis = analyzeResp.content;
      console.log('[layoutAgent] Style analysis:', styleAnalysis.substring(0, 200));
    } catch (err) {
      console.warn('[layoutAgent] Analyze pass failed, continuing without analysis:', err);
    }
  }

  // ── Pass 2: Generate HTML (with retry) ──
  let html = '';
  let review: LayoutReview = {
    dimensions: { readingExperience: 'warn', visualStructure: 'warn', memorability: 'warn' },
    issues: [],
    passed: false,
    overallFeedback: 'Agent 未返回排版',
  };
  let fixRounds = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const userContent = [
      '请为以下文章生成完整排版 HTML。',
      '',
      styleBlock,
      '',
      styleAnalysis ? `## 风格分析\n${styleAnalysis}` : '',
      '',
      '## 文章内容',
      articleContent,
      '',
      '请直接输出完整 HTML，以 <section data-role="outer"> 开始。',
    ].filter((l) => l !== '').join('\n');

    try {
      const response = await callAI({
        messages: [
          { role: 'system', content: LAYOUT_AGENT_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        temperature: 0.7,
        purpose: 'layoutGeneration',
      });

      const content = response.content;
      const extracted = extractHtmlFromResponse(content);
      console.log(`[layoutAgent] Pass 2 attempt ${attempt + 1}: responseLen=${content.length}, extracted=${extracted.length > 0}`);

      if (extracted) {
        html = extracted;
        review = parseSelfReview(content);

        // If self-review passes or warns (not fail), accept it
        if (review.dimensions.readingExperience !== 'fail' &&
            review.dimensions.visualStructure !== 'fail') {
          console.log('[layoutAgent] Layout accepted — self-review:', review.overallFeedback);
          break;
        }

        // Self-review says fail — retry with feedback
        console.log('[layoutAgent] Self-review indicates fail, retrying...');
        fixRounds++;
        styleAnalysis = `上次自审反馈：${review.overallFeedback}\n请针对性地改进。`;
      } else {
        // No HTML extracted — retry
        console.warn('[layoutAgent] No HTML extracted, retrying...');
        fixRounds++;
        styleAnalysis = '上次未输出有效 HTML。请务必输出完整的 <section data-role="outer">...</section>。';
      }
    } catch (err) {
      console.error('[layoutAgent] Generation call failed:', err);
      fixRounds++;
    }
  }

  // Fallback if all attempts failed
  if (!html) {
    console.warn('[layoutAgent] All attempts failed, using fallback. articleContent preview:', articleContent.substring(0, 200));
    html = [
      '<section data-role="outer" style="width:100%;max-width:640px;margin:0 auto;padding:16px;box-sizing:border-box;">',
      `  <section style="border:2px solid ${spec.primaryColor};padding:20px;background:#fff;">`,
      `    <div style="font-size:15px;line-height:2;color:#333;">${articleContent.replace(/\n/g, '<br/>')}</div>`,
      '  </section>',
      '</section>',
    ].join('\n');

    review = {
      dimensions: { readingExperience: 'warn', visualStructure: 'warn', memorability: 'warn' },
      issues: [{
        dimension: 'visualStructure',
        severity: 'important',
        message: '排版 Agent 未能生成 HTML，使用降级排版',
        fixHint: '请重试',
      }],
      passed: false,
      overallFeedback: '排版失败，使用降级方案',
    };
  }

  html = html.replace(/__PLACEHOLDER_IMG__/g, PLACEHOLDER_IMG_DATA_URI);

  return { html, review, fixRounds };
}

export async function refineLayout(
  currentHtml: string,
  feedback: string,
  spec: StyleSpec,
  direction: LayoutDirection,
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
    });

    const extracted = extractHtmlFromResponse(response.content);
    if (extracted) {
      const cleaned = extracted.replace(/__PLACEHOLDER_IMG__/g, PLACEHOLDER_IMG_DATA_URI);
      return {
        html: cleaned,
        review: {
          dimensions: { readingExperience: 'pass', visualStructure: 'pass', memorability: 'warn' },
          issues: [],
          passed: true,
          overallFeedback: '局部精修完成',
        },
        fixRounds: 0,
      };
    }
  } catch (err) {
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

export async function classifyFeedbackIntent(feedback: string): Promise<'refine' | 'redo'> {
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
      purpose: 'general',
    });

    const cleaned = response.content.trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*"action"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.action === 'redo') return 'redo';
    }
    return 'refine';
  } catch {
    return 'refine';
  }
}
