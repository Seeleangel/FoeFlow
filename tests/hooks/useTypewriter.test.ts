import { renderHook, act } from '@testing-library/react'
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { useTypewriter } from '../../src/hooks/useTypewriter'

describe('useTypewriter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('returns full text immediately when text length <= 3', () => {
    const { result } = renderHook(() => useTypewriter('hi'))
    expect(result.current).toBe('hi')
  })

  test('starts empty for long text', () => {
    const { result } = renderHook(() => useTypewriter('hello world'))
    expect(result.current).toBe('')
  })

  test('types out text character by character', () => {
    const { result } = renderHook(() =>
      useTypewriter('abcd', { speedMs: 100, maxDurationMs: 10000 })
    )
    expect(result.current).toBe('')

    act(() => { vi.advanceTimersByTime(100) })
    expect(result.current).toBe('a')

    act(() => { vi.advanceTimersByTime(100) })
    expect(result.current).toBe('ab')

    act(() => { vi.advanceTimersByTime(100) })
    expect(result.current).toBe('abc')

    act(() => { vi.advanceTimersByTime(100) })
    expect(result.current).toBe('abcd')
  })

  test('adapts speed when text is long relative to maxDurationMs', () => {
    const { result } = renderHook(() =>
      useTypewriter('abcdef', { speedMs: 1000, maxDurationMs: 600 })
    )
    expect(result.current).toBe('')

    // actualInterval = Math.min(1000, 600/6) = 100
    act(() => { vi.advanceTimersByTime(100) })
    expect(result.current).toBe('a')

    act(() => { vi.advanceTimersByTime(500) })
    expect(result.current).toBe('abcdef')
  })

  test('does not restart animation on re-render with same text', () => {
    const { result, rerender } = renderHook(
      ({ text }) => useTypewriter(text, { speedMs: 100, maxDurationMs: 10000 }),
      { initialProps: { text: 'hello' } }
    )

    act(() => { vi.advanceTimersByTime(200) })
    expect(result.current).toBe('he')

    rerender({ text: 'hello' })
    act(() => { vi.advanceTimersByTime(100) })
    // Should continue from where it left off, not restart
    expect(result.current).toBe('hel')
  })

  test('cleans up interval on unmount', () => {
    const { unmount } = renderHook(() =>
      useTypewriter('hello', { speedMs: 100, maxDurationMs: 10000 })
    )
    unmount()
    // If interval is not cleaned up, fake timers would complain
    // or we could check that no timers are pending
    expect(vi.getTimerCount()).toBe(0)
  })
})
