import { describe, it, expect, vi } from 'vitest';
import { createEditorialSession, hashText, type EditorialSession, type EvidenceRef } from '../editorialTypes';
import { runEditorialController, type EditorialModelPort } from '../editorialController';
import { deriveGaps } from '../editorialGaps';
import { processEditorTurn } from '../editorialTurnProcessor';
import { applyEditorTurn, ensureQuestionState, sessionAsTurnView } from '../editorialTurnState';
import type { QuestionBatch as QuestionBatchV3, QuestionItem } from '../editorialTypesV3';
import { uiReady } from './editorialUiFixture';

const noSources = { search: vi.fn(async () => []), read: vi.fn(async () => undefined) };
interface Spec { id: string; predicate: string; label: string; reason: string }
function opening(id: string): { session: EditorialSession; refs: EvidenceRef[] } {
  const session = createEditorialSession(id); const text = '请写一篇面向读者的活动报道。';
  session.evidence = [{ id: 'basis', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: { messageId: 'm1' }, context: { scenario: 'real' } }];
  return { session, refs: [{ evidenceId: 'basis', revision: 1, start: 0, end: text.length, quote: text }] };
}
function plan(refs: EvidenceRef[], specs: Spec[], criteria: Record<string, unknown>[] = []) {
  return { factPatch: {}, taskPatch: { baseRevision: 0, refs, objective: '活动报道', intents: ['inform'],
    criteria: criteria.length ? criteria : [{ id: 'body', origin: 'user', refs, severity: 'blocking', verification: 'deterministic', rule: { kind: 'length', min: 1, unit: 'visible_characters' } }],
    requirements: specs.map(spec => ({ id: spec.id, selector: { scopeId: 'event', predicate: spec.predicate }, label: spec.label, reason: spec.reason, whyNeeded: spec.reason, refs, necessity: 'blocking', resolution: 'supply_fact' })) } };
}
function reply(session: EditorialSession, text: string, messageId: string): EditorialSession {
  const next = structuredClone(session); next.evidence.push({ id: messageId, revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: { messageId }, context: { scenario: 'real' } }); next.evidenceRevision++; return next;
}
function runTurn(session: EditorialSession, text: string, slots?: { gapId: string; value?: string; choice?: 'defer' }[]) {
  const view = sessionAsTurnView(ensureQuestionState(session));
  const message = { messageId: 'm-' + text, text, evidenceAlreadyAppended: true, ...(slots ? { slots } : {}) };
  const projection = processEditorTurn(view, message);
  return { projection, applied: applyEditorTurn(session, message, projection) };
}
async function openQuestion(id: string, specs: Spec[]) {
  const { session, refs } = opening(id); const model: EditorialModelPort = async ({ stage }) => stage === 'preflight' ? JSON.stringify(plan(refs, specs)) : stage === 'decide' ? '{"tool":"ask"}' : (() => { throw new Error('fixture_error:' + stage); })();
  const outcome = await runEditorialController({ session, model, sources: noSources, signal: new AbortController().signal });
  if (outcome.type !== 'question') throw new Error('expected_question'); return outcome;
}
function finishing(stages: string[]): EditorialModelPort {
  let decisions = 0;
  return async ({ stage }) => { stages.push(stage);
    if (stage === 'decide') return JSON.stringify(++decisions === 1 ? { tool: 'write', instructions: 'Write' } : { tool: 'review' });
    if (stage === 'write') return JSON.stringify({ title: 'Title', bodyMarkdown: 'Body' });
    if (stage === 'review') return '{"blocking":[],"notes":[]}';
    throw new Error('fixture_error:' + stage);
  };
}

