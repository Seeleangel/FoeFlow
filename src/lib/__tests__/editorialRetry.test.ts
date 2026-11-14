import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { runEditorialController, type EditorialModelPort } from '../editorialController';
import { deriveGaps } from '../editorialGaps';
import { deriveFailureView } from '../editorialFailure';
import { openQuestionBatch } from '../editorialState';
import { parseDraftArtifact } from '../editorialDocument';
import { editorialStopExplanation } from '../editorialStatus';
import { useEditorialSession } from '@/hooks/useEditorialSession';
import type { EditorialSession } from '../editorialTypes';
import { uiReady } from './editorialUiFixture';
import { seedTestTask } from './editorialTestFixtures';
import { createEditorialSession, hashText, type EvidenceRef } from '../editorialTypes';

const noSources = { search: vi.fn(async () => []), read: vi.fn(async () => undefined) };

function stoppedSession(): EditorialSession {
  const session = uiReady();
  delete session.review; delete session.layout; delete session.gate;
  session.phase = 'incomplete';
  session.lastRun = {
    runId: 'old-run', startedAt: '', endedAt: '', outcome: 'stopped', modelCalls: [], agentDiagnostics: [],
    stop: { code: 'model_unavailable', class: 'external', stage: 'review', retryable: true, headline: '模型服务暂时不可用', detail: 'HTTP 502', actions: ['retry'], traceId: 'trace-old', preserved: { candidateRevision: session.candidate?.revision, inputKey: { contentHash: '', evidenceRevision: 0, taskRevision: 0, policyRevision: 0 } } },
  };
  return session;
}

function batchSession(): { session: EditorialSession; gapId: string } {
  const session = seedTestTask(createEditorialSession('retry-batch'));
  const text = '请写一篇活动报道。';
  session.evidence = [{ id: 'basis', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: { messageId: 'm1' }, context: { scenario: 'real' } }];
  const refs: EvidenceRef[] = [{ evidenceId: 'basis', revision: 1, start: 0, end: text.length, quote: text }];
  session.task = {
    ...session.task, revision: 1,
    requirements: [{ id: 'attendance', selector: { scopeId: 'event', predicate: 'attendance' }, label: '出席人数', reason: '读者需要人数', whyNeeded: '读者需要人数', refs, necessity: 'blocking', resolution: 'supply_fact' }],
  };
  session.scopes = [{ id: 'event', kind: 'event', label: '活动', anchors: refs, qualifiers: [], identity: 'aligned' }];
  session.phase = 'gathering';
  const gapId = deriveGaps(session).find(gap => gap.kind === 'missing')!.id;
  const opened = openQuestionBatch(session, [gapId]);
  opened.turns = [{ id: 'turn-basis', messageId: 'm1', receivedAt: '', text, intent: 'other', bindingStatus: 'none', bindingRefs: [] }];
  opened.lastRun = {
    runId: 'old-run', startedAt: '', endedAt: '', outcome: 'stopped', modelCalls: [], agentDiagnostics: [],
    stop: { code: 'gap_unresolved', class: 'input', retryable: false, headline: '还有未解决的信息缺口', detail: '', actions: ['answer', 'waive'], traceId: 'trace-old', preserved: { inputKey: { contentHash: '', evidenceRevision: 0, taskRevision: 0, policyRevision: 0 } } },
  };
  return { session: opened, gapId };
}

function stoppedAskSession(): { session: EditorialSession; gapId: string } {
  const session = uiReady('retry-ask');
  delete session.review; delete session.layout; delete session.gate;
  session.phase = 'incomplete';
  const basis = session.evidence.find(record => record.kind === 'editor_message')!;
  const refs: EvidenceRef[] = [{ evidenceId: basis.id, revision: basis.revision, start: 0, end: basis.text.length, quote: basis.text }];
  session.task = {
    ...session.task, revision: session.task.revision + 1,
    requirements: [{ id: 'attendance', selector: { scopeId: 'event', predicate: 'attendance' }, label: '出席人数', reason: '读者需要人数', whyNeeded: '读者需要人数', refs, necessity: 'blocking', resolution: 'supply_fact' }],
  };
  session.scopes = [{ id: 'event', kind: 'event', label: '活动', anchors: refs, qualifiers: [], identity: 'aligned' }];
  session.lastRun = {
    runId: 'old-run', startedAt: '', endedAt: '', outcome: 'stopped', modelCalls: [], agentDiagnostics: [],
    stop: { code: 'model_unavailable', class: 'external', stage: 'review', retryable: true, headline: '模型服务暂时不可用', detail: 'HTTP 503', actions: ['retry'], traceId: 'trace-old', preserved: { candidateRevision: session.candidate?.revision, inputKey: { contentHash: '', evidenceRevision: 0, taskRevision: 0, policyRevision: 0 } } },
  };
  const gapId = deriveGaps(session).find(gap => gap.kind === 'missing' && gap.blocking)!.id;
  return { session, gapId };
}

