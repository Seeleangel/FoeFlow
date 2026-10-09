/**
 * 图片生成器单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateImagePrompt, generateArticleImage } from '../imageGenerator';
import { callSchoolLLM, callImageAPI } from '../apiClient';
import { saveGeneratedImage } from '../libraryStorage';

// Mock dependencies
vi.mock('../apiClient', () => ({
  callSchoolLLM: vi.fn(),
  callImageAPI: vi.fn(),
  loadSettings: vi.fn(),
}));

vi.mock('../libraryStorage', () => ({
  saveGeneratedImage: vi.fn(),
}));

describe('imageGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateImagePrompt', () => {
    it('应该根据文章标题生成 prompt', async () => {
      const mockArticle = `# 中秋月饼测评
这是一篇关于中秋月饼的文章。
月饼是中秋节的传统食品。
`;
      const mockPrompt = '中秋佳节，月饼，团圆，温馨暖色调，中国传统风格';

      vi.mocked(callSchoolLLM).mockResolvedValue(mockPrompt);

      const result = await generateImagePrompt(mockArticle);

      expect(result).toBe(mockPrompt);
      expect(callSchoolLLM).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('中秋月饼测评'),
          }),
        ])
      );
    });

    it('应该处理无标题的文章', async () => {
      const mockArticle = '这是一篇没有标题的文章。';
      const mockPrompt = '简洁的图片描述';

      vi.mocked(callSchoolLLM).mockResolvedValue(mockPrompt);

      const result = await generateImagePrompt(mockArticle);

      expect(result).toBe(mockPrompt);
    });
  });

  describe('generateArticleImage', () => {
    it('应该成功生成配图并返回本地路径', async () => {
      const mockArticle = `# 测试文章
测试内容`;
      const mockImagePrompt = '测试图片描述';
      const mockImageUrl = 'https://example.com/image.png';
      const mockLocalPath = 'file:///local/path/image.png';

      vi.mocked(callSchoolLLM).mockResolvedValue(mockImagePrompt);
      vi.mocked(callImageAPI).mockResolvedValue({
        created: 1234567890,
        data: [{ url: mockImageUrl, revised_prompt: mockImagePrompt }],
      });
      vi.mocked(saveGeneratedImage).mockResolvedValue(mockLocalPath);

      const result = await generateArticleImage(mockArticle);

      expect(result).toBe(mockLocalPath);
      expect(callSchoolLLM).toHaveBeenCalled();
      expect(callImageAPI).toHaveBeenCalledWith(mockImagePrompt);
      expect(saveGeneratedImage).toHaveBeenCalledWith(mockImageUrl, expect.any(String));
    });

    it('应该在 API 失败时重试', async () => {
      const mockArticle = `# 测试文章
测试内容`;
      const mockImagePrompt = '测试图片描述';
      const mockImageUrl = 'https://example.com/image.png';
      const mockLocalPath = 'file:///local/path/image.png';

      // 第一次失败，第二次成功
      vi.mocked(callSchoolLLM).mockResolvedValue(mockImagePrompt);
      vi.mocked(callImageAPI)
        .mockRejectedValueOnce(new Error('API 超时'))
        .mockResolvedValueOnce({
          created: 1234567890,
          data: [{ url: mockImageUrl, revised_prompt: mockImagePrompt }],
        });
      vi.mocked(saveGeneratedImage).mockResolvedValue(mockLocalPath);

      const result = await generateArticleImage(mockArticle);

      expect(result).toBe(mockLocalPath);
      expect(callImageAPI).toHaveBeenCalledTimes(2);
    });

    it('应该在多次重试失败后返回 null', async () => {
      const mockArticle = `# 测试文章
测试内容`;
      const mockImagePrompt = '测试图片描述';

      vi.mocked(callSchoolLLM).mockResolvedValue(mockImagePrompt);
      vi.mocked(callImageAPI).mockRejectedValue(new Error('API 错误'));

      const result = await generateArticleImage(mockArticle);

      expect(result).toBeNull();
      expect(callImageAPI).toHaveBeenCalledTimes(3); // 初始 + 2 次重试
    });
  });
});
