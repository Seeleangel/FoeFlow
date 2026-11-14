/**
 * v3 shadow contracts (design §8.1/§8.2). These types are additive: the v2
 * EditorialSession schema and controller keep running untouched until step 2.
 */
import { runtimeChecks } from './editorialTypes';
import type {
  Confirmation, Diagnostics as DiagnosticV2, DraftArtifact, EditorialNote, EvidenceRecord, EvidenceRef,
  FactClaim, FactSelector, GateReport, Hash, HumanVerification, Id, InputKey, LayoutStamp, LegacySnapshot,
  Permission, ReadReceipt, ReviewStamp, Scope, ScopeAlignment, TaskContract,
} from './editorialTypes';

export type EditorialPhaseV3 = 'intake' | 'waiting_editor' | 'working' | 'ready' | 'confirmed' | 'stopped';
export const EDITORIAL_PHASES_V3: readonly EditorialPhaseV3[] = Object.freeze(['intake', 'waiting_editor', 'working', 'ready', 'confirmed', 'stopped']);

export type EditorTurnIntent = 'instruction' | 'answer' | 'confirm_answers' | 'confirm_delivery' | 'cancel' | 'other';
export type EditorTurnBindingStatus = 'none' | 'bound' | 'partial' | 'needs_assignment';
export interface EditorTurn {
  id: Id; messageId: Id; receivedAt: string; text: string; replyToBatchId?: Id;
  intent: EditorTurnIntent; bindingStatus: EditorTurnBindingStatus; bindingRefs: Id[];
}

export type AnswerMethod = 'explicit_slot' | 'numbered' | 'model_mapped' | 'editor_assigned' | 'confirmation';
export type AnswerChoice = 'supply' | 'omit' | 'waive' | 'grant' | 'deny' | 'proceed' | 'defer';
export interface AnswerRecord {
  id: Id; turnId: Id; messageId: Id; batchId: Id; gapId: Id; method: AnswerMethod;
  value?: string; choice?: AnswerChoice; optionId?: Id; refs: EvidenceRef[]; resultingClaimIds?: Id[]; createdAt: string;
}

export type GapClass = 'fact' | 'constraint' | 'authorization' | 'internal';
export type GapOwner = 'editor' | 'agent' | 'agent_or_editor';
export type GapStateV3 = 'open' | 'asked' | 'answered' | 'needs_clarification' | 'resolved' | 'resolved_for_gate' |
  'waived' | 'deferred_by_editor' | 'pending_check' | 'unmet' | 'blocked_by_constraint';
export type GapDecisionKind = 'supply' | 'omit' | 'waive' | 'proceed' | 'defer' | 'deny';
export interface GapOrigin { kind: 'requirement' | 'criterion' | 'permission' | 'source' | 'validator'; id: Id }
export interface GapAskHistoryEntry { batchId: Id; messageId: Id; promptHash: Hash; reasonCode: string }
export interface GapDecision { id: Id; gapId: Id; by: 'editor'; kind: GapDecisionKind; refs: EvidenceRef[]; note?: string; createdAt: string }
export interface GapClosure { by: 'claim' | 'source' | 'output_check' | 'editor_decision' | 'retry'; refs: EvidenceRef[] }
export interface GapV2 {
  id: Id; gapClass: GapClass; askable: boolean; owner: GapOwner; state: GapStateV3; origin: GapOrigin;
  selector?: FactSelector; label: string; reason: string; whyNeeded?: string;
  askHistory: GapAskHistoryEntry[];
  decision?: { by: 'editor'; kind: GapDecisionKind; refs: EvidenceRef[]; at: string };
  closure?: GapClosure;
}

export type QuestionBatchStatus = 'active' | 'answered' | 'partially_answered' | 'superseded' | 'cancelled';
export interface QuestionOption { id: Id; label: string; isDefaultAffirmative?: boolean; choice?: 'supply' | 'omit' | 'grant' | 'deny' }
export interface QuestionItem {
  gapId: Id; gapClass: GapClass; subject: string; requested: string; why: string;
  expected: 'free_text' | 'choice' | 'authorization'; options?: QuestionOption[]; answerSlot: Id;
}
export interface QuestionBatch {
  id: Id; createdAtMessageId: Id; gapIds: Id[]; items: QuestionItem[]; status: QuestionBatchStatus;
  answeredByMessageId?: Id; remainingGapIds?: Id[]; intake?: boolean; reasonCode?: string; understood?: string[];
}

