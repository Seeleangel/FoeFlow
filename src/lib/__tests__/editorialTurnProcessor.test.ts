import { describe, it, expect } from 'vitest';
import { hashText, stableJson } from '../editorialTypes';
import { processEditorTurn } from '../editorialTurnProcessor';
import { migrateEditorialSessionV2ToV3 } from '../editorialSessionMigration';
import type { QuestionBatch } from '../editorialTypesV3';
import { v2QuestionSession, v3IntakeSession, v3QuestionSession, v3ReadySession, v3StoppedSession, v3WorkingSession } from './editorialV3Fixtures';

const at = '2026-11-13T10:00:00+08:00';

describe('processEditorTurn shadow: control intents', () => {
  it('routes a ready-state 确认 to the delivery confirmation path', () => {
    const s = v3ReadySession(); const before = stableJson(s);
    const p = processEditorTurn(s, { messageId: 'm-deliver', text: '确认', receivedAt: at });
    expect(p.outcome).toEqual({ type: 'confirm_delivery', toPhase: 'confirmed' });
    expect(p.turn).toMatchObject({ intent: 'confirm_delivery', bindingStatus: 'none', bindingRefs: [] });
    expect(p.answers).toEqual([]);
    expect(p.decisions).toEqual([]);
    expect(p.evidenceToAppend?.provenance.messageId).toBe('m-deliver');
    expect(stableJson(s)).toBe(before);
  });

  it('treats a ready-state modification as a new instruction run', () => {
    const p = processEditorTurn(v3ReadySession(), { messageId: 'm-edit', text: '把标题改得更具体', receivedAt: at });
    expect(p.outcome).toEqual({ type: 'instruction', toPhase: 'working', startRun: 'instruction' });
    expect(p.turn.intent).toBe('instruction');
    expect(p.directiveMode).toBe('normal');
  });

  it('answers a bare 确认 without an active batch by explaining, never starting a model run', () => {
    expect(processEditorTurn(v3WorkingSession(), { messageId: 'm-confirm-working', text: '确认', receivedAt: at }).outcome)
      .toEqual({ type: 'confirm_without_pending', toPhase: 'working', code: 'confirmation_without_pending' });
    expect(processEditorTurn(v3StoppedSession(), { messageId: 'm-confirm-stopped', text: '确认', receivedAt: at }).outcome)
      .toEqual({ type: 'confirm_without_pending', toPhase: 'stopped', code: 'confirmation_without_pending' });
    expect(processEditorTurn(v3StoppedSession(), { messageId: 'm-retry', text: '继续', receivedAt: at }).outcome)
      .toEqual({ type: 'instruction', toPhase: 'working', startRun: 'instruction' });
  });

  it('routes cancellation before any binding and leaves batch closure to the UI', () => {
    const p = processEditorTurn(v3QuestionSession(), { messageId: 'm-cancel', text: '取消', receivedAt: at });
    expect(p.outcome).toEqual({ type: 'cancel', toPhase: 'stopped', stopCode: 'run_cancelled' });
    expect(p.turn.intent).toBe('cancel');
    expect(p.batchTransition).toBeNull();
    expect(p.decisions).toEqual([]);
    expect(p.answers).toEqual([]);
  });

  it('ignores an empty message without appending evidence', () => {
    const p = processEditorTurn(v3QuestionSession(), { messageId: 'm-empty', text: '   ', receivedAt: at });
    expect(p.outcome).toEqual({ type: 'ignored', toPhase: 'waiting_editor', reason: 'empty_message' });
    expect(p.evidenceToAppend).toBeNull();
  });
});

