import { annotateDiagnostics, createEditorialSession, EditorialSessionSchema, hashText, type EditorialSession } from './editorialTypes';
/** Read-time, non-destructive migration. No v2 stamps or confirmation are invented. */
export function normalizeLegacySession(raw: unknown): EditorialSession {
  if (EditorialSessionSchema.is(raw)) return EditorialSessionSchema.parse(raw);
  const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
  const outer = object(raw), state = outer.state ? object(outer.state) : outer;
  const text = (v: unknown) => typeof v === 'string' ? v : '';
  const body = text(state.generatedText) || text(outer.content_text) || text(outer.contentText);
  const html = text(state.layoutHtml) || text(state.generatedHtml) || text(outer.content_html) || text(outer.contentHtml);
  let params = object(outer.paramsJson);
  try { if (typeof outer.params_json === 'string') params = object(JSON.parse(outer.params_json)); } catch { /* damaged metadata does not invent a title */ }
  const title = text(state.generatedTitle) || text(outer.title) || text(params.title) || body.match(/^# ([^\r\n]+)/)?.[1] || '';
  const handoff = object(state.editorial);
  const damaged = outer.schemaVersion !== undefined || typeof raw === 'string';
  const confirmed = !damaged && handoff.status === 'confirmed' && !!body && !!html;
  const mode = damaged ? 'damaged' : confirmed ? 'confirmed' : handoff.status === 'pending' ? 'pending' : 'legacy-manual';
  const session = createEditorialSession(text(outer.id) || 'legacy-' + hashText(body + html).slice(0, 20));
  session.legacy = { mode, title, text: body, html, confirmed, originalConfirmation: confirmed ? structuredClone(state.editorial) : undefined, raw: structuredClone(raw) };
  session.phase = body ? 'incomplete' : 'planning';
  session.diagnostics = annotateDiagnostics([{ owner: 'compatibility', code: damaged ? 'legacy_damaged' : 'legacy_requires_validation', message: 'Historical snapshot retained; no v2 review or confirmation granted.', refs: [] }]);
  return session;
}
