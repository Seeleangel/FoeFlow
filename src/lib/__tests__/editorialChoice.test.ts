import { describe, expect, it } from 'vitest';
import { createEditorialSession, hashText, type EditorialSession, type EvidenceRef, type Gap, type QuestionBatch as QuestionBatchV2 } from '../editorialTypes';
import type { QuestionBatch, QuestionItem } from '../editorialTypesV3';
import { deriveGaps } from '../editorialGaps';
import { openQuestionBatch } from '../editorialState';
import { processEditorTurn } from '../editorialTurnProcessor';
import { applyEditorTurn, batchFromQuestion, ensureQuestionState, sessionAsTurnView } from '../editorialTurnState';
import { validateAcceptance } from '../editorialAcceptance';
import { claimPublicationUses } from '../editorialFacts';
import { uiReady } from './editorialUiFixture';

function taskWithPermission(s: EditorialSession, refs: EvidenceRef[], withFact = false): EditorialSession {
  s.task = {
    schemaVersion: 2, revision: 1, objective: '活动报道', intents: ['inform'], targetScopes: [],
    requirements: withFact ? [{ id: 'attendance', selector: { scopeId: 'event', predicate: 'attendance' }, label: '出席人数', reason: '读者需要人数', whyNeeded: '读者需要人数', refs, necessity: 'blocking', resolution: 'supply_fact' }] : [],
    requiredSources: [], permittedOmissions: [], sourceWaivers: [], coverage: { status: 'validated', refs },
    criteria: [{ id: 'perm-photo', origin: 'user', refs, severity: 'blocking', verification: 'deterministic', rule: { kind: 'permission', subjectIds: ['photo'], use: 'publication', channel: 'public', identity: 'named' } }],
  };
  s.scopes = [
    { id: 'photo', kind: 'asset', label: '讲师照片', anchors: refs, qualifiers: [], identity: 'aligned' },
    ...(withFact ? [{ id: 'event', kind: 'event' as const, label: '活动', anchors: refs, qualifiers: [], identity: 'aligned' as const }] : []),
  ];
  return s;
}
function permissionSession(id: string, withFact = false): { session: EditorialSession; permissionGap: Gap; factGap?: Gap } {
  const session = createEditorialSession(id);
  const text = '请使用讲师照片做封面，写一篇活动报道。';
  session.evidence = [{ id: 'basis', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: { messageId: 'm1' }, context: { scenario: 'real' } }];
  session.evidenceRevision = 1;
  const refs: EvidenceRef[] = [{ evidenceId: 'basis', revision: 1, start: 0, end: text.length, quote: text }];
  taskWithPermission(session, refs, withFact);
  session.phase = 'gathering';
  const gaps = deriveGaps(session);
  return { session, permissionGap: gaps.find(candidate => candidate.kind === 'permission')!, ...(withFact ? { factGap: gaps.find(candidate => candidate.kind === 'missing')! } : {}) };
}
function submit(session: EditorialSession, gaps: string[], slots: { gapId: string; optionId?: string; value?: string; choice?: 'supply' | 'omit' | 'grant' | 'deny' | 'defer' }[]) {
  const message = { messageId: 'm-' + hashText(JSON.stringify(slots)).slice(0, 8), text: '', evidenceAlreadyAppended: false, slots };
  const projection = processEditorTurn(sessionAsTurnView(ensureQuestionState(session)), message);
  const applied = applyEditorTurn(session, message, projection);
  expect(gaps).toHaveLength(new Set(gaps).size);
  return { projection, applied };
}

