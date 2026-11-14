/**
 * Read-only v2 -> v3 session migration (design §8.4, acceptance A26).
 * Nothing here is wired into storage yet; callers opt in explicitly.
 */
import { EditorialSessionSchema, currentInputKey, hashText, stableJson, type EditorialSession, type Gap } from './editorialTypes';
import {
  EditorialSessionV3Schema, isAskableGap,
  type Diagnostic, type GapClass, type GapOrigin, type GapOwner, type GapV2, type QuestionBatch, type QuestionItem,
  type RunReport, type StopAction, type StopClass, type StopPreserved, type StopRecord, type EditorialPhaseV3, type EditorialSessionV3,
} from './editorialTypesV3';

type V2Stop = NonNullable<EditorialSession['lastStop']>;

const PHASE_MAP: Record<EditorialSession['phase'], EditorialPhaseV3> = {
  planning: 'intake', gathering: 'working', writing: 'working', reviewing: 'working',
  waiting_input: 'waiting_editor', pending_confirmation: 'ready', confirmed: 'confirmed',
  incomplete: 'stopped', failed: 'stopped',
};

const EXTERNAL_CODES = new Set(['model_unavailable', 'source_unavailable', 'deadline_exceeded']);
const NON_RETRYABLE = new Set(['task_plan_incomplete', 'gap_unresolved', 'permission_denied', 'ask_limit_reached', 'already_confirmed', 'legacy_incomplete']);
const INPUT_CODES = new Set(['task_plan_incomplete', 'gap_unresolved', 'confirmation_blocked', 'permission_denied', 'legacy_incomplete']);

function stopClassOf(code: string): StopClass {
  if (EXTERNAL_CODES.has(code)) return 'external';
  if (INPUT_CODES.has(code)) return 'input';
  return 'internal';
}

function headlineOf(code: string, cls: StopClass): string {
  if (code === 'source_unavailable') return '无法读取素材';
  if (code === 'model_unavailable') return '模型服务暂时不可用';
  if (code === 'deadline_exceeded') return '本轮处理超过时间上限';
  if (code === 'task_plan_incomplete') return '任务信息还不完整';
  if (code === 'gap_unresolved') return '还有未解决的信息缺口';
  if (code === 'confirmation_blocked') return '还不能确认成稿';
  if (code === 'permission_denied') return '缺少必要授权';
  if (cls === 'external') return '外部服务暂时不可用';
  if (cls === 'input') return '还需要编辑补充信息';
  return '上一轮处理出现内部问题';
}

function actionsOf(code: string, cls: StopClass): StopAction[] {
  if (cls === 'external') return code === 'source_unavailable' ? ['supply', 'waive'] : ['retry'];
  if (cls === 'input') {
    if (code === 'gap_unresolved') return ['answer', 'waive'];
    if (code === 'permission_denied') return ['waive', 'edit_task'];
    if (code === 'confirmation_blocked') return ['retry'];
    return ['edit_task'];
  }
  return ['retry', 'report'];
}

function preservedOf(s: EditorialSession): StopPreserved {
  return {
    ...(s.candidate ? { candidateRevision: s.candidate.revision } : {}),
    ...(s.committed ? { committedRevision: s.committed.artifact.revision } : {}),
    inputKey: currentInputKey(s),
  };
}

function traceOf(sessionId: string, code: string, extra: string): string {
  return 'migration-' + hashText([sessionId, code, extra].join(':')).slice(0, 24);
}

function stopRecord(s: EditorialSession, code: string, detail: string, fields?: StopRecord['fields']): StopRecord {
  const cls = stopClassOf(code);
  return {
    code, class: cls, retryable: !NON_RETRYABLE.has(code), headline: headlineOf(code, cls),
    detail: detail || '迁移自 v2 会话，没有可用的后续动作说明。',
    ...(fields ? { fields } : {}), actions: actionsOf(code, cls),
    traceId: traceOf(s.sessionId, code, 'stop'), preserved: preservedOf(s),
  };
}

function migrateLastStop(s: EditorialSession, lastStop: V2Stop): StopRecord {
  const detail = lastStop.nextActions.join('；');
  const fields = lastStop.unresolvedIds.length ? { unresolvedIds: lastStop.unresolvedIds.join('，') } : undefined;
  return stopRecord(s, lastStop.code, detail, fields);
}

function syntheticStop(s: EditorialSession): StopRecord {
  const code = s.phase === 'failed' ? 'legacy_failed' : 'legacy_incomplete';
  return stopRecord(s, code, '迁移自 v2 会话；上一轮没有结构化停止记录。');
}

