import { describe, expect, it } from 'vitest';
import { createEditorialSession, hashText, type EditorialSession, type EvidenceRef, type RequiredSource } from '../editorialTypes';
import type { StopAction, StopRecord } from '../editorialTypesV3';
import { deriveGaps } from '../editorialGaps';
import { deferGaps, openQuestionBatch } from '../editorialState';
import { answerNoticeText, planStopAction } from '../editorialStopActions';
import { uiReady } from './editorialUiFixture';

function opening(id: string): { session: EditorialSession; refs: EvidenceRef[] } {
  const session = createEditorialSession(id);
  const text = '请写一篇活动报道。';
  session.evidence = [{ id: 'basis', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: { messageId: 'm1' }, context: { scenario: 'real' } }];
  session.evidenceRevision = 1;
  return { session, refs: [{ evidenceId: 'basis', revision: 1, start: 0, end: text.length, quote: text }] };
}
function factSession(id: string): { session: EditorialSession; gapId: string } {
  const { session, refs } = opening(id);
  session.task = {
    schemaVersion: 2, revision: 1, objective: '活动报道', intents: ['inform'], targetScopes: [],
    requirements: [{ id: 'attendance', selector: { scopeId: 'event', predicate: 'attendance' }, label: '出席人数', reason: '读者需要人数', whyNeeded: '读者需要人数', refs, necessity: 'blocking', resolution: 'supply_fact' }],
    requiredSources: [], criteria: [], permittedOmissions: [], sourceWaivers: [], coverage: { status: 'validated', refs },
  };
  session.scopes = [{ id: 'event', kind: 'event', label: '活动', anchors: refs, qualifiers: [], identity: 'aligned' }];
  session.phase = 'gathering';
  const gapId = deriveGaps(session).find(gap => gap.kind === 'missing')!.id;
  return { session, gapId };
}
function sourceSession(id: string, sources: RequiredSource[]): { session: EditorialSession; gapIds: string[] } {
  const { session, refs } = opening(id);
  session.task = {
    schemaVersion: 2, revision: 1, objective: '活动报道', intents: ['inform'], targetScopes: [], requirements: [],
    requiredSources: sources, criteria: [], permittedOmissions: [], sourceWaivers: [], coverage: { status: 'validated', refs },
  };
  session.phase = 'gathering';
  return { session, gapIds: deriveGaps(session).filter(gap => gap.kind === 'source_unavailable').map(gap => gap.id) };
}
function permissionSession(id: string): { session: EditorialSession; gapId: string } {
  const { session, refs } = opening(id);
  session.task = {
    schemaVersion: 2, revision: 1, objective: '活动报道', intents: ['inform'], targetScopes: [], requirements: [], requiredSources: [],
    criteria: [{ id: 'perm-photo', origin: 'user', refs, severity: 'blocking', verification: 'deterministic', rule: { kind: 'permission', subjectIds: ['photo'], use: 'publication', channel: 'public', identity: 'named' } }],
    permittedOmissions: [], sourceWaivers: [], coverage: { status: 'validated', refs },
  };
  session.scopes = [{ id: 'photo', kind: 'asset', label: '讲师照片', anchors: refs, qualifiers: [], identity: 'aligned' }];
  session.phase = 'gathering';
  return { session, gapId: deriveGaps(session).find(gap => gap.kind === 'permission')!.id };
}
function withStop(session: EditorialSession, code: string, fields?: StopRecord['fields']): EditorialSession {
  const stop: StopRecord = { code, class: 'input', retryable: false, headline: 'H', detail: 'D', ...(fields ? { fields } : {}), actions: ['retry', 'report'], traceId: 'trace', preserved: { inputKey: { contentHash: '', evidenceRevision: 0, taskRevision: 0, policyRevision: 0 } } };
  return { ...session, lastRun: { runId: 'r', startedAt: '', endedAt: '', outcome: 'stopped', stop, modelCalls: [], agentDiagnostics: [] } };
}

