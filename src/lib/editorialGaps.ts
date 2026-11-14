import { hashText, stableJson, type EditorialSession, type Gap, type QuestionBatch, type EvidenceRef } from './editorialTypes';
import { resolveFacts, selectorsEquivalent, selectorKey, permissionAllows, validRefs } from './editorialFacts';
import { sourceRequirementSatisfied, sourceWaiver, validateAcceptance } from './editorialAcceptance';
import { applyEditorTaskPatch } from './editorialTask';
import { PERMISSION_CHANNEL_LABEL, PERMISSION_IDENTITY_LABEL, PERMISSION_USE_LABEL, RULE_KIND_LABEL } from './editorialDisplay';
export function latestEditorMessageId(s: EditorialSession): string | undefined { return s.evidence.filter(e => e.kind === 'editor_message').slice(-1)[0]?.provenance.messageId; }
export function deriveGaps(s: EditorialSession): Gap[] {
  const result = resolveFacts(s); const gaps: Gap[] = [];
  const activeBatch = s.activeBatchId ? (s.questionBatches ?? []).find(batch => batch.id === s.activeBatchId && batch.status === 'active') : undefined;
  const activeGapIds = new Set(activeBatch?.gapIds ?? []);
  const add = (gap: Gap) => {
    const old = s.gaps.find(old => old.id === gap.id);
    if (gap.state === 'open' && activeGapIds.has(gap.id)) gap.state = 'asked';
    if (old?.askHistory) gap.askHistory = old.askHistory;
    gaps.push(gap);
  };
  for (const requirement of s.task.requirements) {
    // G3: a requirement without an explicit dependency cannot produce an editor question.
    if (!requirement.whyNeeded || !requirement.whyNeeded.trim()) {
      add({ id: 'requirement-without-dependency-' + hashText(requirement.id).slice(0,24), requirementId: 'requirement_without_dependency', selector: requirement.selector, kind: 'plan_ambiguity', gapClass: 'internal', askable: false, label: '要求缺少依赖：' + requirement.label, reason: '每条 requirement 必须说明它服务于哪条 criterion/段落/读者动作', state: 'open', blocking: false, alternatives: [], resolutionClaimIds: [] });
      continue;
    }
    const claims = result.claims.filter(c => selectorsEquivalent(s, c.selector, requirement.selector) && c.epistemic === 'supported' && c.visibility === 'public');
    const conflict = result.conflicts.find(g => selectorsEquivalent(s, g.selector, requirement.selector));
    const omitted = s.task.permittedOmissions.some(o => o.requirementId === requirement.id && validRefs(s, o.refs) && o.refs.every(ref => s.evidence.find(e => e.id === ref.evidenceId)?.kind === 'editor_message'));
    add({ id: 'gap-' + hashText(requirement.id + selectorKey(requirement.selector)).slice(0,24), requirementId: requirement.id, selector: requirement.selector, kind: conflict?.kind ?? 'missing', gapClass: 'fact', askable: requirement.askable !== false, whyNeeded: requirement.whyNeeded, label: requirement.label, reason: requirement.whyNeeded, state: omitted ? 'waived' : claims.length && !conflict ? 'resolved' : 'open', blocking: requirement.necessity === 'blocking' && requirement.askable !== false, alternatives: conflict?.alternatives ?? (requirement.resolution === 'omit_or_replace' ? [{ id: 'wait', label: '等待补充或授权', refs: [] }, { id: 'replace', label: '由编辑选择已授权替代素材', refs: [] }, { id: 'omit', label: '由编辑明确省略该项', refs: [] }] : []), resolutionClaimIds: claims.map(c => c.id) });
  }
  for (const conflict of result.conflicts) if (!gaps.some(g => selectorsEquivalent(s, g.selector, conflict.selector) && g.state !== 'resolved')) add({ ...structuredClone(conflict), gapClass: 'fact', askable: true, whyNeeded: conflict.whyNeeded ?? conflict.reason });
  for (const criterion of s.task.criteria) {
    if (criterion.rule.kind !== 'permission') continue;
    const rule = criterion.rule;
    for (const subjectId of rule.subjectIds) {
      const allowed = permissionAllows(s, subjectId, { channel: rule.channel ?? 'public', purpose: rule.use, identity: rule.identity ?? 'not_applicable' });
      add({ id: 'permission-' + hashText(criterion.id + subjectId + stableJson(rule)).slice(0,24), requirementId: criterion.id, selector: { scopeId: subjectId, predicate: 'permission:' + rule.use }, kind: 'permission', gapClass: 'authorization', askable: true, whyNeeded: '用途：' + rule.use, label: (s.scopes.find(scope => scope.id === subjectId)?.label ?? subjectId) + '的使用授权', reason: `用途：${PERMISSION_USE_LABEL[rule.use] ?? rule.use}；渠道：${PERMISSION_CHANNEL_LABEL[rule.channel ?? 'public'] ?? rule.channel ?? 'public'}；身份：${PERMISSION_IDENTITY_LABEL[rule.identity ?? 'not_applicable'] ?? rule.identity ?? 'not_applicable'}`, state: allowed ? 'resolved' : 'open', blocking: criterion.severity === 'blocking', alternatives: [{ id: 'wait', label: '等待授权', refs: [] }, ...s.scopes.filter(scope => scope.kind === 'asset' && scope.id !== subjectId && permissionAllows(s, scope.id, { channel: rule.channel ?? 'public', purpose: rule.use, identity: rule.identity ?? 'not_applicable' })).map(scope => ({ id: 'replace:' + scope.id, label: '由编辑明确选择替换为' + scope.label, refs: [] })), { id: 'replace', label: '编辑选择已授权替代素材', refs: [] }, { id: 'omit', label: '编辑选择不含此素材的文字稿', refs: [] }], resolutionClaimIds: [] });
    }
  }
  for (const source of s.task.requiredSources) {
    const satisfied = sourceRequirementSatisfied(s, source), waived = sourceWaiver(s, source.id);
    add({ id: 'source-' + hashText(source.id).slice(0,24), requirementId: source.id, selector: { scopeId: 'source:' + source.id, predicate: 'source_read' }, kind: 'source_unavailable', gapClass: 'fact', askable: true, whyNeeded: source.purpose, label: source.selector.title ?? source.selector.documentId ?? source.id, reason: source.purpose, state: waived ? 'waived' : satisfied ? 'resolved' : 'open', blocking: true, alternatives: [{ id: 'supply', label: '提供指定素材', refs: [] }, { id: 'waive', label: '编辑明确豁免并留记录', refs: [] }], resolutionClaimIds: [] });
  }
  // Constraints are checked against the current candidate; they never become editor questions.
  const constraintMeasurement = (criterion: EditorialSession['task']['criteria'][number], detail: string | undefined) => {
    const measurement: NonNullable<Gap['measurement']> = { criterionId: criterion.id, ...(detail ? { detail } : {}) };
    if (criterion.rule.kind === 'length') {
      const measured = /(\d+)/.exec(detail ?? '')?.[1];
      const required = String(criterion.rule.min ?? 0) + '–' + String(criterion.rule.max ?? '∞') + ' 可见字符';
      if (measured) measurement.measured = measured;
      measurement.required = required;
      measurement.detail = '要求 ' + required + (measured ? '，实测 ' + measured + ' 字符' : '');
    }
    return measurement;
  };
  if (s.phase !== 'confirmed') {
    const constraintChecks = s.candidate ? validateAcceptance(s).checks : [];
    for (const criterion of s.task.criteria) {
      if (criterion.rule.kind === 'permission' || criterion.rule.kind === 'source_read') continue;
      const id = 'constraint-' + hashText(criterion.id).slice(0,24);
      const old = s.gaps.find(gap => gap.id === id);
      const check = constraintChecks.find(item => item.criterionId === criterion.id);
      const state = !s.candidate ? 'pending_check' as const : check?.status === 'pass' ? 'resolved' as const : check?.status === 'fail' ? (old?.state === 'blocked_by_constraint' ? 'blocked_by_constraint' as const : 'unmet' as const) : 'pending_check' as const;
      const measurement = check ? constraintMeasurement(criterion, check.detail) : undefined;
      add({ id, requirementId: criterion.id, kind: 'constraint', gapClass: 'constraint', askable: false, selector: { scopeId: 'criterion:' + criterion.id, predicate: criterion.rule.kind }, label: (RULE_KIND_LABEL[criterion.rule.kind] ?? '验收') + '要求', reason: measurement?.detail ?? check?.detail ?? '等待当前候选的验收结果', state, blocking: false, alternatives: [], resolutionClaimIds: [], ...(measurement ? { measurement } : {}) });
    }
  }
  // Step 2: explicit editor decisions and non-supply answers keep a gap closed
  // without deleting the requirement (design §4.3/§5.2).
  const closed = new Set<string>();
  const confirmedChoice = new Set((s.answers ?? []).filter(answer => answer.method === 'confirmation' && answer.choice).map(answer => answer.gapId));
  for (const decision of s.gapDecisions ?? []) if (decision.kind !== 'supply' || confirmedChoice.has(decision.gapId)) closed.add(decision.gapId);
  for (const answer of s.answers ?? []) if (answer.choice && (answer.choice !== 'supply' || answer.method === 'confirmation')) closed.add(answer.gapId);
  return [...new Map(gaps.map(g => [g.id, closed.has(g.id) && g.state !== 'resolved' ? { ...g, state: 'waived' as const } : g])).values()];
}

