/**
 * AI module for calling AI APIs
 * Uses the same LLM interface as article generation and audit
 */

import { callSchoolLLM } from './apiClient';

export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export type AIPurpose = 'layoutAnalyze' | 'layoutGeneration' | 'general';

export interface AIOptions {
  messages: AIMessage[];
  temperature?: number;
  maxTokens?: number;
  purpose?: AIPurpose;
}

export interface AIResponse {
  content: string;
}

/**
 * Call LLM for layout tasks — sends messages as proper role array
 * so the system prompt has full weight as system role.
 */
async function callLayoutLLM(
  messages: AIMessage[],
  temperature?: number,
  maxTokens?: number,
): Promise<string> {
  console.log('[AI Layout] Calling LLM with', messages.length, 'messages');

  const response = await callSchoolLLM(messages, temperature, maxTokens);

  console.log('[AI Layout] Response length:', response.length);
  return response;
}

/**
 * Call AI API for text analysis/generation.
 *
 * - layoutAnalyze:  short style analysis (no HTML output)
 * - layoutGeneration: full HTML layout generation with system prompt as system role
 * - general: plain LLM call
 */
export async function callAI(options: AIOptions): Promise<AIResponse> {
  const purpose = options.purpose || 'general';

  console.log('[callAI] Purpose:', purpose);
  console.log('[callAI] Messages count:', options.messages.length);
  const firstMsg = options.messages[0]?.content || '';
  console.log('[callAI] First message preview (first 200 chars):', firstMsg.substring(0, 200));

  if (purpose === 'layoutGeneration') {
    const content = await callLayoutLLM(
      options.messages,
      options.temperature,
      options.maxTokens ?? 8192,
    );
    return { content };
  }

  if (purpose === 'layoutAnalyze') {
    const content = await callLayoutLLM(
      options.messages,
      options.temperature ?? 0.5,
      options.maxTokens ?? 1024,
    );
    return { content };
  }

  // general purpose
  const response = await callSchoolLLM(
    options.messages.map((m) => ({ role: m.role, content: m.content })),
    options.temperature,
  );
  return { content: response };
}
