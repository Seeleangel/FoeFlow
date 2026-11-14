import { describe, it, expect } from 'vitest';
import { annotateDiagnostics, createEditorialSession, hashText, stableJson, type EditorialSession } from '../editorialTypes';
import { migrateEditorialSessionV2ToV3 } from '../editorialSessionMigration';
import { EditorialSessionV3Schema } from '../editorialTypesV3';
import { v2QuestionSession } from './editorialV3Fixtures';
import { uiReady } from './editorialUiFixture';

const migrate = (session: unknown) => migrateEditorialSessionV2ToV3(session);

describe('A26（v2 会话迁移）', () => {
  it('restores one active batch for waiting_input + lastQuestion + asked gaps without losing outputs', () => {
    const v2 = v2QuestionSession();
    const before = structuredClone(v2);
    const v3 = migrateEditorialSessionV2ToV3(v2);

    expect(v3.schemaVersion).toBe(3);
    expect(v3.phase).toBe('waiting_editor');
    const active = v3.questionBatches.filter(batch => batch.status === 'active');
    expect(active).toHaveLength(1);
    expect(v3.activeBatchId).toBe(active[0].id);
    expect(active[0].id).toBe('q-1');
    expect(active[0].gapIds).toEqual(['gap-attendance', 'gap-date']);
    expect(active[0].items.map(item => item.gapClass)).toEqual(['fact', 'fact']);
    expect(active[0].items.every(item => item.expected === 'free_text')).toBe(true);

    expect(v3.gaps.map(gap => gap.state)).toEqual(['asked', 'asked']);
    expect(v3.gaps.map(gap => gap.askHistory)).toEqual([
      [{ batchId: 'q-1', messageId: 'm1', promptHash: hashText('出席人数\n报道需要具体出席人数'), reasonCode: 'migrated_asked' }],
      [{ batchId: 'q-1', messageId: 'm1', promptHash: hashText('活动日期\n报道需要活动日期'), reasonCode: 'migrated_asked' }],
    ]);

    expect(v3.committed).toEqual(v2.committed);
    expect(v3.review).toEqual(v2.review);
    expect(v3.layout).toEqual(v2.layout);
    expect(v3.gate).toEqual(v2.gate);
    expect(v3.evidence).toEqual(v2.evidence);
    expect(v3.claims).toEqual(v2.claims);
    expect(v3.task).toEqual(v2.task);
    expect(v2).toEqual(before);
    expect(EditorialSessionV3Schema.parse(v3)).toEqual(v3);
    expect(migrateEditorialSessionV2ToV3(v2)).not.toBeInstanceOf(Promise);
  });
});

