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
  signal?: AbortSignal;
}
export interface AIResponse { content: string }

/** Model adapter; agent lifecycle and validation belong to agentRuntime. */
export async function callAI(options: AIOptions): Promise<AIResponse> {
  const purpose = options.purpose ?? 'general';
  const content = await callSchoolLLM(
    options.messages,
    options.temperature ?? (purpose === 'layoutAnalyze' ? 0.5 : undefined),
    options.maxTokens ?? (purpose === 'layoutGeneration' ? 8192 : purpose === 'layoutAnalyze' ? 1024 : undefined),
    options.signal,
  );
  return { content };
}