describe('processEditorTurn shadow: answer binding', () => {
  it('binds explicit slots for every item and starts the answers run', () => {
    const s = v3QuestionSession(); const before = stableJson(s);
    const p = processEditorTurn(s, {
      messageId: 'm-slots', text: '', receivedAt: at,
      slots: [{ gapId: 'gap-attendance', value: '30 人' }, { gapId: 'gap-date', value: '10 月 20 日' }],
    });
    expect(p.outcome).toEqual({ type: 'answers_bound', toPhase: 'working', startRun: 'answers' });
    expect(p.turn).toMatchObject({ intent: 'answer', bindingStatus: 'bound', bindingRefs: ['gap-attendance', 'gap-date'], replyToBatchId: 'q-1' });
    expect(p.answers.map(answer => [answer.gapId, answer.method, answer.value, answer.choice])).toEqual([
      ['gap-attendance', 'explicit_slot', '30 人', 'supply'],
      ['gap-date', 'explicit_slot', '10 月 20 日', 'supply'],
    ]);
    expect(p.answers.every(answer => answer.createdAt === at && answer.batchId === 'q-1')).toBe(true);
    expect(p.decisions).toEqual([]);
    expect(p.batchTransition).toEqual({ batchId: 'q-1', status: 'answered' });
    expect(p.clarification).toBeNull();
    expect(stableJson(s)).toBe(before);
  });

  it('binds numbered segments in batch item order', () => {
    const p = processEditorTurn(v3QuestionSession(), { messageId: 'm-numbered', text: '1. 30 人\n2. 10 月 20 日', receivedAt: at });
    expect(p.outcome.type).toBe('answers_bound');
    expect(p.answers.map(answer => [answer.gapId, answer.method, answer.value])).toEqual([
      ['gap-attendance', 'numbered', '30 人'],
      ['gap-date', 'numbered', '10 月 20 日'],
    ]);
  });

  it('closes a partially answered batch and opens clarification only for the unbound items', () => {
    const p = processEditorTurn(v3QuestionSession(), { messageId: 'm-partial', text: '1. 30 人', receivedAt: at });
    expect(p.outcome).toEqual({ type: 'clarification', toPhase: 'waiting_editor' });
    expect(p.turn).toMatchObject({ intent: 'answer', bindingStatus: 'partial', bindingRefs: ['gap-attendance'] });
    expect(p.batchTransition).toEqual({ batchId: 'q-1', status: 'partially_answered' });
    expect(p.clarification).toEqual({ batchId: 'q-1', gapIds: ['gap-date'], reasonCode: 'reply_partial', understood: ['30 人'] });
    expect(p.answers.map(answer => answer.gapId)).toEqual(['gap-attendance']);
  });

  it('never re-asks an unmapped multi-item reply; it becomes needs_assignment and additive directives', () => {
    const p = processEditorTurn(v3QuestionSession(), { messageId: 'm-freeform', text: 'A 是 30 人 B 是 10 月 20 日', receivedAt: at });
    expect(p.outcome).toEqual({ type: 'needs_assignment', toPhase: 'waiting_editor' });
    expect(p.turn).toMatchObject({ intent: 'answer', bindingStatus: 'needs_assignment', bindingRefs: [], replyToBatchId: 'q-1' });
    expect(p.answers).toEqual([]);
    expect(p.batchTransition).toBeNull();
    expect(p.directiveMode).toBe('additive');
  });

  it('records a deferral for 无法提供 and still binds the rest', () => {
    const p = processEditorTurn(v3QuestionSession(), { messageId: 'm-defer', text: '1. 无法提供\n2. 10 月 20 日', receivedAt: at });
    expect(p.outcome.type).toBe('answers_bound');
    expect(p.answers.map(answer => [answer.gapId, answer.choice, answer.value])).toEqual([
      ['gap-attendance', 'defer', undefined],
      ['gap-date', 'supply', '10 月 20 日'],
    ]);
    expect(p.decisions.map(decision => [decision.gapId, decision.kind])).toEqual([['gap-attendance', 'defer']]);
  });

  it('maps a single authorization item to grant/deny choices', () => {
    const base = v3QuestionSession();
    const permissionGap = { ...base.gaps[0], id: 'gap-photo', gapClass: 'authorization' as const, owner: 'editor' as const, origin: { kind: 'permission' as const, id: 'crit-photo' }, label: '讲师照片授权', reason: '需要使用讲师照片' };
    const batch: QuestionBatch = {
      id: 'q-photo', createdAtMessageId: 'm1', gapIds: ['gap-photo'], status: 'active',
      items: [{ gapId: 'gap-photo', gapClass: 'authorization', subject: '讲师', requested: '是否可以使用讲师照片', why: '用于封面', expected: 'authorization', answerSlot: 'slot-photo' }],
    };
    const s = { ...base, gaps: [permissionGap], questionBatches: [batch], activeBatchId: 'q-photo' };
    const granted = processEditorTurn(s, { messageId: 'm-grant', text: '同意', receivedAt: at });
    expect(granted.answers[0]).toMatchObject({ method: 'editor_assigned', choice: 'grant' });
    const denied = processEditorTurn(s, { messageId: 'm-deny', text: '不同意', receivedAt: at });
    expect(denied.answers[0]).toMatchObject({ method: 'editor_assigned', choice: 'deny' });
  });

  it('does not bind a reply addressed to another batch', () => {
    const p = processEditorTurn(v3QuestionSession(), { messageId: 'm-old-batch', text: '30 人', replyToBatchId: 'q-old', receivedAt: at });
    expect(p.turn.replyToBatchId).toBe('q-old');
    expect(p.outcome.type).toBe('needs_assignment');
    expect(p.answers).toEqual([]);
  });
});

