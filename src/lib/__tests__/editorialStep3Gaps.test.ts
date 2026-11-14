import { describe, it, expect, vi } from 'vitest';
import { createEditorialSession, hashText, type Diagnostics, type EditorialSession, type EvidenceRef } from '../editorialTypes';
import { applyFactPatch } from '../editorialFacts';
import { applyTaskPatch } from '../editorialTask';
import { normalizeModelExtraction } from '../editorialNormalize';
import { deriveGaps, buildQuestion } from '../editorialGaps';
import { canHandoff, runEditorialController, type EditorialModelPort } from '../editorialController';
import { processEditorTurn } from '../editorialTurnProcessor';
import { editorialStopExplanation } from '../editorialStatus';
import type { GapV2, QuestionBatch as QuestionBatchV3, QuestionItem } from '../editorialTypesV3';
import { v3QuestionSession } from './editorialV3Fixtures';

const noSources = { search: vi.fn(async () => []), read: vi.fn(async () => undefined) };

function directiveSession(text: string): EditorialSession {
  const session = createEditorialSession('step3');
  session.evidence = [{ id: 'basis', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: { messageId: 'm1' }, context: { scenario: 'real' } }];
  session.evidenceRevision = 1;
  return session;
}
function span(session: EditorialSession): EvidenceRef {
  const evidence = session.evidence[0];
  return { evidenceId: evidence.id, revision: evidence.revision, start: 0, end: evidence.text.length, quote: evidence.text };
}
function normalized(session: EditorialSession, directives: unknown[]) {
  const raw = normalizeModelExtraction(session, { directives });
  return { raw, task: raw.taskPatch as Record<string, unknown> | undefined, diagnostics: (raw.diagnostics ?? []) as Diagnostics[] };
}
function reply(session: EditorialSession, text: string, messageId: string): EditorialSession {
  const next = structuredClone(session);
  next.evidence.push({ id: messageId, revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: { messageId }, context: { scenario: 'real' } });
  next.evidenceRevision++;
  return next;
}
function finishingModel(stages: string[], directives: unknown[] = [], legacyTaskPatch?: unknown): EditorialModelPort {
  let decisions = 0;
  return async ({ stage, data }) => {
    stages.push(stage);
    if (stage === 'preflight') return JSON.stringify({ directives, factPatch: {}, editorialNotes: [], ...(legacyTaskPatch ? { taskPatch: legacyTaskPatch } : {}) });
    if (stage === 'decide') return JSON.stringify(++decisions === 1 ? { tool: 'write', instructions: 'Write' } : { tool: 'review' });
    if (stage === 'write') return JSON.stringify({ title: '活动通知', bodyMarkdown: 'Body' });
    if (stage === 'review') {
      const task = data.task as EditorialSession['task'];
      return JSON.stringify({ blocking: [], notes: [], criterionChecks: task.criteria.filter(criterion => criterion.verification === 'semantic').map(criterion => ({ criterionId: criterion.id, status: 'pass', verifier: 'semantic', detail: 'ok' })) });
    }
    throw new Error('fixture_error:' + stage);
  };
}