export type StopClass = 'external' | 'input' | 'internal';
export type StopAction = 'retry' | 'supply' | 'waive' | 'edit_task' | 'answer' | 'confirm' | 'report';
export type StopFields = Record<string, string | number | boolean>;
export interface StopPreserved { candidateRevision?: number; committedRevision?: number; inputKey?: InputKey }
export interface StopRecord {
  code: string; class: StopClass; stage?: string; retryable: boolean; headline: string; detail: string;
  fields?: StopFields; actions: StopAction[]; traceId: string; preserved: StopPreserved;
}

export type ModelCallResult = 'ok' | 'transport_error' | 'syntax_error' | 'schema_error' | 'semantic_error';
export interface ModelCallRecord {
  callId: Id; stage: string; attempt: number; contractVersion: string; startedAt: string; endedAt: string;
  result: ModelCallResult; acceptedCount: number; quarantinedCount: number; errorCodes: string[];
}
export type RunOutcomeV3 = 'needs_editor' | 'ready' | 'stopped' | 'cancelled';
export interface RunReport {
  runId: Id; startedAt: string; endedAt: string; outcome: RunOutcomeV3;
  stop?: StopRecord; modelCalls: ModelCallRecord[]; agentDiagnostics: Diagnostic[];
}

/** `Diagnostic` keeps the existing runtime shape; the session field is renamed by design §8.1. */
export type Diagnostic = DiagnosticV2;

export interface EditorialSessionV3 {
  schemaVersion: 3;
  sessionId: Id; revision: number; evidenceRevision: number; policyRevision: number;
  evidence: EvidenceRecord[]; readReceipts: ReadReceipt[]; scopes: Scope[]; alignments: ScopeAlignment[];
  claims: FactClaim[]; permissions: Permission[]; task: TaskContract;

  phase: EditorialPhaseV3;
  turns: EditorTurn[];
  questionBatches: QuestionBatch[];
  activeBatchId?: Id;
  answers: AnswerRecord[];
  gapDecisions: GapDecision[];
  gaps: GapV2[];
  agentDiagnostics: Diagnostic[];
  lastRun?: RunReport;

  candidate?: DraftArtifact; review?: ReviewStamp; layout?: LayoutStamp; gate?: GateReport;
  committed?: { artifact: DraftArtifact; layout: LayoutStamp; confirmation?: Confirmation };
  activeRunId?: Id; editorialNotes?: EditorialNote[]; humanVerifications: HumanVerification[];
  legacy?: LegacySnapshot; selectedOutput?: 'candidate' | 'committed' | 'legacy';
}

const { str, id, num, bool, en, opt, arr, obj, schema, refs, ids, evidence, scope, alignment, claim, permission, selector, task, note, draft, inputKey, gate, review, layout, confirmation, human, receipt, diagnostic } = runtimeChecks;

const phase = en(...EDITORIAL_PHASES_V3);
const gapClass = en('fact', 'constraint', 'authorization', 'internal');
const gapOwner = en('editor', 'agent', 'agent_or_editor');
const gapState = en('open', 'asked', 'answered', 'needs_clarification', 'resolved', 'resolved_for_gate', 'waived', 'deferred_by_editor', 'pending_check', 'unmet', 'blocked_by_constraint');
const decisionKind = en('supply', 'omit', 'waive', 'proceed', 'defer', 'deny');
const stopClass = en('external', 'input', 'internal');
const stopAction = en('retry', 'supply', 'waive', 'edit_task', 'answer', 'confirm', 'report');
const modelResult = en('ok', 'transport_error', 'syntax_error', 'schema_error', 'semantic_error');