function staleQuestionStop(s: EditorialSession, batchId?: string): StopRecord {
  return stopRecord(
    s,
    'task_plan_incomplete',
    '迁移时发现旧提问批次已过期，请重新说明要写的内容。',
    batchId ? { staleBatchId: batchId } : undefined,
  );
}

function mapGapKind(kind: Gap['kind']): { gapClass: GapClass; originKind: GapOrigin['kind']; owner: GapOwner } | undefined {
  switch (kind) {
    case 'missing':
    case 'conflict':
    case 'scope':
      return { gapClass: 'fact', originKind: 'requirement', owner: 'agent_or_editor' };
    case 'source_unavailable':
      return { gapClass: 'fact', originKind: 'source', owner: 'agent_or_editor' };
    case 'permission':
      return { gapClass: 'authorization', originKind: 'permission', owner: 'editor' };
    case 'constraint':
      return { gapClass: 'constraint', originKind: 'criterion', owner: 'agent' };
    case 'plan_ambiguity':
      return undefined;
  }
}

function migrateGap(gap: Gap, mapped: NonNullable<ReturnType<typeof mapGapKind>>): GapV2 {
  return {
    id: gap.id, gapClass: mapped.gapClass,
    askable: mapped.gapClass === 'fact' || mapped.gapClass === 'authorization',
    owner: mapped.owner, state: gap.state,
    origin: { kind: mapped.originKind, id: gap.requirementId },
    selector: gap.selector, label: gap.label, reason: gap.reason, whyNeeded: gap.reason,
    askHistory: [],
  };
}

function latestEditorMessageId(s: EditorialSession): string | undefined {
  return [...s.evidence].filter(record => record.kind === 'editor_message').slice(-1)[0]?.provenance.messageId;
}

function buildBatch(s: EditorialSession, gaps: GapV2[]): { batch?: QuestionBatch; activeBatchId?: string; createdAtMessageId: string } {
  const mappedById = new Map(gaps.map(gap => [gap.id, gap]));
  const createdAtMessageId = latestEditorMessageId(s) ?? s.gaps.find(gap => gap.state === 'asked' && gap.askedAtMessageId)?.askedAtMessageId ?? 'legacy-message';

  const sourceIds: string[] = [];
  const push = (id: string) => { if (!sourceIds.includes(id)) sourceIds.push(id); };
  for (const id of s.lastQuestion?.gapIds ?? []) push(id);
  for (const gap of gaps) if (gap.state === 'asked') push(gap.id);
  const askable = sourceIds.map(id => mappedById.get(id)).filter((gap): gap is GapV2 => !!gap && isAskableGap(gap));
  const asked = askable.filter(gap => gap.state === 'asked');
  const shouldRecord = !!s.lastQuestion || asked.length > 0;
  if (!shouldRecord) return { createdAtMessageId };

  const batchId = s.lastQuestion?.id.trim() ? s.lastQuestion.id : 'qb-migrated-' + hashText(s.sessionId + ':' + askable.map(gap => gap.id).join(',')).slice(0, 24);
  const itemGaps = asked.length ? asked.slice(0, 3) : askable;
  const v2Items = new Map((s.lastQuestion?.items ?? []).map(item => [item.gapId, item]));
  const items: QuestionItem[] = itemGaps.map(gap => {
    const source = v2Items.get(gap.id);
    const optionLabels = source?.options ?? [];
    return {
      gapId: gap.id, gapClass: gap.gapClass,
      subject: source?.subject ?? s.scopes.find(scope => scope.id === gap.selector?.scopeId)?.label ?? gap.label,
      requested: source?.requested ?? gap.label,
      why: source?.why ?? gap.reason,
      expected: gap.gapClass === 'authorization' ? 'authorization' : optionLabels.length ? 'choice' : 'free_text',
      ...(optionLabels.length ? { options: optionLabels.map(label => ({ id: 'opt-' + hashText(batchId + ':' + gap.id + ':' + label).slice(0, 24), label })) } : {}),
      answerSlot: 'slot-' + hashText(batchId + ':' + gap.id).slice(0, 24),
    };
  });
  const itemIds = new Set(items.map(item => item.gapId));
  const remaining = [...asked.slice(3).map(gap => gap.id), ...(s.lastQuestion?.remainingGapIds ?? [])].filter(id => {
    const gap = mappedById.get(id);
    return !!gap && isAskableGap(gap) && !itemIds.has(id);
  });
  const uniqueRemaining = [...new Set(remaining)];
  const status = asked.length ? 'active' : 'superseded';
  const batch: QuestionBatch = {
    id: batchId, createdAtMessageId, gapIds: items.map(item => item.gapId), items, status,
    ...(uniqueRemaining.length ? { remainingGapIds: uniqueRemaining } : {}),
  };
  return { batch, ...(status === 'active' ? { activeBatchId: batchId } : {}), createdAtMessageId };
}

