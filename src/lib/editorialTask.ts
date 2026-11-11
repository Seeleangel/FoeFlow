import { taskContractValid } from './editorialContract';
import { TaskContractSchema, stableJson, type EditorialSession, type EvidenceRef, type TaskContract, type AcceptanceCriterion } from './editorialTypes';
import { validRefs } from './editorialFacts';
import { invalidateEditorialStamps } from './editorialState';
/** Arrays are upserts, never replacement snapshots. Destructive changes need the editor-only port. */
export interface TaskPatch {
  baseRevision: number; refs: EvidenceRef[]; objective?: string; intents?: TaskContract['intents']; readerAction?: string; targetScopes?: string[];
  requirements?: TaskContract['requirements']; requiredSources?: TaskContract['requiredSources']; criteria?: AcceptanceCriterion[];
  permittedOmissions?: TaskContract['permittedOmissions']; sourceWaivers?: TaskContract['sourceWaivers'];
  removeRequirementIds?: string[]; removeSourceIds?: string[]; removeCriterionIds?: string[];
}
const keys = new Set(['baseRevision', 'refs', 'objective', 'intents', 'readerAction', 'targetScopes', 'requirements', 'requiredSources', 'criteria', 'permittedOmissions', 'sourceWaivers', 'removeRequirementIds', 'removeSourceIds', 'removeCriterionIds']);
function patchTask(session: EditorialSession, raw: unknown, authority: 'model' | 'editor' | 'template'): EditorialSession {
  const reject = (): EditorialSession => ({ ...structuredClone(session), diagnostics: [...session.diagnostics.filter(d => d.code !== 'task_patch_rejected'), { owner:'task:patch', code: 'task_patch_rejected', message: 'Invalid, ungrounded, stale, empty or authority-increasing task patch. Editor intervention is required for removing or weakening obligations.', refs: [] }] });
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(k => !keys.has(k))) return reject();
    const p = raw as TaskPatch;
    if (p.baseRevision !== session.task.revision || !Array.isArray(p.refs) || !validRefs(session, p.refs) || p.refs.some(ref => {
      const kind = session.evidence.find(e => e.id === ref.evidenceId)?.kind; return authority === 'template' ? kind !== 'editor_message' && kind !== 'import' : kind !== 'editor_message';
    })) return reject();
    const t = structuredClone(session.task);
    const removing = (p.removeRequirementIds?.length ?? 0) + (p.removeSourceIds?.length ?? 0) + (p.removeCriterionIds?.length ?? 0);
    if (authority !== 'editor' && (removing || p.sourceWaivers?.length || p.permittedOmissions?.length)) return reject();
    for (const key of ['objective', 'intents', 'readerAction', 'targetScopes'] as const) {
      if (p[key] === undefined) continue;
      if (authority !== 'editor' && t.revision > 0 && stableJson(t[key]) !== stableJson(p[key])) {
        const previous = t[key], incoming = p[key];
        if (!Array.isArray(previous) || !Array.isArray(incoming) || !previous.every(value => incoming.some(next => next === value))) return reject();
      }
    }
    if (p.objective !== undefined) t.objective = p.objective;
    if (p.intents !== undefined) t.intents = p.intents;
    if (p.readerAction !== undefined) t.readerAction = p.readerAction;
    if (p.targetScopes !== undefined) t.targetScopes = p.targetScopes;
    const upsert = <T extends { id: string; refs: EvidenceRef[] }>(old: T[], incoming: T[] | undefined, remove: string[] | undefined): T[] => {
      if (remove && (!Array.isArray(remove) || !remove.every(id => typeof id === 'string' && old.some(item => item.id === id)))) throw new Error('unknown_removal');
      const items = new Map(old.filter(item => !remove?.includes(item.id)).map(item => [item.id, item]));
      for (const item of incoming ?? []) {
        if (!validRefs(session, item.refs) || item.refs.some(ref => !p.refs.some(basis => basis.evidenceId === ref.evidenceId && basis.revision === ref.revision && basis.start <= ref.start && basis.end >= ref.end))) throw new Error('ungrounded_item');
        const previous = items.get(item.id);
        if (previous && stableJson(previous) !== stableJson(item) && authority !== 'editor') throw new Error('cannot_replace_obligation');
        items.set(item.id, item);
      }
      return [...items.values()];
    };
    t.requirements = upsert(t.requirements, p.requirements, p.removeRequirementIds);
    t.requiredSources = upsert(t.requiredSources, p.requiredSources, p.removeSourceIds);
    t.criteria = upsert(t.criteria, p.criteria, p.removeCriterionIds);
    if ((p.criteria ?? []).some(c => c.origin !== (authority === 'template' ? 'template' : 'user'))) return reject();
    if (authority === 'template' && (p.criteria ?? []).some(c => session.task.criteria.some(old => old.origin === 'user' && (old.id === c.id || old.rule.kind === c.rule.kind)))) return reject();
    if (p.permittedOmissions) t.permittedOmissions = [...t.permittedOmissions, ...p.permittedOmissions];
    if (p.sourceWaivers) t.sourceWaivers = [...t.sourceWaivers, ...p.sourceWaivers];
    t.coverage = { status: 'validated', refs: p.refs };
    if (stableJson(t) === stableJson(session.task)) return {...structuredClone(session),diagnostics:session.diagnostics.filter(d=>d.code!=='task_patch_rejected')};
    t.revision++; const checked = TaskContractSchema.parse(t);
    if (!taskContractValid(session, checked)) return reject();
    const allIds = [...t.requirements, ...t.requiredSources, ...t.criteria].map(item => item.id);
    if (new Set(allIds).size !== allIds.length || t.criteria.some(c => c.rule.kind === 'length' && (c.rule.min === undefined && c.rule.max === undefined || (c.rule.min ?? 0) > (c.rule.max ?? Infinity))) || t.requiredSources.some(source => !source.selector.documentId && !source.selector.title)) return reject();
    if (t.sourceWaivers.some(w => !t.requiredSources.some(source => source.id === w.sourceRequirementId) || !validRefs(session, w.refs) || w.refs.some(ref => session.evidence.find(e => e.id === ref.evidenceId)?.kind !== 'editor_message')) || t.permittedOmissions.some(o => !t.requirements.some(r => r.id === o.requirementId) || !validRefs(session, o.refs))) return reject();
    const next = invalidateEditorialStamps(session); next.task = checked; next.revision++;
    next.diagnostics = next.diagnostics.filter(d => d.code !== 'task_patch_rejected'); return next;
  } catch { return reject(); }
}
export function applyTaskPatch(session: EditorialSession, patch: unknown): EditorialSession { return patchTask(session, patch, 'model'); }
/** Only explicit editor choices/approved task edits may call this; never expose it as a model tool. */
export function applyEditorTaskPatch(session: EditorialSession, patch: unknown): EditorialSession { return patchTask(session, patch, 'editor'); }
/** Trusted template loader port, never a source-document instruction. */
export function applyTemplateTaskPatch(session: EditorialSession, patch: unknown): EditorialSession { return patchTask(session, patch, 'template'); }