describe('stop action routing (#2)', () => {
  it('routes retry, confirm and report without inventing handlers', () => {
    expect(planStopAction(uiReady(), 'retry')).toEqual({ kind: 'retry' });
    expect(planStopAction(uiReady(), 'confirm')).toEqual({ kind: 'confirm' });
    expect(planStopAction(uiReady(), 'report')).toEqual({ kind: 'none' });
    expect(planStopAction(undefined, 'retry')).toEqual({ kind: 'none' });
    for (const action of ['retry', 'supply', 'waive', 'answer', 'edit_task', 'confirm', 'report'] as StopAction[]) {
      expect(planStopAction(uiReady(), action)).toBeTruthy();
    }
  });

  it('focuses a matching batch item for supply, otherwise prefills the chat box', () => {
    const { session, gapId } = factSession('supply-batch');
    const opened = openQuestionBatch(session, [gapId]);
    const batchId = opened.activeBatchId!;
    const plan = planStopAction(withStop(opened, 'source_unavailable', { unresolvedIds: gapId }), 'supply');
    expect(plan).toEqual({ kind: 'focus_batch_item', batchId, gapId });
    const source = sourceSession('supply-prefill', [{ id: 'src', selector: { title: '活动通稿' }, purpose: '核对事实', refs: [], depth: 'relevant_excerpt', state: 'pending' }]);
    const prefill = planStopAction(withStop(source.session, 'source_unavailable'), 'supply');
    expect(prefill.kind).toBe('prefill_input');
    if (prefill.kind !== 'prefill_input') throw new Error('expected_prefill');
    expect(prefill.text).toBe('补充素材：活动通稿（请粘贴内容或说明文件位置）');
  });

  it('waives a resolved source gap or defers a non-source gap', () => {
    const source = sourceSession('waive-source', [{ id: 'src', selector: { title: '活动通稿' }, purpose: '核对事实', refs: [], depth: 'relevant_excerpt', state: 'pending' }]);
    expect(planStopAction(withStop(source.session, 'source_unavailable', { unresolvedIds: source.gapIds[0] }), 'waive')).toEqual({ kind: 'waive_sources', requirementIds: ['src'] });
    const permission = permissionSession('waive-permission');
    expect(planStopAction(withStop(permission.session, 'permission_denied', { unresolvedIds: permission.gapId }), 'waive')).toEqual({ kind: 'defer_gaps', gapIds: [permission.gapId] });
    const multiple = sourceSession('waive-multiple', [
      { id: 'a', selector: { title: '来源 A' }, purpose: 'A', refs: [], depth: 'relevant_excerpt', state: 'pending' },
      { id: 'b', selector: { title: '来源 B' }, purpose: 'B', refs: [], depth: 'relevant_excerpt', state: 'pending' },
    ]);
    expect(planStopAction(withStop(multiple.session, 'source_unavailable'), 'waive')).toEqual({ kind: 'focus_gaps', gapIds: multiple.gapIds });
  });

  it('opens a program question batch without model/evidence, or reports the ask limit', () => {
    const { session, gapId } = factSession('answer-open');
    const before = session.evidence.length;
    const plan = planStopAction(withStop(session, 'gap_unresolved'), 'answer');
    expect(plan.kind).toBe('open_question_batch');
    if (plan.kind !== 'open_question_batch') throw new Error('expected_open');
    expect(plan.session.activeBatchId).toBeTruthy();
    expect(plan.session.revision).toBe(session.revision + 1);
    expect(plan.session.evidence).toHaveLength(before);
    expect(plan.session.turns ?? []).toHaveLength(0);
    expect(plan.session.phase).toBe('waiting_input');
    const limited = { ...session, gaps: deriveGaps(session).map(gap => gap.id === gapId ? { ...gap, askHistory: [{ batchId: 'a', messageId: 'm', promptHash: 'h', reasonCode: 'x' }, { batchId: 'b', messageId: 'm', promptHash: 'h', reasonCode: 'x' }] } : gap) };
    expect(planStopAction(withStop(limited, 'gap_unresolved'), 'answer')).toEqual({ kind: 'notice', text: '已达到提问上限，请改用明确豁免或修改任务' });
  });

  it('only reports the ask limit when an open askable gap is actually exhausted', () => {
    const { session } = factSession('answer-notice');
    const unaskable = structuredClone(session);
    unaskable.task = { ...unaskable.task, requirements: unaskable.task.requirements.map(requirement => ({ ...requirement, askable: false })) };
    expect(planStopAction(withStop(unaskable, 'gap_unresolved'), 'answer')).toEqual({ kind: 'notice', text: '当前没有可继续提问的信息项，请改用明确豁免或修改任务。' });
    const gaps = deriveGaps(session);
    expect(answerNoticeText(gaps, new Error('awaiting_editor_reply'))).toBe('当前问题状态已变化，请刷新会话后重试，或改用明确豁免或修改任务。');
    expect(answerNoticeText(gaps, new Error('non_askable_gap'))).toBe('当前没有可继续提问的信息项，请改用明确豁免或修改任务。');
    expect(answerNoticeText(gaps, new Error('boom'))).toBe('当前没有可继续提问的信息项，请改用明确豁免或修改任务。');
    expect(answerNoticeText(gaps)).toBe('当前没有可继续提问的信息项，请改用明确豁免或修改任务。');
    const history = [{ batchId: 'a', messageId: 'm', promptHash: 'h', reasonCode: 'x' }, { batchId: 'b', messageId: 'm', promptHash: 'h', reasonCode: 'x' }];
    expect(answerNoticeText([{ ...gaps[0], askHistory: history }])).toBe('已达到提问上限，请改用明确豁免或修改任务');
    expect(answerNoticeText(gaps, new Error('ask_limit_reached'))).toBe('已达到提问上限，请改用明确豁免或修改任务');
  });

  it('executes deferGaps as one evidence row, decisions and invalidated stamps', () => {
    const { session, gapId } = factSession('defer-exec');
    session.gaps = deriveGaps(session);
    const donor = uiReady();
    session.candidate = donor.candidate;
    session.review = donor.review;
    session.layout = donor.layout;
    session.gate = donor.gate;
    const beforeEvidence = session.evidence.length;
    const next = deferGaps(session, [gapId], '编辑选择按现有信息继续');
    expect(next.evidence).toHaveLength(beforeEvidence + 1);
    expect(next.gapDecisions).toContainEqual(expect.objectContaining({ gapId, kind: 'defer' }));
    expect(deriveGaps(next).find(gap => gap.id === gapId)?.state).toBe('waived');
    expect(next.review).toBeUndefined();
    expect(next.layout).toBeUndefined();
    expect(next.gate).toBeUndefined();
    expect(next.revision).toBe(session.revision + 1);
  });

  it('focuses an active batch for answer and prefills edit_task', () => {
    const { session, gapId } = factSession('answer-active');
    const opened = openQuestionBatch(session, [gapId]);
    expect(planStopAction(withStop(opened, 'gap_unresolved'), 'answer')).toEqual({ kind: 'focus_batch_item', batchId: opened.activeBatchId, gapId });
    expect(planStopAction(withStop(session, 'task_plan_incomplete'), 'edit_task')).toEqual({ kind: 'prefill_input', text: '修改任务要求：', notice: '请说明要修改的任务要求，发送后会重新规划任务' });
  });

  it('does not describe a stale asked gap as an ask limit', () => {
    const { session, gapId } = factSession('answer-stale-asked');
    expect(session.activeBatchId).toBeUndefined();
    expect(session.questionBatches ?? []).toHaveLength(0);
    const gap = deriveGaps(session).find(item => item.id === gapId)!;
    const history = [{ batchId: 'a', messageId: 'm', promptHash: 'h', reasonCode: 'x' }, { batchId: 'b', messageId: 'm', promptHash: 'h', reasonCode: 'x' }];
    const staleAsked = { ...gap, state: 'asked' as const, askHistory: history };
    const text = answerNoticeText([staleAsked]);
    expect(text).not.toContain('上限');
    expect(text).toBe('当前没有可继续提问的信息项，请改用明确豁免或修改任务。');
  });
});
