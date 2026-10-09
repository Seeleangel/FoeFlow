import { fetch } from '@tauri-apps/plugin-http';

export interface XiemiArticle {
  title: string;
  contentText: string;
  imageUrls: string[];
  rawHtml: string;
}

export async function fetchXiemiArticle(url: string): Promise<XiemiArticle> {
  // 1. 获取展示页 HTML
  const response = await fetch(url, { method: 'GET' });
  if (!response || !response.ok) {
    throw new Error(`抓取失败：${response?.status ?? '未知错误'}`);
  }
  const html = await response.text();

  // 从 meta / title 提取标题
  const title = extractTitle(html);

  // 2. 从 HTML 中提取 show_data_url（秀米文章 JSON 数据源）
  const dataUrlMatch = html.match(/show_data_url%22%3A%22(.*?)%22/);
  if (!dataUrlMatch) {
    throw new Error('无法解析秀米文章数据源，请检查链接是否正确');
  }

  const jsonUrl = 'https:' + decodeURIComponent(dataUrlMatch[1]);

  // 3. 请求 JSON 数据（reqwest 会自动处理 gzip）
  const jsonRes = await fetch(jsonUrl, { method: 'GET' });
  if (!jsonRes || !jsonRes.ok) {
    throw new Error(`秀米数据请求失败：${jsonRes?.status ?? '未知错误'}`);
  }
  const articleJson = (await jsonRes.json()) as Record<string, unknown>;

  // 4. 从 JSON 提取渲染后的 HTML
  const contentHtml = getJsonPath(
    articleJson,
    'cubes[0].pages[0].layers[0]._comp._$raHTML'
  ) as string | undefined;

  if (!contentHtml || typeof contentHtml !== 'string') {
    throw new Error('秀米数据格式异常，未能提取正文内容');
  }

  // 5. 解析 HTML 提取文本和图片
  const parser = new DOMParser();
  const doc = parser.parseFromString(contentHtml, 'text/html');

  const imgEls = doc.querySelectorAll('img');
  const imageUrls = Array.from(
    new Set(
      Array.from(imgEls)
        .map((img) => img.getAttribute('src') || img.getAttribute('data-src'))
        .filter(Boolean)
    )
  ) as string[];

  // 深拷贝并清理干扰元素
  const clone = doc.body ? (doc.body.cloneNode(true) as HTMLElement) : doc.documentElement.cloneNode(true) as HTMLElement;
  const noiseSelectors = [
    'script',
    'style',
    'noscript',
    'iframe',
    'svg',
    'canvas',
    'header',
    'footer',
    'nav',
    'aside',
  ];
  clone.querySelectorAll(noiseSelectors.join(', ')).forEach((el) => el.remove());

  // 块级元素后加换行，提升可读性
  clone.querySelectorAll('br').forEach((el) => el.replaceWith(document.createTextNode('\n')));
  clone.querySelectorAll('p, div, section, h1, h2, h3, h4, h5, h6, li, tr, article').forEach((el) => {
    el.appendChild(document.createTextNode('\n'));
  });

  const contentText = (clone.textContent ?? '')
    .replace(/\n+/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

  return { title, contentText, imageUrls, rawHtml: contentHtml };
}

function extractTitle(html: string): string {
  // 优先从 itemprop="name" 的 meta 标签提取
  const metaMatch = html.match(/<meta[^>]+itemprop=["']name["'][^>]+content=["']([^"']+)["']/i);
  if (metaMatch) {
    return metaMatch[1].trim();
  }

  // 再尝试 <title>
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    return titleMatch[1].trim();
  }

  // 回退到 h1
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) {
    return h1Match[1].replace(/<[^>]+>/g, ' ').trim();
  }

  return '';
}

function getJsonPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce((acc: unknown, key) => {
    if (acc == null) return undefined;
    const arrMatch = key.match(/^(\w+)\[(\d+)\]$/);
    if (arrMatch) {
      const arr = (acc as Record<string, unknown>)[arrMatch[1]];
      if (Array.isArray(arr)) {
        return arr[parseInt(arrMatch[2], 10)];
      }
      return undefined;
    }
    return (acc as Record<string, unknown>)[key];
  }, obj);
}
