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
  const start = response.indexOf('{"status"');
  if (start === -1) return null;

  let depth = 0;
  for (let i = start; i < response.length; i++) {
    if (response[i] === '{') depth++;
    else if (response[i] === '}') {
      depth--;
      if (depth === 0) return response.substring(start, i + 1);
    }
  }
  return null;
}

/**
 * Call the requirement gathering agent with full conversation history.
 * Returns either a follow-up question or a ready signal with collected info.
 */
export async function gatherRequirements(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
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
    response = await callSchoolLLM(requestMessages, 0.7);
  } catch (err) {
    console.error('[requirementAgent] LLM call failed:', err);
    throw err;
  }

  const jsonStr = extractReadyJson(response);
  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed.status === 'ready' && parsed.collectedInfo) {
        return {
          type: 'ready',
          content: response.replace(jsonStr, '').trim() || parsed.brief || '信息收集完成，开始为您生成文章…',
          brief: parsed.brief,
          collectedInfo: parsed.collectedInfo,
        };
      }
    } catch (e) {
      console.warn('[requirementAgent] Failed to parse ready JSON:', e);
    }
  }

  return { type: 'question', content: response };
}
