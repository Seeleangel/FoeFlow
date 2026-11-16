/**
 * Read-only shadow of design §3.6. Computes what the v3 editor-turn pipeline
 * would decide for one message; never mutates the session, calls a model or
 * emits an event. Step 1 wiring intentionally stops at this projection.
 */
import { taskContractValid } from './editorialContract';
import { hashText, type EditorialSession, type EvidenceRecord, type EvidenceRef, type Id } from './editorialTypes';
import type {
  AnswerChoice, AnswerMethod, AnswerRecord, EditorialPhaseV3, EditorialSessionV3,
  EditorTurn, EditorTurnBindingStatus, EditorTurnIntent, GapDecision, QuestionBatch, QuestionItem,
} from './editorialTypesV3';

export interface EditorSlotInput { gapId: Id; optionId?: Id; value?: string; choice?: AnswerChoice }
export interface EditorMessageInput {
  messageId: Id;
  text: string;
  receivedAt?: string;
  replyToBatchId?: Id;
  evidenceId?: Id;
  slots?: EditorSlotInput[];
  /** True when the UI already appended the editor message to session evidence. */
  evidenceAlreadyAppended?: boolean;
  /** Validated model mapping suggestions (design §3.7 priority 3). */
  mappedAnswers?: EditorMappedAnswer[];
  /** True when a model mapping suggestion was attempted and produced a usable response. */
  mappingAttempted?: boolean;
}

export interface EditorMappedAnswer { gapId: Id; start: number; end: number; quote: string; confidence?: number }
export interface ValidatedAnswerMapping { gapId: Id; start: number; end: number; quote: string; confidence: number }
export interface AnswerMappingResult { mappings: ValidatedAnswerMapping[]; rejected: number; shapeValid: boolean }

/** Program-side validation of model mapping suggestions; the suggestion port has no other authority. */
export function validateAnswerMappings(batch: QuestionBatch, text: string, raw: unknown): AnswerMappingResult {
  const container = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined;
  const list = Array.isArray(raw) ? raw : container?.mappings;
  if (!Array.isArray(list)) return { mappings: [], rejected: 0, shapeValid: false };
  const itemIds = new Set(batch.items.map(item => item.gapId));
  const accepted: ValidatedAnswerMapping[] = []; const usedGaps = new Set<string>();
  let rejected = 0;
  for (const entry of list) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { rejected++; continue; }
    const value = entry as Record<string, unknown>;
    const gapId = typeof value.gapId === 'string' ? value.gapId : undefined;
    const start = typeof value.start === 'number' && Number.isInteger(value.start) ? value.start : undefined;
    const end = typeof value.end === 'number' && Number.isInteger(value.end) ? value.end : undefined;
    const quote = typeof value.quote === 'string' ? value.quote : undefined;
    const confidence = typeof value.confidence === 'number' && Number.isFinite(value.confidence) ? value.confidence : 1;
    let span: { start: number; end: number } | undefined = start !== undefined && end !== undefined && start >= 0 && end > start && end <= text.length && text.slice(start, end) === quote
      ? { start, end }
      : undefined;
    if (!span && quote && quote.trim()) {
      // Mapping models often get the offsets slightly wrong (for example they leave out the trailing
      // punctuation). Locate the exact quote instead of dropping a real answer into a re-ask.
      const occurrences: number[] = [];
      for (let index = text.indexOf(quote); index >= 0; index = text.indexOf(quote, index + 1)) occurrences.push(index);
      const free = occurrences.filter(index => !accepted.some(mapping => index < mapping.end && mapping.start < index + quote.length));
      const chosen = free.length === 1 ? free[0]
        : free.length > 1 && start !== undefined ? free.reduce((best, index) => Math.abs(index - start) < Math.abs(best - start) ? index : best, free[0])
        : undefined;
      if (chosen !== undefined) span = { start: chosen, end: chosen + quote.length };
    }
    const resolved = span;
    if (!gapId || !itemIds.has(gapId) || usedGaps.has(gapId) || !resolved || !quote || !quote.trim() || confidence < 0.5 ||
        accepted.some(mapping => resolved.start < mapping.end && mapping.start < resolved.end)) { rejected++; continue; }
    usedGaps.add(gapId);
    accepted.push({ gapId, start: resolved.start, end: resolved.end, quote, confidence });
  }
  return { mappings: accepted, rejected, shapeValid: true };
}

