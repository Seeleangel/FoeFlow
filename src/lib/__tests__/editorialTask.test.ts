import { describe, it, expect } from 'vitest';
import { createEditorialSession, hashText, type EvidenceRef, type AcceptanceCriterion } from '../editorialTypes';
import { applyTaskPatch, applyEditorTaskPatch, applyTemplateTaskPatch } from '../editorialTask';
function fixture() {
  const s = createEditorialSession('s'), text = 'Prepare a reminder. The editor explicitly changes the task and waives the unavailable source.';
  s.evidence = [{ id: 'e', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: {}, context: { scenario: 'real' } }];
  const refs: EvidenceRef[] = [{ evidenceId: 'e', revision: 1, start: 0, end: text.length, quote: text }];
  const criterion: AcceptanceCriterion = { id: 'tone', origin: 'user', refs, severity: 'blocking', verification: 'semantic', rule: { kind: 'semantic', instruction: 'Use a helpful tone.' } };
  const patch = { baseRevision: 0, refs, objective: 'Write a useful reminder', intents: ['inform'], criteria: [criterion] };
  return { s, refs, criterion, patch };
}
describe('evidence-backed task revisions', () => {
  it('keeps reminders/comments free of invented time, location, deadline or registration defaults', () => {
    const { s, patch } = fixture(); const reminder = applyTaskPatch(s, patch); expect(reminder.task.requirements).toEqual([]);
    const comment = applyTaskPatch(s, { ...patch, intents: ['other'] }); expect(comment.task.requirements).toEqual([]);
    const action = applyTaskPatch(s, { ...patch, intents: ['call_to_action'], readerAction: 'Register using the supplied channel', requirements: [{ id: 'channel', selector: { scopeId: 'event', predicate: 'channel' }, label: 'Registration channel', reason: 'Reader needs an executable action', refs: patch.refs, necessity: 'blocking', resolution: 'supply_fact' }] });
    expect(action.task.requirements.map(r => r.selector.predicate)).toEqual(['channel']);
  });
  it('cannot delete or weaken obligations via a model patch, even with copied editor refs', () => {
    const { s, refs, patch } = fixture(); const first = applyTaskPatch(s, { ...patch, requiredSources: [{ id: 'src', selector: { documentId: 'doc' }, purpose: 'compare', refs, depth: 'full_document', state: 'pending' }] });
    const bad = applyTaskPatch(first, { baseRevision: 1, refs, removeSourceIds: ['src'] }); expect(bad.task.requiredSources).toHaveLength(1); expect(bad.diagnostics[0].code).toBe('task_patch_rejected');
    const weak = applyTaskPatch(first, { baseRevision: 1, refs, criteria: [{ ...first.task.criteria[0], severity: 'advisory' }] }); expect(weak.task.criteria[0].severity).toBe('blocking');
    const changed = applyEditorTaskPatch(first, { baseRevision: 1, refs, intents: ['inform'], removeSourceIds: ['src'] }); expect(changed.task.requiredSources).toEqual([]); expect(changed.task.revision).toBe(2);
  });
  it('records explicit editor waivers and keeps source obligations visible', () => {
    const { s, refs, patch } = fixture(); const first = applyTaskPatch(s, { ...patch, requiredSources: [{ id: 'src', selector: { title: 'Reference' }, purpose: 'read', refs, depth: 'full_document', state: 'unavailable' }] });
    const next = applyEditorTaskPatch(first, { baseRevision: 1, refs, sourceWaivers: [{ sourceRequirementId: 'src', refs, actor: 'editor', reason: 'Unavailable; proceed without it' }] });
    expect(next.task.sourceWaivers).toHaveLength(1); expect(next.task.requiredSources).toHaveLength(1);
    expect(applyTaskPatch(first, { baseRevision: 1, refs, sourceWaivers: next.task.sourceWaivers }).task.sourceWaivers).toEqual([]);
  });
  it('library instructions cannot create task obligations and templates cannot replace user constraints', () => {
    const { s, patch, refs, criterion } = fixture(); s.evidence[0].kind = 'library'; expect(applyTaskPatch(s, patch).task.revision).toBe(0);
    s.evidence[0].kind = 'editor_message'; const first = applyTaskPatch(s, patch);
    const next = applyTemplateTaskPatch(first, { baseRevision: 1, refs, criteria: [{ ...criterion, origin: 'template', severity: 'advisory' }] }); expect(next.task.criteria[0].origin).toBe('user');
  });
  it('reports stale, malformed and empty plans instead of silently passing', () => {
    const { s, patch } = fixture(); for (const bad of [{ ...patch, baseRevision: 10 }, { baseRevision: 0, refs: patch.refs, objective: 'Complex task', intents: ['inform'] }, { ...patch, criteria: [{}] }]) {
      const next = applyTaskPatch(s, bad); expect(next.task.revision).toBe(0); expect(next.diagnostics.length).toBeGreaterThan(0);
    }
  });
});