describe('retry from persisted state (#4)', () => {
  it('runs a new controller pass without a user message and replaces the old stop', async () => {
    const session = stoppedSession();
    const evidenceBefore = session.evidence.map(record => record.id);
    const stages: string[] = [];
    const checkpoints: EditorialSession[] = [];
    const model: EditorialModelPort = async ({ stage }) => {
      stages.push(stage);
      if (stage === 'decide') return '{"tool":"review"}';
      if (stage === 'review') return '{"blocking":[],"notes":[]}';
      throw new Error('fixture_error:' + stage);
    };
    const outcome = await runEditorialController({ session, model, sources: noSources, signal: new AbortController().signal, resumeFromStop: true, onCheckpoint: checkpoint => checkpoints.push(checkpoint) });
    expect(outcome.type).toBe('draft');
    const inProgress = checkpoints.filter(checkpoint => checkpoint.lastRun?.endedAt === '');
    expect(inProgress.length).toBeGreaterThan(0);
    expect(inProgress.every(checkpoint => checkpoint.lastRun?.stop?.traceId === 'trace-old')).toBe(true);
    expect(stages).not.toContain('preflight');
    expect(stages).toContain('review');
    expect(outcome.session.evidence.map(record => record.id)).toEqual(evidenceBefore);
    expect(outcome.session.lastRun?.stop).toBeUndefined();
    expect(outcome.session.lastRun?.modelCalls.length).toBeGreaterThan(0);
    expect(outcome.session.phase).toBe('pending_confirmation');
  });

  it('stops a decide transport error immediately as model_unavailable without scheduling review', async () => {
    const session = stoppedSession();
    const evidenceBefore = session.evidence.map(record => record.id);
    const stages: string[] = [];
    const model: EditorialModelPort = async ({ stage }) => { stages.push(stage); throw new Error('API 请求失败：503'); };
    const outcome = await runEditorialController({ session, model, sources: noSources, signal: new AbortController().signal, resumeFromStop: true });
    expect(stages).toEqual(['decide']);
    expect(outcome.type).toBe('failed');
    expect(outcome.session.evidence.map(record => record.id)).toEqual(evidenceBefore);
    expect(outcome.session.lastRun?.stop).toMatchObject({ code: 'model_unavailable', class: 'external', stage: 'decide', retryable: true, fields: { status: 503 } });
    expect(outcome.session.lastRun?.stop?.traceId).not.toBe('trace-old');
    expect(outcome.session.lastRun?.modelCalls.find(call => call.stage === 'decide')?.result).toBe('transport_error');
  });

  it('keeps deterministicNext in charge when decide output stays invalid', async () => {
    const session = stoppedSession();
    const stages: string[] = [];
    const model: EditorialModelPort = async ({ stage }) => {
      stages.push(stage);
      if (stage === 'decide' || stage === 'repair') return '这不是 JSON';
      if (stage === 'review') return '{"blocking":[],"notes":[]}';
      throw new Error('fixture_error:' + stage);
    };
    const outcome = await runEditorialController({ session, model, sources: noSources, signal: new AbortController().signal, resumeFromStop: true });
    expect(stages.filter(stage => stage === 'decide')).toHaveLength(1);
    expect(stages.filter(stage => stage === 'repair')).toHaveLength(2);
    expect(stages).toContain('review');
    expect(outcome.type).toBe('draft');
    expect(outcome.session.lastRun?.stop).toBeUndefined();
  });

  it('returns the same active batch with zero model calls', async () => {
    const { session } = batchSession();
    const model = vi.fn(async () => { throw new Error('fixture_error:must_not_call'); });
    const outcome = await runEditorialController({ session, model, sources: noSources, signal: new AbortController().signal, resumeFromStop: true });
    expect(outcome.type).toBe('question');
    if (outcome.type !== 'question') throw new Error('expected_question');
    expect(outcome.question.id).toBe(session.activeBatchId);
    expect(model).not.toHaveBeenCalled();
    expect(outcome.session.evidence).toEqual(session.evidence);
  });

  it('closes a retry as needs_editor and clears the old 503 stop when decide asks', async () => {
    const { session, gapId } = stoppedAskSession();
    const stages: string[] = [];
    const checkpoints: EditorialSession[] = [];
    const model: EditorialModelPort = async ({ stage }) => {
      stages.push(stage);
      if (stage === 'decide') return '{"tool":"ask"}';
      throw new Error('fixture_error:' + stage);
    };
    const outcome = await runEditorialController({ session, model, sources: noSources, signal: new AbortController().signal, resumeFromStop: true, onCheckpoint: checkpoint => checkpoints.push(checkpoint) });
    expect(outcome.type).toBe('question');
    if (outcome.type !== 'question') throw new Error('expected_question');
    expect(stages).toEqual(['decide']);
    expect(outcome.question.gapIds).toEqual([gapId]);
    expect(outcome.session.lastRun?.stop).toBeUndefined();
    expect(outcome.session.lastRun?.endedAt).not.toBe('');
    expect(outcome.session.lastRun?.outcome).toBe('needs_editor');
    expect(outcome.session.phase).toBe('waiting_input');
    const batch = (outcome.session.questionBatches ?? []).find(item => item.id === outcome.session.activeBatchId);
    expect(batch?.status).toBe('active');
    expect(batch?.gapIds).toEqual([gapId]);
    expect(deriveFailureView(outcome.session).stop).toBeUndefined();
    const lastCheckpoint = checkpoints[checkpoints.length - 1];
    expect(lastCheckpoint?.lastRun?.stop).toBeUndefined();
    expect(lastCheckpoint?.lastRun?.endedAt).not.toBe('');
    // Retrying from the closed run must not resurrect the old 503 card or call the model again.
    const modelAgain = vi.fn(async () => { throw new Error('fixture_error:must_not_call'); });
    const again = await runEditorialController({ session: outcome.session, model: modelAgain, sources: noSources, signal: new AbortController().signal, resumeFromStop: true });
    expect(again.type).toBe('question');
    expect(modelAgain).not.toHaveBeenCalled();
    expect(again.session.lastRun?.stop).toBeUndefined();
    expect(deriveFailureView(again.session).stop).toBeUndefined();
  });
});

