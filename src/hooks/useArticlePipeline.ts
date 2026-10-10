import { useState, useCallback, useRef } from 'react';
import { isAbortError } from '@/lib/agentRuntime';
import { runArticleAgent } from '@/lib/articleAgent';
import type { ArticleStyleSpec, WritingDirection, ArticleReview, ArticlePipelineStage } from '@/types/article';

interface UseArticlePipelineOptions {
  onArticleGenerated: (article: string, review: ArticleReview, fixRounds: number) => void;
  onError?: (message: string) => void;
}

import { analyzeViaAgent } from '@/lib/analysisAgents';
import { useAgentRun } from './useAgentRun';

export function useArticlePipeline(options: UseArticlePipelineOptions) {
  const { begin, cancel } = useAgentRun();
  const [articleProgress, setArticleProgress] = useState('');
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
    const run = begin();
    setArticleProgress('正在分析素材');
    setArticleStage('analyzing');
    setArticleSpec(null);
    setArticleDirections([]);
    setSelectedArticleDirection(null);
    setArticleReview(null);
    setArticleFixRounds(0);
    setArticleSourceContent(content);
    setArticlePipelineLoading(true);

    try {
      const { spec, directions } = await analyzeViaAgent(content, conversationHistory, { signal: run.signal });
      if (!run.isCurrent()) return;
      setArticleSpec(spec);
      if (directions.length === 0) {
        setArticleStage(null);
        return;
      }
      setArticleDirections(directions);
      setArticleStage('styleConfirm');
    } catch (err) {
      if (!run.isCurrent() || isAbortError(err)) return;
      onErrorRef.current?.(err instanceof Error ? err.message : '素材分析失败');
      setArticleStage(null);
    } finally {
      if (run.isCurrent()) { setArticlePipelineLoading(false); setArticleProgress(''); run.finish(); }
    }
  }, [begin]);

  const handleArticleDirectionSelect = useCallback(async (
    direction: WritingDirection,
    conversationHistory: string,
  ) => {
    if (!articleSpec || articlePipelineLoading) return;
    const run = begin();
    setSelectedArticleDirection(direction);
    setArticleStage('generating');
    setArticlePipelineLoading(true);

    try {
      const result = await runArticleAgent(
        articleSourceContent,
        direction,
        conversationHistory,
        { signal: run.signal, onEvent: event => {
          if (!run.isCurrent()) return;
          setArticleProgress(event.message);
          if (event.type === 'turn') {
            setArticleStage(event.turn > 1 ? 'fixing' : 'generating');
            setArticleFixRounds(Math.max(0, event.turn - 1));
          }
        } },
      );
      if (!run.isCurrent()) return;

      setArticleReview(result.review);
      setArticleFixRounds(result.fixRounds);
      onArticleGeneratedRef.current(result.article, result.review, result.fixRounds);
      setArticleStage(null);
    } catch (err) {
      if (!run.isCurrent() || isAbortError(err)) return;
      setArticleStage(null);
      onErrorRef.current?.('文章生成失败，请稍后重试');
    } finally {
      if (run.isCurrent()) { setArticlePipelineLoading(false); setArticleProgress(''); run.finish(); }
    }
  }, [begin, articleSpec, articleSourceContent, articlePipelineLoading]);

  const cancelArticlePipeline = useCallback(() => {
    cancel();
    setArticleProgress('');
    setArticleStage(null);
    setArticleSpec(null);
    setArticleDirections([]);
    setSelectedArticleDirection(null);
    setArticleReview(null);
    setArticleFixRounds(0);
    setArticleSourceContent('');
    setArticlePipelineLoading(false);
  }, [cancel]);

  return {
    articleProgress,
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
