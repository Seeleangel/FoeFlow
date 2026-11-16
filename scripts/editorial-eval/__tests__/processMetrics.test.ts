import { describe, expect, it } from 'vitest';
import { computeProcessMetrics, dedupeTrials } from '../processMetrics';
import type { CaseResultLike } from '../processMetrics';

function trial(id: string, trialNo: number, patch: Partial<CaseResultLike> = {}): CaseResultLike {
  return {
    id,
    trial: trialNo,
    trace: [{ type: 'turn_outcome', outcome: 'question', reason: 'waiting_editor' }],
    requests: [
      { stage: 'preflight', sentAt: '2026-11-12T06:50:00.000Z', usage: { total_tokens: 100 } },
      { stage: 'decide', sentAt: '2026-11-12T06:50:20.000Z', usage: { total_tokens: 200 } },
      { stage: 'decide', sentAt: '2026-11-12T06:50:50.000Z', usage: { total_tokens: 300 } },
    ],
    outputs: [
      { type: 'copy', allowed: false },
      { type: 'save', allowed: false },
      { type: 'word', allowed: false },
    ],
    execution: { requiredSteps: ['protocol:a', 'protocol:b'], completedSteps: ['protocol:a'], actions: [{ type: 'copy', status: 'completed' }] },
    outcome: { type: 'question' },
    metrics: { status: 'NEEDS_REVIEW', assertions: [{ id: 'x.1', required: false, status: 'unreviewed' }] },
    modelFailures: [],
    ...patch,
  };
}

describe('computeProcessMetrics', () => {
  it('dedupes by case and trial', () => {
    const result = dedupeTrials([trial('H11', 1), trial('H11', 1), trial('H11', 2)]);
    expect(result.unique).toHaveLength(2);
    expect(result.removed).toBe(1);
  });

  it('classifies tool calls by product / fixture / policy category', () => {
    const metrics = computeProcessMetrics([
      trial('A', 1, {
        trace: [
          { type: 'turn_outcome', outcome: 'question' },
          { type: 'tool', result: { tool: 'read', status: 'progress', code: 'source_consumed' } },
          { type: 'tool', result: { tool: 'read', status: 'failed', code: 'source_unavailable' } },
          { type: 'tool', result: { tool: 'search', status: 'no_progress', code: 'query_empty' } },
          { type: 'tool', result: { tool: 'ask', status: 'progress', code: 'waiting_editor' } },
          { type: 'tool', result: { tool: 'write', status: 'rejected', code: 'invalid_artifact' } },
          { type: 'tool', result: { tool: 'submit', status: 'rejected', code: 'authority_rejected' } },
          { type: 'tool', result: { tool: 'read', status: 'no_progress', code: 'required_read_already_attempted' } },
        ],
      }),
    ], 'run');
    expect(metrics.tools.calls).toBe(7);
    expect(metrics.tools.categories.success).toBe(2);
    expect(metrics.tools.categories.fixture_unavailable).toBe(1);
    expect(metrics.tools.categories.empty_result).toBe(1);
    expect(metrics.tools.categories.product_error).toBe(1);
    expect(metrics.tools.categories.rejected).toBe(1);
    expect(metrics.tools.categories.policy_guard).toBe(1);
    expect(metrics.tools.byTool.read.calls).toBe(3);
    expect(metrics.tools.byTool.read.success).toBe(1);
    expect(metrics.risk.rejectedCalls).toBe(1);
    expect(metrics.risk.productErrors).toBe(1);
    expect(metrics.tools.byTool.write.error).toBe(1);
  });

  it('counts gate blocks and gate violations separately', () => {
    const metrics = computeProcessMetrics([
      trial('B', 1, { outputs: [{ type: 'copy', allowed: true }, { type: 'save', allowed: false }] }),
    ]);
    expect(metrics.task.gateViolations).toBe(1);
    expect(metrics.task.gateBlocked).toBe(1);
  });

  it('derives wall clock, tokens and stall from the recorded requests and trace', () => {
    const metrics = computeProcessMetrics([
      trial('C', 1, {
        outcome: { type: 'failed', reason: 'source_unavailable' },
        trace: [
          { type: 'turn_outcome', outcome: 'failed', reason: 'source_unavailable' },
          { type: 'tool', result: { tool: 'read', status: 'no_progress', code: 'query_empty' } },
          { type: 'tool', result: { tool: 'read', status: 'no_progress', code: 'query_empty' } },
        ],
      }),
    ]);
    expect(metrics.experience.wallClockMs.max).toBe(50000);
    expect(metrics.experience.callsPerTrial.max).toBe(3);
    expect(metrics.experience.tokens.total).toBe(600);
    expect(metrics.experience.tokens.byStage.decide).toBe(500);
    expect(metrics.experience.stall.trialsWithTwoNoProgress).toBe(1);
    expect(metrics.risk.failedReasons.source_unavailable).toBe(1);
    expect(metrics.steps.requiredStepCoverage).toBe(0.5);
  });

  it('warns instead of inventing a task success rate when nothing is gradable', () => {
    const metrics = computeProcessMetrics([trial('D', 1)]);
    expect(metrics.task.successMeasurable).toBe(false);
    expect(metrics.task.deliveredRate).toBe(0);
    expect(metrics.warnings).toContain('no_delivered_outcome: task success rate is not measurable until the user simulator answers clarification questions');
    expect(metrics.warnings).toContain('no_recipe_assertions: no assertion was evaluated (0 observed), so pass/fail cannot be graded');
    expect(metrics.warnings).toContain('trace_timestamps_missing: per-step latency, TTFP and user wait time are unavailable');
  });

  it('marks a single-turn run so experience data is not overclaimed', () => {
    const metrics = computeProcessMetrics([trial('E', 1), trial('E', 2)]);
    expect(metrics.steps.turnsPerTrial).toBe(1);
    expect(metrics.steps.singleTurnTrials).toBe(2);
    expect(metrics.warnings).toContain('single_turn_only: no multi-turn experience data');
  });
});