describe('G1–G4 directive guards', () => {
  it('G1 converts a requirement whose span is classified as a constraint', () => {
    const session = directiveSession('按通用推文结构组织内容。');
    const { task, diagnostics } = normalized(session, [
      { kind: 'constraint', text: '按通用推文结构组织内容', quote: '按通用推文结构组织内容', rule: { kind: 'semantic', instruction: '按通用推文结构组织内容' } },
      { kind: 'missing_value', text: '按通用推文结构组织内容', quote: '按通用推文结构组织内容', predicate: 'structure', label: '按通用推文结构组织内容', whyNeeded: '读者需要清晰结构' },
    ]);
    expect((task?.requirements as unknown[]) ?? []).toHaveLength(0);
    expect((task?.criteria as Record<string, unknown>[]).some(criterion => (criterion.rule as Record<string, unknown>).kind === 'semantic' && String((criterion.rule as Record<string, unknown>).instruction).includes('推文结构'))).toBe(true);
    expect(diagnostics.some(diagnostic => diagnostic.code === 'requirement_duplicates_constraint')).toBe(true);
  });

  it('G2 marks an overlapping requirement non-askable without deleting it', () => {
    const session = directiveSession('内容围绕秋季读书心得。报名人数上限还没定，需要确认。');
    const { task, diagnostics } = normalized(session, [
      { kind: 'constraint', text: '内容围绕秋季读书心得', quote: '内容围绕秋季读书心得' },
      { kind: 'missing_value', text: '内容围绕秋季读书心得并确认报名人数上限', quote: '报名人数上限还没定', label: '内容围绕秋季读书心得并确认报名人数上限', predicate: 'theme_capacity', whyNeeded: '读者需要知道主题和名额' },
    ]);
    const requirements = (task?.requirements as Record<string, unknown>[]) ?? [];
    expect(requirements).toHaveLength(1);
    expect(requirements[0]).toMatchObject({ askable: false, requiresReview: true });
    expect(diagnostics.some(diagnostic => diagnostic.code === 'requirement_overlaps_constraint')).toBe(true);
  });

  it('G3 drops a missing value that has no dependency', () => {
    const session = directiveSession('报名人数上限还没定。');
    const { task, diagnostics } = normalized(session, [
      { kind: 'missing_value', text: '报名人数上限', quote: '报名人数上限还没定', predicate: 'capacity' },
    ]);
    expect((task?.requirements as unknown[]) ?? []).toHaveLength(0);
    expect(diagnostics.some(diagnostic => diagnostic.code === 'requirement_without_dependency')).toBe(true);
  });

  it('G4 downgrades a low-confidence missing value to a constraint', () => {
    const session = directiveSession('报名人数上限还没定。');
    const { task, diagnostics } = normalized(session, [
      { kind: 'missing_value', text: '报名人数上限', quote: '报名人数上限还没定', confidence: 0.2, whyNeeded: '读者需要知道名额', predicate: 'capacity' },
    ]);
    expect((task?.requirements as unknown[]) ?? []).toHaveLength(0);
    expect((task?.criteria as Record<string, unknown>[]).some(criterion => (criterion.rule as Record<string, unknown>).kind === 'semantic')).toBe(true);
    expect(diagnostics.some(diagnostic => diagnostic.code === 'low_confidence_directive')).toBe(true);
  });

  it('maps fact, source, authorization and goal directives into their typed structures', () => {
    const session = directiveSession('活动在 10 月 20 日举行。请参考流程文档。可以用讲师照片吗？让读者报名。');
    const { raw } = normalized(session, [
      { kind: 'fact', text: '活动在 10 月 20 日举行', quote: '活动在 10 月 20 日举行', predicate: 'date' },
      { kind: 'source', text: '流程文档', title: '流程文档', quote: '流程文档' },
      { kind: 'authorization', text: '讲师照片', quote: '讲师照片' },
      { kind: 'goal', text: '让读者报名', quote: '让读者报名' },
    ]);
    const factPatch = raw.factPatch as Record<string, unknown>;
    expect((factPatch.claims as unknown[])).toHaveLength(1);
    expect((factPatch.permissions as unknown[])).toHaveLength(1);
    const withFacts = applyFactPatch(session, factPatch);
    const planned = applyTaskPatch(withFacts, raw.taskPatch);
    expect(planned.task.requiredSources).toHaveLength(1);
    expect(planned.task.criteria.some(criterion => criterion.rule.kind === 'permission')).toBe(true);
    expect(planned.task.objective).toContain('让读者报名');
    expect(planned.task.intents).toContain('call_to_action');
  });
});

