import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initDb } from '@/hooks/useDb';

describe('getAllDrafts', () => {
  beforeEach(async () => {
    vi.resetModules();
    await initDb();
  });

  it('should include generator-draft modes', async () => {
    const { saveDraft, getAllDrafts } = await import('@/lib/draftStorage');
    await saveDraft({
      id: 'gen_draft_1',
      templateId: '',
      mode: 'generator-draft',
      paramsJson: { title: 'Generator Article' },
      contentHtml: '<p>hello</p>',
      contentText: 'hello',
      createdAt: Date.now(),
    });
    const drafts = await getAllDrafts();
    const ids = drafts.map((d) => d.id);
    expect(ids).toContain('gen_draft_1');
  });
});
