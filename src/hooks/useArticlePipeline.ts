import { useState, useCallback, useRef } from 'react';
import { runArticleAgent } from '@/lib/articleAgent';
import type { ArticleStyleSpec, WritingDirection, ArticleReview, ArticlePipelineStage } from '@/types/article';

interface UseArticlePipelineOptions {
  onArticleGenerated: (article: string, review: ArticleReview, fixRounds: number) => void;
  onError?: (message: string) => void;
}

/**
 * One-shot analysis via LLM: returns spec + 3 directions.
 * Tries up to 2 times with different temperatures before falling back to a minimal generic result.
 * NEVER throws.
 */
async function analyzeViaAgent(content: string, conversationHistory: string): Promise<{
  spec: ArticleStyleSpec;
  directions: WritingDirection[];
}> {
  const { callAI } = await import('@/lib/ai');

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

  // JSON parse helper — resilient to markdown fences and leading text
  const tryParse = (raw: string): { spec: ArticleStyleSpec; directions: WritingDirection[] } | null => {
    let text = raw.trim();
    text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first === -1 || last <= first) return null;
    try {
      const parsed = JSON.parse(text.substring(first, last + 1));
      const directions = Array.isArray(parsed.directions) ? parsed.directions.slice(0, 3) : [];
      if (directions.length === 0) return null;
      return {
        spec: parsed.spec && parsed.spec.articleType ? parsed.spec : null,
        directions,
      };
    } catch {
      return null;
    }
  };

  // --- Attempt 1: standard temperature ---
  try {
    const res1 = await callAI({
      messages: [
        { role: 'system', content: '你是一个文章分析器，根据素材自由判断文体特征和写作方向。只输出纯 JSON。' },
        { role: 'user', content: buildPrompt(false) },
      ],
      temperature: 0.4,
      purpose: 'general',
    });
    const result = tryParse(res1.content);
    if (result && result.spec) return result;
    console.warn('[analyzeViaAgent] First attempt returned invalid JSON, retrying...');
  } catch (err) {
    console.warn('[analyzeViaAgent] First attempt failed:', err);
  }

  // --- Attempt 2: lower temperature for reliability ---
  try {
    const res2 = await callAI({
      messages: [
        { role: 'system', content: '你是一个文章分析器。只输出纯 JSON，确保字段完整。' },
        { role: 'user', content: buildPrompt(true) },
      ],
      temperature: 0.2,
      purpose: 'general',
    });
    const result = tryParse(res2.content);
    if (result && result.spec) return result;
  } catch (err) {
    console.warn('[analyzeViaAgent] Second attempt failed:', err);
  }

  // --- Minimal fallback (should be rare) ---
  console.warn('[analyzeViaAgent] All attempts failed, using minimal fallback');
  const title = content.slice(0, 30).replace(/\n/g, ' ') || '素材';
  return {
    spec: {
      articleType: '综合',
      tone: '正式',
      structure: '总分总',
      presentation: '图文结合',
      keywords: [],
      reasoning: '自动分析失败，使用基础设置',
    },
    directions: [
      { id: 'd1', name: '直接呈现', angle: `围绕"${title}"展开`, structure: '总分总', tone: '正式', features: ['清晰直接'], whyFit: '适用于大多数场景' },
      { id: 'd2', name: '故事引入', angle: '从具体场景切入', structure: '故事线', tone: '亲切', features: ['有温度', '易共鸣'], whyFit: '拉近读者距离' },
      { id: 'd3', name: '观点引领', angle: '以核心观点开篇', structure: '倒金字塔', tone: '有力', features: ['观点鲜明', '信息密度高'], whyFit: '适合信息型内容' },
    ],
  };
}

export function useArticlePipeline(options: UseArticlePipelineOptions) {
  const [articleStage, setArticleStage] = useState<ArticlePipelineStage | null>(null);
  const [articleSpec, setArticleSpec] = useState<ArticleStyleSpec | null>(null);
  const [articleDirections, setArticleDirections] = useState<WritingDirection[]>([]);
  const [selectedArticleDirection, setSelectedArticleDirection] = useState<WritingDirection | null>(null);
  const [articleReview, setArticleReview] = useState<ArticleReview | null>(null);
  const [articleFixRounds, setArticleFixRounds] = useState(0);
  const [articlePipelineLoading, setArticlePipelineLoading] = useState(false);
  const [articleSourceContent, setArticleSourceContent] = useState('');

  // Store callbacks in refs to avoid stale closures
  const onArticleGeneratedRef = useRef(options.onArticleGenerated);
  onArticleGeneratedRef.current = options.onArticleGenerated;
  const onErrorRef = useRef(options.onError);
  onErrorRef.current = options.onError;

  const launchArticlePipeline = useCallback(async (
    content: string,
    conversationHistory: string,
  ) => {
    setArticleStage('analyzing');
    setArticleSpec(null);
    setArticleDirections([]);
    setSelectedArticleDirection(null);
    setArticleReview(null);
    setArticleFixRounds(0);
    setArticleSourceContent(content);
    setArticlePipelineLoading(true);

    try {
      const { spec, directions } = await analyzeViaAgent(content, conversationHistory);
      setArticleSpec(spec);
      if (directions.length === 0) {
        setArticleStage(null);
        return;
      }
      setArticleDirections(directions);
      setArticleStage('styleConfirm');
    } catch (err) {
      console.error('[useArticlePipeline] analyze error:', err);
      setArticleStage(null);
    } finally {
      setArticlePipelineLoading(false);
    }
  }, []);

  const handleArticleDirectionSelect = useCallback(async (
    direction: WritingDirection,
    conversationHistory: string,
  ) => {
    if (!articleSpec || articlePipelineLoading) return;
    setSelectedArticleDirection(direction);
    setArticleStage('generating');
    setArticlePipelineLoading(true);

    try {
      const result = await runArticleAgent(
        articleSourceContent,
        direction,
        conversationHistory,
      );

      setArticleReview(result.review);
      setArticleFixRounds(result.fixRounds);
      onArticleGeneratedRef.current(result.article, result.review, result.fixRounds);
      setArticleStage(null);
    } catch (err) {
      console.error('[useArticlePipeline] Pipeline error:', err);
      setArticleStage(null);
      onErrorRef.current?.('文章生成失败，请稍后重试');
    } finally {
      setArticlePipelineLoading(false);
    }
  }, [articleSpec, articleSourceContent, articlePipelineLoading]);

  const cancelArticlePipeline = useCallback(() => {
    setArticleStage(null);
    setArticleSpec(null);
    setArticleDirections([]);
    setSelectedArticleDirection(null);
    setArticleReview(null);
    setArticleFixRounds(0);
    setArticleSourceContent('');
    setArticlePipelineLoading(false);
  }, []);

  return {
    articleStage,
    setArticleStage,
    articleSpec,
    articleDirections,
    setArticleDirections,
    selectedArticleDirection,
    articleReview,
    articleFixRounds,
    articlePipelineLoading,
    articleSourceContent,
    launchArticlePipeline,
    handleArticleDirectionSelect,
    cancelArticlePipeline,
  };
}
