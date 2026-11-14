import { describe, it, expect } from 'vitest';
import {
  AnswerRecordSchema, EDITORIAL_PHASES_V3, EditorialSessionV3Schema, EditorTurnSchema, GapDecisionSchema, GapV2Schema,
  ModelCallRecordSchema, QuestionBatchSchema, RunReportSchema, StopRecordSchema, isAskableGap,
  type AnswerRecord, type EditorTurn, type GapDecision, type GapV2, type ModelCallRecord, type QuestionBatch, type RunReport, type StopRecord,
} from '../editorialTypesV3';
import { v3ReadySession } from './editorialV3Fixtures';

const ref = { evidenceId: 'e', revision: 1, start: 0, end: 3, quote: 'abc' };
const gap = (overrides: Partial<GapV2> = {}): GapV2 => ({
  id: 'gap-1', gapClass: 'fact', askable: true, owner: 'agent_or_editor', state: 'open',
  origin: { kind: 'requirement', id: 'req-1' }, selector: { scopeId: 'event', predicate: 'attendance' },
  label: '出席人数', reason: '报道需要具体出席人数', whyNeeded: '报道需要具体出席人数', askHistory: [], ...overrides,
});
const item = () => ({ gapId: 'gap-1', gapClass: 'fact' as const, subject: '秋季读书会', requested: '出席人数', why: '报道需要', expected: 'free_text' as const, answerSlot: 'slot-1' });
const batch = (overrides: Partial<QuestionBatch> = {}): QuestionBatch => ({ id: 'q-1', createdAtMessageId: 'm1', gapIds: ['gap-1'], items: [item()], status: 'active', ...overrides });
const answer = (overrides: Partial<AnswerRecord> = {}): AnswerRecord => ({ id: 'a-1', turnId: 't-1', messageId: 'm2', batchId: 'q-1', gapId: 'gap-1', method: 'explicit_slot', value: '30 人', choice: 'supply', refs: [ref], createdAt: '2026-11-13T10:00:00+08:00', ...overrides });
const decision = (overrides: Partial<GapDecision> = {}): GapDecision => ({ id: 'gd-1', gapId: 'gap-1', by: 'editor', kind: 'defer', refs: [ref], createdAt: '2026-11-13T10:00:00+08:00', ...overrides });
const turn = (overrides: Partial<EditorTurn> = {}): EditorTurn => ({ id: 't-1', messageId: 'm2', receivedAt: '2026-11-13T10:00:00+08:00', text: '确认', intent: 'confirm_answers', bindingStatus: 'none', bindingRefs: [], ...overrides });
const stop = (overrides: Partial<StopRecord> = {}): StopRecord => ({
  code: 'model_unavailable', class: 'external', retryable: true, headline: '模型服务暂时不可用', detail: 'HTTP 502',
  actions: ['retry'], traceId: 'trace-1', preserved: { candidateRevision: 1 }, ...overrides,
});
const report = (overrides: Partial<RunReport> = {}): RunReport => ({ runId: 'run-1', startedAt: 'a', endedAt: 'b', outcome: 'stopped', stop: stop(), modelCalls: [], agentDiagnostics: [], ...overrides });

