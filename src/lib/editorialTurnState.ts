/**
 * Step 2 bridge: applies the read-only §3.6 turn projection to the persisted
 * session. This is where explicit answers become claims and where batches are
 * opened/closed. The pure processor in editorialTurnProcessor.ts stays model-free.
 */
import { applyEditorFactPatch, claimPublicationUses } from './editorialFacts';
import { hashText, type EditorialSession, type FactClaim, type Gap, type QuestionBatch, type Scope } from './editorialTypes';
import type { EditorMessageInput, EditorTurnProjection } from './editorialTurnProcessor';
import type {
  AnswerChoice, AnswerRecord, EditorialPhaseV3, EditorialSessionV3, EditorTurn, GapDecision, QuestionBatch as QuestionBatchV3, QuestionItem, QuestionOption,
} from './editorialTypesV3';

export interface PendingEditorMessage { messageId: string; text: string; receivedAt: string; replyToBatchId?: string; slots?: { gapId: string; optionId?: string; value?: string; choice?: AnswerChoice }[] }
export type EditorTurnNext = 'continue' | 'question' | 'stop';
export interface AppliedEditorTurn {
  session: EditorialSession;
  next: EditorTurnNext;
  batchId?: string;
  stopCode?: string;
  intent: EditorTurn['intent'];
  skippedPreflight: boolean;
  notice?: string;
}

export function phaseAsV3(phase: EditorialSession['phase']): EditorialPhaseV3 {
  switch (phase) {
    case 'planning': return 'intake';
    case 'gathering': case 'writing': case 'reviewing': return 'working';
    case 'waiting_input': return 'waiting_editor';
    case 'pending_confirmation': return 'ready';
    case 'confirmed': return 'confirmed';
    case 'incomplete': case 'failed': return 'stopped';
  }
}

export function legacyGapClass(kind: Gap['kind']): 'fact' | 'authorization' | 'internal' | 'constraint' {
  if (kind === 'constraint') return 'constraint';
  if (kind === 'permission') return 'authorization';
  if (kind === 'plan_ambiguity') return 'internal';
  return 'fact';
}

function latestMessageId(s: EditorialSession): string | undefined {
  return [...s.evidence].filter(record => record.kind === 'editor_message').slice(-1)[0]?.provenance.messageId;
}

/** Program-side option semantics; the UI only carries optionId back. */
export function optionChoiceForLabel(label: string): NonNullable<QuestionOption['choice']> {
  const text = label.trim();
  if (/^(不允许|拒绝|不授权)/.test(text)) return 'deny';
  if (/^(允许|同意|授权)/.test(text)) return 'grant';
  if (text.includes('不含') || text.includes('省略')) return 'omit';
  return 'supply';
}

function programOptions(item: { gapId: string; options: string[] }, questionId: string, permissionGap: boolean): QuestionOption[] {
  const labels = permissionGap ? [...new Set(['允许使用', '不允许使用', ...item.options])] : item.options;
  return labels.map((label, index) => {
    const choice = optionChoiceForLabel(label);
    return {
      id: 'opt-' + hashText(questionId + ':' + item.gapId + ':' + index).slice(0, 24), label,
      ...(choice === 'grant' ? { isDefaultAffirmative: true } : {}), choice,
    };
  });
}

/** Deterministic v3 batch for a v2 question. Used by question_recorded and legacy sessions. */
export function batchFromQuestion(s: EditorialSession, question: QuestionBatch): QuestionBatchV3 {
  const createdAtMessageId = latestMessageId(s) ?? 'legacy-message';
  const items = question.items.map(item => {
    const gap = s.gaps.find(candidate => candidate.id === item.gapId);
    const gapClass = gap ? legacyGapClass(gap.kind) : 'fact';
    const permissionGap = gap?.kind === 'permission' || gapClass === 'authorization';
    const options = programOptions(item, question.id, permissionGap);
    return {
      gapId: item.gapId, gapClass,
      subject: item.subject, requested: item.requested, why: item.why,
      expected: permissionGap ? 'authorization' : options.length ? 'choice' : 'free_text',
      ...(options.length ? { options } : {}),
      answerSlot: 'slot-' + hashText(question.id + ':' + item.gapId).slice(0, 24),
    } as QuestionItem;
  });
  return {
    id: question.id, createdAtMessageId, gapIds: [...question.gapIds], items, status: 'active',
    ...(question.remainingGapIds?.length ? { remainingGapIds: [...question.remainingGapIds] } : {}),
    ...(question.intake ? { intake: true } : {}), ...(question.reasonCode ? { reasonCode: question.reasonCode } : {}),
  };
}

