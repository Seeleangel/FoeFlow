import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayoutPipeline } from '@/hooks/useLayoutPipeline';
import { analyzeLayout } from '@/lib/analysisAgents';
import { runLayoutAgent, refineLayout } from '@/lib/layoutAgent';
import type { StyleSpec, LayoutDirection } from '@/types/layout';

vi.mock('@/lib/analysisAgents', () => ({ analyzeLayout: vi.fn() }));
vi.mock('@/lib/layoutAgent', () => ({ runLayoutAgent: vi.fn(), refineLayout: vi.fn() }));
const spec: StyleSpec = { articleType: '通知', emotionTone: '正式', primaryColor: '#123456', secondaryColor: '#ffffff', density: 'normal', forbidden: [], keywords: [], reasoning: '' };
const direction: LayoutDirection = { id: 'd1', name: '简洁', description: '简洁布局', features: [], whyFit: '', philosophy: '' };
const output = { html: '<section data-role="outer">新排版</section>', review: { dimensions: { readingExperience: 'pass' as const, visualStructure: 'pass' as const, memorability: 'pass' as const }, issues: [], passed: true, overallFeedback: '完成' }, fixRounds: 0 };

describe('layout run ownership', () => {
  beforeEach(() => { vi.resetAllMocks(); vi.mocked(analyzeLayout).mockResolvedValue({ spec, directions: [direction] }); });
  it('reset aborts generation and a late result cannot overwrite the preview', async () => {
    let resolve!: (value: typeof output) => void;
    vi.mocked(runLayoutAgent).mockImplementation(() => new Promise(r => { resolve = r; }));
    const generated = vi.fn();
    const { result } = renderHook(() => useLayoutPipeline({ onLayoutGenerated: generated }));
    await act(async () => { await result.current.handleLayoutAnalyze('文章'); });
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.handleDirectionSelect(direction, '文章'); });
    const signal = vi.mocked(runLayoutAgent).mock.calls[0][3]!.signal!;
    act(() => result.current.reset());
    expect(signal.aborted).toBe(true);
    await act(async () => { resolve(output); await pending; });
    expect(generated).not.toHaveBeenCalled();
    expect(result.current.layoutStage).toBeNull();
  });
  it('an older analysis does not clear a newer run or replace its spec', async () => {
    let resolve!: (value: { spec: StyleSpec; directions: LayoutDirection[] }) => void;
    vi.mocked(analyzeLayout).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const { result } = renderHook(() => useLayoutPipeline({ onLayoutGenerated: vi.fn() }));
    let old!: Promise<void>;
    act(() => { old = result.current.handleLayoutAnalyze('旧素材'); });
    await act(async () => { await result.current.handleLayoutAnalyze('新素材'); });
    await act(async () => { resolve({ spec: { ...spec, articleType: '旧类型' }, directions: [] }); await old; });
    expect(result.current.styleSpec?.articleType).toBe('通知');
    expect(result.current.layoutDirections).toHaveLength(1);
  });
  it('failed refinement preserves existing HTML and returns false', async () => {
    vi.mocked(refineLayout).mockResolvedValue({ ...output, html: '现有排版', review: { ...output.review, passed: false, overallFeedback: '精修失败' } });
    const generated = vi.fn(), error = vi.fn();
    const { result } = renderHook(() => useLayoutPipeline({ onLayoutGenerated: generated, onError: error }));
    await act(async () => { expect(await result.current.handleRefineLayout('现有排版', '反馈', spec, direction)).toBe(false); });
    expect(generated).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('精修失败');
  });
  it('unmount aborts a pending run', async () => {
    vi.mocked(runLayoutAgent).mockImplementation(() => new Promise(() => {}));
    const { result, unmount } = renderHook(() => useLayoutPipeline({ onLayoutGenerated: vi.fn() }));
    await act(async () => { await result.current.handleLayoutAnalyze('文章'); });
    act(() => { void result.current.handleDirectionSelect(direction, '文章'); });
    const signal = vi.mocked(runLayoutAgent).mock.calls[0][3]!.signal!;
    unmount();
    expect(signal.aborted).toBe(true);
  });
});