describe('v3 phase and gap contracts', () => {
  it('has exactly the six session phases and no failed phase', () => {
    expect(EDITORIAL_PHASES_V3).toEqual(['intake', 'waiting_editor', 'working', 'ready', 'confirmed', 'stopped']);
    const s = v3ReadySession();
    for (const phase of EDITORIAL_PHASES_V3) expect(EditorialSessionV3Schema.parse({ ...s, phase }).phase).toBe(phase);
    expect(() => EditorialSessionV3Schema.parse({ ...s, phase: 'failed' })).toThrow();
    expect(() => EditorialSessionV3Schema.parse({ ...s, phase: 'waiting_input' })).toThrow();
  });

  it('validates GapV2 classes, lifecycle states and askHistory entries', () => {
    expect(GapV2Schema.parse(gap()).gapClass).toBe('fact');
    for (const gapClass of ['fact', 'constraint', 'authorization', 'internal'] as const) expect(GapV2Schema.parse(gap({ gapClass })).gapClass).toBe(gapClass);
    for (const state of ['open', 'asked', 'answered', 'needs_clarification', 'resolved', 'resolved_for_gate', 'waived', 'deferred_by_editor', 'pending_check', 'unmet', 'blocked_by_constraint'] as const) expect(GapV2Schema.parse(gap({ state })).state).toBe(state);
    expect(GapV2Schema.parse(gap({ askHistory: [{ batchId: 'q-1', messageId: 'm1', promptHash: 'h', reasonCode: 'migrated_asked' }] })).askHistory).toHaveLength(1);
    expect(() => GapV2Schema.parse({ ...gap(), kind: 'missing', requirementId: 'req-1' })).toThrow();
    expect(() => GapV2Schema.parse(gap({ gapClass: 'missing' as never }))).toThrow();
    expect(() => GapV2Schema.parse(gap({ state: 'deferred' as never }))).toThrow();
    expect(() => GapV2Schema.parse(gap({ askHistory: [{ batchId: '', messageId: 'm1', promptHash: 'h', reasonCode: 'x' }] }))).toThrow();
    expect(() => GapV2Schema.parse({ ...gap(), alternatives: [] })).toThrow();
  });

  it('enforces the askable-gap hard rule from design §4.1', () => {
    expect(isAskableGap(gap())).toBe(true);
    expect(isAskableGap(gap({ gapClass: 'authorization', owner: 'editor', origin: { kind: 'permission', id: 'c-1' } }))).toBe(true);
    expect(isAskableGap(gap({ askable: false }))).toBe(false);
    expect(isAskableGap(gap({ gapClass: 'constraint', askable: true }))).toBe(false);
    expect(isAskableGap(gap({ gapClass: 'internal', askable: true }))).toBe(false);
  });
});

describe('v3 answer and question contracts', () => {
  it('validates QuestionBatch status, items and answer slots', () => {
    expect(QuestionBatchSchema.parse(batch()).items[0].expected).toBe('free_text');
    for (const status of ['active', 'answered', 'partially_answered', 'superseded', 'cancelled'] as const) expect(QuestionBatchSchema.parse(batch({ status })).status).toBe(status);
    expect(QuestionBatchSchema.parse({ ...batch(), items: [{ ...item(), expected: 'authorization', options: [{ id: 'o-1', label: '同意', isDefaultAffirmative: true }] }] }).items[0].options).toHaveLength(1);
    expect(() => QuestionBatchSchema.parse(batch({ status: 'pending' as never }))).toThrow();
    expect(() => QuestionBatchSchema.parse({ ...batch(), items: [{ ...item(), expected: 'text' }] })).toThrow();
    expect(() => QuestionBatchSchema.parse({ ...batch(), items: [{ ...item(), answerSlot: '' }] })).toThrow();
    expect(() => QuestionBatchSchema.parse({ ...batch(), answeredBy: 'm2' })).toThrow();
  });

  it('validates AnswerRecord methods, choices and evidence refs', () => {
    for (const method of ['explicit_slot', 'numbered', 'model_mapped', 'editor_assigned', 'confirmation'] as const) expect(AnswerRecordSchema.parse(answer({ method })).method).toBe(method);
    for (const choice of ['supply', 'omit', 'waive', 'grant', 'deny', 'proceed', 'defer'] as const) expect(AnswerRecordSchema.parse(answer({ choice })).choice).toBe(choice);
    expect(AnswerRecordSchema.parse(answer({ resultingClaimIds: ['c-1'] })).resultingClaimIds).toEqual(['c-1']);
    expect(() => AnswerRecordSchema.parse(answer({ method: 'legacy' as never }))).toThrow();
    expect(() => AnswerRecordSchema.parse(answer({ choice: 'accept' as never }))).toThrow();
    expect(() => AnswerRecordSchema.parse(answer({ refs: [{ evidenceId: 'e' }] as never }))).toThrow();
    expect(() => AnswerRecordSchema.parse({ ...answer(), bonus: true })).toThrow();
  });

  it('validates GapDecision kinds and EditorTurn intents/binding statuses', () => {
    for (const kind of ['supply', 'omit', 'waive', 'proceed', 'defer', 'deny'] as const) expect(GapDecisionSchema.parse(decision({ kind })).kind).toBe(kind);
    expect(GapDecisionSchema.parse(decision({ note: '按现有信息继续' })).note).toBe('按现有信息继续');
    expect(() => GapDecisionSchema.parse(decision({ kind: 'deferred_by_editor' as never }))).toThrow();
    for (const intent of ['instruction', 'answer', 'confirm_answers', 'confirm_delivery', 'cancel', 'other'] as const) expect(EditorTurnSchema.parse(turn({ intent })).intent).toBe(intent);
    for (const bindingStatus of ['none', 'bound', 'partial', 'needs_assignment'] as const) expect(EditorTurnSchema.parse(turn({ bindingStatus })).bindingStatus).toBe(bindingStatus);
    expect(() => EditorTurnSchema.parse(turn({ intent: 'failed' as never }))).toThrow();
    expect(() => EditorTurnSchema.parse(turn({ bindingStatus: 'assigned' as never }))).toThrow();
  });
});