/** Read-time compatibility: a legacy session with only lastQuestion gets one active batch. */
export function ensureQuestionState(s: EditorialSession): EditorialSession {
  if (s.questionBatches?.length || !s.lastQuestion) return s;
  const batch = batchFromQuestion(s, s.lastQuestion);
  const hasAsked = batch.items.some(item => s.gaps.some(gap => gap.id === item.gapId && gap.state === 'asked'));
  const next = structuredClone(s);
  next.questionBatches = [{ ...batch, status: hasAsked ? 'active' : 'superseded' }];
  if (hasAsked) next.activeBatchId = batch.id;
  next.gaps = next.gaps.map(gap => {
    if (gap.state !== 'asked') return gap;
    const history = gap.askHistory ?? [];
    return history.some(entry => entry.batchId === batch.id) ? gap : {
      ...gap,
      askedAtMessageId: gap.askedAtMessageId ?? batch.createdAtMessageId,
      askHistory: [...history, { batchId: batch.id, messageId: gap.askedAtMessageId ?? batch.createdAtMessageId, promptHash: hashText(gap.label + '\n' + gap.reason), reasonCode: 'legacy_asked' }],
    };
  });
  return next;
}

export function activeBatch(s: EditorialSession): QuestionBatchV3 | undefined {
  if (!s.activeBatchId) return undefined;
  return (s.questionBatches ?? []).find(batch => batch.id === s.activeBatchId && batch.status === 'active');
}

export function questionProjection(batch: QuestionBatchV3): QuestionBatch {
  return {
    id: batch.id, gapIds: [...batch.gapIds],
    ...(batch.remainingGapIds?.length ? { remainingGapIds: [...batch.remainingGapIds] } : {}),
    ...(batch.intake ? { intake: true } : {}), ...(batch.reasonCode ? { reasonCode: batch.reasonCode } : {}),
    items: batch.items.map(item => ({ gapId: item.gapId, subject: item.subject, requested: item.requested, why: item.why, options: (item.options ?? []).map(option => option.label) })),
  };
}

export function sessionAsTurnView(s: EditorialSession): EditorialSessionV3 {
  return {
    ...s, schemaVersion: 3, phase: phaseAsV3(s.phase),
    turns: s.turns ?? [], questionBatches: s.questionBatches ?? [], activeBatchId: s.activeBatchId,
    answers: s.answers ?? [], gapDecisions: s.gapDecisions ?? [],
    gaps: s.gaps.map(gap => ({
      id: gap.id, gapClass: gap.gapClass ?? legacyGapClass(gap.kind), askable: gap.askable ?? (gap.kind !== 'plan_ambiguity'),
      owner: gap.kind === 'permission' ? 'editor' : 'agent_or_editor', state: gap.state,
      origin: { kind: gap.kind === 'permission' ? 'permission' : gap.kind === 'source_unavailable' ? 'source' : 'requirement', id: gap.requirementId },
      selector: gap.selector, label: gap.label, reason: gap.reason,
      ...(gap.whyNeeded ? { whyNeeded: gap.whyNeeded } : {}), askHistory: gap.askHistory ?? [],
    })),
    agentDiagnostics: [...s.diagnostics, ...(s.agentDiagnostics ?? [])],
  } as unknown as EditorialSessionV3;
}