/** Idempotent: a session that already passes the v3 schema is returned unchanged. */
export function migrateEditorialSessionV2ToV3(raw: unknown): EditorialSessionV3 {
  if (EditorialSessionV3Schema.is(raw)) return EditorialSessionV3Schema.parse(raw);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || (raw as { schemaVersion?: unknown }).schemaVersion !== 2) throw new Error('invalid_schema');
  const source = EditorialSessionSchema.parse(raw);

  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  const pushDiagnostic = (diagnostic: Diagnostic) => {
    const key = stableJson([diagnostic.owner ?? '', diagnostic.code, diagnostic.message, diagnostic.refs]);
    if (seen.has(key)) return;
    seen.add(key);
    diagnostics.push(structuredClone(diagnostic));
  };
  for (const diagnostic of [...source.diagnostics, ...(source.agentDiagnostics ?? [])]) pushDiagnostic(diagnostic);
  for (const gap of source.gaps) {
    if (gap.kind !== 'plan_ambiguity') continue;
    pushDiagnostic({ owner: 'gap:migration', code: 'migrated_plan_ambiguity', message: gap.label + '：' + gap.reason, refs: [] });
  }

  const gaps = source.gaps.flatMap(gap => {
    const mapped = mapGapKind(gap.kind);
    return mapped ? [migrateGap(gap, mapped)] : [];
  });
  const { batch, activeBatchId, createdAtMessageId } = buildBatch(source, gaps);
  const sourceById = new Map(source.gaps.map(gap => [gap.id, gap]));
  for (const gap of gaps) {
    if (gap.state !== 'asked') continue;
    gap.askHistory = [{
      batchId: batch && (batch.gapIds.includes(gap.id) || batch.items.some(item => item.gapId === gap.id) || (batch.remainingGapIds ?? []).includes(gap.id)) ? batch.id : 'legacy-question',
      messageId: sourceById.get(gap.id)?.askedAtMessageId ?? createdAtMessageId,
      promptHash: hashText(gap.label + '\n' + gap.reason),
      reasonCode: 'migrated_asked',
    }];
  }

  let phase = PHASE_MAP[source.phase];
  let staleQuestion = false;
  if (source.phase === 'waiting_input' && !activeBatchId) {
    phase = 'stopped';
    staleQuestion = true;
  }

  const stop = staleQuestion ? staleQuestionStop(source, source.lastQuestion?.id)
    : source.lastStop ? migrateLastStop(source, source.lastStop)
      : source.phase === 'incomplete' || source.phase === 'failed' ? syntheticStop(source)
        : undefined;
  const lastRun: RunReport | undefined = stop ? {
    runId: 'migration-' + hashText(source.sessionId + ':' + stop.code + ':' + stop.traceId).slice(0, 24),
    startedAt: '', endedAt: '', outcome: 'stopped', stop, modelCalls: [], agentDiagnostics: [],
  } : undefined;

  const result: EditorialSessionV3 = {
    schemaVersion: 3, sessionId: source.sessionId, revision: source.revision,
    evidenceRevision: source.evidenceRevision, policyRevision: source.policyRevision,
    evidence: source.evidence, readReceipts: source.readReceipts, scopes: source.scopes, alignments: source.alignments,
    claims: source.claims, permissions: source.permissions, task: source.task,
    phase, turns: [], questionBatches: batch ? [batch] : [], ...(activeBatchId ? { activeBatchId } : {}),
    answers: [], gapDecisions: [], gaps, agentDiagnostics: diagnostics,
    ...(lastRun ? { lastRun } : {}),
    ...(source.candidate ? { candidate: source.candidate } : {}),
    ...(source.review ? { review: source.review } : {}),
    ...(source.layout ? { layout: source.layout } : {}),
    ...(source.gate ? { gate: source.gate } : {}),
    ...(source.committed ? { committed: source.committed } : {}),
    ...(source.editorialNotes ? { editorialNotes: source.editorialNotes } : {}),
    humanVerifications: source.humanVerifications,
    ...(source.legacy ? { legacy: source.legacy } : {}),
    ...(source.selectedOutput ? { selectedOutput: source.selectedOutput } : {}),
  };
  return EditorialSessionV3Schema.parse(result);
}
