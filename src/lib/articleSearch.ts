import { getDb } from '@/hooks/useDb';

export interface ArticleExample {
  title: string;
  snippet: string;
}

export async function searchArticleLibrary(keywords: string): Promise<ArticleExample[]> {
  const db = await getDb();

  const terms = keywords
    .replace(/[，,。、！？\s]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 0);

  if (terms.length === 0) return [];

  const likeClauses = terms.map(() => `(content_text LIKE ?)`).join(' OR ');
  const params: string[] = [];
  for (const t of terms) {
    params.push(`%${t}%`);
  }

  const rows = await db.select<{ params_json: string; content_text: string }[]>(
    `SELECT params_json, content_text FROM generated_drafts
     WHERE (${likeClauses})
       AND mode != 'generator-session'
     ORDER BY created_at DESC
     LIMIT 3`,
    params,
  );

  return rows.map((r) => {
    let title = '未命名';
    try {
      const parsed = JSON.parse(r.params_json || '{}');
      if (parsed && typeof parsed === 'object' && parsed.title) {
        title = String(parsed.title);
      }
    } catch { /* use fallback */ }
    return {
      title,
      snippet: (r.content_text || '').slice(0, 200),
    };
  });
}

export function formatArticleExamples(examples: ArticleExample[]): string {
  if (examples.length === 0) return '暂无相关范文。';
  return examples
    .map((e, i) => `${i + 1}. 【${e.title}】\n   ${e.snippet}...`)
    .join('\n\n');
}

/** Discovery metadata is not evidence and cannot issue a read receipt. */
export async function searchEditorialLibraryDocuments(query: string): Promise<{ documentId: string; title: string; snippet: string; contentHash: string }[]> {
  const { hashText } = await import('./editorialTypes');
  const db = await getDb(); const terms = query.normalize('NFKC').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!terms.length) return [];
  if (terms.length > 40) throw new Error('context_capacity');
  const params = terms.flatMap(term => ['%' + term + '%', '%' + term + '%']);
  const clauses = terms.map(() => '(title LIKE ? OR content LIKE ?)').join(' OR ');
  const articles = await db.select<{ id: string; title: string; content: string }[]>(`SELECT id, title, content FROM user_articles WHERE ${clauses} ORDER BY created_at DESC LIMIT 20`, params);
  const drafts = await db.select<{ id: string; params_json: string; content_text: string }[]>(`SELECT id, params_json, content_text FROM generated_drafts WHERE (${terms.map(() => '(params_json LIKE ? OR content_text LIKE ?)').join(' OR ')}) AND mode != 'generator-session' ORDER BY created_at DESC LIMIT 20`, params);
  return [...articles.map(row => ({ documentId: 'article:' + row.id, title: row.title, snippet: row.content.slice(0,720), contentHash: hashText(row.content) })), ...drafts.map(row => {
    let title = '未命名'; try { const value: unknown = JSON.parse(row.params_json || '{}'); if (value && typeof value === 'object' && 'title' in value && typeof value.title === 'string') title = value.title; } catch { /* keep fallback */ }
    return { documentId: 'draft:' + row.id, title, snippet: row.content_text.slice(0,720), contentHash: hashText(row.content_text) };
  })];
}
