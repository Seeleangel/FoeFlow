import { describe, it, expect, vi } from 'vitest';
import { createEditorialSession, currentInputKey, hashText, type EditorialSession, type EvidenceRef } from '../editorialTypes';
import { canHandoff, runEditorialController, type EditorialModelPort } from '../editorialController';
import { deriveGaps, buildQuestion, formatQuestion } from '../editorialGaps';
import { applyControlEvent, assertConfirmable } from '../editorialState';
import { ensureQuestionState, sessionAsTurnView } from '../editorialTurnState';
import { processEditorTurn } from '../editorialTurnProcessor';
import { editorialStopExplanation } from '../editorialStatus';
import { seedTestTask } from './editorialTestFixtures';
import { uiReady } from './editorialUiFixture';

interface RequirementSpec { id: string; predicate: string; label: string; reason: string }
const noSources = { search: vi.fn(async () => []), read: vi.fn(async () => undefined) };

function opening(id: string): { session: EditorialSession; refs: EvidenceRef[] } {
  const session = createEditorialSession(id);
  const text = '请写一篇面向读者的活动报道。';
  session.evidence = [{ id: 'basis', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: { messageId: 'm1' }, context: { scenario: 'real' } }];
  return { session, refs: [{ evidenceId: 'basis', revision: 1, start: 0, end: text.length, quote: text }] };
}

function planFor(refs: EvidenceRef[], requirements: RequirementSpec[]): Record<string, unknown> {
  return {
    factPatch: {},
    taskPatch: {
      baseRevision: 0, refs, objective: '活动报道', intents: ['inform'],
      criteria: [{ id: 'body', origin: 'user', refs, severity: 'blocking', verification: 'deterministic', rule: { kind: 'length', min: 1, unit: 'visible_characters' } }],
      requirements: requirements.map(requirement => ({
        id: requirement.id, selector: { scopeId: 'event', predicate: requirement.predicate },
        label: requirement.label, reason: requirement.reason, whyNeeded: requirement.reason, refs, necessity: 'blocking', resolution: 'supply_fact',
      })),
    },
  };
}

function reply(session: EditorialSession, text: string, messageId: string): EditorialSession {
  const next = structuredClone(session);
  next.evidence.push({ id: messageId, revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: { messageId }, context: { scenario: 'real' } });
  next.evidenceRevision++;
  return next;
}

async function openQuestion(id: string, requirements: RequirementSpec[]) {
  const { session, refs } = opening(id);
  const model: EditorialModelPort = async ({ stage }) => {
    if (stage === 'preflight') return JSON.stringify(planFor(refs, requirements));
    if (stage === 'decide') return '{"tool":"ask"}';
    throw new Error('fixture_error:' + stage);
  };
  const outcome = await runEditorialController({ session, model, sources: noSources, signal: new AbortController().signal });
  expect(outcome.type).toBe('question');
  if (outcome.type !== 'question') throw new Error('expected_question');
  const batch = outcome.session.questionBatches?.find(candidate => candidate.id === outcome.session.activeBatchId);
  expect(batch?.status).toBe('active');
  expect(outcome.session.questionBatches).toHaveLength(1);
  expect(outcome.session.gaps.filter(gap => gap.state === 'asked')).toHaveLength(requirements.length);
  return outcome;
}

function finishingModel(stages: string[], body = 'Body'): EditorialModelPort {
  let decisions = 0;
  return async ({ stage }) => {
    stages.push(stage);
    if (stage === 'decide') return JSON.stringify(++decisions === 1 ? { tool: 'write', instructions: 'Write' } : { tool: 'review' });
    if (stage === 'write') return JSON.stringify({ title: 'Activity', bodyMarkdown: body });
    if (stage === 'review') return '{"blocking":[],"notes":[]}';
    throw new Error('fixture_error:' + stage);
  };
}