describe('gap classes and askability', () => {
  it('classifies fact/authorization/internal gaps and refuses non-askable questions', () => {
    const session = directiveSession('写一篇通知。');
    const refs = [span(session)];
    session.task = {
      schemaVersion: 2, revision: 1, objective: '通知', intents: ['inform'], targetScopes: [],
      requirements: [{ id: 'req', selector: { scopeId: 'event', predicate: 'capacity' }, label: '名额', reason: '读者需要', whyNeeded: '读者需要', refs, necessity: 'blocking', resolution: 'supply_fact' }],
      requiredSources: [{ id: 'src', selector: { title: '流程' }, purpose: '核对', refs, depth: 'relevant_excerpt', state: 'pending' }],
      criteria: [
        { id: 'perm', origin: 'user', refs, severity: 'blocking', verification: 'deterministic', rule: { kind: 'permission', subjectIds: ['photo'], use: 'publication', channel: 'public', identity: 'named' } },
        { id: 'structure', origin: 'user', refs, severity: 'blocking', verification: 'semantic', rule: { kind: 'semantic', instruction: '按推文结构' } },
      ],
      permittedOmissions: [], sourceWaivers: [], coverage: { status: 'validated', refs },
    };
    session.diagnostics = [{ owner: 'facts:claims:x', code: 'missing_status_basis', message: 'x', refs: [] }];
    const gaps = deriveGaps(session);
    expect(gaps.find(gap => gap.requirementId === 'req')).toMatchObject({ gapClass: 'fact', askable: true, whyNeeded: '读者需要' });
    expect(gaps.find(gap => gap.requirementId === 'perm')).toMatchObject({ gapClass: 'authorization', askable: true });
    expect(gaps.find(gap => gap.requirementId === 'src')).toMatchObject({ gapClass: 'fact', askable: true });
    expect(gaps.some(gap => gap.gapClass === 'internal')).toBe(false);
    const constraint = gaps.find(gap => gap.gapClass === 'constraint')!;
    expect(constraint).toMatchObject({ askable: false, blocking: false });
    expect(gaps.some(gap => gap.requirementId === 'structure' && gap.gapClass !== 'constraint')).toBe(false);
    expect(() => buildQuestion(session, [constraint.id])).toThrow('non_askable_gap');
  });
});

