import { callAI, type AIMessage, type AIOptions } from './ai';

export type AgentTermination = 'completed' | 'limit' | 'stalled' | 'error';
export interface AgentEvent {
  type: 'start' | 'turn' | 'validation' | 'end';
  turn: number;
  maxTurns: number;
  message: string;
  termination?: AgentTermination;
}
export interface AgentRunOptions {
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
}
export interface AgentEvaluation<T> {
  value?: T;
  done: boolean;
  feedback: string;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('任务已停止', 'AbortError');
}

/** Also stops waiting when an adapter cannot cancel its underlying operation. */
export function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('任务已停止', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

/** Preserve original requirements and the latest candidate; discard superseded drafts. */
export function prepareAgentContext(initial: AIMessage[], latest?: string, feedback?: string): AIMessage[] {
  const messages = initial.map(message => ({ ...message }));
  if (latest !== undefined) messages.push({ role: 'assistant', content: latest });
  if (feedback) messages.push({ role: 'user', content: feedback });
  // Character bound, deliberately not a claim about model-specific token counts.
  if (messages.reduce((size, message) => size + message.content.length, 0) > 120_000) {
    throw new Error('素材和当前草稿过长，请缩短素材或拆分任务后重试');
  }
  return messages;
}

/** Pi-inspired turn loop. Business validation and the model adapter stay outside the loop. */
export async function runAgent<T>(config: AgentRunOptions & {
  request: Omit<AIOptions, 'messages' | 'signal'> & { messages: AIMessage[] };
  maxTurns: number;
  evaluate: (response: string) => AgentEvaluation<T>;
}): Promise<{ value?: T; turns: number; termination: AgentTermination; feedback: string }> {
  if (!Number.isInteger(config.maxTurns) || config.maxTurns < 1 || config.maxTurns > 8) {
    throw new Error('Agent 轮次必须为 1–8');
  }
  let latest: string | undefined;
  let value: T | undefined;
  let feedback = '';
  let turns = 0;
  const emit = (type: AgentEvent['type'], message: string, termination?: AgentTermination) => {
    throwIfAborted(config.signal);
    config.onEvent?.({ type, turn: turns, maxTurns: config.maxTurns, message, termination });
  };
  const finish = (termination: AgentTermination) => {
    emit('end', feedback, termination);
    return { value, turns, termination, feedback };
  };
  emit('start', '准备素材');
  for (let turn = 1; turn <= config.maxTurns; turn++) {
    throwIfAborted(config.signal);
    const messages = prepareAgentContext(config.request.messages, latest, feedback);
    turns = turn;
    emit('turn', turn === 1 ? '正在生成' : `正在按反馈修改（第 ${turn} 轮）`);
    let content: string;
    try {
      const response = await abortable(callAI({ ...config.request, messages, signal: config.signal }), config.signal);
      throwIfAborted(config.signal);
      content = response.content;
    } catch (error) {
      throwIfAborted(config.signal);
      if (isAbortError(error) || value === undefined) throw error;
      feedback = `修改请求失败，保留上一版：${error instanceof Error ? error.message : String(error)}`;
      return finish('error');
    }
    let evaluation: AgentEvaluation<T>;
    try {
      evaluation = config.evaluate(content);
    } catch (error) {
      evaluation = { done: false, feedback: `结果格式不符合要求：${error instanceof Error ? error.message : String(error)}。请输出完整修正版。` };
    }
    if (evaluation.value !== undefined) value = evaluation.value;
    feedback = evaluation.feedback;
    emit('validation', feedback || '结果检查完成');
    if (evaluation.done && evaluation.value !== undefined) return finish('completed');
    if (latest?.trim() === content.trim()) {
      feedback = '连续两轮没有变化，已停止自动修改，请检查当前结果';
      return finish('stalled');
    }
    latest = content;
  }
  return finish('limit');
}