const oldStop = {
  code: 'model_unavailable', class: 'external' as const, stage: 'decide', retryable: true,
  headline: '模型服务暂时不可用', detail: 'HTTP 503', actions: ['retry' as const], traceId: 'trace-old',
  preserved: { inputKey: { contentHash: '', evidenceRevision: 0, taskRevision: 0, policyRevision: 0 } },
};

function constrainedAskSession(id = 'retry-ask-priority'): { session: EditorialSession; gapId: string } {
  const session = createEditorialSession(id);
  const text = '请写一篇 900 到 1200 个可见字符的活动报道。';
  session.evidence = [{ id: 'basis', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: {}, context: { scenario: 'real' } }];
  session.evidenceRevision = 1;
  const refs: EvidenceRef[] = [{ evidenceId: 'basis', revision: 1, start: 0, end: text.length, quote: text }];
  session.scopes = [{ id: 'event', kind: 'event', label: '活动', anchors: refs, qualifiers: [], identity: 'aligned' }];
  session.task = {
    schemaVersion: 2, revision: 1, objective: '活动报道', intents: ['inform'], targetScopes: [],
    requirements: [{ id: 'attendance', selector: { scopeId: 'event', predicate: 'attendance' }, label: '出席人数', reason: '读者需要人数', whyNeeded: '读者需要人数', refs, necessity: 'blocking', resolution: 'supply_fact' }],
    requiredSources: [],
    criteria: [{ id: 'length-900', origin: 'user', refs, severity: 'blocking', verification: 'deterministic', rule: { kind: 'length', min: 900, max: 1200, unit: 'visible_characters' } }],
    permittedOmissions: [], sourceWaivers: [], coverage: { status: 'validated', refs },
  };
  session.candidate = parseDraftArtifact(JSON.stringify({ title: '活动报道', bodyMarkdown: '正文'.repeat(21) }), { id: 'candidate', revision: 1 }).artifact!;
  session.phase = 'incomplete';
  session.lastRun = { runId: 'old-run', startedAt: '', endedAt: '2026-11-14T00:00:00+08:00', outcome: 'stopped', modelCalls: [], agentDiagnostics: [], stop: oldStop };
  const gap = deriveGaps(session).find(item => item.gapClass === 'fact' && item.blocking && item.requirementId === 'attendance')!;
  expect(gap.state).toBe('open');
  return { session, gapId: gap.id };
}

