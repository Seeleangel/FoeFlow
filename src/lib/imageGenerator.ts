/**
 * 图片生成器模块
 * 负责根据文章内容生成图片描述 prompt，并调用文生图 API
 */

import { callSchoolLLM, callImageAPI } from './apiClient';
import { saveGeneratedImage } from './libraryStorage';
import { loadPromptTemplates, applyPromptTemplate } from './promptStorage';

/**
 * 根据文章内容生成图片描述 prompt
 */
export async function generateImagePrompt(articleContent: string): Promise<string> {
  // 提取标题和前 500 字正文
  const lines = articleContent.split('\n').filter(line => line.trim());
  const title = lines[0]?.replace(/^#\s*/, '') || '文章';
  const bodyPreview = lines.slice(1, 10).join('\n').substring(0, 500);

  const templates = await loadPromptTemplates();
  const prompt = applyPromptTemplate(templates.imageGenerationPrompt, {
    title,
    bodyPreview,
  });

  const response = await callSchoolLLM([
    { role: 'user', content: prompt },
  ]);

  return response.trim();
}

/**
 * 根据文章内容生成配图（完整流程）
 * 返回本地图片路径
 */
export async function generateArticleImage(articleContent: string): Promise<string | null> {
  try {
    // Step 1: 生成图片描述 prompt
    console.log('[generateArticleImage] 正在生成图片描述 prompt...');
    const prompt = await generateImagePrompt(articleContent);
    console.log('[generateArticleImage] Prompt:', prompt);

    // Step 2: 调用文生图 API（带重试）
    console.log('[generateArticleImage] 正在调用文生图 API...');
    const imageUrl = await callImageAPIWithRetry(prompt);
    console.log('[generateArticleImage] 图片 URL:', imageUrl);

    // Step 3: 转存到本地
    console.log('[generateArticleImage] 正在转存图片到本地...');
    const localPath = await saveGeneratedImageToLocal(imageUrl);
    console.log('[generateArticleImage] 本地路径:', localPath);

    return localPath;
  } catch (error) {
    console.error('[generateArticleImage] 配图生成失败，使用备用样式:', error);
    return null;
  }
}

/**
 * 调用文生图 API（带重试机制）
 */
async function callImageAPIWithRetry(prompt: string, maxRetries = 2): Promise<string> {
  let lastError: Error | null = null;

  for (let i = 0; i <= maxRetries; i++) {
    try {
      const response = await callImageAPI(prompt);
      if (response.data && response.data.length > 0) {
        return response.data[0].url;
      }
      throw new Error('API 返回数据为空');
    } catch (error) {
      lastError = error as Error;
      console.log(`[callImageAPIWithRetry] 重试 ${i + 1}/${maxRetries}:`, lastError.message);

      if (i < maxRetries) {
        // 延迟 1 秒后重试
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  throw lastError;
}

/**
 * 转存图片到本地（处理文件协议）
 */
async function saveGeneratedImageToLocal(imageUrl: string): Promise<string> {
  // 从 URL 提取文件名
  const filename = imageUrl.split('/').pop() || `image-${Date.now()}.png`;
  return await saveGeneratedImage(imageUrl, filename);
}
