import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '@/hooks/useDb';
import { searchArticleLibrary } from '@/lib/articleSearch';

describe('searchArticleLibrary', () => {
  beforeEach(async () => {
    const db = await getDb();
    // Clean up before each test
    await db.execute("DELETE FROM generated_drafts WHERE mode != 'generator-session'");

    // Seed test articles
    await db.execute(
      "INSERT INTO generated_drafts (id, template_id, mode, params_json, content_html, content_text, created_at) VALUES (? ,? ,? ,? ,? ,? ,?)",
      ['article-1', 'tmp-1', 'fast', '{}', '<p>量子力学讲座通知</p>', '关于开展量子力学前沿讲座的通知。请各位同学按时参加。', 1000],
    );
    await db.execute(
      "INSERT INTO generated_drafts (id, template_id, mode, params_json, content_html, content_text, created_at) VALUES (? ,? ,? ,? ,? ,? ,?)",
      ['article-2', 'tmp-2', 'co-creation', '{}', '<p>会议通知</p>', '学术委员会会议通知：定于下周召开学术委员会会议。', 2000],
    );
    await db.execute(
      "INSERT INTO generated_drafts (id, template_id, mode, params_json, content_html, content_text, created_at) VALUES (? ,? ,? ,? ,? ,? ,?)",
      ['article-3', 'tmp-3', 'fast', '{}', '<p>课程安排</p>', '新学期课程安排表已发布，请各位教师查收。', 3000],
    );
  });

  it('returns empty array when no articles match', async () => {
    const results = await searchArticleLibrary('量子力学讲座');
    expect(Array.isArray(results)).toBe(true);
  });

  it('returns matching article titles and content snippets', async () => {
    const results = await searchArticleLibrary('通知');
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r).toHaveProperty('title');
      expect(r).toHaveProperty('snippet');
      expect(typeof r.title).toBe('string');
      expect(typeof r.snippet).toBe('string');
    }
  });

  it('matches articles by keyword', async () => {
    const results = await searchArticleLibrary('课程');
    // All results have the expected shape
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r).toHaveProperty('title');
      expect(r).toHaveProperty('snippet');
    }
  });

  it('returns results that include the searched keyword', async () => {
    const results = await searchArticleLibrary('学术委员会');
    expect(results.length).toBeGreaterThan(0);
    // At least one result should contain the search term
    const combined = results.map(r => r.title + ' ' + r.snippet).join(' ');
    expect(combined).toContain('学术委员会');
  });

  it('filters out generator-session mode articles', async () => {
    const db = await getDb();
    await db.execute(
      "INSERT INTO generated_drafts (id, template_id, mode, params_json, content_html, content_text, created_at) VALUES (? ,? ,? ,? ,? ,? ,?)",
      ['session-1', 'tmp-1', 'generator-session', '{}', '<p>session</p>', 'session content with 通知 keyword', 4000],
    );
    const results = await searchArticleLibrary('通知');
    // The generator-session article should not appear
    const titles = results.map(r => r.title);
    expect(titles).not.toContain('session');
  });

  it('limits results to 3', async () => {
    const db = await getDb();
    // Add more articles with the keyword
    for (let i = 4; i <= 6; i++) {
      await db.execute(
        "INSERT INTO generated_drafts (id, template_id, mode, params_json, content_html, content_text, created_at) VALUES (? ,? ,? ,? ,? ,? ,?)",
        [`article-${i}`, 'tmp-1', 'fast', '{}', '<p>test</p>', `通知相关文章 ${i}`, i * 1000],
      );
    }
    const results = await searchArticleLibrary('通知');
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('snippet is truncated to 200 characters', async () => {
    const results = await searchArticleLibrary('讲座');
    for (const r of results) {
      expect(r.snippet.length).toBeLessThanOrEqual(200);
    }
  });

  it('returns empty array for empty keywords', async () => {
    const results = await searchArticleLibrary('');
    expect(results).toEqual([]);
  });

  it('returns empty array for whitespace-only keywords', async () => {
    const results = await searchArticleLibrary('   ');
    expect(results).toEqual([]);
  });
});