function sessionWithBatch(id: string, size: number): { session: EditorialSession; batch: QuestionBatchV3; gapIds: string[] } {
  const { session, refs } = opening(id);
  session.task = { schemaVersion: 2, revision: 1, objective: '活动报道', intents: ['inform'], targetScopes: [], requirements: Array.from({ length: size }, (_, i) => ({ id: 'r' + i, selector: { scopeId: 'event', predicate: 'p' + i }, label: '信息' + i, reason: '读者需要', whyNeeded: '读者需要', refs, necessity: 'blocking' as const, resolution: 'supply_fact' as const })), requiredSources: [], criteria: [], permittedOmissions: [], sourceWaivers: [], coverage: { status: 'validated', refs } };
  const gaps = deriveGaps(session); const items: QuestionItem[] = gaps.map((gap, i) => ({ gapId: gap.id, gapClass: 'fact', subject: '活动', requested: gap.label, why: gap.reason, expected: 'free_text', answerSlot: 'slot-' + i }));
  const batch: QuestionBatchV3 = { id: 'q-' + size, createdAtMessageId: 'm1', gapIds: items.map(item => item.gapId), items, status: 'active' };
  session.gaps = gaps.map(gap => ({ ...gap, state: 'asked', askHistory: [{ batchId: batch.id, messageId: 'm1', promptHash: 'h', reasonCode: 'question_opened' }] }));
  session.questionBatches = [batch]; session.activeBatchId = batch.id; session.phase = 'waiting_input';
  return { session, batch, gapIds: items.map(item => item.gapId) };
}

describe('A22: old patch scenarios replay on v3', () => {
  it('structure correction becomes a criterion rewrite, never a question or a silent requirement delete', async () => {
    const { session, refs } = opening('a22-structure');
    session.scopes = [{ id: 'event', kind: 'event', label: '活动', anchors: refs, qualifiers: [], identity: 'aligned' }];
    session.claims = [{ id: 'attendance-claim', selector: { scopeId: 'event', predicate: 'attendance' }, value: '活动报道', refs, statusBasis: refs, epistemic: 'supported', visibility: 'public' }];
    const structural = { id: 'structure', origin: 'user', refs, severity: 'blocking', verification: 'semantic', rule: { kind: 'semantic', instruction: '按通用推文结构组织内容' } };
    const planData = plan(refs, [{ id: 'attendance', predicate: 'attendance', label: '出席人数', reason: '报道需要人数' }], [structural]); let decisions = 0; let reviews = 0; let written = 0;
    const model: EditorialModelPort = async ({ stage }) => {
      if (stage === 'preflight') return JSON.stringify(planData);
      if (stage === 'decide') return JSON.stringify(++decisions === 1 ? { tool: 'write', instructions: 'Write' } : decisions === 2 ? { tool: 'review' } : decisions === 3 ? { tool: 'write', instructions: 'Repair structure' } : { tool: 'review' });
      if (stage === 'write') { written++; return JSON.stringify({ title: 'Title', bodyMarkdown: written === 1 ? '初稿' : '引入\n主体\n亮点\n结尾' }); }
      if (stage === 'review') { reviews++; return JSON.stringify({ blocking: [], notes: [], criterionChecks: [{ criterionId: 'structure', status: reviews === 1 ? 'fail' : 'pass', verifier: 'semantic', detail: reviews === 1 ? '缺少主体' : '结构完整' }] }); }
      throw new Error('fixture_error:' + stage);
    };
    const outcome = await runEditorialController({ session, model, sources: noSources, signal: new AbortController().signal });
    expect(outcome.type).toBe('draft');
    expect(outcome.session.task.requirements.map(requirement => requirement.id)).toEqual(['attendance']);
    expect(outcome.session.claims.some(claim => claim.id === 'attendance-claim')).toBe(true);
    expect(outcome.session.questionBatches?.length ?? 0).toBe(0);
    expect(outcome.session.lastRun?.stop).toBeUndefined();
    expect(outcome.session.diagnostics.some(diagnostic => diagnostic.code === 'model_or_tool_failed')).toBe(false);
  });

  it('single-gap binding closes the gap without re-asking or deleting the requirement', async () => {
    const first = await openQuestion('a22-single', [{ id: 'attendance', predicate: 'attendance', label: '出席人数', reason: '报道需要人数' }]);
    const answered = reply(first.session, '30 人', 'answer-single'); const stages: string[] = [];
    const second = await runEditorialController({ session: answered, model: finishing(stages), sources: noSources, signal: new AbortController().signal });
    expect(second.type).toBe('draft');
    expect(second.session.answers).toHaveLength(1);
    expect(second.session.task.requirements).toHaveLength(1);
    expect(second.session.questionBatches?.filter(batch => batch.status === 'active')).toHaveLength(0);
    expect(stages).not.toContain('preflight');
  });

  it('confirmation binding records defer decisions and preserves requirements', async () => {
    const first = await openQuestion('a22-confirm', [
      { id: 'attendance', predicate: 'attendance', label: '出席人数', reason: '报道需要人数' },
      { id: 'date', predicate: 'date', label: '活动日期', reason: '报道需要日期' },
    ]);
    const answered = reply(first.session, '确认', 'answer-confirm'); const stages: string[] = [];
    const second = await runEditorialController({ session: answered, model: finishing(stages), sources: noSources, signal: new AbortController().signal });
    expect(second.type).toBe('draft');
    expect(second.session.task.requirements).toHaveLength(2);
    expect(second.session.gapDecisions?.map(decision => decision.kind)).toEqual(['defer', 'defer']);
    expect(second.session.lastRun?.stop).toBeUndefined();
    expect(stages).not.toContain('preflight');
  });
});