describe('v2 -> v3 session migration', () => {
  it('maps all nine legacy phases onto the six-state contract', () => {
    const base = uiReady();
    const cases = [
      ['planning', 'intake'], ['gathering', 'working'], ['writing', 'working'], ['reviewing', 'working'],
      ['pending_confirmation', 'ready'], ['confirmed', 'confirmed'],
    ] as const;
    for (const [phase, expected] of cases) expect(migrate({ ...base, phase }).phase).toBe(expected);
    expect(migrate({ ...base, phase: 'incomplete' }).phase).toBe('stopped');
    expect(migrate({ ...base, phase: 'failed' }).phase).toBe('stopped');
  });

  it('degrades waiting_input without a live question to stopped(input) instead of inventing state', () => {
    const stale = migrate({ ...uiReady(), phase: 'waiting_input' });
    expect(stale.phase).toBe('stopped');
    expect(stale.activeBatchId).toBeUndefined();
    expect(stale.questionBatches).toEqual([]);
    expect(stale.lastRun?.stop).toMatchObject({ code: 'task_plan_incomplete', class: 'input', retryable: false });
  });

  it('maps gap kinds, drops plan_ambiguity from editor questions and keeps it as an agent diagnostic', () => {
    const s = createEditorialSession('gaps');
    s.phase = 'gathering';
    const kinds = ['missing', 'source_unavailable', 'permission', 'conflict', 'scope', 'plan_ambiguity'] as const;
    s.gaps = kinds.map((kind, index) => ({
      id: 'gap-' + index, requirementId: 'req-' + index, kind,
      selector: { scopeId: 'subject', predicate: 'p' + index },
      label: 'L' + index, reason: 'R' + index, state: 'open' as const, blocking: true, alternatives: [], resolutionClaimIds: [],
    }));
    const v3 = migrate(s);
    expect(v3.gaps.map(gap => [gap.id, gap.gapClass, gap.origin.kind])).toEqual([
      ['gap-0', 'fact', 'requirement'],
      ['gap-1', 'fact', 'source'],
      ['gap-2', 'authorization', 'permission'],
      ['gap-3', 'fact', 'requirement'],
      ['gap-4', 'fact', 'requirement'],
    ]);
    expect(v3.gaps.map(gap => gap.askable)).toEqual([true, true, true, true, true]);
    expect(v3.gaps.map(gap => gap.owner)).toEqual(['agent_or_editor', 'agent_or_editor', 'editor', 'agent_or_editor', 'agent_or_editor']);
    expect(v3.gaps.map(gap => gap.whyNeeded)).toEqual(['R0', 'R1', 'R2', 'R3', 'R4']);
    expect(v3.gaps.some(gap => gap.id === 'gap-5')).toBe(false);
    expect(v3.agentDiagnostics).toContainEqual({ owner: 'gap:migration', code: 'migrated_plan_ambiguity', message: 'L5：R5', refs: [] });
  });

  it('splits v2 diagnostics into agentDiagnostics and never turns them into gaps', () => {
    const s = createEditorialSession('diag');
    s.diagnostics = [
      { owner: 'task:patch', code: 'task_patch_rejected', message: 'bad patch', refs: [] },
      { owner: 'compatibility', code: 'legacy_requires_validation', message: 'legacy', refs: [] },
    ];
    const v3 = migrate(s);
    expect(v3.agentDiagnostics).toEqual(annotateDiagnostics(s.diagnostics));
    expect(v3.gaps).toEqual([]);
    expect('diagnostics' in v3).toBe(false);
  });

  it('caps a restored batch at three items and keeps the overflow in remainingGapIds', () => {
    const s = v2QuestionSession();
    s.gaps = Array.from({ length: 5 }, (_, index) => ({
      id: 'gap-' + index, requirementId: 'req-' + index, kind: 'missing' as const,
      selector: { scopeId: 'event', predicate: 'p' + index }, label: 'L' + index, reason: 'R' + index,
      state: 'asked' as const, blocking: true, alternatives: [], resolutionClaimIds: [], askedAtMessageId: 'm1',
    }));
    s.lastQuestion = {
      id: 'q-5', gapIds: s.gaps.map(gap => gap.id),
      items: s.gaps.map(gap => ({ gapId: gap.id, subject: '秋季读书会', requested: gap.label, why: gap.reason, options: ['选项 A'] })),
    };
    const v3 = migrate(s);
    const batch = v3.questionBatches[0];
    expect(batch.status).toBe('active');
    expect(batch.items).toHaveLength(3);
    expect(batch.remainingGapIds).toEqual(['gap-3', 'gap-4']);
    expect(batch.items[0].expected).toBe('choice');
    expect(batch.items[0].options).toEqual([{ id: expect.any(String), label: '选项 A' }]);
    expect(v3.gaps.filter(gap => gap.state === 'asked')).toHaveLength(5);
    expect(v3.gaps.every(gap => gap.askHistory[0]?.batchId === 'q-5')).toBe(true);
  });

  it('drops stale lastQuestion inference when its gaps are already resolved', () => {
    const s = v2QuestionSession();
    s.gaps = s.gaps.map(gap => ({ ...gap, state: 'resolved' as const }));
    const v3 = migrate(s);
    expect(v3.phase).toBe('stopped');
    expect(v3.activeBatchId).toBeUndefined();
    expect(v3.questionBatches[0].status).toBe('superseded');
    expect(v3.questionBatches[0].items).toHaveLength(2);
    expect(v3.gaps.map(gap => gap.state)).toEqual(['resolved', 'resolved']);
    expect(v3.gaps.every(gap => gap.askHistory.length === 0)).toBe(true);
    expect(v3.lastRun?.stop).toMatchObject({ code: 'task_plan_incomplete', class: 'input' });
    expect(v3.lastRun?.stop?.fields).toEqual({ staleBatchId: 'q-1' });
  });

  it('maps lastStop into a structured RunReport and preserves the output revisions', () => {
    const base = uiReady();
    const v3 = migrate({ ...base, phase: 'incomplete', lastStop: { code: 'deadline_exceeded', unresolvedIds: ['criterion:length'], nextActions: ['重试本轮'] } });
    expect(v3.phase).toBe('stopped');
    expect(v3.lastRun).toMatchObject({ outcome: 'stopped', modelCalls: [], agentDiagnostics: [] });
    expect(v3.lastRun?.stop).toMatchObject({ code: 'deadline_exceeded', class: 'external', retryable: true, actions: ['retry'], detail: '重试本轮' });
    expect(v3.lastRun?.stop?.fields).toEqual({ unresolvedIds: 'criterion:length' });
    expect(v3.lastRun?.stop?.preserved.candidateRevision).toBe(v3.candidate?.revision);
    expect(v3.lastRun?.stop?.preserved.inputKey).toBeDefined();
    expect(v3.lastRun?.stop?.traceId).toMatch(/^migration-/);
  });

  it('classifies incomplete as input and failed as internal when no structured stop exists', () => {
    expect(migrate({ ...uiReady(), phase: 'failed' }).lastRun?.stop).toMatchObject({ code: 'legacy_failed', class: 'internal', retryable: true });
    expect(migrate({ ...uiReady(), phase: 'incomplete' }).lastRun?.stop).toMatchObject({ code: 'legacy_incomplete', class: 'input', retryable: false });
  });

  it('preserves the grounded fact layer, notes and output selection', () => {
    const s: EditorialSession = createEditorialSession('preserve');
    const text = '出席人数 30 人。';
    const ref = { evidenceId: 'e1', revision: 1, start: 0, end: 3, quote: '出席人' };
    s.evidence = [{ id: 'e1', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: { messageId: 'm1' }, context: { scenario: 'real' } }];
    s.scopes = [{ id: 'event', kind: 'event', label: '秋季读书会', qualifiers: [], anchors: [ref], identity: 'aligned' }];
    s.claims = [{ id: 'c1', selector: { scopeId: 'event', predicate: 'attendance' }, value: '30 人', refs: [ref], statusBasis: [ref], epistemic: 'supported', visibility: 'public' }];
    s.permissions = [{ id: 'p1', subjectId: 'event', uses: [{ channel: 'public', purpose: 'report', identity: 'named' }], state: 'allowed', refs: [ref] }];
    s.alignments = [];
    s.editorialNotes = [{ id: 'n1', kind: 'process', text: 'keep me', relatedIds: [] }];
    s.selectedOutput = 'candidate';
    s.phase = 'gathering';
    const v3 = migrate(s);
    expect(v3.evidence).toEqual(s.evidence);
    expect(v3.scopes).toEqual(s.scopes);
    expect(v3.claims).toEqual(s.claims);
    expect(v3.permissions).toEqual(s.permissions);
    expect(v3.editorialNotes).toEqual(s.editorialNotes);
    expect(v3.selectedOutput).toBe('candidate');
  });

  it('is idempotent, read-only and rejects unknown versions or damaged v3', () => {
    const once = migrateEditorialSessionV2ToV3(v2QuestionSession());
    const twice = migrateEditorialSessionV2ToV3(once);
    expect(stableJson(twice)).toBe(stableJson(once));
    expect(() => migrateEditorialSessionV2ToV3({ ...v2QuestionSession(), schemaVersion: 1 })).toThrow('invalid_schema');
    expect(() => migrateEditorialSessionV2ToV3('not a session')).toThrow('invalid_schema');
    expect(() => migrateEditorialSessionV2ToV3({ ...once, phase: 'failed' })).toThrow('invalid_schema');
  });
});
