import { getDb } from '@/hooks/useDb';

export interface GeneratorSessionState {
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
  }>;
  chatInput: string;
  generatedText: string;
  generatedHtml: string;
  generatedTitle: string;
  layoutHtml: string;
  layoutStrategyJson: string;
  styleSpecJson: string;
  selectedDirectionJson: string;
  selectedTemplateId: string;
}

export interface GeneratorSession {
  id: string;
  title: string;
  state: GeneratorSessionState;
  createdAt: number;
  updatedAt: number;
}

interface GeneratorSessionRow {
  id: string;
  template_id: string;
  mode: string;
  params_json: string;
  content_html: string;
  content_text: string;
  created_at: number;
}

function stateToRow(sessionId: string, state: GeneratorSessionState): GeneratorSessionRow {
  const paramsJson = JSON.stringify(state);
  return {
    id: sessionId,
    template_id: state.selectedTemplateId,
    mode: 'generator-session',
    params_json: paramsJson,
    content_html: state.generatedHtml,
    content_text: state.generatedText,
    created_at: Date.now(),
  };
}

function rowToSession(row: GeneratorSessionRow): GeneratorSession {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(row.params_json || '{}') as Record<string, unknown>;
  } catch (e) {
    console.warn('[generatorSessionStorage] Failed to parse params_json:', e);
  }

  return {
    id: row.id,
    title: (parsed.generatedTitle as string) || '未命名生成',
    state: {
      messages: (parsed.messages as GeneratorSessionState['messages']) || [],
      chatInput: (parsed.chatInput as string) || '',
      generatedText: row.content_text || '',
      generatedHtml: row.content_html || '',
      generatedTitle: (parsed.generatedTitle as string) || '',
      layoutHtml: (parsed.layoutHtml as string) || '',
      layoutStrategyJson: (parsed.layoutStrategyJson as string) || '',
      styleSpecJson: (parsed.styleSpecJson as string) || '',
      selectedDirectionJson: (parsed.selectedDirectionJson as string) || '',
      selectedTemplateId: row.template_id || '',
    },
    createdAt: row.created_at,
    updatedAt: row.created_at,
  };
}

function isValidSession(session: GeneratorSession): boolean {
  return session.state.messages.length > 0 || session.state.generatedText.length > 0;
}

export async function saveGeneratorSession(
  sessionId: string,
  state: GeneratorSessionState
): Promise<void> {
  const db = await getDb();
  const row = stateToRow(sessionId, state);
  await db.execute(
    `INSERT OR REPLACE INTO generated_drafts
     (id, template_id, mode, params_json, content_html, content_text, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.template_id, row.mode, row.params_json, row.content_html, row.content_text, row.created_at]
  );
}

export async function loadGeneratorSession(sessionId: string): Promise<GeneratorSession | null> {
  const db = await getDb();
  const rows = await db.select<GeneratorSessionRow[]>(
    'SELECT * FROM generated_drafts WHERE id = ? AND mode = ?',
    [sessionId, 'generator-session']
  );
  if (rows.length === 0) return null;
  const session = rowToSession(rows[0]);
  return isValidSession(session) ? session : null;
}

export async function getAllGeneratorSessions(): Promise<GeneratorSession[]> {
  const db = await getDb();
  const rows = await db.select<GeneratorSessionRow[]>(
    'SELECT * FROM generated_drafts WHERE mode = ? ORDER BY created_at DESC',
    ['generator-session']
  );
  return rows.map(rowToSession).filter(isValidSession);
}

export async function deleteGeneratorSession(sessionId: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    'DELETE FROM generated_drafts WHERE id = ? AND mode = ?',
    [sessionId, 'generator-session']
  );
}

export async function clearAllGeneratorSessions(): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM generated_drafts WHERE mode = ?",
    ['generator-session']
  );
}