describe('A23: batch size x answer shape matrix', () => {
  const run = (session: EditorialSession, text: string, slots?: { gapId: string; value: string }[]) => {
    const view = sessionAsTurnView(ensureQuestionState(session)); const projection = processEditorTurn(view, { messageId: 'm-' + text, text, evidenceAlreadyAppended: true, ...(slots ? { slots } : {}) });
    return { projection, applied: applyEditorTurn(session, { messageId: 'm-' + text, text, evidenceAlreadyAppended: true, ...(slots ? { slots } : {}) }, projection) };
  };
  for (const size of [1, 2, 3]) {
    it(`size ${size}: all/partial/none/confirm keep legal transitions and ask at most twice`, () => {
      const all = sessionWithBatch('a23-all-' + size, size); const allRun = run(all.session, '', all.gapIds.map((gapId, i) => ({ gapId, value: '值' + i })));
      expect(allRun.projection.outcome.type).toBe('answers_bound');
      expect(allRun.projection.outcome.toPhase).toBe('working');
      expect(allRun.applied.session.questionBatches?.[0].status).toBe('answered');
      expect(allRun.applied.session.activeBatchId).toBeUndefined();

      const confirm = sessionWithBatch('a23-confirm-' + size, size); const confirmRun = run(confirm.session, '确认');
      expect(confirmRun.projection.outcome.type).toBe('answer_confirmation');
      expect(confirmRun.projection.outcome.toPhase).toBe('working');

      const none = sessionWithBatch('a23-none-' + size, size);
      const noneRun = run(none.session, '   ');
      expect(noneRun.projection.outcome.type).toBe('ignored');
      expect(noneRun.applied.session.answers ?? []).toHaveLength(0);
      expect(noneRun.applied.session.activeBatchId).toBe(none.batch.id);
      expect(noneRun.applied.session.phase).toBe('waiting_input');

      if (size > 1) {
        const partial = sessionWithBatch('a23-partial-' + size, size); const partialRun = run(partial.session, '', [{ gapId: partial.gapIds[0], value: '值0' }]);
        expect(partialRun.projection.outcome.type).toBe('clarification');
        expect(partialRun.projection.outcome.toPhase).toBe('waiting_editor');
        const opened = partialRun.applied.session.questionBatches?.find(batch => batch.id === partialRun.applied.session.activeBatchId);
        expect(opened?.gapIds).toHaveLength(size - 1);
        for (const gap of partialRun.applied.session.gaps) expect((gap.askHistory?.length ?? 0)).toBeLessThanOrEqual(2);
      }
    });
  }
});