export function buildQuestion(s: EditorialSession, gapIds: string[]): QuestionBatch {
  const gaps = deriveGaps(s); const requested = [...new Set(gapIds)];
  if (!requested.length) throw new Error('empty_question');
  const selected = requested.map(id => {
    const gap = gaps.find(g => g.id === id); if (!gap || gap.state === 'resolved' || gap.state === 'waived') throw new Error('invalid_gap_selection');
    if (gap.state === 'asked') throw new Error('awaiting_editor_reply');
    const askable = gap.askable ?? (gap.gapClass ? gap.gapClass === 'fact' || gap.gapClass === 'authorization' : gap.kind !== 'plan_ambiguity');
    if (!askable || gap.gapClass === 'constraint' || gap.gapClass === 'internal') throw new Error('non_askable_gap');
    if ((gap.askHistory?.length ?? 0) >= 2) throw new Error('ask_limit_reached'); return gap;
  });
  const batch = selected.slice(0,3); const ids = batch.map(g => g.id);
  return { id: 'q-' + hashText(stableJson(ids) + (latestEditorMessageId(s) ?? '')).slice(0,24), gapIds: ids, remainingGapIds: selected.slice(3).map(g => g.id), items: batch.map(g => ({ gapId: g.id, subject: s.scopes.find(scope => scope.id === g.selector.scopeId)?.label ?? g.label, requested: g.label, why: g.reason, options: g.alternatives.map(option => option.label) })) };
}
export function buildIntakeQuestion(s: EditorialSession): QuestionBatch {
  const id = 'intake-' + hashText((latestEditorMessageId(s) ?? 'intake') + ':' + s.revision).slice(0,24);
  const items = [
    { gapId: 'intake:goal', subject: '目标', requested: '这篇内容主要想达成什么目标？', why: '任务契约需要目标与读者动作', options: [] },
    { gapId: 'intake:audience', subject: '读者', requested: '主要写给谁看？希望读者看完做什么？', why: '任务契约需要读者动作', options: [] },
    { gapId: 'intake:facts', subject: '必须包含的事实', requested: '必须写进内容的事实、数据或结论是什么？', why: '需要可核验的事实依据', options: [] },
    { gapId: 'intake:sources', subject: '来源', requested: '需要参考哪些文件或素材？', why: '需要知道必读来源', options: [] },
  ];
  return { id, gapIds: items.map(item => item.gapId), items, intake: true, reasonCode: 'task_plan_incomplete' };
}

export function formatQuestionBubble(q: { items: readonly unknown[]; intake?: boolean; reasonCode?: string; remainingGapIds?: string[] }): string {
  const count = q.items.length;
  const clarification = q.reasonCode === 'reply_partial' || q.reasonCode === 'reply_unmapped';
  let text = q.intake
    ? `已整理出 ${count} 项需要你确认的信息。请在下方卡片中逐项填写，或对某项选择「无法提供」。`
    : clarification
      ? `还有 ${count} 项未能对应到你的上一条回复。请在下方卡片中补充。`
      : `还有 ${count} 项信息需要你补充。请在下方卡片中回答。`;
  if (q.remainingGapIds?.length) text += `另有 ${q.remainingGapIds.length} 项会在下一批继续询问。`;
  return text;
}

export function formatQuestion(q: QuestionBatch): string {
  return '请确认以下具体事项：\n' + q.items.map((item,i) => `${i+1}. ${item.subject}：${item.requested}（${item.why}）${item.options.length ? '；可选：' + item.options.join(' / ') : ''}`).join('\n') + (q.remainingGapIds?.length ? `\n还有 ${q.remainingGapIds.length} 项保留在待补清单中。` : '');
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
