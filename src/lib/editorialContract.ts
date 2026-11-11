import { TaskContractSchema, type EditorialSession, type TaskContract } from './editorialTypes';
import { validRefs } from './editorialFacts';
/** Shared semantic minimum; neither a restored revision nor a generic snapshot certifies coverage. */
export function taskContractValid(s: EditorialSession, task: TaskContract = s.task): boolean {
  if (!TaskContractSchema.is(task) || task.revision <= 0 || !task.objective.trim() || !task.intents.length || !task.requirements.length && !task.criteria.length && !task.requiredSources.length) return false;
  if (task.coverage?.status !== 'validated' || !validRefs(s, task.coverage.refs)) return false;
  const obligations = [...task.requirements, ...task.criteria, ...task.requiredSources];
  return new Set(obligations.map(item => item.id)).size === obligations.length && obligations.every(item => validRefs(s, item.refs)) && task.requiredSources.every(source => !!source.selector.title || !!source.selector.documentId);
}

/** Generic tool snapshots have model authority, never the editor's destructive task-edit authority. */
export function taskSnapshotMonotonic(previous: TaskContract, next: TaskContract): boolean {
  if (previous.revision === 0) return true;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  return previous.objective === next.objective && previous.readerAction === next.readerAction && previous.intents.every(value => next.intents.includes(value)) && previous.targetScopes.every(id => next.targetScopes.includes(id)) &&
    (['requirements', 'criteria', 'requiredSources'] as const).every(key => previous[key].every(old => next[key].some(item => same(old, item)))) && same(previous.permittedOmissions, next.permittedOmissions) && same(previous.sourceWaivers, next.sourceWaivers);
}