describe('#8 structured options and grant/deny closure', () => {
  it('gives real permission gaps program-side allow/deny options', () => {
    const { session, permissionGap } = permissionSession('perm-options');
    const opened = openQuestionBatch(session, [permissionGap.id]);
    const batch = opened.questionBatches!.find(candidate => candidate.id === opened.activeBatchId)!;
    const options = batch.items[0].options!;
    expect(options).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '允许使用', choice: 'grant', isDefaultAffirmative: true }),
      expect.objectContaining({ label: '不允许使用', choice: 'deny' }),
    ]));
    expect(opened.evidence).toHaveLength(session.evidence.length);
    expect(opened.phase).toBe('waiting_input');
  });

  it('assigns option semantics from labels for non-permission batches', () => {
    const base = createEditorialSession('labels');
    const text = '素材说明';
    base.evidence = [{ id: 'e', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: {}, context: { scenario: 'real' } }];
    const gap: Gap = { id: 'g', requirementId: 'r', kind: 'missing', selector: { scopeId: 'event', predicate: 'p' }, label: '素材', reason: '需要决定', state: 'open', blocking: true, alternatives: [], resolutionClaimIds: [], gapClass: 'fact', askable: true };
    base.gaps = [gap];
    const question: QuestionBatchV2 = {
      id: 'q', gapIds: ['g'], items: [],
    };
    question.items = [{ gapId: 'g', subject: '素材', requested: '怎么处理', why: '需要决定', options: ['不允许使用某素材', '同意授权', '不含此素材', '其他'] }];
    const batch = batchFromQuestion(base, question);
    expect(batch.items[0].options?.map(option => [option.label, option.choice])).toEqual([
      ['不允许使用某素材', 'deny'], ['同意授权', 'grant'], ['不含此素材', 'omit'], ['其他', 'supply'],
    ]);
    expect(batch.items[0].options?.find(option => option.choice === 'grant')?.isDefaultAffirmative).toBe(true);
  });

  it('submits an optionId, writes an allowed Permission and never asks again', () => {
    const { session, permissionGap } = permissionSession('grant');
    const opened = openQuestionBatch(session, [permissionGap.id]);
    const batch = opened.questionBatches!.find(candidate => candidate.id === opened.activeBatchId)!;
    const allow = batch.items[0].options!.find(option => option.choice === 'grant')!;
    const { projection, applied } = submit(opened, [permissionGap.id], [{ gapId: permissionGap.id, optionId: allow.id, choice: 'grant' }]);
    expect(projection.answers[0]).toMatchObject({ gapId: permissionGap.id, optionId: allow.id, choice: 'grant' });
    expect(applied.session.answers?.[0]).toMatchObject({ optionId: allow.id, choice: 'grant' });
    expect(applied.session.permissions).toContainEqual(expect.objectContaining({ subjectId: 'photo', state: 'allowed' }));
    expect(deriveGaps(applied.session).find(gap => gap.id === permissionGap.id)?.state).toBe('resolved');
    expect(validateAcceptance(applied.session).checks.find(check => check.criterionId === 'perm-photo')).toMatchObject({ status: 'pass' });
    expect(applied.session.questionBatches?.filter(candidate => candidate.status === 'active')).toHaveLength(0);
    expect(applied.next).toBe('continue');
  });

  it('writes a deny GapDecision, closes the gap and passes the permission gate only when unused', () => {
    const { session, permissionGap } = permissionSession('deny');
    const opened = openQuestionBatch(session, [permissionGap.id]);
    const batch = opened.questionBatches!.find(candidate => candidate.id === opened.activeBatchId)!;
    const deny = batch.items[0].options!.find(option => option.choice === 'deny')!;
    const { applied } = submit(opened, [permissionGap.id], [{ gapId: permissionGap.id, optionId: deny.id, choice: 'deny' }]);
    expect(applied.session.gapDecisions).toContainEqual(expect.objectContaining({ gapId: permissionGap.id, kind: 'deny' }));
    expect(deriveGaps(applied.session).find(gap => gap.id === permissionGap.id)?.state).toBe('waived');
    expect(validateAcceptance(applied.session).checks.find(check => check.criterionId === 'perm-photo')).toMatchObject({
      status: 'pass', detail: '编辑选择按现有信息继续；正文未使用该素材',
    });
    const using = structuredClone(applied.session);
    using.candidate = { ...uiReady().candidate!, assets: [{ assetId: 'photo', slotId: 'slot', use: 'cover', state: 'included' }] };
    expect(validateAcceptance(using).checks.find(check => check.criterionId === 'perm-photo')).toMatchObject({ status: 'fail' });
  });

  it('passes a denied permission only when the candidate does not use the asset', () => {
    const { session } = permissionSession('denied-state');
    const refs = session.evidence.map(record => ({ evidenceId: record.id, revision: record.revision, start: 0, end: record.text.length, quote: record.text }));
    session.permissions = [{ id: 'deny', subjectId: 'photo', uses: claimPublicationUses(session, 'photo'), state: 'denied', refs }];
    expect(validateAcceptance(session).checks.find(check => check.criterionId === 'perm-photo')).toMatchObject({
      status: 'pass', detail: '编辑拒绝授权；正文未使用该素材',
    });
    session.candidate = { ...uiReady().candidate!, assets: [{ assetId: 'photo', slotId: 'slot', use: 'cover', state: 'included' }] };
    expect(validateAcceptance(session).checks.find(check => check.criterionId === 'perm-photo')).toMatchObject({ status: 'fail' });
  });

  it('binds authorization free text only for explicit grant/deny tokens', () => {
    const { session, permissionGap } = permissionSession('free-text');
    const items: QuestionItem[] = [{ gapId: permissionGap.id, gapClass: 'authorization', subject: '讲师照片', requested: '是否可以使用', why: '需要授权', expected: 'authorization', answerSlot: 'slot' }];
    const batch: QuestionBatch = { id: 'q-free', createdAtMessageId: 'm1', gapIds: [permissionGap.id], items, status: 'active' };
    const withBatch = { ...session, gaps: deriveGaps(session).map(gap => gap.id === permissionGap.id ? { ...gap, state: 'asked' as const, askHistory: [{ batchId: batch.id, messageId: 'm1', promptHash: 'h', reasonCode: 'opened' }] } : gap), questionBatches: [batch], activeBatchId: batch.id, phase: 'waiting_input' as const };
    const granted = processEditorTurn(sessionAsTurnView(withBatch), { messageId: 'm-allow', text: '允许在公众号使用', evidenceAlreadyAppended: true });
    expect(granted.answers[0]).toMatchObject({ gapId: permissionGap.id, choice: 'grant' });
    const unclear = processEditorTurn(sessionAsTurnView(withBatch), { messageId: 'm-unclear', text: '应该可以吧', evidenceAlreadyAppended: true });
    expect(unclear.answers).toEqual([]);
    expect(unclear.outcome.type).toBe('needs_assignment');
  });

  it('stores understood only for answered items and leaves unanswered whys intact', () => {
    const { session, permissionGap, factGap } = permissionSession('understood', true);
    const opened = openQuestionBatch(session, [factGap!.id, permissionGap.id]);
    const batch = opened.questionBatches!.find(candidate => candidate.id === opened.activeBatchId)!;
    const allow = batch.items.find(item => item.gapId === permissionGap.id)!.options!.find(option => option.choice === 'grant')!;
    const { applied } = submit(opened, [permissionGap.id], [{ gapId: permissionGap.id, optionId: allow.id, choice: 'grant' }]);
    const clarification = applied.session.questionBatches!.find(candidate => candidate.id === applied.session.activeBatchId)!;
    expect(clarification.understood).toEqual(['允许使用']);
    expect(clarification.items).toHaveLength(1);
    expect(clarification.items[0].gapId).toBe(factGap!.id);
    expect(clarification.items[0].why).toBe('读者需要人数');
    expect(clarification.items[0].why).not.toContain('已了解');
  });
});
