import { describe, it, expect, vi } from 'vitest';
import { createEditorialSession, hashText, type EditorialSession, type EvidenceRef } from '../editorialTypes';
import { canHandoff, runEditorialController, type EditorialModelPort } from '../editorialController';
import { buildQuestion, deriveGaps } from '../editorialGaps';

const noSources = { search: vi.fn(async () => []), read: vi.fn(async () => undefined) };

function fixture(id: string): { session: EditorialSession; refs: EvidenceRef[] } {
  const session = createEditorialSession(id);
  const text = '写一篇至少 10 个可见字符的通知。';
  session.evidence = [{ id: 'basis', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: { messageId: 'm1' }, context: { scenario: 'real' } }];
  return { session, refs: [{ evidenceId: 'basis', revision: 1, start: 0, end: text.length, quote: text }] };
}
function plan(refs: EvidenceRef[]): Record<string, unknown> {
  return { factPatch: {}, taskPatch: { baseRevision: 0, refs, objective: '通知', intents: ['inform'], criteria: [{ id: 'length-10', origin: 'user', refs, severity: 'blocking', verification: 'deterministic', rule: { kind: 'length', min: 10, unit: 'visible_characters' } }] } };
}

describe('constraint gaps', () => {
  it('drives a rewrite for an unmet criterion and resolves after the candidate passes', async () => {
    const { session, refs } = fixture('constraint-rewrite');
    const bodies = ['short', 'long enough body'];
    const writeInputs: Record<string, unknown>[] = [];
    const checkpoints: EditorialSession[] = [];
    let decisions = 0;
    const model: EditorialModelPort = async ({ stage, data }) => {
      if (stage === 'preflight') return JSON.stringify(plan(refs));
      if (stage === 'decide') return JSON.stringify(++decisions === 1 ? { tool: 'write', instructions: 'Write' } : decisions === 2 ? { tool: 'write', instructions: 'Repair the length constraint' } : { tool: 'review' });
      if (stage === 'write') { writeInputs.push(data); return JSON.stringify({ title: '通知', bodyMarkdown: bodies.shift() ?? 'long enough body' }); }
      if (stage === 'review') return '{"blocking":[],"notes":[]}';
      throw new Error('fixture_error:' + stage);
    };
    const outcome = await runEditorialController({ session, model, sources: noSources, signal: new AbortController().signal, onCheckpoint: next => checkpoints.push(structuredClone(next)) });
    expect(outcome.type).toBe('draft');
    expect(writeInputs).toHaveLength(2);
    expect((writeInputs[1].repairCriterionIds as string[])).toContain('length-10');
    expect(checkpoints.some(checkpoint => checkpoint.gaps.some(gap => gap.gapClass === 'constraint' && gap.requirementId === 'length-10' && gap.state === 'unmet'))).toBe(true);
    expect(outcome.session.gaps.find(gap => gap.gapClass === 'constraint' && gap.requirementId === 'length-10')?.state).toBe('resolved');
    expect(outcome.session.gaps.some(gap => gap.askable === true)).toBe(false);
  });

  it('drives a rewrite for an unmet structure constraint and resolves after the review passes', async () => {
    const { session, refs } = fixture('constraint-structure');
    session.task = {
      schemaVersion: 2, revision: 1, objective: '通知', intents: ['inform'], targetScopes: [],
      requirements: [], requiredSources: [],
      criteria: [{ id: 'structure', origin: 'user', refs, severity: 'blocking', verification: 'semantic', rule: { kind: 'semantic', instruction: '按通用推文结构组织内容' } }],
      permittedOmissions: [], sourceWaivers: [], coverage: { status: 'validated', refs },
    };
    const writes: Record<string, unknown>[] = [];
    const checkpoints: EditorialSession[] = [];
    let decisions = 0; let reviews = 0; let written = 0;
    const model: EditorialModelPort = async ({ stage, data }) => {
      if (stage === 'preflight') return '{"factPatch":{}}';
      if (stage === 'decide') return JSON.stringify(++decisions === 1 ? { tool: 'write', instructions: 'Write' } : decisions === 2 ? { tool: 'review' } : decisions === 3 ? { tool: 'write', instructions: 'Repair structure' } : { tool: 'review' });
      if (stage === 'write') { writes.push(data); written++; return JSON.stringify({ title: '通知', bodyMarkdown: written === 1 ? '初稿' : '引入\n主体\n亮点\n结尾' }); }
      if (stage === 'review') {
        reviews++;
        return JSON.stringify({ blocking: [], notes: [], criterionChecks: [{ criterionId: 'structure', status: reviews === 1 ? 'fail' : 'pass', verifier: 'semantic', detail: reviews === 1 ? '缺少主体段落' : '结构完整' }] });
      }
      throw new Error('fixture_error:' + stage);
    };
    const outcome = await runEditorialController({ session, model, sources: noSources, signal: new AbortController().signal, onCheckpoint: next => checkpoints.push(structuredClone(next)) });
    expect(outcome.type).toBe('draft');
    expect(writes).toHaveLength(2);
    expect((writes[1].repairCriterionIds as string[])).toContain('structure');
    expect(checkpoints.some(checkpoint => checkpoint.gaps.some(gap => gap.gapClass === 'constraint' && gap.requirementId === 'structure' && gap.state === 'unmet'))).toBe(true);
    expect(outcome.session.gaps.find(gap => gap.gapClass === 'constraint' && gap.requirementId === 'structure')?.state).toBe('resolved');
  });

  it('still rewrites a review decision into a repair write when no gap is open', async () => {
    const { session, refs } = fixture('constraint-review-rewrite');
    const bodies = ['short', 'long enough body'];
    const writeInputs: Record<string, unknown>[] = [];
    const stages: string[] = [];
    let decisions = 0;
    const model: EditorialModelPort = async ({ stage, data }) => {
      stages.push(stage);
      if (stage === 'preflight') return JSON.stringify(plan(refs));
      if (stage === 'decide') return JSON.stringify(++decisions === 1 ? { tool: 'write', instructions: 'Write' } : { tool: 'review' });
      if (stage === 'write') { writeInputs.push(data); return JSON.stringify({ title: '通知', bodyMarkdown: bodies.shift() ?? 'long enough body' }); }
      if (stage === 'review') return '{"blocking":[],"notes":[]}';
      throw new Error('fixture_error:' + stage);
    };
    const outcome = await runEditorialController({ session, model, sources: noSources, signal: new AbortController().signal });
    expect(outcome.type).toBe('draft');
    expect(writeInputs).toHaveLength(2);
    expect(writeInputs[1].repairCriterionIds as string[]).toContain('length-10');
    expect(stages.filter(stage => stage === 'review')).toHaveLength(1);
  });

  it('blocks the delivery page with measurements when the rewrite budget is exhausted and never asks', async () => {
    const { session, refs } = fixture('constraint-budget');
    let decisions = 0;
    const model: EditorialModelPort = async ({ stage }) => {
      if (stage === 'preflight') return JSON.stringify(plan(refs));
      if (stage === 'decide') return JSON.stringify(++decisions === 1 ? { tool: 'write', instructions: 'Write' } : { tool: 'write', instructions: 'Repair' });
      if (stage === 'write') return JSON.stringify({ title: '通知', bodyMarkdown: 'short' });
      if (stage === 'review') return '{"blocking":[],"notes":[]}';
      throw new Error('fixture_error:' + stage);
    };
    const outcome = await runEditorialController({ session, model, sources: noSources, signal: new AbortController().signal, budget: { writes: 1 } });
    expect(outcome.type).not.toBe('question');
    expect(outcome.type).toBe('incomplete');
    const gap = outcome.session.gaps.find(item => item.gapClass === 'constraint' && item.requirementId === 'length-10')!;
    expect(gap).toMatchObject({ askable: false, blocking: false, state: 'blocked_by_constraint' });
    expect(gap.measurement).toMatchObject({ criterionId: 'length-10', measured: '5', required: '10–∞ 可见字符' });
    expect(canHandoff(outcome.session).blockers).toContain('length-10');
    expect(() => buildQuestion(outcome.session, [gap.id])).toThrow('non_askable_gap');
    expect(outcome.session.lastRun?.stop?.code).toBe('write_budget_exhausted');
  });

  it('derives pending_check before a candidate exists and never asks for a constraint', () => {
    const { session, refs } = fixture('constraint-pending');
    session.task = {
      schemaVersion: 2, revision: 1, objective: '通知', intents: ['inform'], targetScopes: [],
      requirements: [], requiredSources: [], criteria: [{ id: 'length-10', origin: 'user', refs, severity: 'blocking', verification: 'deterministic', rule: { kind: 'length', min: 10, unit: 'visible_characters' } }],
      permittedOmissions: [], sourceWaivers: [], coverage: { status: 'validated', refs },
    };
    const gap = deriveGaps(session).find(item => item.gapClass === 'constraint')!;
    expect(gap.state).toBe('pending_check');
    expect(() => buildQuestion(session, [gap.id])).toThrow('non_askable_gap');
  });
});