const turn = obj({ id, messageId: id, receivedAt: str, text: str, replyToBatchId: opt(id), intent: en('instruction', 'answer', 'confirm_answers', 'confirm_delivery', 'cancel', 'other'), bindingStatus: en('none', 'bound', 'partial', 'needs_assignment'), bindingRefs: ids });
const answer = obj({ id, turnId: id, messageId: id, batchId: id, gapId: id, method: en('explicit_slot', 'numbered', 'model_mapped', 'editor_assigned', 'confirmation'), value: opt(str), choice: opt(en('supply', 'omit', 'waive', 'grant', 'deny', 'proceed', 'defer')), optionId: opt(id), refs, resultingClaimIds: opt(ids), createdAt: str });
const askHistory = obj({ batchId: id, messageId: id, promptHash: id, reasonCode: id });
const gapDecision = obj({ id, gapId: id, by: en('editor'), kind: decisionKind, refs, note: opt(str), createdAt: str });
const gapV2 = obj({ id, gapClass, askable: bool, owner: gapOwner, state: gapState, origin: obj({ kind: en('requirement', 'criterion', 'permission', 'source', 'validator'), id }), selector: opt(selector), label: id, reason: id, whyNeeded: opt(id), askHistory: arr(askHistory), decision: opt(obj({ by: en('editor'), kind: decisionKind, refs, at: str })), closure: opt(obj({ by: en('claim', 'source', 'output_check', 'editor_decision', 'retry'), refs })) });
const questionOption = obj({ id, label: id, isDefaultAffirmative: opt(bool), choice: opt(en('supply', 'omit', 'grant', 'deny')) });
const questionItem = obj({ gapId: id, gapClass, subject: id, requested: id, why: id, expected: en('free_text', 'choice', 'authorization'), options: opt(arr(questionOption)), answerSlot: id });
const questionBatch = obj({ id, createdAtMessageId: id, gapIds: ids, items: arr(questionItem), status: en('active', 'answered', 'partially_answered', 'superseded', 'cancelled'), answeredByMessageId: opt(id), remainingGapIds: opt(ids), intake: opt(bool), reasonCode: opt(id), understood: opt(arr(str)) });
const modelCall = obj({ callId: id, stage: id, attempt: num, contractVersion: id, startedAt: str, endedAt: str, result: modelResult, acceptedCount: num, quarantinedCount: num, errorCodes: arr(str) });
const stopFields = (v: unknown) => v === undefined || !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(value => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean');
const stopRecord = obj({ code: id, class: stopClass, stage: opt(id), retryable: bool, headline: id, detail: str, fields: opt(stopFields), actions: arr(stopAction), traceId: id, preserved: obj({ candidateRevision: opt(num), committedRevision: opt(num), inputKey: opt(inputKey) }) });
const runReport = obj({ runId: id, startedAt: str, endedAt: str, outcome: en('needs_editor', 'ready', 'stopped', 'cancelled'), stop: opt(stopRecord), modelCalls: arr(modelCall), agentDiagnostics: arr(diagnostic) });
const legacy = obj({ mode: en('pending', 'confirmed', 'legacy-manual', 'damaged'), title: str, text: str, html: str, confirmed: bool, originalConfirmation: () => true, raw: () => true });
const sessionV3 = obj({
  schemaVersion: en(3), sessionId: id, revision: num, evidenceRevision: num, policyRevision: num,
  evidence: arr(evidence), readReceipts: arr(receipt), scopes: arr(scope), alignments: arr(alignment), claims: arr(claim), permissions: arr(permission), task,
  phase, turns: arr(turn), questionBatches: arr(questionBatch), activeBatchId: opt(id), answers: arr(answer), gapDecisions: arr(gapDecision), gaps: arr(gapV2), agentDiagnostics: arr(diagnostic), lastRun: opt(runReport),
  candidate: opt(draft), review: opt(review), layout: opt(layout), gate: opt(gate), committed: opt(obj({ artifact: draft, layout, confirmation: opt(confirmation) })),
  activeRunId: opt(id), editorialNotes: opt(arr(note)), humanVerifications: arr(human), legacy: opt(legacy), selectedOutput: opt(en('candidate', 'committed', 'legacy')),
});

export const EditorTurnSchema = schema<EditorTurn>(turn);
export const AnswerRecordSchema = schema<AnswerRecord>(answer);
export const GapDecisionSchema = schema<GapDecision>(gapDecision);
export const GapV2Schema = schema<GapV2>(gapV2);
export const QuestionItemSchema = schema<QuestionItem>(questionItem);
export const QuestionBatchSchema = schema<QuestionBatch>(questionBatch);
export const ModelCallRecordSchema = schema<ModelCallRecord>(modelCall);
export const StopRecordSchema = schema<StopRecord>(stopRecord);
export const RunReportSchema = schema<RunReport>(runReport);
export const EditorialSessionV3Schema = schema<EditorialSessionV3>(sessionV3);

/** Design §4.1 hard rule: only fact/authorization gaps marked askable may enter a question batch. */
export function isAskableGap(gap: GapV2): boolean {
  return gap.askable && (gap.gapClass === 'fact' || gap.gapClass === 'authorization');
}
