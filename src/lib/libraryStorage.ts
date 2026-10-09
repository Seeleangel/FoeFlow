import { getDb } from '@/hooks/useDb';
import type { StyleTemplate, UserArticle } from '@/types';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { mkdir, writeFile, readDir, remove } from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

export async function getAllTemplates(): Promise<StyleTemplate[]> {
  const db = await getDb();
  console.log('[getAllTemplates] Querying style_templates...');
  const rows = await db.select<
    {
      id: string;
      name: string;
      description: string;
      source_type: string;
      structure_json: string;
      form_schema: string;
      co_creation_prompt: string;
      sample_snippets: string;
      created_at: number;
      updated_at: number;
    }[]
  >('SELECT * FROM style_templates ORDER BY created_at DESC');
  console.log('[getAllTemplates] Raw rows:', rows.length, rows);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    sourceType: r.source_type as 'built-in' | 'user-generated',
    structureJson: JSON.parse(r.structure_json || '{}'),
    formSchema: JSON.parse(r.form_schema || '[]'),
    coCreationPrompt: r.co_creation_prompt,
    sampleSnippets: r.sample_snippets,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function saveTemplate(template: StyleTemplate): Promise<void> {
  console.log('[saveTemplate] Saving template:', template.id, template.name);
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO style_templates
     (id, name, description, source_type, structure_json, form_schema, co_creation_prompt, sample_snippets, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      template.id,
      template.name,
      template.description,
      template.sourceType,
      JSON.stringify(template.structureJson),
      JSON.stringify(template.formSchema),
      template.coCreationPrompt,
      template.sampleSnippets,
      template.createdAt,
      template.updatedAt,
    ]
  );
  console.log('[saveTemplate] Saved successfully:', template.id);
}

export async function deleteTemplate(id: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM style_templates WHERE id = ?', [id]);
}

export async function getAllUserArticles(): Promise<UserArticle[]> {
  const db = await getDb();
  const rows = await db.select<
    {
      id: string;
      title: string;
      source_url: string;
      content: string;
      template_id: string;
      tags: string;
      created_at: number;
    }[]
  >('SELECT * FROM user_articles ORDER BY created_at DESC');
  return rows.map((r) => {
    let tags: string[] = [];
    try {
      const parsed = JSON.parse(r.tags || '[]');
      if (Array.isArray(parsed)) tags = parsed;
    } catch {
      // ignore parse error
    }
    return {
      id: r.id,
      title: r.title,
      sourceUrl: r.source_url,
      content: r.content,
      templateId: r.template_id,
      tags,
      createdAt: r.created_at,
    };
  });
}

export async function saveUserArticle(article: UserArticle): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO user_articles (id, title, source_url, content, template_id, tags, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      article.id,
      article.title,
      article.sourceUrl,
      article.content,
      article.templateId,
      JSON.stringify(article.tags),
      article.createdAt,
    ]
  );
}

export async function deleteUserArticle(id: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM user_articles WHERE id = ?', [id]);
}

/**
 * 下载图片，优先使用原生 fetch，失败时回退到 Tauri HTTP 插件
 */
async function downloadImage(imageUrl: string): Promise<Response> {
  // 策略 1：原生 fetch（在 Tauri WebView 中通常可直接访问外部 URL）
  try {
    const response = await fetch(imageUrl);
    if (response.ok) {
      return response;
    }
  } catch (error) {
    console.log('[downloadImage] native fetch failed:', error);
  }

  // 策略 2：Tauri HTTP 插件 fetch
  try {
    const response = await tauriFetch(imageUrl);
    if (response.ok) {
      return response;
    }
  } catch (error) {
    console.log('[downloadImage] tauri fetch failed:', error);
  }

  throw new Error('图片下载失败：所有请求方式均已失败');
}

/**
 * 将远程图片 URL 下载并保存到本地文件
 * 返回可直接在 Tauri 中使用的本地 asset URL
 */
export async function saveGeneratedImage(imageUrl: string, filename?: string): Promise<string> {
  console.log('[saveGeneratedImage] Processing image:', imageUrl);

  // 生成安全文件名（移除 Windows 非法字符并限制长度）
  const safeFilename = (filename || `image-${Date.now()}.png`)
    .replace(/[<>:"/\\|?*]/g, '_')
    .substring(0, 200);

  // 准备本地保存路径（使用 join 保证跨平台正确）
  const baseDir = await appDataDir();
  const imagesDir = await join(baseDir, 'generated-images');
  try {
    await mkdir(imagesDir, { recursive: true });
  } catch (e) {
    // 目录已存在或创建失败时忽略
  }
  const localPath = await join(imagesDir, safeFilename);

  // 如果是 data URL，直接解码保存到本地
  if (imageUrl.startsWith('data:')) {
    try {
      const base64Data = imageUrl.split(',')[1];
      const bytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
      await writeFile(localPath, bytes);
      console.log('[saveGeneratedImage] Saved data URL to local file:', localPath);
      return convertFileSrc(localPath);
    } catch (error) {
      console.log('[saveGeneratedImage] Failed to save data URL:', error);
      throw new Error('data URL 图片保存失败');
    }
  }

  // 策略 1：后端下载到本地文件（绕过 CORS / 防盗链限制）
  try {
    console.log('[saveGeneratedImage] Trying backend download to file...');
    await invoke<string>('download_image_to_file', { url: imageUrl, filePath: localPath });
    console.log('[saveGeneratedImage] Saved via backend to:', localPath);
    return convertFileSrc(localPath);
  } catch (error) {
    console.log('[saveGeneratedImage] backend download failed:', error);
  }

  // 策略 2：前端下载并写入本地文件
  try {
    const response = await downloadImage(imageUrl);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);
    await writeFile(localPath, buffer);

    console.log('[saveGeneratedImage] Saved via frontend fetch to:', localPath);
    return convertFileSrc(localPath);
  } catch (error) {
    console.log('[saveGeneratedImage] frontend download failed:', error);
  }

  throw new Error('图片下载失败：所有请求方式均已失败');
}

/**
 * 获取本地生成的图片
 */
export async function getGeneratedImage(filename: string): Promise<string> {
  const baseDir = await appDataDir();
  const localPath = await join(baseDir, 'generated-images', filename);
  return convertFileSrc(localPath);
}

/**
 * 清理 30 天前的图片
 */
export async function cleanupOldImages(maxAgeDays: number = 30): Promise<void> {
  const baseDir = await appDataDir();
  const imagesDir = await join(baseDir, 'generated-images');

  try {
    const entries = await readDir(imagesDir);
    const now = Date.now();
    const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;

    for (const entry of entries) {
      if (entry.isFile && entry.name.endsWith('.png')) {
        // 从文件名解析日期 (格式：YYYY-MM-DD-xxx.png)
        const dateMatch = entry.name.match(/^(\d{4}-\d{2}-\d{2})-/);
        if (dateMatch) {
          const fileDate = new Date(dateMatch[1]).getTime();
          if (now - fileDate > maxAge) {
            // 删除过期文件
            await remove(`${imagesDir}/${entry.name}`);
            console.log('[cleanupOldImages] 已删除过期文件:', entry.name);
          }
        }
      }
    }
  } catch (error) {
    console.error('[cleanupOldImages] 清理失败:', error);
  }
}
