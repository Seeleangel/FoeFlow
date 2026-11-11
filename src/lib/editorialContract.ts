import { TaskContractSchema, stableJson, type EditorialSession, type TaskContract } from './editorialTypes';
import { validRefs } from './editorialFacts';
/** Shared semantic minimum; neither a restored revision nor a generic snapshot certifies coverage. */
export function taskContractValid(s: EditorialSession, task: TaskContract = s.task): boolean {
  if (!TaskContractSchema.is(task) || task.revision <= 0 || !task.objective.trim() || !task.intents.length || !task.requirements.length && !task.criteria.length && !task.requiredSources.length) return false;
  if (task.coverage?.status !== 'validated' || !validRefs(s, task.coverage.refs)) return false;
  if (task.coverage.refs.some(ref => { const kind = s.evidence.find(e => e.id === ref.evidenceId)?.kind; return kind !== 'editor_message' && kind !== 'import'; })) return false;
  for (const criterion of task.criteria) {
    if (criterion.origin === 'user' && criterion.refs.some(ref => s.evidence.find(e => e.id === ref.evidenceId)?.kind !== 'editor_message')) return false;
    const rule = criterion.rule;
    if (rule.kind === 'length' && (rule.min === undefined && rule.max === undefined || (rule.min ?? 0) > (rule.max ?? Infinity))) return false;
    if ((rule.kind === 'include_facts' || rule.kind === 'exclude_claims') && !rule.factIds.length || rule.kind === 'permission' && !rule.subjectIds.length || rule.kind === 'preserve_blocks' && !rule.blockHashes.length || rule.kind === 'source_read' && !task.requiredSources.some(source => source.id === rule.sourceRequirementId)) return false;
  }
  const editorRefs = (refs: import('./editorialTypes').EvidenceRef[]) => validRefs(s,refs) && refs.every(ref => s.evidence.find(e => e.id === ref.evidenceId)?.kind === 'editor_message');
  if (task.sourceWaivers.some(waiver => !task.requiredSources.some(source => source.id === waiver.sourceRequirementId) || !editorRefs(waiver.refs)) || task.permittedOmissions.some(omit => !task.requirements.some(r => r.id === omit.requirementId) || !editorRefs(omit.refs))) return false;
  const obligations = [...task.requirements, ...task.criteria, ...task.requiredSources];
  return new Set(obligations.map(item => item.id)).size === obligations.length && obligations.every(item => validRefs(s, item.refs)) && task.requiredSources.every(source => !!source.selector.title || !!source.selector.documentId);
}

/** Generic tool snapshots have model authority, never the editor's destructive task-edit authority. */
export function taskSnapshotMonotonic(previous: TaskContract, next: TaskContract): boolean {
  const same = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);
  if (!same(previous.permittedOmissions,next.permittedOmissions) || !same(previous.sourceWaivers,next.sourceWaivers)) return false;
  if (previous.revision === 0) return true;
  return previous.objective === next.objective && previous.readerAction === next.readerAction && previous.intents.every(value => next.intents.includes(value)) && previous.targetScopes.every(id => next.targetScopes.includes(id)) &&
    (['requirements', 'criteria', 'requiredSources'] as const).every(key => previous[key].every(old => next[key].some(item => same(old, item)))) && same(previous.permittedOmissions, next.permittedOmissions) && same(previous.sourceWaivers, next.sourceWaivers);
}
