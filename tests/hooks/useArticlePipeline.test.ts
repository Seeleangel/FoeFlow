import { renderHook, act } from '@testing-library/react'
import { describe, expect, test, vi, beforeEach } from 'vitest'
import { useArticlePipeline } from '../../src/hooks/useArticlePipeline'

const mockedCallAI = vi.fn().mockResolvedValue({
  content: JSON.stringify({
    spec: {
      articleType: '新闻稿',
      tone: '正式',
      structure: '总分总',
      presentation: '图文结合',
      keywords: ['新闻', '正式'],
      reasoning: '测试分析',
    },
    directions: [
      { id: 'dir1', name: '方向1', angle: '角度1', structure: '结构1', tone: '正式' },
      { id: 'dir2', name: '方向2', angle: '角度2', structure: '结构2', tone: '亲切' },
      { id: 'dir3', name: '方向3', angle: '角度3', structure: '结构3', tone: '温暖' },
    ],
  }),
})

const mockedRunAgent = vi.fn().mockResolvedValue({
  article: '# 测试文章\n\n正文内容',
  review: { issues: [], passed: true, overallFeedback: 'Good' },
  fixRounds: 0,
})

vi.mock('@/lib/ai', () => ({
  callAI: (...args: unknown[]) => mockedCallAI(...args),
}))

vi.mock('@/lib/articleAgent', () => ({
  runArticleAgent: (...args: unknown[]) => mockedRunAgent(...args),
  ARTICLE_AGENT_SYSTEM_PROMPT: 'mock system prompt',
}))

describe('useArticlePipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('initial state is null/empty', () => {
    const onGenerated = vi.fn()
    const { result } = renderHook(() => useArticlePipeline({ onArticleGenerated: onGenerated }))

    expect(result.current.articleStage).toBeNull()
    expect(result.current.articleSpec).toBeNull()
    expect(result.current.articleDirections).toEqual([])
    expect(result.current.articlePipelineLoading).toBe(false)
  })

  test('launchArticlePipeline sets stage to styleConfirm with spec and directions', async () => {
    const onGenerated = vi.fn()
    const { result } = renderHook(() => useArticlePipeline({ onArticleGenerated: onGenerated }))

    await act(async () => {
      await result.current.launchArticlePipeline('测试内容', '对话历史')
    })

    expect(result.current.articleStage).toBe('styleConfirm')
    expect(result.current.articleSpec).not.toBeNull()
    expect(result.current.articleDirections).toHaveLength(3)
  })

  test('launchArticlePipeline repairs an empty directions array before publishing', async () => {
    mockedCallAI.mockResolvedValueOnce({
      content: JSON.stringify({
        spec: { articleType: '新闻稿', tone: '正式', structure: '总分总', presentation: '图文结合', keywords: [], reasoning: '' },
        directions: [],
      }),
    })
    const onGenerated = vi.fn()
    const { result } = renderHook(() => useArticlePipeline({ onArticleGenerated: onGenerated }))

    await act(async () => {
      await result.current.launchArticlePipeline('测试内容', '对话历史')
    })

    // The second validated response repairs the first invalid result.
    expect(result.current.articleStage).toBe('styleConfirm')
    expect(result.current.articleDirections.length).toBeGreaterThan(0)
  })

  test('cancelArticlePipeline resets all state', async () => {
    const onGenerated = vi.fn()
    const { result } = renderHook(() => useArticlePipeline({ onArticleGenerated: onGenerated }))

    await act(async () => {
      await result.current.launchArticlePipeline('测试内容', '历史')
    })

    act(() => {
      result.current.cancelArticlePipeline()
    })

    expect(result.current.articleStage).toBeNull()
    expect(result.current.articleSpec).toBeNull()
  })

  test('calls onError when handleArticleDirectionSelect fails', async () => {
    mockedRunAgent.mockRejectedValueOnce(new Error('agent error'))
    const onGenerated = vi.fn()
    const onError = vi.fn()
    const { result } = renderHook(() =>
      useArticlePipeline({ onArticleGenerated: onGenerated, onError })
    )

    await act(async () => {
      await result.current.launchArticlePipeline('测试内容', '历史')
    })

    await act(async () => {
      await result.current.handleArticleDirectionSelect(
        { id: 'dir1', name: '方向1', angle: '角度1', structure: '结构1', tone: '正式' },
        '对话历史'
      )
    })

    expect(onError).toHaveBeenCalledWith('文章生成失败，请稍后重试')
  })

  test('uses latest onArticleGenerated callback via ref', async () => {
    const onGenerated1 = vi.fn()
    const onGenerated2 = vi.fn()
    const { result, rerender } = renderHook(
      ({ cb }) => useArticlePipeline({ onArticleGenerated: cb }),
      { initialProps: { cb: onGenerated1 } }
    )

    await act(async () => {
      await result.current.launchArticlePipeline('测试内容', '历史')
    })

    // Switch to second callback before agent runs
    rerender({ cb: onGenerated2 })

    await act(async () => {
      await result.current.handleArticleDirectionSelect(
        { id: 'dir1', name: '方向1', angle: '角度1', structure: '结构1', tone: '正式' },
        '对话历史'
      )
    })

    expect(onGenerated1).not.toHaveBeenCalled()
    expect(onGenerated2).toHaveBeenCalledWith('# 测试文章\n\n正文内容', expect.anything(), 0)
  })

  test('cancelled analysis cannot resurrect its style panel after a late response', async () => {
    let resolve!: (value: { content: string }) => void
    mockedCallAI.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const { result } = renderHook(() => useArticlePipeline({ onArticleGenerated: vi.fn() }))
    let pending!: Promise<void>
    act(() => { pending = result.current.launchArticlePipeline('旧素材', '历史') })
    act(() => result.current.cancelArticlePipeline())
    await act(async () => { await pending })
    await act(async () => { resolve({ content: '{}' }); await Promise.resolve() })
    expect(result.current.articleStage).toBeNull()
    expect(result.current.articleSpec).toBeNull()
    expect(result.current.articlePipelineLoading).toBe(false)
  })

  test('cancelled generation aborts its signal and cannot publish a late draft', async () => {
    let resolve!: (value: unknown) => void
    mockedRunAgent.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const onGenerated = vi.fn()
    const { result } = renderHook(() => useArticlePipeline({ onArticleGenerated: onGenerated }))
    await act(async () => { await result.current.launchArticlePipeline('素材', '历史') })
    let pending!: Promise<void>
    act(() => { pending = result.current.handleArticleDirectionSelect(result.current.articleDirections[0], '历史') })
    const signal = mockedRunAgent.mock.calls.at(-1)![3].signal as AbortSignal
    act(() => result.current.cancelArticlePipeline())
    expect(signal.aborted).toBe(true)
    await act(async () => { resolve({ article: '旧草稿', review: {}, fixRounds: 0 }); await pending })
    expect(onGenerated).not.toHaveBeenCalled()
    expect(result.current.articleStage).toBeNull()
  })
})
