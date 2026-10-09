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