export type EditorDirectiveMode = 'none' | 'normal' | 'additive';
export type EditorTurnOutcome =
  | { type: 'duplicate'; toPhase: EditorialPhaseV3; batchId?: Id }
  | { type: 'ignored'; toPhase: EditorialPhaseV3; reason: 'empty_message' }
  | { type: 'cancel'; toPhase: 'stopped'; stopCode: 'run_cancelled' }
  | { type: 'confirm_delivery'; toPhase: 'confirmed' }
  | { type: 'confirm_without_pending'; toPhase: EditorialPhaseV3; code: 'confirmation_without_pending' | 'already_confirmed' }
  | { type: 'answers_bound'; toPhase: 'working'; startRun: 'answers' }
  | { type: 'clarification'; toPhase: 'waiting_editor' }
  | { type: 'answer_confirmation'; toPhase: 'working'; startRun: 'deferred' }
  | { type: 'needs_assignment'; toPhase: 'waiting_editor' }
  | { type: 'instruction'; toPhase: 'working'; startRun: 'instruction' }
  | { type: 'intake_question'; toPhase: 'waiting_editor' };

export interface EditorBatchTransition { batchId: Id; status: 'answered' | 'partially_answered' }
export interface EditorTurnClarification { batchId: Id; gapIds: Id[]; reasonCode: 'reply_partial' | 'reply_unmapped'; understood: string[] }
export interface EditorTurnProjection {
  readonly notice?: string;
  readonly turn: EditorTurn;
  readonly duplicate: boolean;
  readonly evidenceToAppend: EvidenceRecord | null;
  readonly answers: AnswerRecord[];
  readonly decisions: GapDecision[];
  readonly batchTransition: EditorBatchTransition | null;
  readonly clarification: EditorTurnClarification | null;
  readonly directiveMode: EditorDirectiveMode;
  readonly outcome: EditorTurnOutcome;
}

/** Answer confirmation (design §5.1): active batch + 确认/好的/就这样/继续. */
const ANSWER_CONFIRMATION = /^(确认|好的|可以|行|嗯|对|是|是的|继续|就这样|开始写)[。！!]?$/;
/** Delivery confirmation must stay explicit; 继续 is not a delivery confirmation. */
const DELIVERY_CONFIRMATION = /^(确认|确认成稿|确认发布|好的|可以|行)[。！!]?$/;
/** No batch and not ready: T17 explanation, never a model run. */
const BARE_CONFIRMATION = /^(确认|好的|可以|行|嗯|对|是|是的|就这样)[。！!]?$/;
const CANCEL = /^(取消|停止|算了|不用了|先不写了|不写了|结束)[。！!]?$/;
const DECLINE = /^(无法提供|不能提供|提供不了|不清楚|不确定|不知道|跳过|没有)[。！!]?$/;
const AFFIRMATIVE = /^(已授权|已获授权|允许|同意|授权|可以|grant)/i;
const NEGATIVE = /^(已拒绝|不允许|不同意|拒绝|禁止|deny)/i;
const UNPROVIDED_VALUE = /^(还没想好|没想好|不知道|不确定|待定|再想想|稍后|稍后再说|暂时没有|暂无|以后再补|没想到)[。！!]?$/;
const isUnprovidedValue = (text: string): boolean => text.length <= 20 && UNPROVIDED_VALUE.test(text.trim());

interface BindingResult { answers: AnswerRecord[]; decisions: GapDecision[]; boundGapIds: Id[]; unboundGapIds: Id[] }

interface SlotMark { value?: string; choice?: AnswerChoice; optionId?: Id }
/** Authorization free text only binds an explicit grant/deny; anything else goes to clarification. */
function valueRecord(item: QuestionItem, raw: string): SlotMark | undefined {
  const value = raw.trim();
  if (DECLINE.test(value)) return { choice: 'defer' };
  if (item.gapClass === 'authorization') {
    if (AFFIRMATIVE.test(value)) return { choice: 'grant' };
    if (NEGATIVE.test(value)) return { choice: 'deny' };
    return undefined;
  }
  return { choice: 'supply', value };
}

