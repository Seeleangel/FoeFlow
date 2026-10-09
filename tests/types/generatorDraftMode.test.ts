import { describe, it, expect } from 'vitest';
import type { GeneratedDraft } from '@/types';

describe('GeneratedDraft mode types', () => {
  it('should accept generator-draft as a valid mode', () => {
    const draft: GeneratedDraft = {
      id: 'test',
      templateId: '',
      mode: 'generator-draft',
      paramsJson: {},
      contentHtml: '',
      contentText: '',
      createdAt: 0,
    };
    expect(draft.mode).toBe('generator-draft');
  });
});