describe('A24: question event and batch invariants', () => {
  it('every question corresponds to askable gaps, batches close legally and no active batch remains', async () => {
    const first = await openQuestion('a24', [
      { id: 'attendance', predicate: 'attendance', label: '出席人数', reason: '报道需要人数' },
      { id: 'date', predicate: 'date', label: '活动日期', reason: '报道需要日期' },
    ]);
    const events: { type: string; question?: { items: { gapId: string }[] } }[] = [];
    const answered = reply(first.session, '30 人；10 月 20 日', 'answer-a24');
    const second = await runEditorialController({ session: answered, model: finishing([]), sources: noSources, signal: new AbortController().signal, onEvent: event => events.push(event as never) });
    expect(second.type).toBe('draft');
    for (const event of events.filter(item => item.type === 'question_recorded')) for (const item of event.question!.items) {
      const gap = second.session.gaps.find(candidate => candidate.id === item.gapId);
      expect(item.gapId.startsWith('intake:') || !!gap && gap.askable !== false && (gap.gapClass === undefined || gap.gapClass === 'fact' || gap.gapClass === 'authorization')).toBe(true);
    }
    expect(second.session.questionBatches?.every(batch => ['answered', 'partially_answered', 'superseded', 'cancelled'].includes(batch.status))).toBe(true);
    expect(second.session.activeBatchId).toBeUndefined();
    expect(second.session.questionBatches?.filter(batch => batch.status === 'active')).toHaveLength(0);
  });
});


describe('A24 extra: cancelled/superseded finals and active-batch invariants', () => {
  it('cancellation closes the active batch as cancelled and clears ownership', () => {
    const { session, batch } = sessionWithBatch('a24-cancel', 2);
    const { projection, applied } = runTurn(session, '取消');
    expect(projection.outcome.type).toBe('cancel');
    expect(applied.session.questionBatches?.find(item => item.id === batch.id)?.status).toBe('cancelled');
    expect(applied.session.activeBatchId).toBeUndefined();
  });

  it('records a controller cancel as RunReport outcome cancelled, not stopped', async () => {
    const { session, batch } = sessionWithBatch('a24-cancel-run', 2);
    const answered = reply(session, '取消', 'cancel-message');
    const outcome = await runEditorialController({ session: answered, model: async () => { throw new Error('fixture_error:must_not_call'); }, sources: noSources, signal: new AbortController().signal });
    expect(outcome.session.lastRun?.outcome).toBe('cancelled');
    expect(outcome.session.lastRun?.stop).toMatchObject({ code: 'run_cancelled', class: 'input', actions: ['retry'] });
    expect(outcome.session.questionBatches?.find(item => item.id === batch.id)?.status).toBe('cancelled');
    expect(outcome.session.activeBatchId).toBeUndefined();
  });

  it('a stale legacy lastQuestion with no asked gap restores as superseded, never active', () => {
    const { session } = opening('a24-superseded'); const gapId = 'gap-old';
    session.lastQuestion = { id: 'q-old', gapIds: [gapId], items: [{ gapId, subject: '活动', requested: '信息', why: '需要', options: [] }] };
    session.gaps = [{ id: gapId, requirementId: 'r', kind: 'missing', selector: { scopeId: 'event', predicate: 'p' }, label: '信息', reason: '需要', state: 'resolved', blocking: true, alternatives: [], resolutionClaimIds: [] }];
    const next = ensureQuestionState(session);
    expect(next.questionBatches?.[0].status).toBe('superseded');
    expect(next.activeBatchId).toBeUndefined();
  });

  it('an active batch never contains a resolved gap', async () => {
    const first = await openQuestion('a24-active-invariant', [
      { id: 'attendance', predicate: 'attendance', label: '出席人数', reason: '报道需要人数' },
      { id: 'date', predicate: 'date', label: '活动日期', reason: '报道需要日期' },
    ]);
    const active = first.session.questionBatches?.find(batch => batch.id === first.session.activeBatchId);
    expect(active).toBeDefined();
    for (const gapId of active!.gapIds) expect(deriveGaps(first.session).find(gap => gap.id === gapId)?.state).not.toBe('resolved');
  });
});

