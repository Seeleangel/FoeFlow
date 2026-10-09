import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, expect, test, vi, beforeEach } from 'vitest'
import { useImageCompressor } from '../../src/hooks/useImageCompressor'
import { invoke } from '@tauri-apps/api/core'

const mockedInvoke = vi.mocked(invoke)

describe('useImageCompressor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('initial state', () => {
    const { result } = renderHook(() => useImageCompressor())
    expect(result.current.files).toEqual([])
    expect(result.current.outputDir).toBe('')
    expect(result.current.isProcessing).toBe(false)
    expect(result.current.progress).toBe(0)
  })

  test('addFiles adds image files', () => {
    const { result } = renderHook(() => useImageCompressor())
    const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' })

    act(() => {
      result.current.addFiles({ 0: file, length: 1 } as unknown as FileList)
    })

    expect(result.current.files).toHaveLength(1)
    expect(result.current.files[0].file.name).toBe('test.jpg')
  })

  test('addFiles filters non-image files', () => {
    const { result } = renderHook(() => useImageCompressor())
    const imageFile = new File(['test'], 'test.jpg', { type: 'image/jpeg' })
    const textFile = new File(['text'], 'test.txt', { type: 'text/plain' })

    act(() => {
      result.current.addFiles({
        0: imageFile,
        1: textFile,
        length: 2,
      } as unknown as FileList)
    })

    expect(result.current.files).toHaveLength(1)
  })

  test('removeFile removes by id', () => {
    const { result } = renderHook(() => useImageCompressor())
    const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' })

    act(() => {
      result.current.addFiles({ 0: file, length: 1 } as unknown as FileList)
    })

    const id = result.current.files[0].id

    act(() => {
      result.current.removeFile(id)
    })

    expect(result.current.files).toHaveLength(0)
  })

  test('selectOutputDir calls invoke and sets dir', async () => {
    mockedInvoke.mockResolvedValueOnce('/mock/output')

    const { result } = renderHook(() => useImageCompressor())

    await act(async () => {
      await result.current.selectOutputDir()
    })

    expect(mockedInvoke).toHaveBeenCalledWith('pick_output_directory')
    expect(result.current.outputDir).toBe('/mock/output')
  })

  test('processFiles calls compress_images with files and dir', async () => {
    mockedInvoke.mockResolvedValueOnce('/mock/output')
    mockedInvoke.mockResolvedValueOnce([
      { filename: 'test.jpg', original_size: 4, final_size: 4, status: 'copied', error: null },
    ])

    const { result } = renderHook(() => useImageCompressor())
    const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' })

    act(() => {
      result.current.addFiles({ 0: file, length: 1 } as unknown as FileList)
    })

    await act(async () => {
      await result.current.selectOutputDir()
    })

    await act(async () => {
      await result.current.processFiles()
    })

    expect(mockedInvoke).toHaveBeenLastCalledWith('compress_images', expect.objectContaining({
      outputDir: '/mock/output',
    }))
    expect(result.current.files[0].status).toBe('done')
    expect(result.current.isProcessing).toBe(false)
  })

  test('processFiles batches multiple files', async () => {
    mockedInvoke.mockResolvedValueOnce('/mock/output')
    // Batch 1: 8 files all succeed
    mockedInvoke.mockResolvedValueOnce(
      Array.from({ length: 8 }, (_, i) => ({
        filename: `test${i}.jpg`,
        original_size: 1024,
        final_size: 512,
        status: 'compressed',
        error: null,
      }))
    )
    // Batch 2: 2 files
    mockedInvoke.mockResolvedValueOnce(
      Array.from({ length: 2 }, (_, i) => ({
        filename: `test${i + 8}.jpg`,
        original_size: 2048,
        final_size: 1024,
        status: 'copied',
        error: null,
      }))
    )

    const { result } = renderHook(() => useImageCompressor())

    // Add 10 files
    const mockFiles: File[] = []
    for (let i = 0; i < 10; i++) {
      mockFiles.push(new File(['test'], `test${i}.jpg`, { type: 'image/jpeg' }))
    }

    act(() => {
      result.current.addFiles(
        Object.assign(mockFiles, { length: 10 }) as unknown as FileList
      )
    })

    await act(async () => {
      await result.current.selectOutputDir()
    })

    await act(async () => {
      await result.current.processFiles()
    })

    // Should have called compress_images twice (ceil(10/8) = 2)
    const compressCalls = mockedInvoke.mock.calls.filter(
      (call: any[]) => call[0] === 'compress_images'
    )
    expect(compressCalls).toHaveLength(2)

    // All files should be done
    expect(result.current.files.every((f) => f.status === 'done')).toBe(true)
    expect(result.current.isProcessing).toBe(false)
  })
})