function stoppedBatchSession(): { session: EditorialSession; batchId: string } {
  const { session } = batchSession();
  session.phase = 'incomplete';
  session.lastRun = { ...session.lastRun!, outcome: 'stopped', endedAt: '2026-11-14T00:00:00+08:00', stop: oldStop };
  return { session, batchId: session.activeBatchId! };
}

function stoppedIntakeSession(id = 'retry-intake-order'): EditorialSession {
  const session = createEditorialSession(id);
  const text = '写点东西';
  session.evidence = [{ id: 'basis', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: {}, context: { scenario: 'real' } }];
  session.evidenceRevision = 1;
  session.phase = 'incomplete';
  session.lastRun = { runId: 'old-run', startedAt: '', endedAt: '2026-11-14T00:00:00+08:00', outcome: 'stopped', modelCalls: [], agentDiagnostics: [], stop: oldStop };
  return session;
}

function partialBindingSession(): { session: EditorialSession; batchId: string; pendingGapId: string } {
  const session = createEditorialSession('retry-partial');
  const text = '请写一篇活动报道。';
  session.evidence = [{ id: 'basis', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: { messageId: 'm1' }, context: { scenario: 'real' } }];
  session.evidenceRevision = 1;
  const refs: EvidenceRef[] = [{ evidenceId: 'basis', revision: 1, start: 0, end: text.length, quote: text }];
  session.scopes = [{ id: 'event', kind: 'event', label: '活动', anchors: refs, qualifiers: [], identity: 'aligned' }];
  const requirement = (id: string, predicate: string, label: string) => ({ id, selector: { scopeId: 'event', predicate }, label, reason: '读者需要', whyNeeded: '读者需要', refs, necessity: 'blocking' as const, resolution: 'supply_fact' as const });
  session.task = {
    schemaVersion: 2, revision: 1, objective: '活动报道', intents: ['inform'], targetScopes: [],
    requirements: [requirement('attendance', 'attendance', '出席人数'), requirement('venue', 'venue', '活动地点')],
    requiredSources: [], criteria: [{ id: 'body', origin: 'user', refs, severity: 'blocking', verification: 'deterministic', rule: { kind: 'length', min: 1, unit: 'visible_characters' } }],
    permittedOmissions: [], sourceWaivers: [], coverage: { status: 'validated', refs },
  };
  session.phase = 'incomplete';
  session.lastRun = { runId: 'old-run', startedAt: '', endedAt: '2026-11-14T00:00:00+08:00', outcome: 'stopped', modelCalls: [], agentDiagnostics: [], stop: oldStop };
  const open = deriveGaps(session).filter(gap => gap.gapClass === 'fact' && gap.blocking && gap.state === 'open');
  const opened = openQuestionBatch(session, open.map(gap => gap.id));
  const reply = '1. 30 人';
  opened.evidence.push({ id: 'reply-1', revision: 1, text: reply, contentHash: hashText(reply), kind: 'editor_message', provenance: { messageId: 'reply-1' }, context: { scenario: 'real' } });
  opened.evidenceRevision++;
  const pending = (opened.questionBatches ?? []).find(batch => batch.id === opened.activeBatchId)!.gapIds.find(id => id !== open[0].id)!;
  return { session: opened, batchId: opened.activeBatchId!, pendingGapId: pending };
}