describe('A9–A12: constraint intake and real missing values', () => {
  it('A9/A11: structure requirement is a criterion, never a question or gap', async () => {
    const session = directiveSession('按通用推文结构组织内容。');
    const stages: string[] = [];
    const outcome = await runEditorialController({ session, model: finishingModel(stages, [
      { kind: 'goal', text: '写一篇活动通知', quote: '按通用推文结构组织内容' },
      { kind: 'constraint', text: '按通用推文结构组织内容', quote: '按通用推文结构组织内容', rule: { kind: 'semantic', instruction: '按通用推文结构组织内容' } },
      { kind: 'missing_value', text: '按通用推文结构组织内容', quote: '按通用推文结构组织内容', predicate: 'structure', label: '按通用推文结构组织内容', whyNeeded: '读者需要清晰结构' },
    ]), sources: noSources, signal: new AbortController().signal });
    expect(outcome.type).toBe('draft');
    expect(outcome.session.task.criteria.some(criterion => criterion.rule.kind === 'semantic' && criterion.rule.instruction.includes('推文结构'))).toBe(true);
    expect(outcome.session.task.requirements.some(requirement => requirement.selector.predicate === 'structure')).toBe(false);
    expect(outcome.session.gaps.some(gap => gap.selector.predicate === 'structure')).toBe(false);
    expect(outcome.session.agentDiagnostics?.some(diagnostic => diagnostic.code === 'requirement_duplicates_constraint')).toBe(true);
    expect(stages).not.toContain('extract');
  });

  it('A10: theme requirement is a criterion, never a question or gap', async () => {
    const session = directiveSession('内容围绕秋季读书心得。');
    const stages: string[] = [];
    const outcome = await runEditorialController({ session, model: finishingModel(stages, [
      { kind: 'goal', text: '写一篇秋季读书心得', quote: '内容围绕秋季读书心得' },
      { kind: 'constraint', text: '内容围绕秋季读书心得', quote: '内容围绕秋季读书心得' },
    ]), sources: noSources, signal: new AbortController().signal });
    expect(outcome.type).toBe('draft');
    expect(outcome.session.task.criteria.some(criterion => criterion.rule.kind === 'semantic' && criterion.rule.instruction.includes('秋季读书心得'))).toBe(true);
    expect(outcome.session.task.requirements.some(requirement => requirement.selector.predicate.includes('theme'))).toBe(false);
    expect(outcome.session.gaps.some(gap => gap.selector.predicate.includes('theme'))).toBe(false);
  });

  it('A11: a legacy requirement over a classified constraint span becomes a criterion and an agent diagnostic', async () => {
    const session = directiveSession('按通用推文结构组织内容。');
    const refs = [span(session)];
    const legacyTaskPatch = {
      baseRevision: 0, refs, objective: '活动通知', intents: ['inform'],
      criteria: [{ id: 'body', origin: 'user', refs, severity: 'blocking', verification: 'deterministic', rule: { kind: 'length', min: 1, unit: 'visible_characters' } }],
      requirements: [{ id: 'structure-req', selector: { scopeId: 'event', predicate: 'structure' }, label: '按通用推文结构组织内容', reason: '编辑要求结构', refs, necessity: 'blocking', resolution: 'supply_fact' }],
    };
    const stages: string[] = [];
    const outcome = await runEditorialController({ session, model: finishingModel(stages, [
      { kind: 'constraint', text: '按通用推文结构组织内容', quote: '按通用推文结构组织内容' },
    ], legacyTaskPatch), sources: noSources, signal: new AbortController().signal });
    expect(outcome.type).toBe('draft');
    expect(outcome.session.task.requirements.some(requirement => requirement.id === 'structure-req')).toBe(false);
    expect(outcome.session.agentDiagnostics?.some(diagnostic => diagnostic.code === 'requirement_duplicates_constraint')).toBe(true);
    expect(outcome.session.gaps.some(gap => gap.selector.predicate === 'structure')).toBe(false);
  });

  it('A12: a real missing value gets whyNeeded, is asked once and closes with the editor answer', async () => {
    const session = directiveSession('写一篇报名通知。报名人数上限还没定，需要确认。');
    const directives = [
      { kind: 'goal', text: '写一篇报名通知', quote: '写一篇报名通知' },
      { kind: 'missing_value', text: '报名人数上限', quote: '报名人数上限还没定', predicate: 'capacity', label: '报名人数上限', whyNeeded: '读者需要知道名额上限' },
    ];
    const firstModel: EditorialModelPort = async ({ stage }) => {
      if (stage === 'preflight') return JSON.stringify({ directives, factPatch: {}, editorialNotes: [] });
      if (stage === 'decide') return '{"tool":"ask"}';
      throw new Error('fixture_error:' + stage);
    };
    const first = await runEditorialController({ session, model: firstModel, sources: noSources, signal: new AbortController().signal });
    expect(first.type).toBe('question');
    if (first.type !== 'question') throw new Error('expected_question');
    const gap = deriveGaps(first.session).find(candidate => candidate.selector.predicate === 'capacity')!;
    expect(gap).toMatchObject({ gapClass: 'fact', askable: true, blocking: true });
    expect(gap.whyNeeded).toBeTruthy();
    expect(first.question.items[0].requested).toContain('报名人数上限');

    const answered = reply(first.session, '上限 30 人', 'answer-a12');
    const stages: string[] = [];
    const second = await runEditorialController({ session: answered, model: finishingModel(stages), sources: noSources, signal: new AbortController().signal });
    expect(stages).not.toContain('preflight');
    expect(second.type).not.toBe('question');
    expect(second.session.answers).toHaveLength(1);
    expect(second.session.claims.some(claim => claim.value === '上限 30 人')).toBe(true);
    expect(deriveGaps(second.session).find(candidate => candidate.selector.predicate === 'capacity')?.state).toBe('resolved');
  });
});

