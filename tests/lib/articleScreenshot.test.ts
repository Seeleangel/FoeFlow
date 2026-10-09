import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { captureArticleScreenshots } from '../../src/lib/articleScreenshot';

// Mock html2canvas
vi.mock('html2canvas', () => ({
  default: vi.fn(),
}));

// Mock Tauri HTTP plugin — not available in test, code falls back to native fetch
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn().mockRejectedValue(new Error('not available')),
}));

import html2canvas from 'html2canvas';

describe('captureArticleScreenshots', () => {
  beforeEach(() => {
    document.body.innerHTML = '';

    // jsdom does not implement getContext('2d') — mock at prototype level
    // so all canvas elements (both our mock and those created by splitCanvas) work.
    const mockCtx = {
      drawImage: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      mockCtx as unknown as CanvasRenderingContext2D
    );
    // toDataURL is also unimplemented in jsdom
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,mocksegment'
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  function createMockCanvas(width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'width', { value: width, writable: true });
    Object.defineProperty(canvas, 'height', { value: height, writable: true });
    return canvas;
  }

  it('should create a hidden container with width 375px', async () => {
    const mockCanvas = createMockCanvas(750, 2000);
    vi.mocked(html2canvas).mockResolvedValue(mockCanvas);

    // Spy on appendChild/removeChild to verify container lifecycle
    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const removeSpy = vi.spyOn(document.body, 'removeChild');

    await captureArticleScreenshots('<p>测试内容</p>');

    // Container was appended and removed
    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledTimes(1);

    // Verify the appended element is a div with 375px width
    const appendedEl = appendSpy.mock.calls[0][0] as HTMLElement;
    expect(appendedEl.tagName).toBe('DIV');
    expect(appendedEl.style.width).toBe('375px');
    expect(appendedEl.innerHTML).toBe('<p>测试内容</p>');
  });

  it('should call html2canvas with correct options', async () => {
    const mockCanvas = createMockCanvas(750, 2000);
    vi.mocked(html2canvas).mockResolvedValue(mockCanvas);

    await captureArticleScreenshots('<p>test</p>');

    expect(html2canvas).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ width: 375, scale: 2 })
    );
  });

  it('should return single segment for short content', async () => {
    const mockCanvas = createMockCanvas(750, 800);
    vi.mocked(html2canvas).mockResolvedValue(mockCanvas);

    const result = await captureArticleScreenshots('<p>short</p>');

    expect(result).toHaveLength(1);
    expect(result[0]).toBeTruthy();
    expect(result[0]).not.toMatch(/^data:/);
  });

  it('should split into multiple segments for long content', async () => {
    const mockCanvas = createMockCanvas(750, 4000);
    vi.mocked(html2canvas).mockResolvedValue(mockCanvas);

    const result = await captureArticleScreenshots('<p>long content</p>');

    expect(result.length).toBeGreaterThan(1);
    result.forEach((seg) => {
      expect(seg).toBeTruthy();
      expect(seg).not.toMatch(/^data:/);
    });
  });

  it('should clean up the container after capture', async () => {
    const mockCanvas = createMockCanvas(750, 800);
    vi.mocked(html2canvas).mockResolvedValue(mockCanvas);

    await captureArticleScreenshots('<p>test</p>');

    const remaining = document.body.querySelector('div[style*="375px"]');
    expect(remaining).toBeNull();
  });

  it('should handle empty HTML gracefully', async () => {
    const mockCanvas = createMockCanvas(750, 100);
    vi.mocked(html2canvas).mockResolvedValue(mockCanvas);

    const result = await captureArticleScreenshots('');

    expect(result).toHaveLength(1);
  });

  it('should preload background-image URLs from inline styles', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['fake'], { type: 'image/jpeg' })),
    });
    vi.stubGlobal('fetch', mockFetch);

    const mockCanvas = createMockCanvas(750, 2000);
    vi.mocked(html2canvas).mockResolvedValue(mockCanvas);

    const appendSpy = vi.spyOn(document.body, 'appendChild');

    const html =
      '<div style="background-image: url(http://statics.xiumi.us/test.jpg)">content</div>';
    await captureArticleScreenshots(html);

    const appendedEl = appendSpy.mock.calls[0][0] as HTMLElement;
    expect(appendedEl.innerHTML).not.toContain('statics.xiumi.us');
    expect(appendedEl.innerHTML).toContain('data:image/jpeg;base64,');
  });
});