describe('A13/5a: control-event input stops', () => {
  const noCall: EditorialModelPort = async () => { throw new Error('fixture_error:must_not_call'); };
  it('routes ready-state confirmation to confirmation_requires_control_event with an input card', async () => {
    const session = reply(uiReady(), '确认', 'answer-control');
    const outcome = await runEditorialController({ session, model: noCall, sources: noSources, signal: new AbortController().signal });
    expect(outcome.session.lastRun?.stop).toMatchObject({ code: 'confirmation_requires_control_event', class: 'input', headline: '成稿确认请使用确认按钮', actions: ['confirm'], retryable: false });
    expect(outcome.session.lastRun?.stop?.code).not.toBe('internal_invariant');
  });
  it('routes confirmation on an already confirmed draft to already_confirmed with an input card', async () => {
    const prepared = uiReady(); prepared.phase = 'confirmed';
    const session = reply(prepared, '确认', 'answer-confirmed');
    const outcome = await runEditorialController({ session, model: noCall, sources: noSources, signal: new AbortController().signal });
    expect(outcome.session.lastRun?.stop).toMatchObject({ code: 'already_confirmed', class: 'input', headline: '当前稿已确认', actions: ['edit_task'], retryable: false });
    expect(outcome.session.lastRun?.stop?.code).not.toBe('internal_invariant');
  });
});

describe('binding risk: unprovided values are never bound as answers', () => {
  for (const phrase of ['还没想好', '不知道', '不确定', '待定', '再想想', '稍后']) {
    it(`does not bind the unprovided phrase ${phrase}`, () => {
      const { session, batch } = sessionWithBatch('unprovided', 1);
      const { projection, applied } = runTurn(session, phrase);
      expect(projection.outcome.type).toBe('needs_assignment');
      expect(projection.answers).toHaveLength(0);
      expect(applied.session.answers ?? []).toHaveLength(0);
      expect(applied.session.activeBatchId).toBe(batch.id);
      expect(applied.session.questionBatches?.[0].status).toBe('active');
    });
  }
  it('still binds normal content through the single-item fallback', () => {
    const { session } = sessionWithBatch('provided', 1);
    const { projection } = runTurn(session, '活动报道');
    expect(projection.outcome.type).toBe('answers_bound');
    expect(projection.answers).toHaveLength(1);
  });
});


