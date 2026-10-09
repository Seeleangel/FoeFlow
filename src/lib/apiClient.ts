import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { invoke } from '@tauri-apps/api/core';
import { loadSettings } from './settingsStorage';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function isTauriEnv(): boolean {
  return typeof window !== 'undefined' && !!((window as unknown) as Record<string, unknown>).__TAURI_INTERNALS__;
}

async function invokeHttpRequest(
  url: string,
  options: { method: string; headers: Record<string, string>; body: string }
): Promise<{ status: number; body: string }> {
  console.log('[invokeHttpRequest] called with url=', url, 'method=', options.method);
  if (!isTauriEnv()) {
    throw new Error('Tauri 环境未就绪，无法发送请求');
  }

  try {
    const rawResponse = await invoke<unknown>('invoke_http_request', {
      url,
      method: options.method,
      headers: options.headers,
      body: options.body,
    });
    console.log('[invokeHttpRequest] raw response:', rawResponse, 'type:', typeof rawResponse);
    const response = rawResponse as { status: number; body: string } | null;
    if (!response || typeof response !== 'object') {
      throw new Error(`invoke 返回了无效的响应格式：${JSON.stringify(rawResponse)}`);
    }
    if (typeof response.status !== 'number' || typeof response.body !== 'string') {
      throw new Error(`响应字段类型错误：status=${typeof response.status}, body=${typeof response.body}`);
    }
    return response;
  } catch (err) {
    console.error('[invokeHttpRequest] ERROR:', err);
    throw err;
  }
}

