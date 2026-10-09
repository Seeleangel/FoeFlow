import { getDb } from '@/hooks/useDb';
import type { GeneratedDraft } from '@/types';

export interface DraftRow {
  id: string;
  template_id: string;
  mode: string;
  params_json: string;
  content_html: string;
  content_text: string;
  created_at: number;
}

function mapRowToDraft(row: DraftRow): GeneratedDraft {
  let paramsJson: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.params_json || '{}');
    if (parsed && typeof parsed === 'object') {
      paramsJson = parsed;
    }
  } catch (e) {
    console.warn('[draftStorage] Failed to parse params_json:', e);
  }
  return {
    id: row.id,
    templateId: row.template_id,
    mode: row.mode as GeneratedDraft['mode'],
    paramsJson,
    contentHtml: row.content_html,
    contentText: row.content_text,
    createdAt: row.created_at,
  };
}

export async function getAllDrafts(): Promise<GeneratedDraft[]> {
  const db = await getDb();
  const rows = await db.select<DraftRow[]>(
    "SELECT * FROM generated_drafts WHERE mode IN ('quick', 'co-creation', 'generator-draft') ORDER BY created_at DESC"
  );
  return rows.map(mapRowToDraft);
}

export async function saveDraft(draft: GeneratedDraft): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO generated_drafts (id, template_id, mode, params_json, content_html, content_text, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      draft.id,
      draft.templateId,
      draft.mode,
      JSON.stringify(draft.paramsJson),
      draft.contentHtml,
      draft.contentText,
      draft.createdAt,
    ]
  );
}

export async function deleteDraft(id: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM generated_drafts WHERE id = ?', [id]);
}