describe('A1–A7: explicit answers and confirmation', () => {
  it('A1: one semicolon reply binds every gap without model re-extraction', async () => {
    const first = await openQuestion('a1', [
      { id: 'attendance', predicate: 'attendance', label: '出席人数', reason: '报道需要人数' },
      { id: 'date', predicate: 'date', label: '活动日期', reason: '报道需要日期' },
    ]);
    const answered = reply(first.session, '30 人；10 月 20 日', 'answer-a1');
    const projection = processEditorTurn(sessionAsTurnView(ensureQuestionState(answered)), { messageId: 'answer-a1', text: '30 人；10 月 20 日', evidenceAlreadyAppended: true });
    expect(projection.outcome.type).toBe('answers_bound');
    expect(projection.answers.map(answer => answer.gapId)).toEqual(first.session.questionBatches![0].gapIds);

    const stages: string[] = [];
    const second = await runEditorialController({ session: answered, model: finishingModel(stages), sources: noSources, signal: new AbortController().signal });
    expect(stages).not.toContain('preflight');
    expect(stages).not.toContain('extract');
    expect(second.type).not.toBe('question');
    expect(second.session.answers).toHaveLength(2);
    expect(second.session.answers?.every(answer => answer.choice === 'supply')).toBe(true);
    expect(second.session.claims.filter(claim => claim.selector.predicate === 'attendance' || claim.selector.predicate === 'date')).toHaveLength(2);
    expect(deriveGaps(second.session).filter(gap => gap.selector.predicate === 'attendance' || gap.selector.predicate === 'date').every(gap => gap.state === 'resolved')).toBe(true);
    expect(second.session.questionBatches?.filter(batch => batch.status === 'active')).toHaveLength(0);
  });

  it('A2: a partial numbered reply closes part of the batch and asks only the rest', async () => {
    const first = await openQuestion('a2', [
      { id: 'attendance', predicate: 'attendance', label: '出席人数', reason: '报道需要人数' },
      { id: 'date', predicate: 'date', label: '活动日期', reason: '报道需要日期' },
      { id: 'location', predicate: 'location', label: '活动地点', reason: '报道需要地点' },
    ]);
    const oldBatchId = first.session.activeBatchId!;
    const oldGapIds = first.session.questionBatches![0].gapIds;
    const answered = reply(first.session, '1. 30 人', 'answer-a2');
    const model = vi.fn(async () => { throw new Error('fixture_error:must_not_call'); });
    const second = await runEditorialController({ session: answered, model, sources: noSources, signal: new AbortController().signal });
    expect(model).not.toHaveBeenCalled();
    expect(second.type).toBe('question');
    if (second.type !== 'question') throw new Error('expected_question');
    expect(second.session.questionBatches?.find(batch => batch.id === oldBatchId)?.status).toBe('partially_answered');
    const clarification = second.session.questionBatches?.find(batch => batch.id === second.session.activeBatchId)!;
    expect(clarification.status).toBe('active');
    expect(clarification.gapIds).toEqual(oldGapIds.slice(1));
    expect(clarification.understood).toEqual(['30 人']);
    expect(clarification.items[0].why).not.toContain('已了解');
    expect(formatQuestion(second.question)).not.toBe(formatQuestion(first.question));
    expect(second.session.answers).toHaveLength(1);
    expect(second.session.gaps.filter(gap => gap.state === 'asked').map(gap => gap.id)).toEqual(oldGapIds.slice(1));
    expect(second.session.gaps.find(gap => gap.id === clarification.gapIds[0])?.askHistory?.slice(-1)[0]?.reasonCode).toBe('reply_partial');
  });

  it('A3: re-entering the same message returns the same active batch with no model or events', async () => {
    const first = await openQuestion('a3', [{ id: 'attendance', predicate: 'attendance', label: '出席人数', reason: '报道需要人数' }]);
    const model = vi.fn(async () => { throw new Error('fixture_error:must_not_call'); });
    const events: unknown[] = [];
    const second = await runEditorialController({ session: first.session, model, sources: noSources, signal: new AbortController().signal, onEvent: event => { events.push(event); } });
    expect(second.type).toBe('question');
    if (second.type !== 'question') throw new Error('expected_question');
    expect(second.question.id).toBe(first.question.id);
    expect(model).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('A4: a gap that was already asked twice cannot enter a third batch', () => {
    const { session, refs } = opening('a4');
    session.task = {
      schemaVersion: 2, revision: 1, objective: '活动报道', intents: ['inform'], targetScopes: [],
      requirements: [{ id: 'attendance', selector: { scopeId: 'event', predicate: 'attendance' }, label: '出席人数', reason: '报道需要人数', whyNeeded: '报道需要人数', refs, necessity: 'blocking', resolution: 'supply_fact' }],
      requiredSources: [], criteria: [], permittedOmissions: [], sourceWaivers: [], coverage: { status: 'validated', refs },
    };
    const gap = deriveGaps(session)[0];
    session.gaps = [{ ...gap, state: 'open', askHistory: [
      { batchId: 'q-1', messageId: 'm1', promptHash: 'h1', reasonCode: 'question_opened' },
      { batchId: 'q-2', messageId: 'm2', promptHash: 'h2', reasonCode: 'reply_partial' },
    ] }];
    expect(() => buildQuestion(session, [gap.id])).toThrow('ask_limit_reached');
  });

  it('A5: 确认 over a fact batch records defer decisions without deleting requirements or calling preflight', async () => {
    const first = await openQuestion('a5', [
      { id: 'attendance', predicate: 'attendance', label: '出席人数', reason: '报道需要人数' },
      { id: 'date', predicate: 'date', label: '活动日期', reason: '报道需要日期' },
    ]);
    const answered = reply(first.session, '确认', 'answer-a5');
    const stages: string[] = [];
    const second = await runEditorialController({ session: answered, model: finishingModel(stages), sources: noSources, signal: new AbortController().signal });
    expect(stages).not.toContain('preflight');
    expect(second.session.task.revision).toBe(first.session.task.revision);
    expect(second.session.task.requirements).toHaveLength(2);
    expect((second.session.gapDecisions ?? []).map(decision => decision.kind)).toEqual(['defer', 'defer']);
    expect(second.session.questionBatches?.find(batch => batch.id === first.session.activeBatchId)?.status).toBe('answered');
    expect(second.session.answers).toEqual([]);
    expect(second.type).toBe('draft');
    expect(second.session.lastStop?.code).not.toBe('model_or_tool_failed');
  });

  it('A6: 确认 without an active batch explains and returns without a model call', async () => {
    const { session } = opening('a6');
    session.phase = 'writing';
    const answered = reply(session, '确认', 'answer-a6');
    const model = vi.fn(async () => { throw new Error('fixture_error:must_not_call'); });
    const outcome = await runEditorialController({ session: answered, model, sources: noSources, signal: new AbortController().signal });
    expect(model).not.toHaveBeenCalled();
    expect(outcome.type).toBe('incomplete');
    expect(outcome.session.lastRun?.stop?.code).toBe('confirmation_without_pending');
    expect(outcome.session.lastRun?.stop?.actions).toHaveLength(2);
    expect(outcome.session.lastRun?.stop?.class).toBe('input');
  });

  it('A7: delivery confirmation is a control event and stale keys list the failed gate', () => {
    const session = uiReady();
    const confirmed = applyControlEvent(session, {
      type: 'editor_confirmed', sessionId: session.sessionId, runId: session.activeRunId!, expectedRevision: session.revision,
      confirmation: { inputKey: currentInputKey(session), htmlHash: session.layout!.htmlHash, actor: 'editor', confirmedAt: '2026-11-13T10:00:00+08:00' },
    });
    expect(confirmed.phase).toBe('confirmed');
    expect(confirmed.committed?.artifact.contentHash).toBe(session.candidate?.contentHash);
    const stale = { ...session, evidenceRevision: session.evidenceRevision + 1 };
    expect(() => assertConfirmable(stale)).toThrow('confirmation_blocked');
    expect(canHandoff(stale).blockers).toContain('review_current');
  });

  it('A13: a single preflight syntax repair keeps the run alive', async () => {
    const { session, refs } = opening('a13');
    const plan = planFor(refs, [{ id: 'attendance', predicate: 'attendance', label: '出席人数', reason: '报道需要人数' }]);
    let decisions = 0;
    const stages: string[] = [];
    const model: EditorialModelPort = async ({ stage }) => {
      stages.push(stage);
      if (stage === 'preflight') return '{bad';
      if (stage === 'repair') return JSON.stringify(plan);
      if (stage === 'decide') return JSON.stringify(++decisions === 1 ? { tool: 'write', instructions: 'Write' } : { tool: 'review' });
      if (stage === 'write') return JSON.stringify({ title: 'Activity', bodyMarkdown: 'Body' });
      if (stage === 'review') return '{"blocking":[],"notes":[]}';
      throw new Error('fixture_error:' + stage);
    };
    const outcome = await runEditorialController({ session, model, sources: { search: async () => [], read: async () => ({ documentId: 'd', title: 'd', text: '30 人', complete: true }) }, signal: new AbortController().signal });
    expect(stages.filter(stage => stage === 'repair')).toHaveLength(1);
    const preflightCalls = outcome.session.lastRun?.modelCalls.filter(call => call.stage === 'preflight') ?? [];
    expect(preflightCalls.filter(call => call.result === 'syntax_error')).toHaveLength(1);
    expect(preflightCalls.filter(call => call.result === 'ok')).toHaveLength(1);
    expect(outcome.type).not.toBe('failed');
    expect(outcome.session.lastStop?.code).not.toBe('model_or_tool_failed');
  });
});

const twoRequirements: RequirementSpec[] = [
  { id: 'attendance', predicate: 'attendance', label: '出席人数', reason: '报道需要人数' },
  { id: 'date', predicate: 'date', label: '活动日期', reason: '报道需要日期' },
];

describe('A8 and A14–A18: output contracts and failure taxonomy', () => {
  it('A8: an internal invariant during a confirmation run is a structured internal failure and preserves answers', async () => {
    const first = await openQuestion('a8', twoRequirements);
    const answered = reply(first.session, '确认', 'answer-a8');
    const model: EditorialModelPort = async ({ stage }) => {
      if (stage === 'preflight' || stage === 'mapping') throw new Error('fixture_error:' + stage);
      if (stage === 'decide') return '{"tool":"write","instructions":"Write"}';
      if (stage === 'write') throw new Error('unsafe_fact_snapshot');
      throw new Error('fixture_error:' + stage);
    };
    const outcome = await runEditorialController({ session: answered, model, sources: noSources, signal: new AbortController().signal });
    expect(outcome.session.lastRun?.stop).toMatchObject({ class: 'internal', code: 'internal_invariant', stage: 'write', retryable: true, actions: ['retry', 'report'] });
    expect(outcome.session.lastRun?.stop?.traceId).toMatch(/^trace-/);
    expect(outcome.session.lastRun?.stop?.preserved.inputKey).toBeDefined();
    expect(outcome.session.lastStop?.code).not.toBe('model_or_tool_failed');
    expect(outcome.session.evidence).toHaveLength(answered.evidence.length);
    expect(outcome.session.gapDecisions?.map(decision => decision.kind)).toEqual(['defer', 'defer']);
    expect(outcome.session.questionBatches?.[0].status).toBe('answered');
    expect(editorialStopExplanation(outcome.session)).not.toContain('模型或素材工具失败');
  });

  it('A14: a mixed fact batch keeps valid peers and quarantines only the invalid claim', async () => {
    const session = createEditorialSession('a14');
    const text = 'A value B value C value D value';
    session.evidence = [{ id: 'basis', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: { messageId: 'm1' }, context: { scenario: 'real' } }];
    const refs = [{ evidenceId: 'basis', revision: 1, start: 0, end: text.length, quote: text }];
    const plan = planFor(refs, []);
    const scope = { id: 'subject', kind: 'other', label: 'Article', anchors: refs, qualifiers: [], identity: 'aligned' };
    const validClaim = (id: string) => ({ id, selector: { scopeId: 'subject', predicate: id }, value: id + ' value', refs, epistemic: 'supported', visibility: 'public', statusBasis: [] });
    const invalidClaim = { id: 'D', selector: { scopeId: 'subject', predicate: 'd' }, value: 'D value', refs, epistemic: 'pending', visibility: 'public', statusBasis: [{ evidenceId: 'basis', revision: 1, start: 0, end: 2, quote: 'WRONG' }] };
    let decisions = 0;
    const model: EditorialModelPort = async ({ stage }) => {
      if (stage === 'preflight') return JSON.stringify({ factPatch: { scopes: [scope], claims: [validClaim('A'), validClaim('B'), validClaim('C'), invalidClaim] }, taskPatch: plan.taskPatch });
      if (stage === 'decide') return JSON.stringify(++decisions === 1 ? { tool: 'write', instructions: 'Write' } : { tool: 'review' });
      if (stage === 'write') return JSON.stringify({ title: 'Title', bodyMarkdown: 'Body' });
      if (stage === 'review') return '{"blocking":[],"notes":[]}';
      throw new Error('fixture_error:' + stage);
    };
    const outcome = await runEditorialController({ session, model, sources: noSources, signal: new AbortController().signal });
    expect(outcome.type).toBe('draft');
    expect(outcome.session.claims.map(claim => claim.id).sort()).toEqual(['A', 'B', 'C']);
    expect(outcome.session.agentDiagnostics?.some(diagnostic => diagnostic.owner === 'facts:claims:D' && diagnostic.code === 'missing_status_basis')).toBe(true);
    expect(outcome.session.lastRun?.agentDiagnostics?.some(diagnostic => diagnostic.code === 'missing_status_basis')).toBe(true);
    expect(outcome.session.gaps.some(gap => gap.askable === true)).toBe(false);
    expect(outcome.session.gaps.some(gap => gap.gapClass === 'internal' || gap.kind === 'plan_ambiguity')).toBe(false);
    expect(outcome.session.lastRun?.modelCalls.find(call => call.stage === 'preflight')).toMatchObject({ acceptedCount: 3, quarantinedCount: 1 });
  });

  it('§6.1/6.2 generates a program template intake question when the task contract stays invalid', async () => {
    const { session, refs } = opening('intake-question');
    let preflights = 0; let decisions = 0;
    const model: EditorialModelPort = async ({ stage }) => {
      if (stage === 'preflight') { preflights++; return preflights === 1 ? '{"directives":[],"factPatch":{},"editorialNotes":[]}' : JSON.stringify(planFor(refs, [])); }
      if (stage === 'repair') return '{"directives":[],"factPatch":{},"editorialNotes":[]}';
      if (stage === 'decide') return JSON.stringify(++decisions === 1 ? { tool: 'write', instructions: 'Write' } : { tool: 'review' });
      if (stage === 'write') return JSON.stringify({ title: 'Title', bodyMarkdown: 'Body' });
      if (stage === 'review') return '{"blocking":[],"notes":[]}';
      throw new Error('fixture_error:' + stage);
    };
    const first = await runEditorialController({ session, model, sources: noSources, signal: new AbortController().signal });
    expect(first.type).toBe('question');
    if (first.type !== 'question') throw new Error('expected_question');
    expect(first.question.intake).toBe(true);
    expect(first.question.reasonCode).toBe('task_plan_incomplete');
    expect(first.question.items.map(item => item.subject)).toEqual(['目标', '读者', '必须包含的事实', '来源']);
    expect(first.session.questionBatches?.[0]).toMatchObject({ intake: true, status: 'active' });

    const answered = reply(first.session, '给本科生写一篇读书会报名通知，必须包含时间和地点，参考流程文档。', 'intake-answer');
    const second = await runEditorialController({ session: answered, model, sources: noSources, signal: new AbortController().signal });
    expect(second.type).toBe('draft');
    expect(second.session.questionBatches?.[0].status).toBe('answered');
    expect(second.session.activeBatchId).toBeUndefined();
  });

  it('§6.2 extract retries only the quarantined candidates once and then continues', async () => {
    const { session, refs } = opening('extract-retry');
    const plan = planFor(refs, []);
    (plan.taskPatch as Record<string, unknown>).requiredSources = [{ id: 'required', selector: { documentId: 'doc' }, purpose: '必须读取', refs, depth: 'full_document', state: 'pending' }];
    const sourceText = '容量 30 人';
    const validClaim = (evidenceId: string) => ({ id: 'capacity', selector: { scopeId: 'source', predicate: 'capacity' }, value: sourceText, refs: [{ evidenceId, revision: 1, start: 0, end: sourceText.length, quote: sourceText }], epistemic: 'supported', visibility: 'public', statusBasis: [] });
    const invalidClaim = (evidenceId: string) => ({ ...validClaim(evidenceId), epistemic: 'pending', statusBasis: [{ evidenceId, revision: 1, start: 0, end: 2, quote: 'WRONG' }] });
    const stages: string[] = []; let decisions = 0;
    const model: EditorialModelPort = async ({ stage, data }) => {
      stages.push(stage);
      if (stage === 'preflight') return JSON.stringify(plan);
      if (stage === 'extract') {
        const loaded = (data.loadedSources as { evidenceId: string }[])[0];
        const retrying = Array.isArray(data.quarantinedCandidates) && data.quarantinedCandidates.length > 0;
        const scope = { id: 'source', kind: 'other', label: 'Source', anchors: [{ evidenceId: loaded.evidenceId, revision: 1, start: 0, end: sourceText.length, quote: sourceText }], qualifiers: [], identity: 'aligned' };
        return JSON.stringify({ factPatch: { scopes: [scope], claims: [retrying ? validClaim(loaded.evidenceId) : invalidClaim(loaded.evidenceId)] } });
      }
      if (stage === 'decide') return JSON.stringify(++decisions === 1 ? { tool: 'write', instructions: 'Write' } : { tool: 'review' });
      if (stage === 'write') return JSON.stringify({ title: 'Title', bodyMarkdown: 'Body' });
      if (stage === 'review') return '{"blocking":[],"notes":[]}';
      throw new Error('fixture_error:' + stage);
    };
    const outcome = await runEditorialController({ session, model, sources: { search: async () => [], read: async () => ({ documentId: 'doc', title: 'Doc', text: sourceText, complete: true }) }, signal: new AbortController().signal });
    expect(stages.filter(stage => stage === 'extract')).toHaveLength(2);
    expect(outcome.type).toBe('draft');
    expect(outcome.session.claims.some(claim => claim.id === 'capacity')).toBe(true);
    const extractRecords = outcome.session.lastRun?.modelCalls.filter(call => call.stage === 'extract') ?? [];
    expect(extractRecords.some(call => call.acceptedCount === 0 && call.quarantinedCount === 1)).toBe(true);
    expect(extractRecords.some(call => call.acceptedCount === 1 && call.quarantinedCount === 0)).toBe(true);
    expect(outcome.session.questionBatches?.length ?? 0).toBe(0);
  });

  it('A15: two syntax failures keep the existing task and facts with a retryable internal stop', async () => {
    const session = seedTestTask(createEditorialSession('a15'));
    const evidence = session.evidence[0];
    const claimRef = { evidenceId: evidence.id, revision: evidence.revision, start: 0, end: evidence.text.length, quote: evidence.text };
    session.claims = [{ id: 'kept', selector: { scopeId: 'subject', predicate: 'value' }, value: 'value', refs: [claimRef], statusBasis: [claimRef], epistemic: 'supported', visibility: 'public' }];
    const before = structuredClone(session);
    let repairs = 0;
    const model: EditorialModelPort = async ({ stage }) => {
      if (stage === 'preflight') return '{bad';
      if (stage === 'repair') { repairs++; return '{bad'; }
      throw new Error('fixture_error:' + stage);
    };
    const outcome = await runEditorialController({ session, model, sources: noSources, signal: new AbortController().signal });
    expect(outcome.type).toBe('incomplete');
    expect(repairs).toBe(2);
    expect(outcome.session.lastRun?.stop).toMatchObject({ class: 'internal', code: 'model_output_invalid', stage: 'preflight', retryable: true, actions: ['retry', 'report'] });
    expect(outcome.session.lastRun?.stop?.traceId).toMatch(/^trace-/);
    expect(outcome.session.lastRun?.stop?.preserved.inputKey).toBeDefined();
    expect(outcome.session.task).toEqual(before.task);
    expect(outcome.session.claims).toEqual(before.claims);
    expect(outcome.session.lastRun?.stop?.code).toBe('model_output_invalid');
  });

  it('A16: an invalid decide action is discarded and the deterministic scheduler continues the run', async () => {
    const { session, refs } = opening('a16');
    const plan = planFor(refs, []);
    const stages: string[] = []; let decisions = 0;
    const model: EditorialModelPort = async ({ stage }) => {
      stages.push(stage);
      if (stage === 'preflight') return JSON.stringify(plan);
      if (stage === 'decide') return JSON.stringify(++decisions === 1 ? { tool: 'unknown' } : { tool: 'review' });
      if (stage === 'write') return JSON.stringify({ title: 'Title', bodyMarkdown: 'Body' });
      if (stage === 'review') return '{"blocking":[],"notes":[]}';
      throw new Error('fixture_error:' + stage);
    };
    const outcome = await runEditorialController({ session, model, sources: noSources, signal: new AbortController().signal });
    expect(outcome.type).toBe('draft');
    expect(outcome.session.agentDiagnostics?.some(diagnostic => diagnostic.code === 'invalid_action')).toBe(true);
    expect(stages.filter(stage => stage === 'decide')).toHaveLength(2);
    expect(stages).toContain('write');
    expect(outcome.session.lastStop).toBeUndefined();
  });

  it('A17: an invalid write artifact stops with artifact_invalid and keeps the old candidate', async () => {
    const session = uiReady();
    delete session.review; delete session.layout; delete session.gate; session.phase = 'writing';
    const oldCandidate = structuredClone(session.candidate!);
    let writes = 0;
    const model: EditorialModelPort = async ({ stage }) => {
      if (stage === 'preflight') return '{"factPatch":{}}';
      if (stage === 'decide') return '{"tool":"write","instructions":"Write attempt"}';
      if (stage === 'write') { writes++; return JSON.stringify({ bodyMarkdown: 'Body without title' }); }
      throw new Error('fixture_error:' + stage);
    };
    const outcome = await runEditorialController({ session, model, sources: noSources, signal: new AbortController().signal });
    expect(writes).toBe(2);
    expect(outcome.session.lastRun?.stop).toMatchObject({ class: 'internal', code: 'artifact_invalid', stage: 'write', retryable: true, actions: ['retry', 'report'], preserved: { candidateRevision: oldCandidate.revision } });
    expect(outcome.session.lastRun?.stop?.traceId).toMatch(/^trace-/);
    expect(outcome.session.lastRun?.stop?.detail).toContain('标题');
    expect(outcome.session.candidate).toEqual(oldCandidate);
  });

  it('A18: an invalid review records review_unavailable and never claims a model failure', async () => {
    const session = seedTestTask(createEditorialSession('a18'));
    let decisions = 0;
    const model: EditorialModelPort = async ({ stage }) => {
      if (stage === 'preflight') return '{"factPatch":{}}';
      if (stage === 'decide') return JSON.stringify(++decisions === 1 ? { tool: 'write', instructions: 'Write' } : { tool: 'review' });
      if (stage === 'write') return JSON.stringify({ title: 'Title', bodyMarkdown: 'Body' });
      if (stage === 'review' || stage === 'repair') return '{"blocking":123}';
      throw new Error('fixture_error:' + stage);
    };
    const outcome = await runEditorialController({ session, model, sources: noSources, signal: new AbortController().signal });
    expect(outcome.type).toBe('incomplete');
    expect(outcome.session.diagnostics.some(diagnostic => diagnostic.code === 'review_unavailable' && diagnostic.gateEffect === 'block')).toBe(true);
    expect(outcome.session.lastRun?.stop).toMatchObject({ class: 'internal', code: 'review_invalid', stage: 'review', retryable: true, actions: ['retry', 'report'] });
    expect(outcome.session.lastRun?.stop?.traceId).toMatch(/^trace-/);
    expect(outcome.session.lastRun?.stop?.preserved.inputKey).toBeDefined();
    expect(outcome.session.lastStop?.code).not.toBe('model_or_tool_failed');
    expect(outcome.session.phase).not.toBe('pending_confirmation');
    expect(canHandoff(outcome.session).blockers).toContain('diagnostic:review_unavailable');
  });
});