async function nativeFetch(
  url: string,
  options: { method: string; headers: Record<string, string>; body: string }
): Promise<{ status: number; body: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    });
    const body = await response.text();
    return { status: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function tauriPluginFetch(
  url: string,
  options: { method: string; headers: Record<string, string>; body: string }
): Promise<{ status: number; body: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const response = await tauriFetch(url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    });
    const body = await response.text();
    return { status: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function proxyFetch(
  url: string,
  options: { method: string; headers: Record<string, string>; body: string }
): Promise<{ status: number; body: string }> {
  const failures: string[] = [];

  // Diagnostic: test basic invoke
  try {
    const version = await invoke<string>('plugin:app|version');
    console.log('[proxyFetch] invoke diagnostic - app version:', version);
  } catch (e) {
    console.warn('[proxyFetch] invoke diagnostic failed:', e);
    failures.push(`invoke diagnostic: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Strategy 1: native fetch (works in production Tauri WebView, CORS-blocked in dev browser)
  try {
    console.log('[proxyFetch] trying native fetch...');
    const result = await nativeFetch(url, options);
    console.log('[proxyFetch] native fetch succeeded, status:', result.status);
    return result;
  } catch (nativeErr) {
    const msg = nativeErr instanceof Error ? nativeErr.message : String(nativeErr);
    console.warn('[proxyFetch] native fetch failed:', msg);
    failures.push(`native fetch: ${msg}`);
  }

  // Strategy 2: tauri plugin fetch (official Tauri HTTP plugin, has AbortController, most reliable)
  try {
    console.log('[proxyFetch] trying tauri plugin fetch...');
    const result = await tauriPluginFetch(url, options);
    console.log('[proxyFetch] tauri plugin fetch succeeded, status:', result.status);
    return result;
  } catch (pluginErr) {
    const msg = pluginErr instanceof Error ? pluginErr.message : String(pluginErr);
    console.warn('[proxyFetch] tauri plugin fetch failed:', msg);
    failures.push(`tauri plugin fetch: ${msg}`);
  }

  // Strategy 3: custom invoke command (last resort, full timeout — layout generation may need 60s+)
  try {
    console.log('[proxyFetch] trying custom invoke...');
    const result = await withTimeout(
      invokeHttpRequest(url, options),
      API_TIMEOUT_MS,
      'custom invoke'
    );
    console.log('[proxyFetch] custom invoke succeeded, status:', result.status);
    return result;
  } catch (invokeErr) {
    const msg = invokeErr instanceof Error ? invokeErr.message : String(invokeErr);
    console.warn('[proxyFetch] custom invoke failed:', msg);
    failures.push(`custom invoke: ${msg}`);
  }

  throw new Error(
    `所有请求方式均已失败：\n${failures.map((f) => '  - ' + f).join('\n')}`
  );
}

const API_TIMEOUT_MS = 120000; // 120-second timeout for all API calls

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} 请求超时（${ms / 1000}秒）`)), ms);
  });
  try {
    const result = await Promise.race([promise, timeout]);
    return result;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function callSchoolLLM(messages: ChatMessage[], temperature?: number, maxTokens?: number): Promise<string> {
  const settings = await loadSettings();
  if (!settings.apiUrl || !settings.apiKey) {
    throw new Error('API 配置不完整，请先在设置中填写');
  }

  console.log('[callSchoolLLM] Requesting:', settings.apiUrl);
  console.log('[callSchoolLLM] Messages:', messages.length, 'items');
  console.log('[callSchoolLLM] Model:', settings.modelName || 'default');
  console.log('[callSchoolLLM] Temperature:', temperature ?? 0.2);
  console.log('[callSchoolLLM] maxTokens:', maxTokens ?? 'not set');
  console.log('[callSchoolLLM] isTauriEnv:', isTauriEnv());

  const body: Record<string, unknown> = {
    model: settings.modelName || 'default',
    messages,
    temperature: temperature ?? 0.2,
  };
  if (maxTokens) {
    body.max_tokens = maxTokens;
  }
  const requestBody = JSON.stringify(body);
  const requestHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${settings.apiKey}`,
  };

  const response = await proxyFetch(settings.apiUrl, {
    method: 'POST',
    headers: requestHeaders,
    body: requestBody,
  });

  console.log('[callSchoolLLM] Response status:', response.status);

  if (response.status !== 200) {
    console.error('[callSchoolLLM] Error response:', response.body);
    throw new Error(`API 请求失败：${response.status} ${response.body}`);
  }

  const data = JSON.parse(response.body) as {
    choices?: [{ message?: { content?: string } }];
    error?: { message?: string };
  };

  if (data.error?.message) {
    throw new Error(`API 错误：${data.error.message}`);
  }

  console.log('[callSchoolLLM] Response data:', data);
  return data.choices?.[0]?.message?.content ?? '';
}

import { loadPromptTemplates, applyPromptTemplate } from './promptStorage';

const RULE_DESCRIPTIONS: Record<string, string> = {
  typo: '错别字检查',
  punctuation: '标点符号规范',
  sensitive_words: '敏感词审查',
  notification_completeness: '通知完整性：检查活动通知是否缺少时间、地点、报名方式等关键信息。注意：如果文中写了"扫描下方二维码""填写下方报名问卷"等表述，说明二维码/问卷图片已存在于排版中，只是文本提取时看不到，不要标记为信息缺失',
  date_consistency: '日期一致性',
  logic_conflict: '逻辑矛盾：检查内容是否存在自相矛盾。注意：文中提到"下方"的链接/二维码/问卷（如"扫码进群""点击下方链接"）不视为矛盾——这些元素在排版平台中已作为图片添加',
  copyright_image: '图片版权：检查图片是否存在版权风险。注意：来自 xiumi.us 域名的图片是秀米排版平台的合法素材，不要标记为版权问题',
  portrait_rights: '肖像权',
  political_risk: '政治风险',
  paragraph_length: '段落长度',
  image_alt: '图片alt文本：检查图片是否有替代文本。注意：秀米等排版平台生成的图片通常不包含alt属性，这在公众号推文中是正常现象，不要标记为问题',
  structure_clarity: '结构清晰度',
};

export async function buildAuditPrompt(text: string, enabledRules: string[]): Promise<string> {
  const templates = await loadPromptTemplates();
  const rulesText = enabledRules
    .map((r) => RULE_DESCRIPTIONS[r] ?? r)
    .join('\n- ');
  return applyPromptTemplate(templates.auditPrompt, {
    year: String(new Date().getFullYear()),
    enabledRules: '- ' + rulesText,
    text,
  });
}

export function buildGenerationPrompt(
  templateName: string,
  templateStructure: Record<string, unknown>,
  params: Record<string, string>,
  styleGuidance?: string
): string {
  const styleSection = styleGuidance
    ? `

${styleGuidance}`
    : '';

  return `你是一位熟悉"未来教育引领者"公众号风格的资深编辑。

当前使用的风格模板是：${templateName}
模板结构说明：${JSON.stringify(templateStructure, null, 2)}

用户提供的素材：
${JSON.stringify(params, null, 2)}
${styleSection}

请根据以上模板结构和素材，生成一篇完整的公众号推文。要求：
1. 语言风格贴合模板调性，遵循风格指南
2. 段落层次分明，适合手机屏幕阅读
3. 输出纯文本内容，不需要 HTML 标签
4. 在需要配图的位置标注【此处配图：配图说明】`;
}

export async function buildCoCreationPrompt(
  templateName: string,
  structureJson: Record<string, unknown>,
  styleGuidance?: string
): Promise<string> {
  const templates = await loadPromptTemplates();
  return applyPromptTemplate(templates.coCreationPrompt, {
    templateName,
    structureJson: JSON.stringify(structureJson),
    styleSection: styleGuidance || '',
  });
}

export async function callSchoolLLMWithImage(
  textPrompt: string,
  base64Image: string
): Promise<string> {
  return callSchoolLLMWithImages(textPrompt, [base64Image]);
}

export async function callSchoolLLMWithImages(
  textPrompt: string,
  base64Images: string[]
): Promise<string> {
  const settings = await loadSettings();
  if (!settings.apiUrl || !settings.apiKey) {
    throw new Error('API 配置不完整，请先在设置中填写');
  }

  const imageContents = base64Images.map((base64) => ({
    type: 'image_url',
    image_url: { url: `data:image/png;base64,${base64}` },
  }));

  const requestBody = JSON.stringify({
    model: settings.modelName || 'default',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: textPrompt },
          ...imageContents,
        ],
      },
    ],
    temperature: 0.2,
  });
  const requestHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${settings.apiKey}`,
  };

  const response = await proxyFetch(settings.apiUrl, {
    method: 'POST',
    headers: requestHeaders,
    body: requestBody,
  });

  console.log('[callSchoolLLMWithImages] Response status:', response.status);

  if (response.status !== 200) {
    console.error('[callSchoolLLMWithImages] Error response:', response.body);
    throw new Error(`API 请求失败：${response.status} ${response.body}`);
  }

  const data = JSON.parse(response.body) as {
    choices?: [{ message?: { content?: string } }];
  };
  console.log('[callSchoolLLMWithImages] Response data:', data);
  return data.choices?.[0]?.message?.content ?? '';
}