describe('explicit slot binding (design 3.7)', () => {
  it('binds by gapId regardless of item order and numeric text', () => {
    const { session, gapIds } = sessionWithBatch('slots-order', 3);
    const { projection } = runTurn(session, '1. 999 人', [{ gapId: gapIds[2], value: '活动报道' }, { gapId: gapIds[0], value: '30 人' }]);
    expect(projection.outcome.type).toBe('clarification');
    expect(projection.answers.map(answer => [answer.gapId, answer.value, answer.method])).toEqual([[gapIds[0], '30 人', 'explicit_slot'], [gapIds[2], '活动报道', 'explicit_slot']]);
  });

  it('binds a partial submission by gapId and leaves the rest for clarification', () => {
    const { session, gapIds } = sessionWithBatch('slots-partial', 3);
    const { projection } = runTurn(session, '', [{ gapId: gapIds[1], value: '活动报道' }]);
    expect(projection.outcome.type).toBe('clarification');
    expect(projection.answers.map(answer => answer.gapId)).toEqual([gapIds[1]]);
    expect(projection.clarification?.gapIds).toEqual([gapIds[0], gapIds[2]]);
  });

  it('turns an explicit defer choice into a GapDecision without a value', () => {
    const { session, gapIds } = sessionWithBatch('slots-defer', 2);
    const { projection } = runTurn(session, '', [{ gapId: gapIds[0], choice: 'defer' }, { gapId: gapIds[1], value: '活动报道' }]);
    expect(projection.outcome.type).toBe('answers_bound');
    expect(projection.answers.find(answer => answer.gapId === gapIds[0])?.choice).toBe('defer');
    expect(projection.decisions.find(decision => decision.gapId === gapIds[0])?.kind).toBe('defer');
  });

  it('rejects an expired batchId or an out-of-batch gapId instead of silently rebinding', () => {
    const { session, gapIds } = sessionWithBatch('slots-reject', 2);
    const expired = processEditorTurn(sessionAsTurnView(ensureQuestionState(session)), { messageId: 'expired', text: '30 人', evidenceAlreadyAppended: true, replyToBatchId: 'q-old', slots: [{ gapId: gapIds[0], value: '30 人' }] });
    expect(expired.outcome.type).toBe('needs_assignment');
    expect(expired.answers).toHaveLength(0);
    expect(expired.notice).toContain('过期');
    const outOfBatch = processEditorTurn(sessionAsTurnView(ensureQuestionState(session)), { messageId: 'out-of-batch', text: '30 人', evidenceAlreadyAppended: true, slots: [{ gapId: 'not-in-batch', value: '30 人' }] });
    expect(outOfBatch.outcome.type).toBe('needs_assignment');
    expect(outOfBatch.answers).toHaveLength(0);
    expect(outOfBatch.notice).toContain('不属于当前批次');
  });

  it('consumes evidence provenance slots end-to-end by gapId', async () => {
    const { session, batch, gapIds } = sessionWithBatch('slots-e2e', 3);
    const text = '30 人\n活动报道'; const withCard = structuredClone(session);
    withCard.evidence.push({ id: 'card', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: { messageId: 'card', replyToBatchId: batch.id, slots: [{ gapId: gapIds[2], value: '活动报道' }, { gapId: gapIds[0], value: '30 人' }] }, context: { scenario: 'real' } });
    const outcome = await runEditorialController({ session: withCard, model: async () => { throw new Error('fixture_error:must_not_call'); }, sources: noSources, signal: new AbortController().signal });
    expect(outcome.type).toBe('question');
    expect(outcome.session.answers?.map(answer => [answer.gapId, answer.value])).toEqual([[gapIds[0], '30 人'], [gapIds[2], '活动报道']]);
    expect(outcome.session.answers?.every(answer => answer.method === 'explicit_slot')).toBe(true);
  });
});


describe('slot rejection notice reaches the controller outcome', () => {
  it('returns a question with the expired-batch notice and no silent answers', async () => {
    const { session, batch, gapIds } = sessionWithBatch('notice-expired', 2);
    const text = '30 人'; const withCard = structuredClone(session);
    withCard.evidence.push({ id: 'card', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: { messageId: 'card', replyToBatchId: 'q-old', slots: [{ gapId: gapIds[0], value: '30 人' }] }, context: { scenario: 'real' } });
    const outcome = await runEditorialController({ session: withCard, model: async ({ stage }) => { if (stage === 'mapping') return '{bad'; throw new Error('fixture_error:' + stage); }, sources: noSources, signal: new AbortController().signal });
    expect(outcome.type).toBe('question');
    expect(outcome.type === 'question' ? outcome.notice : undefined).toContain('过期');
    expect(outcome.session.answers ?? []).toHaveLength(0);
    expect(outcome.session.activeBatchId).toBe(batch.id);
  });
});