describe('v3 run report contracts', () => {
  it('validates the three stop classes and structured actions', () => {
    for (const cls of ['external', 'input', 'internal'] as const) expect(StopRecordSchema.parse(stop({ class: cls })).class).toBe(cls);
    expect(StopRecordSchema.parse(stop({ fields: { status: 502, stage: 'preflight' } })).fields).toEqual({ status: 502, stage: 'preflight' });
    expect(() => StopRecordSchema.parse(stop({ class: 'model' as never }))).toThrow();
    expect(() => StopRecordSchema.parse(stop({ actions: ['fetch' as never] }))).toThrow();
    expect(() => StopRecordSchema.parse(stop({ fields: [1] as never }))).toThrow();
    expect(() => StopRecordSchema.parse(stop({ retryable: 'yes' as never }))).toThrow();
  });

  it('validates RunReport outcomes and model call records', () => {
    for (const outcome of ['needs_editor', 'ready', 'stopped', 'cancelled'] as const) expect(RunReportSchema.parse(report({ outcome })).outcome).toBe(outcome);
    expect(() => RunReportSchema.parse(report({ outcome: 'failed' as never }))).toThrow();
    expect(() => RunReportSchema.parse(report({ stop: stop({ traceId: '' }) }))).toThrow();
    const call: ModelCallRecord = { callId: 'c-1', stage: 'preflight', attempt: 1, contractVersion: 'v3', startedAt: 'a', endedAt: 'b', result: 'syntax_error', acceptedCount: 0, quarantinedCount: 1, errorCodes: ['invalid_json'] };
    expect(ModelCallRecordSchema.parse(call).result).toBe('syntax_error');
    expect(() => ModelCallRecordSchema.parse({ ...call, result: 'timeout' })).toThrow();
    expect(() => ModelCallRecordSchema.parse({ ...call, attempt: -1 })).toThrow();
  });
});

describe('v3 session envelope', () => {
  it('round-trips a migrated v3 session and rejects v2 fields', () => {
    const s = v3ReadySession();
    expect(EditorialSessionV3Schema.parse(s)).toEqual(s);
    expect(() => EditorialSessionV3Schema.parse({ ...s, schemaVersion: 2 })).toThrow();
    expect(() => EditorialSessionV3Schema.parse({ ...s, diagnostics: [] })).toThrow();
    expect(() => EditorialSessionV3Schema.parse({ ...s, lastQuestion: batch() })).toThrow();
    expect(() => EditorialSessionV3Schema.parse({ ...s, lastStop: { code: 'x', unresolvedIds: [], nextActions: [] } })).toThrow();
    expect(() => EditorialSessionV3Schema.parse({ ...s, gaps: [...s.gaps, { id: 'g', requirementId: 'r', kind: 'missing' }] })).toThrow();
  });
});
