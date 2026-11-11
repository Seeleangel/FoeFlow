import { describe, it, expect, vi } from 'vitest';
import { replayCases, replay, type ReplayCase } from './editorialReplayFixtures';
import { runEditorialController, type EditorialModelPort } from '../editorialController';
import { legacyEditorialSession, legacyEditorialResult } from '../editorialAgent';
import { applyToolEvents } from '../editorialState';
import { hashText, type EditorialSession } from '../editorialTypes';
const scripted = (id: string, body: string, dirty?: string): ReplayCase => {
  const c = replayCases.find(c => c.id === id)!;
  const responses = [{ stage: 'decide', response: JSON.stringify({ tool: 'write', instructions: 'Use the grounded public facts' }) }, { stage: 'write', response: JSON.stringify({ title: 'Public article', bodyMarkdown: dirty ?? body }) }, ...(dirty ? [{ stage: 'decide', response: JSON.stringify({ tool: 'write', instructions: 'Repair public constraints' }) }, { stage: 'write', response: JSON.stringify({ title: 'Public article', bodyMarkdown: body }) }] : []),{ stage: 'decide', response: '{"tool":"review"}' },{ stage: 'review', response: '{"blocking":[],"notes":[]}' }];
  return { ...c, input: { ...c.input, operator_events: responses.map(response => '模拟响应：' + JSON.stringify(response)) } };
};
describe('D02/D04/H04/H05 deterministic behavior rechecks (not live quality scores)', () => {
  it('D02 asks four missing action fields, then merges only the supplied answers without library search', async () => {
    const c = replayCases.find(c => c.id === 'D02')!, sources = { search: vi.fn(async () => []), read: vi.fn(async () => undefined) }; let answered = false;
    const model: EditorialModelPort = async ({ stage, data }) => {
      const evidence = data.evidence as EditorialSession['evidence'] | undefined, task = data.task as EditorialSession['task'];
      if (stage === 'preflight') {
        const original = evidence![0], firstRefs = [{ evidenceId: original.id, revision: original.revision, start: 0, end: original.text.length, quote: original.text }];
        const e = answered ? evidence![evidence!.length-1] : original; const refs = [{ evidenceId: e.id, revision: e.revision, start: 0, end: e.text.length, quote: e.text }];
        const values = answered ? ['2026 年 12 月 8 日 19:00','知行楼 205 室','学院公众号菜单「讲座报名」','12 月 7 日 20:00'] : []; const predicates = ['time','location','registration_channel','registration_deadline'];
        return JSON.stringify({ factPatch: { scopes: [{ id: 'lecture', kind: 'event', label: '讲座', anchors: firstRefs, qualifiers: [], identity: 'aligned' }], claims: values.map((value,i) => ({ id: predicates[i], selector: { scopeId: 'lecture', predicate: predicates[i] }, value, refs, statusBasis: [], epistemic: 'supported', visibility: 'public' })) }, ...(!answered ? { taskPatch: { baseRevision: task.revision, refs: firstRefs, objective: '讲座报名通知', intents: ['call_to_action'], requirements: predicates.map((predicate,i) => ({ id: predicate, selector: { scopeId: 'lecture', predicate }, label: ['活动时间','活动地点','报名渠道','报名截止时间'][i], reason: '读者需要准确行动信息', refs: firstRefs, necessity: 'blocking', resolution: 'supply_fact' })) } } : {}) });
      }
      if (stage === 'decide') return answered && !data.draft ? '{"tool":"write","instructions":"Write supplied facts"}' : answered ? '{"tool":"review"}' : '{"tool":"ask","fields":["detail"]}';
      if (stage === 'write') return JSON.stringify({ title: '讲座报名', bodyMarkdown: '从校园观察到小型研究讲座面向本科生，安排研究问题设计和现场示范，名额 30 人。\n2026 年 12 月 8 日 19:00 在知行楼 205 室举行。请于 12 月 7 日 20:00 前通过学院公众号菜单「讲座报名」提交。' });
      if (stage === 'review') return '{"blocking":[],"notes":[]}'; throw new Error('fixture_error:'+stage);
    };
    const first = await runEditorialController({ session: legacyEditorialSession({ messages: [{ role: 'user', content: c.input.initial_message! }], previousDraft: '' }), model, signal: new AbortController().signal, sources }); expect(first.type).toBe('question'); expect(first.session.candidate).toBeUndefined(); expect(first.session.gaps.filter(g => g.state === 'asked')).toHaveLength(4);
    answered = true; const text = c.input.followups[0].message; const session = applyToolEvents(first.session,[{ sessionId: first.session.sessionId, runId: first.session.activeRunId!, expectedRevision: first.session.revision, type: 'evidence_loaded', records: [{ id: 'answer', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: { messageId: 'answer' }, context: { scenario: 'real' } }], receipts: [] }]);
    const second = await runEditorialController({ session, model, signal: new AbortController().signal, sources }); expect(second.type).toBe('draft'); for (const value of ['30 人','205 室','讲座报名','12 月 7 日 20:00']) expect(second.session.candidate?.bodyMarkdown).toContain(value); expect(sources.search).not.toHaveBeenCalled();
  });
  it('D04 reads the current material; current editor schedule wins over historical placeholders', async () => {
    const { outcome } = await replay(scripted('D04','本期读书会于2026 年 12 月 9 日 18:30 在知行楼 204 室举行。\n本期阅读《乡土中国》第一章，名额 24 人，每人带一个阅读问题。')); expect(outcome.type).toBe('draft'); expect(outcome.session.readReceipts).toHaveLength(1); expect(outcome.session.candidate?.bodyMarkdown).not.toMatch(/小王子|40 人|101 室/);
  });
  it('H04 excludes a pending quote while retaining a concrete editor-side check note across rewriting', async () => {
    const body = '素描组和摄影组参加的校园展览于2026 年 12 月 4 日在白榆展厅开展。'; const { outcome } = await replay(scripted('H04',body,body+'这是学院规模最大的展览。')); expect(outcome.type).toBe('draft'); expect(outcome.session.candidate?.bodyMarkdown).not.toContain('规模最大'); const adapted = legacyEditorialResult(outcome); expect(adapted.type).toBe('draft'); if (adapted.type === 'draft') expect(adapted.handoff.notes.some(note => note.includes('规模最大') && note.includes('核实'))).toBe(true);
  });
  it('H05 verifies closing time and booking condition in the actual first HTML body paragraph', async () => {
    const { outcome } = await replay(scripted('H05','澄湾成果展于2026 年 12 月 20 日 16:00 闭展，免费开放，无需预约。\n展览有「教学实验」「学生作品」两个展区，服务台提供纸质导览图。')); expect(outcome.type).toBe('draft'); const first = new DOMParser().parseFromString(outcome.session.layout!.html,'text/html').querySelector('article p')!; for (const value of ['12 月 20 日 16:00','无需预约','免费开放']) expect(first.textContent).toContain(value); expect(outcome.session.candidate?.bodyMarkdown).toContain('纸质导览图');
  });
});
