import {describe,it,expect} from 'vitest';
import {deriveView} from '../derived';
import {createEditorialSession} from '../../../src/lib/editorialTypes';

function trial(overrides: any = {}) {
  const session = createEditorialSession('s') as any;
  session.task = { ...session.task, revision: 3, coverage: { status: 'validated', refs: [] } };
  session.claims = [
    { id: 'c1', selector: { scopeId: 'x', predicate: 'time' }, value: '2026 年 12 月 8 日 19:00', refs: [], epistemic: 'supported', visibility: 'public', statusBasis: [] },
    { id: 'c2', selector: { scopeId: 'x', predicate: 'private' }, value: 'internal note', refs: [], epistemic: 'supported', visibility: 'private', statusBasis: [] },
  ];
  session.candidate = { schemaVersion: 2, id: 'candidate', revision: 1, title: '报名开启', bodyMarkdown: '讲座时间：2026 年 12 月 8 日 19:00\n\n请报名。', contentHash: 'hash', blocks: [{ id: 'b1', kind: 'paragraph', text: '讲座时间：2026 年 12 月 8 日 19:00' }, { id: 'b2', kind: 'paragraph', text: '请报名。' }], claimLinks: [], editorialNotes: [], assets: [], origin: 'model' };
  session.review = { inputKey: { contentHash: 'hash', evidenceRevision: 0, taskRevision: 3, policyRevision: 0 }, issues: [], blocking: [], notes: [] };
  session.layout = { contentHash: 'hash', themeId: 't', themeVersion: '1', html: '<p>x</p>', htmlHash: 'wrong' };
  return { id: 'D01', runId: 'r', trial: 1, outcome: { type: 'draft', session }, modelCalls: 1, legacyModelCalls: null, trace: [{ type: 'model_request', stage: 'preflight' }, { type: 'model_request', stage: 'write' }], outputs: [{ type: 'copy', allowed: false }], checkpoints: [], privateSpans: [], cancelled: false, modelCalls_: 0, operatorPlanRequired: false, unappliedFollowups: 0, execution: { requiredSteps: ['followup:0'], completedSteps: ['followup:0'] }, ...overrides } as any;
}

describe('deriveView', () => {
  it('summarises terminal state, deterministic facts, stamps and stages', () => {
    const view = deriveView(trial());
    expect(view.terminalKind).toBe('draft'); expect(view.delivered).toBe(true);
    expect(view.claimCount).toBe(1); expect(view.bodyHasAllFacts).toBe(true);
    expect(view.reviewAligned).toBe(true); expect(view.layoutAligned).toBe(false);
    expect(view.stages).toEqual(['preflight', 'write']); expect(view.gatesLocked).toBe(true);
    expect(view.followupsApplied).toBe(true);
  });
  it('grades the atomic facts of a compound restatement instead of the sentence wording', () => {
    const t = trial();
    t.outcome.session.claims = [
      { ...t.outcome.session.claims[0], id: 'c-time', value: '2026 年 12 月 8 日 19:00' },
      { ...t.outcome.session.claims[0], id: 'c-venue', value: '知行楼 205 室' },
      { ...t.outcome.session.claims[0], id: 'c-compound', value: '2026 年 12 月 8 日 19:00 在知行楼 205 室' },
    ];
    t.outcome.session.candidate.blocks = [
      { id: 'b1', kind: 'paragraph', text: '时间：2026 年 12 月 8 日 19:00' },
      { id: 'b2', kind: 'paragraph', text: '地点：知行楼 205 室' },
    ];
    t.outcome.session.candidate.bodyMarkdown = '时间：2026 年 12 月 8 日 19:00\n\n地点：知行楼 205 室';
    expect(deriveView(t).bodyHasAllFacts).toBe(true);
  });
  it('does not grade editorial instructions or statements of absence as body facts', () => {
    const t = trial();
    t.outcome.session.claims = [
      { ...t.outcome.session.claims[0], id: 'c-time', value: '2026 年 12 月 8 日 19:00' },
      { ...t.outcome.session.claims[0], id: 'c-deliverable', selector: { scopeId: 'x', predicate: '交付物' }, value: '可发的标题和短稿' },
      { ...t.outcome.session.claims[0], id: 'c-tone', selector: { scopeId: 'x', predicate: '成绩口径' }, value: '只报集体成绩' },
      { ...t.outcome.session.claims[0], id: 'c-absence', selector: { scopeId: 'x', predicate: '参赛者是否自带纸张' }, value: '不自带纸张' },
    ];
    const view = deriveView(t);
    expect(view.claimCount).toBe(1);
    expect(view.bodyHasAllFacts).toBe(true);
  });
  it('grades dated facts across paraphrase but leaves qualitative wording to G1', () => {
    const t = trial();
    t.outcome.session.claims = [
      { ...t.outcome.session.claims[0], id: 'c-place', selector: { scopeId: 'x', predicate: '地点' }, value: '地点知行楼 103 室' },
      { ...t.outcome.session.claims[0], id: 'c-audience', selector: { scopeId: 'x', predicate: '对象是初学者' }, value: '对象是初学者' },
    ];
    t.outcome.session.candidate.blocks = [{ id: 'b1', kind: 'paragraph', text: '本次体验活动面向初学者开展，活动地点为知行楼 103 室。' }];
    t.outcome.session.candidate.bodyMarkdown = '本次体验活动面向初学者开展，活动地点为知行楼 103 室。';
    const view = deriveView(t);
    expect(view.claimCount).toBe(1);
    expect(view.bodyHasAllFacts).toBe(true);
  });
  it('matches dated facts whose labels split the sentence in the draft', () => {
    const t = trial();
    t.outcome.session.claims = [
      { ...t.outcome.session.claims[0], id: 'c-when-where', selector: { scopeId: 'x', predicate: '时间地点' }, value: '2026 年 12 月 8 日 19:00 在知行楼 205 室' },
    ];
    t.outcome.session.candidate.blocks = [{ id: 'b1', kind: 'paragraph', text: '时间：2026 年 12 月 8 日 19:00 地点：知行楼 205 室' }];
    t.outcome.session.candidate.bodyMarkdown = '时间：2026 年 12 月 8 日 19:00 地点：知行楼 205 室';
    expect(deriveView(t).bodyHasAllFacts).toBe(true);
    t.outcome.session.candidate.blocks = [{ id: 'b1', kind: 'paragraph', text: '时间：2026 年 12 月 8 日 19:00 地点：知行楼 405 室' }];
    t.outcome.session.candidate.bodyMarkdown = '时间：2026 年 12 月 8 日 19:00 地点：知行楼 405 室';
    expect(deriveView(t).bodyHasAllFacts).toBe(false);
  });
  it('reports a missing public fact and an unapplied followup', () => {
    const t = trial(); t.outcome.session.claims.push({ ...t.outcome.session.claims[0], id: 'c3', value: '知行楼 205 室' }); t.execution.completedSteps = [];
    const view = deriveView(t);
    expect(view.bodyHasAllFacts).toBe(false); expect(view.followupsApplied).toBe(false);
  });
});
