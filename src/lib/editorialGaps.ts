import { hashText, stableJson, type EditorialSession, type Gap, type QuestionBatch, type EvidenceRef } from './editorialTypes';
import { resolveFacts, selectorsEquivalent, selectorKey, permissionAllows, validRefs } from './editorialFacts';
import { sourceRequirementSatisfied, sourceWaiver } from './editorialAcceptance';
import { applyEditorTaskPatch } from './editorialTask';
export function latestEditorMessageId(s: EditorialSession): string | undefined { return s.evidence.filter(e => e.kind === 'editor_message').slice(-1)[0]?.provenance.messageId; }
export function deriveGaps(s: EditorialSession): Gap[] {
  const result = resolveFacts(s); const gaps: Gap[] = []; const latest = latestEditorMessageId(s);
  const add = (gap: Gap) => {
    const old = s.gaps.find(old => old.id === gap.id);
    if (gap.state === 'open' && old?.state === 'asked' && old.askedAtMessageId === latest) { gap.state = 'asked'; gap.askedAtMessageId = old.askedAtMessageId; }
    gaps.push(gap);
  };
  for (const requirement of s.task.requirements) {
    const claims = result.claims.filter(c => selectorsEquivalent(s, c.selector, requirement.selector) && c.epistemic === 'supported' && c.visibility === 'public');
    const conflict = result.conflicts.find(g => selectorsEquivalent(s, g.selector, requirement.selector));
    const omitted = s.task.permittedOmissions.some(o => o.requirementId === requirement.id && validRefs(s, o.refs) && o.refs.every(ref => s.evidence.find(e => e.id === ref.evidenceId)?.kind === 'editor_message'));
    add({ id: 'gap-' + hashText(requirement.id + selectorKey(requirement.selector)).slice(0,24), requirementId: requirement.id, selector: requirement.selector, kind: conflict?.kind ?? 'missing', label: requirement.label, reason: requirement.reason, state: omitted ? 'waived' : claims.length && !conflict ? 'resolved' : 'open', blocking: requirement.necessity === 'blocking', alternatives: conflict?.alternatives ?? (requirement.resolution === 'omit_or_replace' ? [{ id: 'wait', label: '等待补充或授权', refs: [] }, { id: 'replace', label: '由编辑选择已授权替代素材', refs: [] }, { id: 'omit', label: '由编辑明确省略该项', refs: [] }] : []), resolutionClaimIds: claims.map(c => c.id) });
  }
  for (const conflict of result.conflicts) if (!gaps.some(g => selectorsEquivalent(s, g.selector, conflict.selector) && g.state !== 'resolved')) add(structuredClone(conflict));
  for (const criterion of s.task.criteria) {
    if (criterion.rule.kind !== 'permission') continue;
    const rule = criterion.rule;
    for (const subjectId of rule.subjectIds) {
      const allowed = permissionAllows(s, subjectId, { channel: rule.channel ?? 'public', purpose: rule.use, identity: rule.identity ?? 'not_applicable' });
      add({ id: 'permission-' + hashText(criterion.id + subjectId + stableJson(rule)).slice(0,24), requirementId: criterion.id, selector: { scopeId: subjectId, predicate: 'permission:' + rule.use }, kind: 'permission', label: (s.scopes.find(scope => scope.id === subjectId)?.label ?? subjectId) + '的使用授权', reason: `用途：${rule.use}；渠道：${rule.channel ?? 'public'}；身份：${rule.identity ?? 'not_applicable'}`, state: allowed ? 'resolved' : 'open', blocking: criterion.severity === 'blocking', alternatives: [{ id: 'wait', label: '等待授权', refs: [] }, ...s.scopes.filter(scope => scope.kind === 'asset' && scope.id !== subjectId && permissionAllows(s, scope.id, { channel: rule.channel ?? 'public', purpose: rule.use, identity: rule.identity ?? 'not_applicable' })).map(scope => ({ id: 'replace:' + scope.id, label: '由编辑明确选择替换为' + scope.label, refs: [] })), { id: 'replace', label: '编辑选择已授权替代素材', refs: [] }, { id: 'omit', label: '编辑选择不含此素材的文字稿', refs: [] }], resolutionClaimIds: [] });
    }
  }
  for (const source of s.task.requiredSources) {
    const satisfied = sourceRequirementSatisfied(s, source), waived = sourceWaiver(s, source.id);
    add({ id: 'source-' + hashText(source.id).slice(0,24), requirementId: source.id, selector: { scopeId: 'source:' + source.id, predicate: 'source_read' }, kind: 'source_unavailable', label: source.selector.title ?? source.selector.documentId ?? source.id, reason: source.purpose, state: waived ? 'waived' : satisfied ? 'resolved' : 'open', blocking: true, alternatives: [{ id: 'supply', label: '提供指定素材', refs: [] }, { id: 'waive', label: '编辑明确豁免并留记录', refs: [] }], resolutionClaimIds: [] });
  }
  for (const diagnostic of [...s.diagnostics, ...result.diagnostics]) {
    if (gaps.some(g => g.kind === 'plan_ambiguity' && g.requirementId === diagnostic.code)) continue;
    add({ id: 'diagnostic-' + hashText(diagnostic.code).slice(0,24), requirementId: diagnostic.code, selector: { scopeId: 'task', predicate: diagnostic.code }, kind: 'plan_ambiguity', label: '任务依据或证据需要明确', reason: diagnostic.message, state: 'open', blocking: true, alternatives: [], resolutionClaimIds: [] });
  }
  return [...new Map(gaps.map(g => [g.id, g])).values()];
}
export function buildQuestion(s: EditorialSession, gapIds: string[]): QuestionBatch {
  const gaps = deriveGaps(s); const requested = [...new Set(gapIds)];
  if (!requested.length) throw new Error('empty_question');
  const selected = requested.map(id => {
    const gap = gaps.find(g => g.id === id); if (!gap || gap.state === 'resolved' || gap.state === 'waived') throw new Error('invalid_gap_selection');
    if (gap.state === 'asked') throw new Error('awaiting_editor_reply'); return gap;
  });
  const batch = selected.slice(0,6); const ids = batch.map(g => g.id);
  return { id: 'q-' + hashText(stableJson(ids) + (latestEditorMessageId(s) ?? '')).slice(0,24), gapIds: ids, remainingGapIds: selected.slice(6).map(g => g.id), items: batch.map(g => ({ gapId: g.id, subject: s.scopes.find(scope => scope.id === g.selector.scopeId)?.label ?? g.label, requested: g.label, why: g.reason, options: g.alternatives.map(option => option.label) })) };
}
export function formatQuestion(q: QuestionBatch): string {
  return '请确认以下具体事项：\n' + q.items.map((item,i) => `${i+1}. ${item.subject}：${item.requested}（${item.why}）${item.options.length ? '；可选：' + item.options.join(' / ') : ''}`).join('\n') + (q.remainingGapIds?.length ? `\n还有 ${q.remainingGapIds.length} 项保留在待补清单中。` : '');
}
export function legacyFieldsToGapIds(s: EditorialSession, fields: string[]): string[] {
  const gaps = deriveGaps(s).filter(g => g.state === 'open'); const ids: string[] = [];
  for (const field of fields) {
    const matching = gaps.filter(g => g.selector.predicate === field);
    if (field === 'detail' || matching.length !== 1) throw new Error('ambiguous_legacy_fields'); ids.push(matching[0].id);
  }
  return [...new Set(ids)];
}
/** Editor-only choice port. Model answers cannot call this function. Waiting never resolves a gap. */
export function applyGapChoice(s: EditorialSession, gapId: string, choice: 'wait' | 'omit' | 'waive', refs: EvidenceRef[]): EditorialSession {
  const gap = deriveGaps(s).find(g => g.id === gapId); if (!gap || !validRefs(s, refs)) throw new Error('invalid_editor_choice');
  if (choice === 'wait') return structuredClone(s);
  if (choice === 'waive' && gap.kind === 'source_unavailable') return applyEditorTaskPatch(s, { baseRevision: s.task.revision, refs, sourceWaivers: [{ sourceRequirementId: gap.requirementId, actor: 'editor', refs, reason: '编辑明确选择豁免指定来源' }] });
  const requirement = s.task.requirements.find(r => r.id === gap.requirementId);
  if (choice !== 'omit' || !requirement || requirement.resolution !== 'omit_or_replace') throw new Error('choice_requires_task_revision');
  return applyEditorTaskPatch(s, { baseRevision: s.task.revision, refs, permittedOmissions: [{ requirementId: requirement.id, refs }] });
}