export function latestUnprocessedEditorMessage(s: EditorialSession): PendingEditorMessage | undefined {
  const processed = new Set((s.turns ?? []).map(turn => turn.messageId));
  const record = [...s.evidence].filter(evidence =>
    evidence.kind === 'editor_message' && !!evidence.text.trim() && !!evidence.provenance.messageId && !processed.has(evidence.provenance.messageId!),
  ).slice(-1)[0];
  return record ? { messageId: record.provenance.messageId!, text: record.text, receivedAt: '', ...(record.provenance.replyToBatchId ? { replyToBatchId: record.provenance.replyToBatchId } : {}), ...(record.provenance.slots ? { slots: record.provenance.slots } : {}) } : undefined;
}

function applyAnswerClaims(s: EditorialSession, projection: EditorTurnProjection, messageId: string): { session: EditorialSession; claimByGap: Map<string, string>; rejectedGaps: string[] } {
  const claims: FactClaim[] = [];
  const scopes: Scope[] = [];
  const claimByGap = new Map<string, string>();
  for (const answer of projection.answers) {
    if (answer.choice !== 'supply' || answer.value === undefined || answer.method === 'confirmation') continue;
    const gap = s.gaps.find(candidate => candidate.id === answer.gapId);
    const requirement = s.task.requirements.find(item => item.id === gap?.requirementId);
    const selector = requirement?.selector ?? gap?.selector;
    if (!selector) continue;
    if (!s.scopes.some(scope => scope.id === selector.scopeId)) {
      scopes.push({ id: selector.scopeId, kind: 'other', label: requirement?.label || gap?.label || selector.scopeId, anchors: answer.refs.slice(0, 1), qualifiers: [], identity: 'aligned' });
    }
    const claimId = 'editor-answer-' + hashText(answer.gapId + ':' + messageId).slice(0, 24);
    claims.push({ id: claimId, selector: { ...selector }, value: answer.value, refs: answer.refs, epistemic: 'supported', visibility: 'public', statusBasis: answer.refs });
    claimByGap.set(answer.gapId, claimId);
  }
  const decided = new Set(projection.decisions.map(decision => decision.gapId));
  // Confirmation choices are answered by the selected option, not by a claim grounded
  // in the message text; they must not be reported as rejected answers.
  const rejected = (answer: AnswerRecord) => answer.choice === 'supply' && answer.method !== 'confirmation' && !decided.has(answer.gapId);
  if (!claims.length) {
    return { session: s, claimByGap, rejectedGaps: projection.answers.filter(rejected).map(answer => answer.gapId) };
  }
  const patched = applyEditorFactPatch(s, { ...(scopes.length ? { scopes } : {}), claims });
  const rejectedGaps = projection.answers.filter(rejected).filter(answer => {
    const claimId = claimByGap.get(answer.gapId);
    return !claimId || !patched.claims.some(claim => claim.id === claimId);
  }).map(answer => answer.gapId);
  return { session: patched, claimByGap, rejectedGaps };
}