/** Design §3.7 binding order: explicit slots, then numbered segments, then single-item assignment. */
function bindAnswers(batch: QuestionBatch, message: EditorMessageInput, ref: EvidenceRef, turnId: Id, createdAt: string): BindingResult {
  const items = batch.items;
  const itemById = new Map(items.map(item => [item.gapId, item]));
  const marks = new Map<Id, { method: AnswerMethod; mark: SlotMark; refs?: EvidenceRef[] }>();

  for (const slot of message.slots ?? []) {
    const item = itemById.get(slot.gapId);
    if (!item) continue;
    let mark: SlotMark | undefined;
    if (slot.optionId) {
      const option = item.options?.find(option => option.id === slot.optionId);
      if (!option) continue;
      const choice = option.choice ?? slot.choice ?? 'supply';
      mark = { choice, ...(choice === 'supply' ? { value: option.label } : {}), optionId: option.id };
    } else if (slot.choice) mark = { choice: slot.choice };
    else if (slot.value !== undefined && slot.value.trim()) mark = valueRecord(item, slot.value);
    if (mark) marks.set(item.gapId, { method: 'explicit_slot', mark });
  }
  if (!marks.size) {
    let numberedSeen = 0;
    for (const line of message.text.split(/\r?\n/)) {
      const match = line.trim().match(/^(?:(\d{1,2})[.、)．]|（(\d{1,2})）|\((\d{1,2})\))\s*(.+)$/);
      if (!match) continue;
      const value = (match[4] ?? '').trim();
      if (!value) continue;
      numberedSeen++;
      const item = items[Number(match[1] ?? match[2] ?? match[3]) - 1];
      if (!item || marks.has(item.gapId)) continue;
      const mark = valueRecord(item, value);
      if (mark) marks.set(item.gapId, { method: 'numbered', mark });
    }
    if (!marks.size && message.mappedAnswers?.length) {
      for (const mapping of message.mappedAnswers) {
        const item = itemById.get(mapping.gapId);
        const quote = mapping.quote.trim();
        if (!item || marks.has(item.gapId) || !quote) continue;
        marks.set(item.gapId, {
          method: 'model_mapped', mark: { choice: 'supply', value: quote },
          refs: [{ evidenceId: ref.evidenceId, revision: ref.revision, start: mapping.start, end: mapping.end, quote: mapping.quote }],
        });
      }
    }
    if (!numberedSeen && !marks.size && items.length > 1) {
      // A1: one reply with semicolon/newline separated segments binds in item order.
      const segments = message.text.split(/\r?\n|[；;]/).map(segment => segment.trim()).filter(Boolean);
      if (segments.length === items.length) {
        for (let index = 0; index < items.length; index++) {
          const mark = valueRecord(items[index], segments[index]);
          if (mark) marks.set(items[index].gapId, { method: 'editor_assigned', mark });
        }
      }
    }
    if (!numberedSeen && !marks.size && items.length === 1 && !ANSWER_CONFIRMATION.test(message.text.trim()) && !isUnprovidedValue(message.text)) {
      const mark = valueRecord(items[0], message.text);
      if (mark) marks.set(items[0].gapId, { method: 'editor_assigned', mark });
    }
  }

  const answers: AnswerRecord[] = [];
  const decisions: GapDecision[] = [];
  for (const item of items) {
    const marked = marks.get(item.gapId);
    if (!marked) continue;
    answers.push({
      id: 'ans-' + hashText(batch.id + ':' + item.gapId + ':' + turnId).slice(0, 24),
      turnId, messageId: message.messageId, batchId: batch.id, gapId: item.gapId, method: marked.method,
      refs: marked.refs ?? [ref], createdAt,
      ...(marked.mark.value !== undefined ? { value: marked.mark.value } : {}),
      ...(marked.mark.choice ? { choice: marked.mark.choice } : {}),
      ...(marked.mark.optionId ? { optionId: marked.mark.optionId } : {}),
    });
    const decision = marked.mark.choice ? choiceDecision(batch.id, item.gapId, marked.mark.choice, ref, createdAt, turnId) : undefined;
    if (decision) decisions.push(decision);
  }
  const bound = new Set(answers.map(answer => answer.gapId));
  return { answers, decisions, boundGapIds: items.filter(item => bound.has(item.gapId)).map(item => item.gapId), unboundGapIds: items.filter(item => !bound.has(item.gapId)).map(item => item.gapId) };
}