export interface ImageGenerationResponse {
  created: number;
  data: Array<{
    url: string;
    revised_prompt?: string;
  }>;
}

export interface ImageGenerationOptions {
  prompt: string;
  size?: '512x512' | '768x768' | '720x1280' | '1280x720' | '1024x1024';
  responseFormat?: 'url' | 'b64_json';
}

/**
 * 调用华东师大文生图 API 生成图片
 */
export async function callImageAPI(
  prompt: string,
  options?: ImageGenerationOptions
): Promise<ImageGenerationResponse> {
  const settings = await loadSettings();
  if (!settings.apiUrl || !settings.apiKey) {
    throw new Error('API 配置不完整，请先在设置中填写 API Key');
  }

  // Extract base URL from apiUrl (e.g., https://chat.ecnu.edu.cn/open/api/v1/chat/completions)
  const baseUrl = settings.apiUrl.replace(/\/open\/api\/v1\/chat\/completions$/, '').replace(/\/$/, '');
  const imageUrl = `${baseUrl}/open/api/v1/images/generations`;

  console.log('[callImageAPI] Requesting:', imageUrl);

  const requestBody = JSON.stringify({
    model: 'ecnu-image',
    prompt: prompt,
    size: options?.size || '1280x720',
    response_format: options?.responseFormat || 'url',
  });
  const requestHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${settings.apiKey}`,
  };

  const response = await proxyFetch(imageUrl, {
    method: 'POST',
    headers: requestHeaders,
    body: requestBody,
  });

  console.log('[callImageAPI] Response status:', response.status);

  if (response.status !== 200) {
    console.error('[callImageAPI] Error response:', response.body);
    throw new Error(`文生图 API 请求失败：${response.status} ${response.body}`);
  }

  const data = JSON.parse(response.body) as ImageGenerationResponse;
  console.log('[callImageAPI] Response data:', data);
  return data;
}

export async function callSchoolLLMStream(
  messages: ChatMessage[],
  onChunk: (chunk: string) => void,
  onError?: (error: Error) => void
): Promise<void> {
  const settings = await loadSettings();
  if (!settings.apiUrl || !settings.apiKey) {
    throw new Error('API 配置不完整，请先在设置中填写');
  }

  const requestBody = JSON.stringify({
    model: settings.modelName || 'default',
    messages,
    temperature: 0.7,
    stream: true,
  });
  const requestHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${settings.apiKey}`,
  };

  let body: string;
  let status: number;

  // Strategy 1: tauriFetch bypasses CORS via Rust backend and supports streaming
  try {
    console.log('[callSchoolLLMStream] trying tauriFetch to', settings.apiUrl);
    const response = await tauriFetch(settings.apiUrl, {
      method: 'POST',
      headers: requestHeaders,
      body: requestBody,
    });
    status = response.status;
    body = await response.text();
    console.log('[callSchoolLLMStream] tauriFetch succeeded, status:', status);
  } catch (tauriErr) {
    const tauriErrMsg = tauriErr instanceof Error ? tauriErr.message : String(tauriErr);
    console.warn('[callSchoolLLMStream] tauriFetch failed:', tauriErrMsg);
    // Strategy 2: proxyFetch (custom invoke command)
    try {
      const result = await proxyFetch(settings.apiUrl, {
        method: 'POST',
        headers: requestHeaders,
        body: requestBody,
      });
      status = result.status;
      body = result.body;
    } catch (proxyErr) {
      const proxyErrMsg = proxyErr instanceof Error ? proxyErr.message : String(proxyErr);
      throw new Error(`请求发送失败：${proxyErrMsg}`);
    }
  }

  if (status !== 200) {
    throw new Error(`API 请求失败：${status} ${body}`);
  }

  // Parse SSE format line by line and simulate streaming
  const lines = body.split('\n');
  try {
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;

      const data = trimmed.slice(6);
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data) as {
          choices?: [{ delta?: { content?: string } }];
          error?: { message?: string };
        };
        if (parsed.error?.message) {
          throw new Error(`流式错误：${parsed.error.message}`);
        }
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) {
          onChunk(content);
          // Small delay to preserve streaming feel when body arrives all at once
          await new Promise((resolve) => setTimeout(resolve, 8));
        }
      } catch (parseErr) {
        if (parseErr instanceof Error && parseErr.message.startsWith('流式错误')) {
          throw parseErr;
        }
      }
    }
  } catch (err) {
    if (onError) {
      onError(err instanceof Error ? err : new Error(String(err)));
    }
    throw err;
  }
}
