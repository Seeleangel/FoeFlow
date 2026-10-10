import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { callAI } from '@/lib/ai';

vi.mock('@/lib/settingsStorage', () => ({ loadSettings: vi.fn(async () => ({ apiUrl: 'https://example.test/v1/chat/completions', apiKey: 'test-only', modelName: 'test-model' })) }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
const messages = [{ role: 'user' as const, content: '测试素材' }];
const response = (content = '正常结果', finish_reason = 'stop') => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason }] }));

describe('agent transport', () => {
  beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('fetch', vi.fn()); delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; });
  afterEach(() => { vi.unstubAllGlobals(); delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; });
  it('forwards general-purpose maxTokens and abort signal to the browser request', async () => {
    vi.mocked(fetch).mockResolvedValue(response());
    await callAI({ messages, maxTokens: 4096, signal: new AbortController().signal });
    const options = vi.mocked(fetch).mock.calls[0][1]!;
    expect(JSON.parse(String(options.body)).max_tokens).toBe(4096);
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
  it('selects the native HTTP adapter once and does not fall back after a failed POST', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    vi.mocked(tauriFetch).mockRejectedValue(new Error('连接断开'));
    await expect(callAI({ messages })).rejects.toThrow('连接断开');
    expect(tauriFetch).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects empty model content', async () => {
    vi.mocked(fetch).mockResolvedValue(response(''));
    await expect(callAI({ messages })).rejects.toThrow('空内容');
  });
  it('rejects truncated model content', async () => {
    vi.mocked(fetch).mockResolvedValue(response('不完整草稿', 'length'));
    await expect(callAI({ messages })).rejects.toThrow('截断');
  });
  it('cancels the active HTTP request instead of sending another one', async () => {
    vi.mocked(fetch).mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const controller = new AbortController();
    const pending = callAI({ messages, signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    controller.abort();
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
