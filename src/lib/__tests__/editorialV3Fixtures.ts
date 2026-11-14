import { createEditorialSession, type EditorialSession } from '../editorialTypes';
import { migrateEditorialSessionV2ToV3 } from '../editorialSessionMigration';
import { uiReady } from './editorialUiFixture';

/** v2 waiting_input session with an in-flight two-item fact batch and output gates. */
export function v2QuestionSession(): EditorialSession {
  const s = uiReady();
  s.scopes = [{ id: 'event', kind: 'event', label: '秋季读书会', qualifiers: [], anchors: [], identity: 'aligned' }];
  s.gaps = [
    { id: 'gap-attendance', requirementId: 'req-attendance', selector: { scopeId: 'event', predicate: 'attendance' }, kind: 'missing', label: '出席人数', reason: '报道需要具体出席人数', state: 'asked', blocking: true, alternatives: [], resolutionClaimIds: [], askedAtMessageId: 'm1' },
    { id: 'gap-date', requirementId: 'req-date', selector: { scopeId: 'event', predicate: 'date' }, kind: 'missing', label: '活动日期', reason: '报道需要活动日期', state: 'asked', blocking: true, alternatives: [], resolutionClaimIds: [], askedAtMessageId: 'm1' },
  ];
  s.lastQuestion = {
    id: 'q-1', gapIds: ['gap-attendance', 'gap-date'],
    items: s.gaps.map(gap => ({ gapId: gap.id, subject: '秋季读书会', requested: gap.label, why: gap.reason, options: [] })),
  };
  s.phase = 'waiting_input';
  s.committed = { artifact: structuredClone(s.candidate!), layout: structuredClone(s.layout!) };
  return s;
}

export const v3QuestionSession = () => migrateEditorialSessionV2ToV3(v2QuestionSession());
export const v3ReadySession = () => migrateEditorialSessionV2ToV3(uiReady());
export const v3WorkingSession = () => migrateEditorialSessionV2ToV3({ ...uiReady(), phase: 'gathering' as const });
export const v3StoppedSession = () => migrateEditorialSessionV2ToV3({ ...uiReady(), phase: 'incomplete' as const, lastStop: { code: 'deadline_exceeded', unresolvedIds: [], nextActions: ['保留当前候选；由编辑选择重试或补充。'] } });
export const v3IntakeSession = () => migrateEditorialSessionV2ToV3(createEditorialSession('empty'));