const DECISION_NOTES: Partial<Record<AnswerChoice, string>> = {
  defer: '编辑选择按现有信息继续', deny: '编辑不允许使用该素材', omit: '编辑选择省略该项', waive: '编辑明确豁免该项', proceed: '编辑选择按现有信息继续',
};
function choiceDecision(batchId: Id, gapId: Id, choice: AnswerChoice, ref: EvidenceRef, createdAt: string, turnId: Id): GapDecision | undefined {
  const note = DECISION_NOTES[choice];
  if (!note || !['defer', 'deny', 'omit', 'waive', 'proceed'].includes(choice)) return undefined;
  return {
    id: 'gd-' + hashText(batchId + ':' + gapId + ':' + choice + ':' + turnId).slice(0, 24),
    gapId, by: 'editor', kind: choice as GapDecision['kind'], refs: [ref], note, createdAt,
  };
}
function deferDecision(batchId: Id, gapId: Id, ref: EvidenceRef, createdAt: string, turnId: Id): GapDecision {
  return choiceDecision(batchId, gapId, 'defer', ref, createdAt, turnId)!;
}
function answerUnderstoodLabel(answer: AnswerRecord, batch: QuestionBatch): string {
  const item = batch.items.find(item => item.gapId === answer.gapId);
  const option = answer.optionId ? item?.options?.find(option => option.id === answer.optionId) : undefined;
  if (option) return option.label;
  if (answer.value) return answer.value;
  switch (answer.choice) {
    case 'grant': return '允许使用';
    case 'deny': return '不允许使用';
    case 'defer': return '无法提供';
    case 'omit': return '省略';
    case 'proceed': return '按现有信息继续';
    case 'waive': return '已豁免';
    default: return item?.subject ?? answer.gapId;
  }
}

/** taskContractValid only reads evidence + task; both keep the v2 shape inside a v3 session. */
function contractView(session: EditorialSessionV3): EditorialSession {
  return { ...session, phase: 'planning', gaps: [], diagnostics: [], lastQuestion: undefined, lastStop: undefined } as unknown as EditorialSession;
}

