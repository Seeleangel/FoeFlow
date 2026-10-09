import html2canvas from 'html2canvas';

const VIEWPORT_HEIGHT = 667;
const OVERLAP = 100;
const SCALE = 2;

export async function captureArticleScreenshots(rawHtml: string): Promise<string[]> {
  // Pre-fetch external images and convert to data URLs to avoid CORS issues.
  // Xiumi's CDN doesn't return Access-Control-Allow-Origin headers, so
  // html2canvas with useCORS:true can't load them. We bypass this by
  // fetching through Tauri's HTTP plugin (which runs outside the browser).
  const html = await preloadImages(rawHtml);

  const container = document.createElement('div');
  container.style.cssText = 'position:absolute;left:-9999px;top:0;width:375px;';
  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    await waitForImages(container);

    const fullCanvas = await html2canvas(container, {
      width: 375,
      useCORS: true,
      scale: SCALE,
    });

    return splitCanvas(fullCanvas);
  } finally {
    document.body.removeChild(container);
  }
}

async function preloadImages(html: string): Promise<string> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const fetches: Promise<void>[] = [];

  // Preload <img> src
  for (const img of doc.querySelectorAll('img')) {
    const src = img.getAttribute('src');
    if (!src || src.startsWith('data:')) continue;

    fetches.push(
      fetchImageAsBase64(src).then((dataUrl) => {
        img.setAttribute('src', dataUrl);
      }).catch(() => {
        // Image can't be fetched — leave original URL. html2canvas will
        // attempt CORS for it; if CORS fails it's silently skipped.
      })
    );
  }

  // Preload background-image URLs in inline styles
  const urlRegex = /url\(["']?(https?:\/\/[^"'\s)]+)["']?\)/g;

  for (const el of doc.querySelectorAll('[style]')) {
    const style = el.getAttribute('style');
    if (!style) continue;

    const matches = [...style.matchAll(urlRegex)];
    if (matches.length === 0) continue;

    let newStyle = style;
    for (const m of matches) {
      try {
        const dataUrl = await fetchImageAsBase64(m[1]);
        newStyle = newStyle.replace(m[0], `url(${dataUrl})`);
      } catch {
        // Can't fetch — leave original URL
      }
    }

    if (newStyle !== style) {
      el.setAttribute('style', newStyle);
    }
  }

  await Promise.all(fetches);
  return doc.body?.innerHTML ?? html;
}

async function fetchImageAsBase64(url: string): Promise<string> {
  // Strategy 1: Tauri HTTP plugin (bypasses CORS by running in Rust backend)
  try {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    const response = await tauriFetch(url, { method: 'GET' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const contentType = response.headers.get('content-type') ?? 'image/png';
    return `data:${contentType};base64,${bytesToBase64(bytes)}`;
  } catch {
    // Tauri HTTP not available — try native fetch (works for same-origin)
  }

  // Strategy 2: native fetch (works in browser for same-origin, fails for cross-origin)
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function waitForImages(container: HTMLElement): Promise<void> {
  const images = container.querySelectorAll('img');
  const failedUrls: string[] = [];

  for (const img of images) {
    // Force eager loading — lazy images never start when offscreen
    img.loading = 'eager';
  }

  const promises = Array.from(images).map(
    (img) =>
      new Promise<void>((resolve) => {
        if (img.complete) {
          resolve();
        } else {
          img.onload = () => resolve();
          img.onerror = () => {
            failedUrls.push(img.src);
            resolve();
          };
        }
      })
  );

  return Promise.race([
    Promise.all(promises).then(() => undefined),
    new Promise<void>((resolve) => {
      setTimeout(() => {
        if (failedUrls.length > 0) {
          console.warn('Images failed to load:', failedUrls);
        }
        resolve();
      }, 10_000);
    }),
  ]);
}

function splitCanvas(canvas: HTMLCanvasElement): string[] {
  const stepPx = VIEWPORT_HEIGHT * SCALE;
  const overlapPx = OVERLAP * SCALE;
  const segments: string[] = [];

  let y = 0;
  while (y < canvas.height) {
    const segHeight = Math.min(stepPx, canvas.height - y);
    const seg = document.createElement('canvas');
    seg.width = canvas.width;
    seg.height = segHeight;
    const ctx = seg.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2d context');
    ctx.drawImage(canvas, 0, y, canvas.width, segHeight, 0, 0, canvas.width, segHeight);
    segments.push(seg.toDataURL('image/png').split(',')[1]);
    y += stepPx - overlapPx;
  }

  return segments;
}
