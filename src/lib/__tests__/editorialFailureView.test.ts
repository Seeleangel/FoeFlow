import { describe, expect, it } from 'vitest';
import { classifyFailure, deriveFailureView, stopFromBlockDiagnostic } from '../editorialFailure';
import type { Diagnostics } from '../editorialTypes';
import { uiReady } from './editorialUiFixture';

const block = (owner: string, code: string, message = '内部校验失败'): Diagnostics => ({ owner, code, message, refs: [], gateEffect: 'block' });

describe('deriveFailureView (#3)', () => {
  it('synthesizes one internal card from the first block diagnostic when no run stop exists', () => {
    const session = uiReady();
    session.diagnostics = [block('write:validation', 'invalid_artifact', '生成的正文未通过校验')];
    const view = deriveFailureView(session);
    expect(view.stop).toMatchObject({
      code: 'invalid_artifact', class: 'internal', stage: 'write:validation', retryable: true,
      headline: expect.any(String), detail: '生成的正文未通过校验', actions: ['retry', 'report'],
    });
    expect(view.stop?.traceId).toMatch(/^diag-/);
    expect(view.stop?.preserved.candidateRevision).toBe(session.candidate!.revision);
    expect(view.diagnostics).toEqual([]);
  });

  it('prefers lastRun.stop and removes the same diagnostic code from the panel', () => {
    const session = uiReady();
    session.diagnostics = [block('write:validation', 'invalid_artifact', '生成的正文未通过校验')];
    const synthesized = deriveFailureView(session).stop!;
    session.lastRun = { runId: 'r', startedAt: '', endedAt: '', outcome: 'stopped', stop: synthesized, modelCalls: [], agentDiagnostics: [] };
    const view = deriveFailureView(session);
    expect(view.stop).toEqual(synthesized);
    expect(view.diagnostics).toEqual([]);
  });

  it('sorts owner+code, keeps the rest as block-badged diagnostics, and never duplicates rows', () => {
    const session = uiReady();
    session.diagnostics = [block('zeta:owner', 'invalid_artifact', 'Z'), block('alpha:owner', 'unsafe_fact_snapshot', 'A')];
    session.agentDiagnostics = [{ owner: 'agent', code: 'missing_status_basis', message: '缺少依据', refs: [] }];
    session.lastRun = { runId: 'r', startedAt: '', endedAt: '', outcome: 'stopped', modelCalls: [], agentDiagnostics: [{ owner: 'agent', code: 'missing_status_basis', message: '缺少依据', refs: [] }] };
    const view = deriveFailureView(session);
    expect(view.stop?.code).toBe('unsafe_fact_snapshot');
    expect(view.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['missing_status_basis', 'invalid_artifact']);
  });

  it('keeps non-block diagnostics out of the synthesized stop', () => {
    const session = uiReady();
    session.diagnostics = [{ owner: 'facts', code: 'invalid_reference', message: '引用无效', refs: [], gateEffect: 'info' }];
    const view = deriveFailureView(session);
    expect(view.stop).toBeUndefined();
    expect(view.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['invalid_reference']);
  });

  it('builds the trace id from session, owner and code', () => {
    const session = uiReady();
    const first = stopFromBlockDiagnostic(session, block('write', 'invalid_artifact'));
    const second = stopFromBlockDiagnostic(session, block('write', 'invalid_artifact'));
    expect(first.traceId).toBe(second.traceId);
    expect(first.traceId).toHaveLength('diag-'.length + 20);
  });
});

describe('retryable table (#4)', () => {
  it('retries external/internal and re-validating input stops, but not terminal editor decisions', () => {
    for (const code of ['model_unavailable', 'source_unavailable', 'deadline_exceeded', 'internal_invariant', 'artifact_invalid', 'run_cancelled', 'confirmation_blocked']) {
      expect(classifyFailure(code).retryable, code).toBe(true);
    }
    for (const code of ['task_plan_incomplete', 'gap_unresolved', 'permission_denied', 'ask_limit_reached', 'already_confirmed']) {
      expect(classifyFailure(code).retryable, code).toBe(false);
    }
  });
});
