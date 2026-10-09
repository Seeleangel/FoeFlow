import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import ImageCompressorPanel from '../../src/components/ImageCompressorPanel'

vi.mock('../../src/hooks/useImageCompressor', () => ({
  useImageCompressor: () => ({
    files: [],
    outputDir: '',
    isProcessing: false,
    progress: 0,
    addFiles: vi.fn(),
    removeFile: vi.fn(),
    clearFiles: vi.fn(),
    selectOutputDir: vi.fn(),
    processFiles: vi.fn(),
  }),
}))

describe('ImageCompressorPanel', () => {
  test('renders empty state with upload prompt', () => {
    render(<ImageCompressorPanel />)
    expect(screen.getByText(/拖拽图片到此处/)).toBeInTheDocument()
  })
})