describe('ask priority, terminal phase and checkpoint ordering (spec v3)', () => {
  it('keeps a model ask when a constraint is unmet and a blocking fact gap is open', async () => {
    const { session, gapId } = constrainedAskSession();
    const stages: string[] = []; const codes: string[] = [];
    const model: EditorialModelPort = async ({ stage }) => {
      stages.push(stage);
      if (stage === 'decide') return '{"tool":"ask"}';
      throw new Error('fixture_error:' + stage);
    };
    const outcome = await runEditorialController({ session, model, sources: noSources, signal: new AbortController().signal, resumeFromStop: true, onToolResult: result => codes.push(result.code) });
    expect(outcome.type).toBe('question');
    if (outcome.type !== 'question') throw new Error('expected_question');
    expect(stages).toEqual(['decide']);
    expect(outcome.question.gapIds).toEqual([gapId]);
    expect(outcome.session.activeBatchId).toBeDefined();
    expect((outcome.session.questionBatches ?? []).find(batch => batch.id === outcome.session.activeBatchId)).toMatchObject({ status: 'active', gapIds: [gapId] });
    expect(outcome.session.phase).toBe('waiting_input');
    expect(outcome.session.lastRun?.stop).toBeUndefined();
    expect(deriveFailureView(outcome.session).stop).toBeUndefined();
    expect(outcome.session.gaps.find(gap => gap.gapClass === 'constraint' && gap.requirementId === 'length-900')?.state).toBe('unmet');
    expect(codes).not.toContain('blocking_gaps');
    expect(stages.filter(stage => stage === 'write' || stage === 'review')).toHaveLength(0);
  });

  it('falls back to the scheduler ask when decide output is invalid, without a constraint rewrite', async () => {
    const { session, gapId } = constrainedAskSession('retry-ask-invalid');
    const stages: string[] = [];
    const model: EditorialModelPort = async ({ stage }) => {
      stages.push(stage);
      if (stage === 'decide' || stage === 'repair') return '这不是 JSON';
      throw new Error('fixture_error:' + stage);
    };
    const outcome = await runEditorialController({ session, model, sources: noSources, signal: new AbortController().signal, resumeFromStop: true });
    expect(outcome.type).toBe('question');
    if (outcome.type !== 'question') throw new Error('expected_question');
    expect(outcome.question.gapIds).toEqual([gapId]);
    expect(stages.filter(stage => stage === 'decide')).toHaveLength(1);
    expect(stages.filter(stage => stage === 'write' || stage === 'review')).toHaveLength(0);
    expect(outcome.session.phase).toBe('waiting_input');
    expect(outcome.session.lastRun?.stop).toBeUndefined();
  });

  it('closes an active-batch retry as waiting_input and keeps the same batch', async () => {
    const { session, batchId } = stoppedBatchSession();
    const model = vi.fn(async () => { throw new Error('fixture_error:must_not_call'); });
    const checkpoints: EditorialSession[] = [];
    const outcome = await runEditorialController({ session, model, sources: noSources, signal: new AbortController().signal, resumeFromStop: true, onCheckpoint: next => checkpoints.push(next) });
    expect(outcome.type).toBe('question');
    if (outcome.type !== 'question') throw new Error('expected_question');
    expect(model).not.toHaveBeenCalled();
    expect(outcome.question.id).toBe(batchId);
    expect(outcome.session.activeBatchId).toBe(batchId);
    expect(outcome.session.phase).toBe('waiting_input');
    expect(outcome.session.lastRun?.stop).toBeUndefined();
    expect(outcome.session.lastRun?.endedAt).not.toBe('');
    expect(outcome.session.lastRun?.outcome).toBe('needs_editor');
    expect(editorialStopExplanation(outcome.session)).toBe('正在等待编辑补充');
    expect(deriveFailureView(outcome.session).stop).toBeUndefined();
    expect(checkpoints[checkpoints.length - 1]?.lastRun).toMatchObject({ outcome: 'needs_editor' });
  });

  it('checkpoints the terminal intake question after the run closes', async () => {
    const session = stoppedIntakeSession();
    const checkpoints: EditorialSession[] = [];
    const model: EditorialModelPort = async ({ stage }) => {
      if (stage === 'preflight' || stage === 'repair') return '{"factPatch":{}}';
      throw new Error('fixture_error:' + stage);
    };
    const outcome = await runEditorialController({ session, model, sources: noSources, signal: new AbortController().signal, resumeFromStop: true, onCheckpoint: next => checkpoints.push(next) });
    expect(outcome.type).toBe('question');
    if (outcome.type !== 'question') throw new Error('expected_question');
    expect(outcome.question.intake).toBe(true);
    const last = checkpoints[checkpoints.length - 1];
    expect(last.lastRun).toMatchObject({ outcome: 'needs_editor' });
    expect(last.lastRun?.endedAt).not.toBe('');
    expect(last.lastRun?.stop).toBeUndefined();
    expect(last.phase).toBe('waiting_input');
    expect(last.activeBatchId).toBeDefined();
  });

  it('bumps the revision when an active-batch retry returns early', async () => {
    const { session } = stoppedBatchSession();
    const persistedRevision = session.revision;
    const checkpoints: EditorialSession[] = [];
    const model = vi.fn(async () => { throw new Error('fixture_error:must_not_call'); });
    const outcome = await runEditorialController({ session, model, sources: noSources, signal: new AbortController().signal, resumeFromStop: true, onCheckpoint: next => checkpoints.push(next) });
    expect(outcome.session.revision).toBeGreaterThan(persistedRevision);
    const last = checkpoints[checkpoints.length - 1];
    expect(last.revision).toBe(outcome.session.revision);
    expect(last.lastRun?.outcome).toBe('needs_editor');
    expect(last.lastRun?.endedAt).not.toBe('');
  });

  it('bumps the revision when a clarification retry returns early', async () => {
    const { session, batchId, pendingGapId } = partialBindingSession();
    const persistedRevision = session.revision;
    const checkpoints: EditorialSession[] = [];
    const stages: string[] = [];
    const model = vi.fn(async ({ stage }: { stage: string }) => { stages.push(stage); throw new Error('fixture_error:' + stage); });
    const outcome = await runEditorialController({ session, model: model as unknown as EditorialModelPort, sources: noSources, signal: new AbortController().signal, resumeFromStop: true, onCheckpoint: next => checkpoints.push(next) });
    expect(outcome.type).toBe('question');
    if (outcome.type !== 'question') throw new Error('expected_question');
    expect(stages).toEqual([]);
    expect(outcome.question.gapIds).toEqual([pendingGapId]);
    expect(outcome.session.activeBatchId).toBeDefined();
    expect(outcome.session.activeBatchId).not.toBe(batchId);
    expect(outcome.session.phase).toBe('waiting_input');
    expect(outcome.session.lastRun?.stop).toBeUndefined();
    expect(outcome.session.lastRun?.endedAt).not.toBe('');
    expect(outcome.session.revision).toBeGreaterThan(persistedRevision);
    const last = checkpoints[checkpoints.length - 1];
    expect(last.revision).toBe(outcome.session.revision);
    expect(last.lastRun?.outcome).toBe('needs_editor');
  });

  it('lets useEditorialSession.checkpoint accept the terminal needs_editor session', async () => {
    const { session } = stoppedBatchSession();
    const { result } = renderHook(() => useEditorialSession('retry-hook'));
    act(() => result.current.restore(session));
    let owner!: ReturnType<typeof result.current.begin>;
    act(() => { owner = result.current.begin(); });
    const accepted: number[] = [];
    const model = vi.fn(async () => { throw new Error('fixture_error:must_not_call'); });
    await act(async () => {
      const outcome = await runEditorialController({ session: owner.session, runId: owner.runId, model, sources: noSources, signal: new AbortController().signal, resumeFromStop: true, onCheckpoint: next => { if (owner.checkpoint(next)) accepted.push(next.revision); } });
      expect(accepted).toContain(outcome.session.revision);
    });
    expect(result.current.session?.phase).toBe('waiting_input');
    expect(result.current.session?.lastRun?.outcome).toBe('needs_editor');
    expect(result.current.session?.lastRun?.stop).toBeUndefined();
    expect(result.current.session?.lastRun?.endedAt).not.toBe('');
  });
});
