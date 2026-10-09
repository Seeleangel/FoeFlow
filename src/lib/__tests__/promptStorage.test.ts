import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PROMPTS,
  ARTICLE_AGENT_SYSTEM_PROMPT,
  LAYOUT_AGENT_SYSTEM_PROMPT,
} from '@/lib/promptStorage';

describe('DEFAULT_PROMPTS', () => {
  it('has coCreationPrompt', () => {
    expect(DEFAULT_PROMPTS.coCreationPrompt).toBeDefined();
    expect(typeof DEFAULT_PROMPTS.coCreationPrompt).toBe('string');
    expect(DEFAULT_PROMPTS.coCreationPrompt.length).toBeGreaterThan(100);
  });

  it('has auditPrompt', () => {
    expect(DEFAULT_PROMPTS.auditPrompt).toBeDefined();
    expect(typeof DEFAULT_PROMPTS.auditPrompt).toBe('string');
    expect(DEFAULT_PROMPTS.auditPrompt.length).toBeGreaterThan(100);
  });

  it('has imageGenerationPrompt', () => {
    expect(DEFAULT_PROMPTS.imageGenerationPrompt).toBeDefined();
    expect(typeof DEFAULT_PROMPTS.imageGenerationPrompt).toBe('string');
    expect(DEFAULT_PROMPTS.imageGenerationPrompt.length).toBeGreaterThan(50);
  });

  it('has articleAgentPrompt', () => {
    expect(DEFAULT_PROMPTS.articleAgentPrompt).toBeDefined();
    expect(typeof DEFAULT_PROMPTS.articleAgentPrompt).toBe('string');
    expect(DEFAULT_PROMPTS.articleAgentPrompt.length).toBeGreaterThan(100);
    expect(DEFAULT_PROMPTS.articleAgentPrompt).toContain('未来教育引领者');
  });

  it('has layoutAgentPrompt', () => {
    expect(DEFAULT_PROMPTS.layoutAgentPrompt).toBeDefined();
    expect(typeof DEFAULT_PROMPTS.layoutAgentPrompt).toBe('string');
    expect(DEFAULT_PROMPTS.layoutAgentPrompt.length).toBeGreaterThan(100);
    expect(DEFAULT_PROMPTS.layoutAgentPrompt).toContain('微信推文排版');
  });
});

describe('loadPromptTemplates', () => {
  it('loads defaults when DB is unavailable', async () => {
    const { loadPromptTemplates } = await import('@/lib/promptStorage');
    const templates = await loadPromptTemplates();
    expect(templates.articleAgentPrompt).toBeDefined();
    expect(templates.layoutAgentPrompt).toBeDefined();
    expect(templates.coCreationPrompt).toBeDefined();
    expect(templates.auditPrompt).toBeDefined();
    expect(templates.imageGenerationPrompt).toBeDefined();
  });
});

describe('applyPromptTemplate', () => {
  it('replaces placeholders in template strings', async () => {
    const { applyPromptTemplate } = await import('@/lib/promptStorage');
    const result = applyPromptTemplate('Hello {name}, welcome to {place}!', {
      name: 'World',
      place: 'ECNU',
    });
    expect(result).toBe('Hello World, welcome to ECNU!');
  });
});

describe('named exports', () => {
  it('exports ARTICLE_AGENT_SYSTEM_PROMPT from DEFAULT_PROMPTS', () => {
    expect(ARTICLE_AGENT_SYSTEM_PROMPT).toBe(DEFAULT_PROMPTS.articleAgentPrompt);
  });

  it('exports LAYOUT_AGENT_SYSTEM_PROMPT from DEFAULT_PROMPTS', () => {
    expect(LAYOUT_AGENT_SYSTEM_PROMPT).toBe(DEFAULT_PROMPTS.layoutAgentPrompt);
  });
});
