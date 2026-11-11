import { getDb } from '@/hooks/useDb';
import { EditorialSessionSchema, stableJson, type EditorialSession } from './editorialTypes';
import { normalizeLegacySession } from './editorialCompatibility';
import type { EditorialHandoff } from './editorialAgent';

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
  editorial?: EditorialHandoff;
  editorialSession?: EditorialSession;
  creationMode?: 'agent' | 'manual';
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

  let editorialSession: EditorialSession | undefined;
  if (parsed.editorialSession !== undefined) {
    editorialSession = normalizeLegacySession(parsed.editorialSession);
    // Damaged v2 state is preserved for recovery, never implicitly unlocked.
    editorialSession.sessionId = row.id;
  } else if (parsed.editorial) {
    editorialSession = normalizeLegacySession({id:row.id,state:{...parsed,generatedText:row.content_text,generatedHtml:row.content_html}});
    if (editorialSession.legacy?.confirmed) editorialSession.selectedOutput='legacy';
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
      editorial: (parsed.editorial as EditorialHandoff | undefined),
      editorialSession,
      creationMode: parsed.creationMode === 'manual' ? 'manual' : 'agent',
    },
    createdAt: row.created_at,
    updatedAt: row.created_at,
  };
}

function isValidSession(session: GeneratorSession): boolean {
  return !!session.state.editorialSession || session.state.messages.length > 0 || session.state.generatedText.length > 0;
}

export async function saveGeneratorSession(
  sessionId: string,
  state: GeneratorSessionState
): Promise<void> {
  const db = await getDb();
  const row = stateToRow(sessionId, state);
  const rows = await db.select<GeneratorSessionRow[]>('SELECT * FROM generated_drafts WHERE id = ? AND mode = ?', [sessionId, 'generator-session']);
  if (rows.length) {
    const previous = JSON.parse(rows[0].params_json || '{}') as GeneratorSessionState;
    const old = previous.editorialSession, next = state.editorialSession;
    if (old && (!next || next.sessionId !== sessionId || next.revision < old.revision || next.revision === old.revision && stableJson(next) !== stableJson(old))) throw new Error('stale_persistence');
    const result = await db.execute('UPDATE generated_drafts SET template_id = ?, params_json = ?, content_html = ?, content_text = ?, created_at = ? WHERE id = ? AND mode = ? AND params_json = ?', [row.template_id,row.params_json,row.content_html,row.content_text,row.created_at,sessionId,'generator-session',rows[0].params_json]);
    assertWritten(result);
  } else {
    const result = await db.execute(`INSERT OR IGNORE INTO generated_drafts (id, template_id, mode, params_json, content_html, content_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, [row.id,row.template_id,row.mode,row.params_json,row.content_html,row.content_text,row.created_at]);
    assertWritten(result);
  }
}
function assertWritten(result: unknown) {
 if (!result || typeof result !== 'object' || !('rowsAffected' in result) || result.rowsAffected !== 1) throw new Error('stale_persistence');
}
/** A single SQL CAS covers both native SQLite and the web IndexedDB transaction. No read/replace race. */
export async function compareAndSaveEditorialSession(sessionId: string, state: GeneratorSessionState, next: EditorialSession, expectedRevision: number): Promise<void> {
 EditorialSessionSchema.parse(next);
 if (next.sessionId !== sessionId || next.revision !== expectedRevision + 1) throw new Error('stale_persistence');
 const db=await getDb(); const rows=await db.select<GeneratorSessionRow[]>('SELECT * FROM generated_drafts WHERE id = ? AND mode = ?', [sessionId,'generator-session']);
 const old=rows[0]; if (!old) throw new Error('stale_persistence');
 const previous=JSON.parse(old.params_json || '{}') as GeneratorSessionState;
 if (previous.editorialSession?.sessionId !== sessionId || previous.editorialSession.revision !== expectedRevision || stableJson(previous.editorialSession) !== stableJson(state.editorialSession)) throw new Error('stale_persistence');
 const row=stateToRow(sessionId,{...state,editorialSession:next,editorial:{status:'confirmed',notes:state.editorial?.notes ?? [],sources:state.editorial?.sources ?? []}});
 assertWritten(await db.execute('UPDATE generated_drafts SET params_json = ?, content_html = ?, content_text = ? WHERE id = ? AND mode = ? AND params_json = ?', [row.params_json,row.content_html,row.content_text,sessionId,'generator-session',old.params_json]));
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
