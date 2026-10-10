import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callAI } from '@/lib/ai';
import { runAgent, prepareAgentContext, type AgentEvent } from '@/lib/agentRuntime';

vi.mock('@/lib/ai', () => ({ callAI: vi.fn() }));
const request = { messages: [{ role: 'system' as const, content: '规则' }, { role: 'user' as const, content: '原始事实' }] };
const evaluate = (content: string) => ({ value: content, done: content === '完成', feedback: '修复标题，保留原始事实' });

describe('agent runtime', () => {
  beforeEach(() => vi.resetAllMocks());
  it('emits ordered lifecycle events and completes once', async () => {
    vi.mocked(callAI).mockResolvedValue({ content: '完成' });
    const events: AgentEvent[] = [];
    const result = await runAgent({ request, maxTurns: 4, evaluate, onEvent: e => events.push(e) });
    expect(result.termination).toBe('completed');
    expect(events.map(e => e.type)).toEqual(['start', 'turn', 'validation', 'end']);
    expect(callAI).toHaveBeenCalledTimes(1);
  });
  it('sends the original task, last draft and concrete feedback, without growing old drafts', async () => {
    vi.mocked(callAI).mockResolvedValueOnce({ content: '第一版' }).mockResolvedValueOnce({ content: '第二版' }).mockResolvedValueOnce({ content: '完成' });
    await runAgent({ request, maxTurns: 4, evaluate });
    const messages = vi.mocked(callAI).mock.calls[2][0].messages;
    expect(messages.map(m => m.content)).toEqual(['规则', '原始事实', '第二版', '修复标题，保留原始事实']);
    expect(request.messages).toHaveLength(2);
  });
  it('stops an unchanged invalid result', async () => {
    vi.mocked(callAI).mockResolvedValue({ content: '相同内容' });
    expect((await runAgent({ request, maxTurns: 4, evaluate })).termination).toBe('stalled');
    expect(callAI).toHaveBeenCalledTimes(2);
  });
  it('bounds changing invalid results by maxTurns', async () => {
    let index = 0;
    vi.mocked(callAI).mockImplementation(async () => ({ content: `版本${++index}` }));
    const result = await runAgent({ request, maxTurns: 3, evaluate });
    expect(result.termination).toBe('limit');
    expect(result.value).toBe('版本3');
    expect(callAI).toHaveBeenCalledTimes(3);
  });
  it('repairs malformed results with validation feedback', async () => {
    vi.mocked(callAI).mockResolvedValueOnce({ content: 'broken' }).mockResolvedValueOnce({ content: '完成' });
    await runAgent({ request, maxTurns: 2, evaluate: text => {
      if (text === 'broken') throw new Error('缺少必填字段');
      return evaluate(text);
    } });
    expect(vi.mocked(callAI).mock.calls[1][0].messages.at(-1)?.content).toContain('缺少必填字段');
  });
  it('does not retry transport errors or fabricate output', async () => {
    vi.mocked(callAI).mockRejectedValue(new Error('401'));
    await expect(runAgent({ request, maxTurns: 4, evaluate })).rejects.toThrow('401');
    expect(callAI).toHaveBeenCalledTimes(1);
  });
  it('keeps the previous candidate if a later request fails, with error termination', async () => {
    vi.mocked(callAI).mockResolvedValueOnce({ content: '已有草稿' }).mockRejectedValueOnce(new Error('503'));
    const result = await runAgent({ request, maxTurns: 4, evaluate });
    expect(result.value).toBe('已有草稿');
    expect(result.termination).toBe('error');
    expect(result.feedback).toContain('503');
  });
  it('stops waiting even when the adapter ignores abort; late output emits no events', async () => {
    let resolve!: (result: { content: string }) => void;
    vi.mocked(callAI).mockImplementation(() => new Promise(r => { resolve = r; }));
    const controller = new AbortController(), events: AgentEvent[] = [];
    const pending = runAgent({ request, maxTurns: 4, evaluate, signal: controller.signal, onEvent: e => events.push(e) });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await assertion;
    resolve({ content: '完成' });
    await Promise.resolve();
    expect(events.map(e => e.type)).toEqual(['start', 'turn']);
    expect(callAI).toHaveBeenCalledTimes(1);
  });
  it('does not send a pre-cancelled task', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(runAgent({ request, maxTurns: 1, evaluate, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(callAI).not.toHaveBeenCalled();
  });
  it('rejects oversized material instead of silently removing facts', () => {
    expect(() => prepareAgentContext([{ role: 'user', content: 'a'.repeat(120001) }])).toThrow('过长');
  });
});