function openClarificationBatch(s: EditorialSession, closed: QuestionBatchV3, messageId: string, gapIds: string[], understood: string[], reasonCode: 'reply_partial' | 'reply_unmapped' = 'reply_partial'): { session: EditorialSession; batch?: QuestionBatchV3 } {
  const candidates = gapIds.map(id => s.gaps.find(gap => gap.id === id)).filter((gap): gap is Gap => !!gap);
  const openable = candidates.filter(gap => (gap.askHistory?.length ?? 0) < 2);
  const overLimit = candidates.filter(gap => (gap.askHistory?.length ?? 0) >= 2);
  if (overLimit.length) {
    s.gapDecisions = [...(s.gapDecisions ?? []), ...overLimit.map(gap => ({
      id: 'gd-' + hashText(gap.id + ':ask_limit:' + messageId).slice(0, 24),
      gapId: gap.id, by: 'editor' as const, kind: 'defer' as const, refs: [], note: '提问上限已到，按现有信息继续', createdAt: '',
    } satisfies GapDecision))];
    s.gaps = s.gaps.map(gap => overLimit.some(item => item.id === gap.id) ? { ...gap, state: 'waived' } : gap);
  }
  const items = openable.flatMap(gap => {
    const item = closed.items.find(candidate => candidate.gapId === gap.id);
    return item ? [structuredClone(item)] : [];
  });
  if (!items.length) { delete s.activeBatchId; return { session: s }; }
  const id = 'qb-' + hashText(closed.id + ':' + messageId + ':' + items.map(item => item.gapId).join(',')).slice(0, 24);
  const optionsFor = (item: QuestionItem): QuestionOption[] | undefined => {
    const existing = item.options ?? [];
    if (item.gapClass === 'authorization') {
      return programOptions({ gapId: item.gapId, options: [...new Set(['允许使用', '不允许使用', ...existing.map(option => option.label)])] }, id, false);
    }
    return existing.length ? existing.map(option => ({ ...option, ...(option.choice ? {} : { choice: optionChoiceForLabel(option.label) }) })) : undefined;
  };
  const batch: QuestionBatchV3 = {
    id, createdAtMessageId: messageId, gapIds: items.map(item => item.gapId), status: 'active', reasonCode,
    ...(understood.length ? { understood } : {}),
    items: items.map(item => ({ ...item, ...(optionsFor(item)?.length ? { options: optionsFor(item) } : {}), answerSlot: 'slot-' + hashText(id + ':' + item.gapId).slice(0, 24) })),
  };
  s.questionBatches = [...(s.questionBatches ?? []), batch];
  s.activeBatchId = id;
  s.gaps = s.gaps.map(gap => batch.gapIds.includes(gap.id) ? {
    ...gap, state: 'asked',
    askHistory: [...(gap.askHistory ?? []), { batchId: id, messageId, promptHash: hashText(gap.label + '\n' + gap.reason), reasonCode }],
  } : gap);
  s.phase = 'waiting_input';
  return { session: s, batch };
}

