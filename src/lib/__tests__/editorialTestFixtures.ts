import { hashText, type EditorialSession } from '../editorialTypes';
import { applyEditorTaskPatch } from '../editorialTask';
/** Real grounded minimal contract for ready-state tests, not a positive revision as a certificate. */
export function seedTestTask(s: EditorialSession): EditorialSession {
  let e = s.evidence.find(e => e.kind === 'editor_message' && e.text.trim());
  if (!e) { const text = 'Publish a nonempty public article.'; e = { id: 'test-basis', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: {}, context: { scenario: 'real' } }; s.evidence.push(e); }
  const refs = [{ evidenceId: e.id, revision: e.revision, start: 0, end: e.text.length, quote: e.text }];
  Object.assign(s, applyEditorTaskPatch(s, { baseRevision: s.task.revision, refs, objective: s.task.objective || 'Publish public article', intents: s.task.intents.length ? s.task.intents : ['inform'], criteria: [{ id: 'test-minimum', origin: 'user', refs, severity: 'blocking', verification: 'deterministic', rule: { kind: 'length', min: 1, unit: 'visible_characters' } }] }));
  return s;
}
