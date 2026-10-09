import { describe, it, expect, beforeEach } from 'vitest';
import {
  getAllTemplates,
  saveTemplate,
  deleteTemplate,
  getAllUserArticles,
  saveUserArticle,
  deleteUserArticle,
} from '../../src/lib/libraryStorage';
import { initDb } from '../../src/hooks/useDb';
import type { StyleTemplate, UserArticle } from '../../src/types';

describe('libraryStorage', () => {
  beforeEach(async () => {
    await initDb();
  });

  it('should save and retrieve templates', async () => {
    const template: StyleTemplate = {
      id: 't1',
      name: '测试模板',
      description: 'desc',
      sourceType: 'user-generated',
      structureJson: { intro: 'intro' },
      formSchema: [],
      coCreationPrompt: 'prompt',
      sampleSnippets: 'sample',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveTemplate(template);
    const templates = await getAllTemplates();
    const userTemplate = templates.find((t) => t.id === 't1');
    expect(userTemplate).toBeDefined();
    expect(userTemplate!.name).toBe('测试模板');
  });

  it('should delete a template', async () => {
    const template: StyleTemplate = {
      id: 't2',
      name: '临时模板',
      description: '',
      sourceType: 'user-generated',
      structureJson: {},
      formSchema: [],
      coCreationPrompt: '',
      sampleSnippets: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveTemplate(template);
    await deleteTemplate('t2');
    const templates = await getAllTemplates();
    expect(templates.find((t) => t.id === 't2')).toBeUndefined();
  });

  it('should save and retrieve user articles', async () => {
    const article: UserArticle = {
      id: 'a1',
      title: '测试文章',
      sourceUrl: 'https://example.com',
      content: 'content',
      templateId: null,
      tags: ['tag1'],
      createdAt: Date.now(),
    };
    await saveUserArticle(article);
    const articles = await getAllUserArticles();
    expect(articles).toHaveLength(1);
    expect(articles[0].title).toBe('测试文章');
  });
});