export function applyEditorTurn(session: EditorialSession, message: EditorMessageInput, projection: EditorTurnProjection): AppliedEditorTurn {
  const s = structuredClone(session);
  const intent = projection.turn.intent;
  const current = activeBatch(s);
  if (projection.duplicate) return { session, next: current ? 'question' : 'continue', ...(current ? { batchId: current.id } : {}), intent, skippedPreflight: false };
  if (projection.outcome.type === 'ignored') return { session, next: 'continue', intent, skippedPreflight: false };

  const recordTurn = () => { s.turns = [...(s.turns ?? []).filter(turn => turn.messageId !== projection.turn.messageId), projection.turn]; };
  const bump = () => { s.revision++; };

  if (projection.outcome.type === 'cancel') {
    recordTurn(); s.phase = 'incomplete';
    s.questionBatches = (s.questionBatches ?? []).map(batch => batch.id === s.activeBatchId ? { ...batch, status: 'cancelled' as const } : batch);
    delete s.activeBatchId;
    bump();
    return { session: s, next: 'stop', stopCode: 'run_cancelled', intent, skippedPreflight: true };
  }
  if (projection.outcome.type === 'confirm_delivery') return { session, next: 'stop', stopCode: 'confirmation_requires_control_event', intent, skippedPreflight: true };
  if (projection.outcome.type === 'confirm_without_pending') {
    recordTurn();
    bump();
    return { session: s, next: 'stop', stopCode: projection.outcome.code, intent, skippedPreflight: true };
  }

  if (projection.evidenceToAppend && !s.evidence.some(evidence => evidence.id === projection.evidenceToAppend!.id)) {
    s.evidence = [...s.evidence, projection.evidenceToAppend]; s.evidenceRevision++;
  }
  recordTurn();

  if (projection.outcome.type === 'instruction' || projection.outcome.type === 'intake_question') {
    if (projection.batchTransition) {
      s.questionBatches = (s.questionBatches ?? []).map(batch => batch.id === projection.batchTransition!.batchId ? { ...batch, status: projection.batchTransition!.status, answeredByMessageId: message.messageId } : batch);
      if (s.activeBatchId === projection.batchTransition.batchId) delete s.activeBatchId;
      s.phase = s.candidate ? 'writing' : 'gathering';
    }
    bump();
    return { session: s, next: 'continue', intent, skippedPreflight: false };
  }
  if (projection.outcome.type === 'needs_assignment') {
    bump();
    const batch = activeBatch(s);
    return { session: s, next: batch ? 'question' : 'continue', ...(batch ? { batchId: batch.id } : {}), intent, skippedPreflight: true, ...(projection.notice ? { notice: projection.notice } : {}) };
  }

  const batch = activeBatch(s);
  if (!batch) { bump(); return { session: s, next: 'continue', intent, skippedPreflight: true }; }

  const { session: claimed, claimByGap, rejectedGaps } = applyAnswerClaims(s, projection, message.messageId);
  let next = claimed;
  const grantedGaps = new Set<string>();
  for (const answer of projection.answers.filter(answer => answer.choice === 'grant')) {
    const gap = next.gaps.find(candidate => candidate.id === answer.gapId);
    const subjectId = gap?.selector?.scopeId;
    if (!subjectId) continue;
    const permissionId = 'perm-' + hashText(answer.id).slice(0, 24);
    const patched = applyEditorFactPatch(next, {
      permissions: [{ id: permissionId, subjectId, uses: claimPublicationUses(next, subjectId), state: 'allowed', refs: answer.refs }],
    });
    if (patched.permissions.some(permission => permission.id === permissionId && permission.state === 'allowed')) {
      next = patched;
      grantedGaps.add(answer.gapId);
    }
  }

  const accepted = (gapId: string) => { const claimId = claimByGap.get(gapId); return !!claimId && next.claims.some(claim => claim.id === claimId); };
  const existingAnswers = next.answers ?? [];
  const addedAnswers = projection.answers.filter(answer => !existingAnswers.some(existing => existing.id === answer.id)).map(answer => {
    const claimId = claimByGap.get(answer.gapId);
    return claimId && accepted(answer.gapId) ? { ...answer, resultingClaimIds: [claimId] } : answer;
  });
  next.answers = [...existingAnswers, ...addedAnswers];
  const existingDecisions = next.gapDecisions ?? [];
  next.gapDecisions = [...existingDecisions, ...projection.decisions.filter(decision => !existingDecisions.some(existing => existing.id === decision.id))];

  const clarificationGaps = [
    ...rejectedGaps,
    ...(projection.outcome.type === 'clarification' ? projection.clarification?.gapIds ?? [] : []),
  ].filter((id, index, all) => all.indexOf(id) === index);
  const closeStatus = clarificationGaps.length ? 'partially_answered' as const : 'answered' as const;
  next.questionBatches = (next.questionBatches ?? []).map(candidate => candidate.id === batch.id ? { ...candidate, status: closeStatus, answeredByMessageId: message.messageId } : candidate);
  if (!clarificationGaps.length) delete next.activeBatchId;

  next.gaps = next.gaps.map(gap => {
    const answer = projection.answers.find(candidate => candidate.gapId === gap.id);
    if (answer?.choice === 'grant' && grantedGaps.has(gap.id)) return { ...gap, state: 'resolved' as const };
    if (answer?.choice === 'supply' && accepted(gap.id)) return { ...gap, state: 'resolved' as const };
    if (projection.decisions.some(decision => decision.gapId === gap.id)) return { ...gap, state: 'waived' as const };
    if (answer && answer.choice !== 'supply') return { ...gap, state: 'waived' as const };
    return gap;
  });
  next.phase = next.candidate ? 'writing' : 'gathering';

  if (clarificationGaps.length) {
    const understood = projection.outcome.type === 'clarification' ? projection.clarification?.understood ?? [] : [];
    const reasonCode = projection.outcome.type === 'clarification' ? projection.clarification?.reasonCode ?? 'reply_partial' : 'reply_partial';
    const opened = openClarificationBatch(next, batch, message.messageId, clarificationGaps, understood, reasonCode);
    next = opened.session;
    if (opened.batch) {
      if (next.revision === session.revision) bump();
      return { session: next, next: 'question', batchId: opened.batch.id, intent, skippedPreflight: true };
    }
  }
  if (next.revision === session.revision) bump();
  return { session: next, next: 'continue', intent, skippedPreflight: true };
}