describe('answer confirmation corrections (design §5.2)', () => {
  it('uses the default affirmative option instead of deferring an authorization item', () => {
    const base = v3QuestionSession();
    const gap: GapV2 = { ...base.gaps[0], id: 'gap-photo', gapClass: 'authorization', askable: true, owner: 'editor', origin: { kind: 'permission', id: 'crit-photo' }, label: '讲师照片授权', selector: { scopeId: 'event', predicate: 'photo' } };
    const item: QuestionItem = { gapId: 'gap-photo', gapClass: 'authorization', subject: '讲师', requested: '是否可以使用讲师照片', why: '封面需要', expected: 'authorization', options: [{ id: 'allow', label: '同意', isDefaultAffirmative: true }], answerSlot: 'slot-photo' };
    const batch = { ...base.questionBatches[0], id: 'q-photo', gapIds: ['gap-photo'], items: [item], status: 'active' as const };
    const session = { ...base, gaps: [gap], questionBatches: [batch], activeBatchId: 'q-photo' };
    const projection = processEditorTurn(session, { messageId: 'default-confirm', text: '确认', receivedAt: '2026-11-13T10:00:00+08:00' });
    expect(projection.answers).toEqual([expect.objectContaining({ gapId: 'gap-photo', method: 'confirmation', choice: 'grant' })]);
    expect(projection.decisions).toEqual([expect.objectContaining({ gapId: 'gap-photo', kind: 'proceed' })]);
  });

  it('answers a choice item with its default affirmative option', () => {
    const base = v3QuestionSession();
    const gap: GapV2 = { ...base.gaps[0], id: 'gap-mode', gapClass: 'fact', askable: true, label: '活动形式', selector: { scopeId: 'event', predicate: 'format' } };
    const item: QuestionItem = { gapId: 'gap-mode', gapClass: 'fact', subject: '活动', requested: '线上还是线下', why: '读者需要知道形式', expected: 'choice', options: [{ id: 'online', label: '线上', isDefaultAffirmative: true }, { id: 'offline', label: '线下' }], answerSlot: 'slot-mode' };
    const batch = { ...base.questionBatches[0], id: 'q-mode', gapIds: ['gap-mode'], items: [item], status: 'active' as const };
    const session = { ...base, gaps: [gap], questionBatches: [batch], activeBatchId: 'q-mode' };
    const projection = processEditorTurn(session, { messageId: 'choice-confirm', text: '确认', receivedAt: '2026-11-13T10:00:00+08:00' });
    expect(projection.answers).toEqual([expect.objectContaining({ gapId: 'gap-mode', method: 'confirmation', choice: 'supply', value: '线上' })]);
    expect(projection.decisions).toEqual([expect.objectContaining({ gapId: 'gap-mode', kind: 'supply', note: '默认选项：线上' })]);
  });

  it('closes a defaultAffirmative choice end-to-end without re-asking', async () => {
    const session = createEditorialSession('choice-e2e');
    const text = '写一篇报名通知。活动是线上还是线下？';
    session.evidence = [{ id: 'basis', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: { messageId: 'm1' }, context: { scenario: 'real' } }];
    session.evidenceRevision = 1;
    const refs = [span(session)];
    session.task = {
      schemaVersion: 2, revision: 1, objective: '报名通知', intents: ['inform'], targetScopes: [],
      requirements: [{ id: 'format', selector: { scopeId: 'event', predicate: 'format' }, label: '活动形式', reason: '读者需要知道形式', whyNeeded: '读者需要知道形式', refs, necessity: 'blocking', resolution: 'supply_fact' }],
      requiredSources: [], criteria: [{ id: 'body', origin: 'user', refs, severity: 'blocking', verification: 'deterministic', rule: { kind: 'length', min: 1, unit: 'visible_characters' } }],
      permittedOmissions: [], sourceWaivers: [], coverage: { status: 'validated', refs },
    };
    const gap = deriveGaps(session)[0];
    session.gaps = [{ ...gap, state: 'asked', askedAtMessageId: 'm1', askHistory: [{ batchId: 'q-format', messageId: 'm1', promptHash: 'h', reasonCode: 'question_opened' }] }];
    const batch: QuestionBatchV3 = {
      id: 'q-format', createdAtMessageId: 'm1', gapIds: [gap.id], status: 'active',
      items: [{ gapId: gap.id, gapClass: 'fact', subject: '活动', requested: '线上还是线下', why: '读者需要知道形式', expected: 'choice', options: [{ id: 'online', label: '线上', isDefaultAffirmative: true }, { id: 'offline', label: '线下' }], answerSlot: 'slot-format' }],
    };
    session.questionBatches = [batch];
    session.activeBatchId = 'q-format';
    session.lastQuestion = { id: 'q-format', gapIds: [gap.id], items: [{ gapId: gap.id, subject: '活动', requested: '线上还是线下', why: '读者需要知道形式', options: ['线上', '线下'] }] };
    session.phase = 'waiting_input';
    const answered = reply(session, '确认', 'answer-choice');
    let decisions = 0; const stages: string[] = [];
    const model: EditorialModelPort = async ({ stage }) => {
      stages.push(stage);
      if (stage === 'preflight' || stage === 'mapping') throw new Error('fixture_error:' + stage);
      if (stage === 'decide') return JSON.stringify(++decisions === 1 ? { tool: 'write', instructions: 'Write' } : { tool: 'review' });
      if (stage === 'write') return JSON.stringify({ title: '报名通知', bodyMarkdown: '活动为线上。' });
      if (stage === 'review') return '{"blocking":[],"notes":[]}';
      throw new Error('fixture_error:' + stage);
    };
    const outcome = await runEditorialController({ session: answered, model, sources: noSources, signal: new AbortController().signal });
    expect(outcome.type).toBe('draft');
    expect(stages).not.toContain('preflight');
    expect(stages).not.toContain('mapping');
    expect(outcome.session.answers?.[0]).toMatchObject({ method: 'confirmation', choice: 'supply', value: '线上' });
    expect(outcome.session.questionBatches).toHaveLength(1);
    expect(outcome.session.questionBatches?.[0].status).toBe('answered');
    expect(outcome.session.activeBatchId).toBeUndefined();
    expect(deriveGaps(outcome.session).find(candidate => candidate.id === gap.id)?.state).toBe('waived');
    expect(canHandoff(outcome.session).checks.find(check => check.criterionId === 'requirement:format')?.status).toBe('pass');
  });

  it('does not re-ask or re-claim an already supported value', () => {
    const base = v3QuestionSession();
    const gap = base.gaps.find(candidate => candidate.selector?.predicate === 'attendance')!;
    const ref = { evidenceId: 'test-basis', revision: 1, start: 0, end: 1, quote: 'P' };
    const session = { ...base, claims: [...base.claims, { id: 'known', selector: gap.selector!, value: '30 人', refs: [ref], statusBasis: [ref], epistemic: 'supported' as const, visibility: 'public' as const }] };
    const projection = processEditorTurn(session, { messageId: 'known-confirm', text: '确认', receivedAt: '2026-11-13T10:00:00+08:00' });
    expect(projection.decisions.find(decision => decision.gapId === gap.id)).toMatchObject({ kind: 'proceed', note: 'already_known' });
    expect(projection.answers.some(answer => answer.gapId === gap.id)).toBe(false);
  });

  it('has dedicated copy for confirmation_without_pending', () => {
    const session = createEditorialSession('copy');
    session.lastStop = { code: 'confirmation_without_pending', unresolvedIds: [], nextActions: [] };
    expect(editorialStopExplanation(session)).toContain('当前没有待确认的问题');
  });
});