describe('processEditorTurn shadow: answer confirmation', () => {
  it('turns 确认 over an active batch into one defer decision per item and starts the deferred run', () => {
    const p = processEditorTurn(v3QuestionSession(), { messageId: 'm-confirm-batch', text: '确认', receivedAt: at });
    expect(p.outcome).toEqual({ type: 'answer_confirmation', toPhase: 'working', startRun: 'deferred' });
    expect(p.turn).toMatchObject({ intent: 'confirm_answers', bindingStatus: 'none', bindingRefs: [] });
    expect(p.answers).toEqual([]);
    expect(p.decisions.map(decision => [decision.gapId, decision.kind, decision.by])).toEqual([
      ['gap-attendance', 'defer', 'editor'],
      ['gap-date', 'defer', 'editor'],
    ]);
    expect(p.batchTransition).toEqual({ batchId: 'q-1', status: 'answered' });
    expect(p.directiveMode).toBe('none');
  });

  it('accepts 继续/就这样 as answer confirmation while a batch is active (design §5.1)', () => {
    for (const text of ['继续', '就这样', '好的']) {
      expect(processEditorTurn(v3QuestionSession(), { messageId: 'm-' + text, text, receivedAt: at }).outcome.type).toBe('answer_confirmation');
    }
  });
});

describe('processEditorTurn shadow: invariants', () => {
  it('is read-only across binding, confirmation, clarification and control messages', () => {
    const s = v3QuestionSession(); const before = stableJson(s);
    const messages = [
      { messageId: 'i-1', text: '30 人' },
      { messageId: 'i-2', text: '1. 30 人\n2. 10 月 20 日' },
      { messageId: 'i-3', text: '确认' },
      { messageId: 'i-4', text: '取消' },
      { messageId: 'i-5', text: '' },
    ];
    for (const message of messages) expect(processEditorTurn(s, { ...message, receivedAt: at })).not.toBeInstanceOf(Promise);
    expect(stableJson(s)).toBe(before);
  });

  it('detects a messageId already present in evidence and creates no duplicate evidence', () => {
    const v2 = v2QuestionSession();
    v2.evidence.push({ id: 'dup', revision: 1, text: '已经落过证据', contentHash: hashText('已经落过证据'), kind: 'editor_message', provenance: { messageId: 'dup' }, context: { scenario: 'real' } });
    const s = migrateEditorialSessionV2ToV3(v2);
    const p = processEditorTurn(s, { messageId: 'dup', text: '重复消息', receivedAt: at });
    expect(p.duplicate).toBe(true);
    expect(p.evidenceToAppend).toBeNull();
    expect(p.outcome).toEqual({ type: 'duplicate', toPhase: 'waiting_editor', batchId: 'q-1' });
    expect(p.answers).toEqual([]);
    expect(p.decisions).toEqual([]);
  });

  it('opens an intake question when no executable task contract exists', () => {
    const p = processEditorTurn(v3IntakeSession(), { messageId: 'm-intake', text: '写一篇活动报道', receivedAt: at });
    expect(p.outcome).toEqual({ type: 'intake_question', toPhase: 'waiting_editor' });
    expect(p.turn.intent).toBe('instruction');
    expect(p.directiveMode).toBe('normal');
  });
});
