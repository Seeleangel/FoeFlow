import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initDb } from '@/hooks/useDb';

describe('generatorSessionStorage', () => {
  beforeEach(async () => {
    vi.resetModules();
    await initDb();
  });

  describe('saveGeneratorSession', () => {
    it('should save session without throwing', async () => {
      const { saveGeneratorSession } = await import('@/lib/generatorSessionStorage');
      const state = {
        messages: [{ role: 'user' as const, content: 'hello', timestamp: new Date().toISOString() }],
        chatInput: '',
        generatedText: 'test',
        generatedHtml: '<p>test</p>',
        generatedTitle: 'Test Title',
        layoutHtml: '',
        layoutStrategyJson: '',
        selectedTemplateId: 'tmpl_1',
      };
      await expect(saveGeneratorSession('gen_1', state)).resolves.not.toThrow();
    });
  });

  describe('getAllGeneratorSessions', () => {
    it('should return saved sessions', async () => {
      const { saveGeneratorSession, getAllGeneratorSessions } = await import('@/lib/generatorSessionStorage');
      await saveGeneratorSession('gen_a', {
        messages: [{ role: 'user' as const, content: 'a', timestamp: new Date().toISOString() }],
        chatInput: '',
        generatedText: 'a',
        generatedHtml: '',
        generatedTitle: 'A',
        layoutHtml: '',
        layoutStrategyJson: '',
        selectedTemplateId: '',
      });
      const all = await getAllGeneratorSessions();
      expect(all.length).toBeGreaterThanOrEqual(1);
      const ids = all.map((s) => s.id);
      expect(ids).toContain('gen_a');
    });

    it('should filter out invalid sessions', async () => {
      const { saveGeneratorSession, getAllGeneratorSessions } = await import('@/lib/generatorSessionStorage');
      await saveGeneratorSession('gen_empty', {
        messages: [],
        chatInput: '',
        generatedText: '',
        generatedHtml: '',
        generatedTitle: '',
        layoutHtml: '',
        layoutStrategyJson: '',
        selectedTemplateId: '',
      });
      const all = await getAllGeneratorSessions();
      const ids = all.map((s) => s.id);
      expect(ids).not.toContain('gen_empty');
    });
  });

  describe('loadGeneratorSession', () => {
    it('should return null for non-existent session', async () => {
      const { loadGeneratorSession } = await import('@/lib/generatorSessionStorage');
      const result = await loadGeneratorSession('non-existent');
      expect(result).toBeNull();
    });

    it('should round-trip session data', async () => {
      const { saveGeneratorSession, loadGeneratorSession } = await import('@/lib/generatorSessionStorage');
      const state = {
        messages: [
          { role: 'user' as const, content: 'hi', timestamp: '2024-01-01T00:00:00.000Z' },
          { role: 'assistant' as const, content: 'hello', timestamp: '2024-01-01T00:00:01.000Z' },
        ],
        chatInput: 'draft input',
        generatedText: 'article text',
        generatedHtml: '<p>article</p>',
        generatedTitle: 'My Article',
        layoutHtml: '<div>layout</div>',
        layoutStrategyJson: '{"type":"default"}',
        selectedTemplateId: 'tmpl_1',
      };
      await saveGeneratorSession('gen_rt', state);
      const loaded = await loadGeneratorSession('gen_rt');
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe('gen_rt');
      expect(loaded!.state.messages).toHaveLength(2);
      expect(loaded!.state.generatedTitle).toBe('My Article');
      expect(loaded!.state.layoutHtml).toBe('<div>layout</div>');
      expect(loaded!.state.selectedTemplateId).toBe('tmpl_1');
    });
  });

  describe('deleteGeneratorSession', () => {
    it('should delete a session', async () => {
      const { saveGeneratorSession, deleteGeneratorSession, loadGeneratorSession } = await import('@/lib/generatorSessionStorage');
      await saveGeneratorSession('gen_del', {
        messages: [{ role: 'user' as const, content: 'x', timestamp: new Date().toISOString() }],
        chatInput: '',
        generatedText: 'x',
        generatedHtml: '',
        generatedTitle: 'X',
        layoutHtml: '',
        layoutStrategyJson: '',
        selectedTemplateId: '',
      });
      await deleteGeneratorSession('gen_del');
      const result = await loadGeneratorSession('gen_del');
      expect(result).toBeNull();
    });

    it('should not throw when deleting non-existent session', async () => {
      const { deleteGeneratorSession } = await import('@/lib/generatorSessionStorage');
      await expect(deleteGeneratorSession('non-existent')).resolves.not.toThrow();
    });
  });

  describe('clearAllGeneratorSessions', () => {
    it('should clear all generator sessions', async () => {
      const { saveGeneratorSession, getAllGeneratorSessions, clearAllGeneratorSessions } = await import('@/lib/generatorSessionStorage');
      await saveGeneratorSession('gen_clear1', {
        messages: [{ role: 'user' as const, content: 'x', timestamp: new Date().toISOString() }],
        chatInput: '',
        generatedText: 'x',
        generatedHtml: '',
        generatedTitle: 'X',
        layoutHtml: '',
        layoutStrategyJson: '',
        selectedTemplateId: '',
      });
      await saveGeneratorSession('gen_clear2', {
        messages: [{ role: 'user' as const, content: 'y', timestamp: new Date().toISOString() }],
        chatInput: '',
        generatedText: 'y',
        generatedHtml: '',
        generatedTitle: 'Y',
        layoutHtml: '',
        layoutStrategyJson: '',
        selectedTemplateId: '',
      });
      await clearAllGeneratorSessions();
      const all = await getAllGeneratorSessions();
      expect(all).toHaveLength(0);
    });
  });
});
