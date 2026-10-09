import { useState, useCallback, useRef } from 'react';
import { runLayoutAgent, refineLayout } from '@/lib/layoutAgent';
import type { StyleSpec, LayoutDirection, LayoutStrategy } from '@/types/layout';
import { FALLBACK_STRATEGY } from '@/types/layout';

interface UseLayoutPipelineOptions {
  onLayoutGenerated: (html: string, strategy: LayoutStrategy, fixRounds: number) => void;
  onError?: (message: string) => void;
}

export function useLayoutPipeline(options: UseLayoutPipelineOptions) {
  const [layoutStage, setLayoutStage] = useState<string | null>(null);
  const [styleSpec, setStyleSpec] = useState<StyleSpec | null>(null);
  const [layoutDirections, setLayoutDirections] = useState<LayoutDirection[]>([]);
  const [selectedDirection, setSelectedDirection] = useState<LayoutDirection | null>(null);
  const [specLoading, setSpecLoading] = useState(false);
  const [layoutError, setLayoutError] = useState<string | null>(null);

  // Store callbacks in refs to avoid stale closures
  const onLayoutGeneratedRef = useRef(options.onLayoutGenerated);
  onLayoutGeneratedRef.current = options.onLayoutGenerated;
  const onErrorRef = useRef(options.onError);
  onErrorRef.current = options.onError;

  const reset = useCallback(() => {
    setLayoutStage(null);
    setStyleSpec(null);
    setLayoutDirections([]);
    setSelectedDirection(null);
    setSpecLoading(false);
    setLayoutError(null);
  }, []);

  const handleLayoutAnalyze = useCallback(async (content: string) => {
    setLayoutStage('analyzing');
    setStyleSpec(null);
    setLayoutDirections([]);
    setSelectedDirection(null);
    setSpecLoading(true);
    setLayoutError(null);

    try {
      const { callAI } = await import('@/lib/ai');

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

      const response = await callAI({
        messages: [
          { role: 'system', content: '你是一个排版风格分析器。你的唯一任务是分析文章内容，输出纯 JSON。不要问候、不要解释、不要 Markdown 代码块、不要其他任何文字。只输出 JSON 对象。' },
          { role: 'user', content: analysisPrompt },
        ],
        temperature: 0.3,
        purpose: 'general',
      });

      let cleaned = response.content.trim();
      cleaned = cleaned.replace(/\`\`\`json\s*/gi, '').replace(/\`\`\`\s*/g, '');
      const bracket = cleaned.indexOf('{');
      if (bracket > 0) cleaned = cleaned.substring(bracket);
      const lastBracket = cleaned.lastIndexOf('}');
      if (lastBracket > 0 && lastBracket < cleaned.length - 1) cleaned = cleaned.substring(0, lastBracket + 1);

      const parsed = JSON.parse(cleaned) as {
        spec: StyleSpec;
        directions: LayoutDirection[];
      };

      setStyleSpec(parsed.spec);
      setLayoutDirections(Array.isArray(parsed.directions) ? parsed.directions.slice(0, 3) : []);
      setSpecLoading(false);
      setLayoutStage(null);
    } catch (err) {
      console.error('[useLayoutPipeline] Error:', err);
      setLayoutError(err instanceof Error ? err.message : '风格分析失败');
      onErrorRef.current?.(err instanceof Error ? err.message : '风格分析失败');
      setSpecLoading(false);
      setLayoutStage(null);
    }
  }, []);

  const handleDirectionSelect = useCallback(async (direction: LayoutDirection, content: string) => {
    if (!styleSpec) return;
    setSelectedDirection(direction);
    setLayoutStage('generating');

    try {
      const result = await runLayoutAgent(content, styleSpec, direction);

      const strategy: LayoutStrategy = {
        articleType: styleSpec.articleType as typeof FALLBACK_STRATEGY.articleType,
        style: direction.name,
        density: styleSpec.density,
        colorScheme: {
          primary: styleSpec.primaryColor,
          secondary: styleSpec.secondaryColor,
          ...(styleSpec.accentColor ? { accent: styleSpec.accentColor } : {}),
        },
        layoutPattern: 'default',
        decorations: [],
      };

      onLayoutGeneratedRef.current(result.html, strategy, result.fixRounds);
      setLayoutStage('done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLayoutError(`排版失败：${msg}`);
      onErrorRef.current?.(`排版失败：${msg}`);
    }
  }, [styleSpec]);

  const handleRefineLayout = useCallback(async (
    currentHtml: string,
    feedback: string,
    overrideSpec?: StyleSpec,
    overrideDirection?: LayoutDirection,
  ) => {
    const spec = overrideSpec ?? styleSpec;
    const direction = overrideDirection ?? selectedDirection;
    if (!spec || !direction) {
      console.warn('[useLayoutPipeline] handleRefineLayout called without styleSpec or selectedDirection');
      return;
    }

    setLayoutStage('generating');
    setLayoutError(null);

    try {
      const result = await refineLayout(currentHtml, feedback, spec, direction);

      const strategy: LayoutStrategy = {
        articleType: spec.articleType as typeof FALLBACK_STRATEGY.articleType,
        style: direction.name,
        density: spec.density,
        colorScheme: {
          primary: spec.primaryColor,
          secondary: spec.secondaryColor,
          ...(spec.accentColor ? { accent: spec.accentColor } : {}),
        },
        layoutPattern: 'default',
        decorations: [],
      };

      onLayoutGeneratedRef.current(result.html, strategy, result.fixRounds);
      setLayoutStage('done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLayoutError(`精修失败：${msg}`);
      onErrorRef.current?.(`精修失败：${msg}`);
      setLayoutStage(null);
    }
  }, [styleSpec, selectedDirection]);

  return {
    layoutStage,
    styleSpec,
    layoutDirections,
    selectedDirection,
    specLoading,
    layoutError,
    pipelineSnapshot: null,
    setStyleSpec,
    setSelectedDirection,
    reset,
    handleLayoutAnalyze,
    handleDirectionSelect,
    handleRefineLayout,
  };
}
