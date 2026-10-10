import { parseJsonObject } from './agentValidation';
import { prepareAgentContext, throwIfAborted } from './agentRuntime';
import { loadPromptTemplates } from './promptStorage';
import { callSchoolLLM } from './apiClient';
import type { ChatMessage } from './apiClient';

export interface RequirementResult {
  type: 'question' | 'ready';
  content: string;
  brief?: string;
  collectedInfo?: {
    topic: string;
    style: string;
    materials: string;
  };
}

export function extractReadyJson(response: string): string | null {
  const match = /\{\s*"status"\s*:/.exec(response);
  if (!match) return null;
  const tail = response.slice(match.index);
  let depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < tail.length; i++) {
    const char = tail[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return tail.slice(0, i + 1);
  }
  return null;
}

/**
 * Call the requirement gathering agent with full conversation history.
 * Returns either a follow-up question or a ready signal with collected info.
 */
export async function gatherRequirements(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  signal?: AbortSignal,
): Promise<RequirementResult> {
  const templates = await loadPromptTemplates();
  const systemPrompt = templates.requirementGatheringPrompt;

  const requestMessages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  ];

  let response: string;
  try {
    response = await callSchoolLLM(prepareAgentContext(requestMessages), 0.7, 2048, signal);
  } catch (err) {
    console.error('[requirementAgent] LLM call failed:', err);
    throw err;
  }

  throwIfAborted(signal);
  const jsonStr = extractReadyJson(response);
  if (jsonStr) {
    try {
      const parsed = parseJsonObject(jsonStr);
      const info = parsed.collectedInfo as Record<string, unknown> | undefined;
      if (parsed.status === 'ready' && info && ['topic', 'style', 'materials'].every(key => typeof info[key] === 'string') && (parsed.brief === undefined || typeof parsed.brief === 'string')) {
        return {
          type: 'ready',
          content: response.replace(jsonStr, '').trim() || (parsed.brief as string) || '信息收集完成，开始为您生成文章…',
          brief: parsed.brief as string | undefined,
          collectedInfo: info as { topic: string; style: string; materials: string },
        };
      }
    } catch (e) {
      console.warn('[requirementAgent] Failed to parse ready JSON:', e);
    }
  }

  return { type: 'question', content: response };
}
