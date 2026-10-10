import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { loadSettings } from './settingsStorage';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const API_TIMEOUT_MS = 120000;

function isTauriEnv(): boolean {
  return typeof window !== 'undefined' && !!((window as unknown) as Record<string, unknown>).__TAURI_INTERNALS__;
}

async function proxyFetch(
  url: string,
  options: { method: string; headers: Record<string, string>; body: string },
  signal?: AbortSignal,
): Promise<{ status: number; body: string }> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, API_TIMEOUT_MS);
  try {
    // Select once before sending. Retrying a timed-out POST via another adapter can
    // generate duplicate paid requests while the original is still running.
    const adapter = isTauriEnv() ? tauriFetch : fetch;
    const response = await adapter(url, { ...options, signal: controller.signal });
    const body = await response.text();
    if (controller.signal.aborted) throw new DOMException('请求已取消', 'AbortError');
    return { status: response.status, body };
  } catch (error) {
    if (signal?.aborted) throw new DOMException('任务已停止', 'AbortError');
    if (controller.signal.aborted) throw new Error('AI 请求超过 120 秒，请稍后重试');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export async function callSchoolLLM(
  messages: ChatMessage[], temperature?: number, maxTokens?: number, signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw new DOMException('任务已停止', 'AbortError');
  const settings = await loadSettings();
  if (signal?.aborted) throw new DOMException('任务已停止', 'AbortError');
  if (!settings.apiUrl || !settings.apiKey) {
    throw new Error('API 配置不完整，请先在设置中填写');
  }
  const body: Record<string, unknown> = {
    model: settings.modelName || 'default', messages, temperature: temperature ?? 0.2,
  };
  if (maxTokens) body.max_tokens = maxTokens;
  const response = await proxyFetch(settings.apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
    body: JSON.stringify(body),
  }, signal);
  if (response.status !== 200) throw new Error(`API 请求失败：${response.status}`);
  const data = JSON.parse(response.body) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    error?: { message?: string };
  };
  if (data.error?.message) throw new Error(`API 错误：${data.error.message}`);
  const choice = data.choices?.[0];
  if (choice?.finish_reason === 'length') throw new Error('模型输出被长度限制截断，请缩短素材或提高输出长度设置');
  if (choice?.finish_reason === 'content_filter') throw new Error('模型未能返回内容，请调整素材后重试');
  const content = choice?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('模型返回了空内容，请重试');
  return content;
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
