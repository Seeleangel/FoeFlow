import { useState, useCallback, useRef } from 'react';
import { runLayoutAgent, refineLayout } from '@/lib/layoutAgent';
import { analyzeLayout } from '@/lib/analysisAgents';
import { isAbortError, type AgentEvent } from '@/lib/agentRuntime';
import { useAgentRun } from './useAgentRun';
import type { StyleSpec, LayoutDirection, LayoutStrategy, LayoutReview } from '@/types/layout';
import { FALLBACK_STRATEGY } from '@/types/layout';

interface UseLayoutPipelineOptions {
  onLayoutGenerated: (html: string, strategy: LayoutStrategy, fixRounds: number, review?: LayoutReview) => void;
  onError?: (message: string) => void;
}

function strategyFor(spec: StyleSpec, direction: LayoutDirection): LayoutStrategy {
  return {
    articleType: spec.articleType as typeof FALLBACK_STRATEGY.articleType,
    style: direction.name, density: spec.density,
    colorScheme: { primary: spec.primaryColor, secondary: spec.secondaryColor,
      ...(spec.accentColor ? { accent: spec.accentColor } : {}) },
    layoutPattern: 'default', decorations: [],
  };
}

export function useLayoutPipeline(options: UseLayoutPipelineOptions) {
  const { begin, cancel } = useAgentRun();
  const [layoutProgress, setLayoutProgress] = useState('');
  const [layoutStage, setLayoutStage] = useState<string | null>(null);
  const [styleSpec, setStyleSpec] = useState<StyleSpec | null>(null);
  const [layoutDirections, setLayoutDirections] = useState<LayoutDirection[]>([]);
  const [selectedDirection, setSelectedDirection] = useState<LayoutDirection | null>(null);
  const [specLoading, setSpecLoading] = useState(false);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const onLayoutGeneratedRef = useRef(options.onLayoutGenerated);
  onLayoutGeneratedRef.current = options.onLayoutGenerated;
  const onErrorRef = useRef(options.onError);
  onErrorRef.current = options.onError;

  const reset = useCallback(() => {
    cancel(); setLayoutProgress(''); setLayoutStage(null); setStyleSpec(null);
    setLayoutDirections([]); setSelectedDirection(null); setSpecLoading(false); setLayoutError(null);
  }, [cancel]);
  // Stop preserves the last completed preview and selected style.
  const cancelLayoutPipeline = useCallback(() => {
    cancel(); setLayoutProgress(''); setLayoutStage(null); setSpecLoading(false);
  }, [cancel]);

  const handleLayoutAnalyze = useCallback(async (content: string) => {
    const run = begin();
    setLayoutProgress('正在分析排版风格'); setLayoutStage('analyzing');
    setStyleSpec(null); setLayoutDirections([]); setSelectedDirection(null);
    setSpecLoading(true); setLayoutError(null);
    try {
      const parsed = await analyzeLayout(content, { signal: run.signal });
      if (!run.isCurrent()) return;
      setStyleSpec(parsed.spec); setLayoutDirections(parsed.directions);
    } catch (error) {
      if (!run.isCurrent() || isAbortError(error)) return;
      const message = error instanceof Error ? error.message : '风格分析失败';
      setLayoutError(message); onErrorRef.current?.(message);
    } finally {
      if (run.isCurrent()) { setSpecLoading(false); setLayoutStage(null); setLayoutProgress(''); run.finish(); }
    }
  }, [begin]);

  const handleDirectionSelect = useCallback(async (direction: LayoutDirection, content: string) => {
    if (!styleSpec) return false;
    const run = begin();
    setSelectedDirection(direction); setLayoutStage('generating'); setLayoutError(null);
    const onEvent = (event: AgentEvent) => { if (run.isCurrent()) setLayoutProgress(event.message); };
    try {
      const result = await runLayoutAgent(content, styleSpec, direction, { signal: run.signal, onEvent });
      if (!run.isCurrent()) return false;
      onLayoutGeneratedRef.current(result.html, strategyFor(styleSpec, direction), result.fixRounds, result.review);
      setLayoutStage('done');
      return true;
    } catch (error) {
      if (!run.isCurrent() || isAbortError(error)) return false;
      const message = `排版失败：${error instanceof Error ? error.message : String(error)}`;
      setLayoutError(message); onErrorRef.current?.(message); setLayoutStage(null);
      return false;
    } finally {
      if (run.isCurrent()) { setLayoutProgress(''); run.finish(); }
    }
  }, [begin, styleSpec]);

  const handleRefineLayout = useCallback(async (
    currentHtml: string, feedback: string, overrideSpec?: StyleSpec, overrideDirection?: LayoutDirection,
  ) => {
    const spec = overrideSpec ?? styleSpec, direction = overrideDirection ?? selectedDirection;
    if (!spec || !direction) return false;
    const run = begin();
    setLayoutStage('generating'); setLayoutProgress('正在修改排版'); setLayoutError(null);
    try {
      const result = await refineLayout(currentHtml, feedback, spec, direction, { signal: run.signal });
      if (!run.isCurrent()) return false;
      if (result.html === currentHtml) {
        setLayoutError(result.review.overallFeedback); onErrorRef.current?.(result.review.overallFeedback);
        setLayoutStage(null); return false;
      }
      onLayoutGeneratedRef.current(result.html, strategyFor(spec, direction), result.fixRounds, result.review);
      setLayoutStage('done'); return true;
    } catch (error) {
      if (!run.isCurrent() || isAbortError(error)) return false;
      const message = `精修失败：${error instanceof Error ? error.message : String(error)}`;
      setLayoutError(message); onErrorRef.current?.(message); setLayoutStage(null); return false;
    } finally {
      if (run.isCurrent()) { setLayoutProgress(''); run.finish(); }
    }
  }, [begin, styleSpec, selectedDirection]);

  return {
    layoutStage, layoutProgress, styleSpec, layoutDirections, selectedDirection, specLoading, layoutError,
    pipelineSnapshot: null, setStyleSpec, setSelectedDirection, reset, cancelLayoutPipeline,
    handleLayoutAnalyze, handleDirectionSelect, handleRefineLayout,
  };
}