export function processEditorTurn(session: EditorialSessionV3, message: EditorMessageInput): EditorTurnProjection {
  // Card submissions carry their payload in slots and may have no chat text; the
  // serialized submission becomes the evidence quote so bindings stay auditable.
  const submissionText = message.text.trim()
    ? message.text
    : (message.slots ?? []).map(slot => slot.gapId + '：' + (slot.value ?? slot.choice ?? '')).join('\n');
  const text = submissionText.trim();
  const turnId = 'turn-' + hashText(message.messageId + '\n' + submissionText).slice(0, 24);
  const createdAt = message.receivedAt ?? '';
  const existingEvidence = session.evidence.find(record => record.kind === 'editor_message' && record.provenance.messageId === message.messageId);
  const duplicate = session.turns.some(turn => turn.messageId === message.messageId) || (!message.evidenceAlreadyAppended && !!existingEvidence);
  const existingTurn = session.turns.find(turn => turn.messageId === message.messageId);
  // An active batch is authoritative regardless of a phase reset caused by an
  // evidence event: only that batch's answers may close its gaps.
  const activeBatch = session.questionBatches.find(batch => batch.id === session.activeBatchId && batch.status === 'active');
  const turnFor = (intent: EditorTurnIntent, bindingStatus: EditorTurnBindingStatus, bindingRefs: Id[], replyToBatchId?: Id): EditorTurn => ({
    id: turnId, messageId: message.messageId, receivedAt: createdAt, text: message.text,
    ...(replyToBatchId ? { replyToBatchId } : {}), intent, bindingStatus, bindingRefs,
  });
  const projection = (turn: EditorTurn, outcome: EditorTurnOutcome, extras: Partial<EditorTurnProjection> = {}): EditorTurnProjection => ({
    turn, duplicate: false, evidenceToAppend: null, answers: [], decisions: [],
    batchTransition: null, clarification: null, directiveMode: 'none', outcome, ...extras,
  });

  if (duplicate) {
    return {
      ...projection(existingTurn ?? turnFor('other', 'none', []), { type: 'duplicate', toPhase: session.phase, ...(session.activeBatchId ? { batchId: session.activeBatchId } : {}) }),
      duplicate: true,
    };
  }
  if (!text) return projection(turnFor('other', 'none', []), { type: 'ignored', toPhase: session.phase, reason: 'empty_message' });

  const projectedEvidence: EvidenceRecord = {
    id: message.evidenceId ?? 'editor-' + hashText(message.messageId + '\n' + submissionText).slice(0, 24),
    revision: 1, contentHash: hashText(submissionText), kind: 'editor_message', text: submissionText,
    provenance: { messageId: message.messageId }, context: { scenario: 'real' },
  };
  // The UI normally appends the editor message before the run. Reuse that exact
  // record so answer refs stay grounded; only a slot-only payload adds evidence.
  const reusableEvidence = existingEvidence && existingEvidence.text.includes(submissionText) ? existingEvidence : undefined;
  const evidenceToAppend: EvidenceRecord | null = reusableEvidence ? null : projectedEvidence;
  const evidenceForRef = reusableEvidence ?? projectedEvidence;
  const ref: EvidenceRef = { evidenceId: evidenceForRef.id, revision: evidenceForRef.revision, start: 0, end: evidenceForRef.text.length, quote: evidenceForRef.text };

  if (CANCEL.test(text)) {
    return projection(turnFor('cancel', 'none', [], activeBatch?.id), { type: 'cancel', toPhase: 'stopped', stopCode: 'run_cancelled' }, { evidenceToAppend });
  }
  if (session.phase === 'ready' && DELIVERY_CONFIRMATION.test(text)) {
    return projection(turnFor('confirm_delivery', 'none', []), { type: 'confirm_delivery', toPhase: 'confirmed' }, { evidenceToAppend });
  }

  if (activeBatch) {
    const itemIds = new Set(activeBatch.items.map(item => item.gapId));
    const expired = message.replyToBatchId !== undefined && message.replyToBatchId !== activeBatch.id;
    const outOfBatch = (message.slots ?? []).some(slot => !itemIds.has(slot.gapId));
    if (expired || outOfBatch) {
      return projection(turnFor('answer', 'needs_assignment', [], message.replyToBatchId ?? activeBatch.id), { type: 'needs_assignment', toPhase: 'waiting_editor' }, {
        evidenceToAppend, directiveMode: 'additive', notice: expired ? '该回答属于已过期的问题批次，请按当前问题重新回答。' : '回答中存在不属于当前批次的项，请按当前问题重新回答。',
      });
    }
    if (activeBatch.intake) {
      return projection(turnFor('instruction', 'none', [], activeBatch.id), { type: 'instruction', toPhase: 'working', startRun: 'instruction' }, {
        evidenceToAppend, directiveMode: 'normal', batchTransition: { batchId: activeBatch.id, status: 'answered' },
      });
    }
    const mismatched = message.replyToBatchId !== undefined && message.replyToBatchId !== activeBatch.id;
    const binding: BindingResult = mismatched
      ? { answers: [], decisions: [], boundGapIds: [], unboundGapIds: activeBatch.items.map(item => item.gapId) }
      : bindAnswers(activeBatch, message, ref, turnId, createdAt);
    const replyTo = message.replyToBatchId ?? activeBatch.id;

    if (activeBatch.items.length && binding.boundGapIds.length === activeBatch.items.length) {
      return projection(turnFor('answer', 'bound', binding.boundGapIds, replyTo), { type: 'answers_bound', toPhase: 'working', startRun: 'answers' }, {
        evidenceToAppend, answers: binding.answers, decisions: binding.decisions,
        batchTransition: { batchId: activeBatch.id, status: 'answered' },
      });
    }
    if (binding.boundGapIds.length) {
      return projection(turnFor('answer', 'partial', binding.boundGapIds, replyTo), { type: 'clarification', toPhase: 'waiting_editor' }, {
        evidenceToAppend, answers: binding.answers, decisions: binding.decisions,
        batchTransition: { batchId: activeBatch.id, status: 'partially_answered' },
        clarification: { batchId: activeBatch.id, gapIds: binding.unboundGapIds, reasonCode: 'reply_partial', understood: binding.answers.map(answer => answerUnderstoodLabel(answer, activeBatch)) },
      });
    }
    if (ANSWER_CONFIRMATION.test(text)) {
      // Design §5.2: already-known first, then an explicit default option, else defer.
      const answers: AnswerRecord[] = [];
      const decisions: GapDecision[] = [];
      for (const item of activeBatch.items) {
        const gap = session.gaps.find(candidate => candidate.id === item.gapId);
        const known = !!gap?.selector && session.claims.some(claim => claim.epistemic === 'supported' && claim.visibility === 'public' &&
          claim.selector.scopeId === gap.selector?.scopeId && claim.selector.predicate === gap.selector?.predicate);
        const affirmative = item.expected === 'choice' || item.expected === 'authorization' ? item.options?.find(option => option.isDefaultAffirmative) : undefined;
        if (known) {
          decisions.push({ id: 'gd-' + hashText(activeBatch.id + ':' + item.gapId + ':known:' + turnId).slice(0, 24), gapId: item.gapId, by: 'editor', kind: 'proceed', refs: [ref], note: 'already_known', createdAt });
          continue;
        }
        if (affirmative) {
          const authorization = item.gapClass === 'authorization';
          answers.push({
            id: 'ans-' + hashText(activeBatch.id + ':' + item.gapId + ':default:' + turnId).slice(0, 24),
            turnId, messageId: message.messageId, batchId: activeBatch.id, gapId: item.gapId, method: 'confirmation',
            choice: authorization ? 'grant' : 'supply', optionId: affirmative.id, refs: [ref], createdAt, ...(authorization ? {} : { value: affirmative.label }),
          });
          decisions.push({ id: 'gd-' + hashText(activeBatch.id + ':' + item.gapId + ':default:' + turnId).slice(0, 24), gapId: item.gapId, by: 'editor', kind: authorization ? 'proceed' : 'supply', refs: [ref], note: '默认选项：' + affirmative.label, createdAt });
          continue;
        }
        decisions.push(deferDecision(activeBatch.id, item.gapId, ref, createdAt, turnId));
      }
      return projection(turnFor('confirm_answers', 'none', [], replyTo), { type: 'answer_confirmation', toPhase: 'working', startRun: 'deferred' }, {
        evidenceToAppend, answers, decisions, batchTransition: { batchId: activeBatch.id, status: 'answered' },
      });
    }
    if (message.mappingAttempted) {
      return projection(turnFor('answer', 'needs_assignment', [], replyTo), { type: 'clarification', toPhase: 'waiting_editor' }, {
        evidenceToAppend, directiveMode: 'none',
        clarification: { batchId: activeBatch.id, gapIds: activeBatch.items.map(item => item.gapId), reasonCode: 'reply_unmapped', understood: [] },
      });
    }
    return projection(turnFor('answer', 'needs_assignment', [], replyTo), { type: 'needs_assignment', toPhase: 'waiting_editor' }, {
      evidenceToAppend, directiveMode: 'additive',
    });
  }

  if (BARE_CONFIRMATION.test(text)) {
    return projection(turnFor('other', 'none', []), {
      type: 'confirm_without_pending', toPhase: session.phase,
      code: session.phase === 'confirmed' ? 'already_confirmed' : 'confirmation_without_pending',
    }, { evidenceToAppend });
  }

  const canRun = session.phase === 'ready' || session.phase === 'confirmed' || taskContractValid(contractView(session));
  return canRun
    ? projection(turnFor('instruction', 'none', []), { type: 'instruction', toPhase: 'working', startRun: 'instruction' }, { evidenceToAppend, directiveMode: 'normal' })
    : projection(turnFor('instruction', 'none', []), { type: 'intake_question', toPhase: 'waiting_editor' }, { evidenceToAppend, directiveMode: 'normal' });
}
