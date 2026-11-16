import { describe, it, expect } from 'vitest';
import { createEditorialSession, hashText, type EvidenceRef } from '../editorialTypes';
import { deriveGaps, buildQuestion, applyGapChoice } from '../editorialGaps';
import { parseContentBlocks } from '../editorialDocument';
const withCandidate = (s: ReturnType<typeof createEditorialSession>, bodyMarkdown: string) => {
  s.candidate = { schemaVersion: 2, id: 'd', revision: 1, title: '专题', bodyMarkdown, contentHash: hashText('专题\n' + bodyMarkdown), blocks: parseContentBlocks(bodyMarkdown), origin: 'model', claimLinks: [], assets: [], editorialNotes: [] };
  return s;
};
const fixture = () => {
  const s = createEditorialSession('s'), text = 'Ada quote. Ben quote. Omit Ben quote.';
  s.evidence = [{ id: 'e', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: { messageId: 'm1' }, context: { scenario: 'real' } }];
  const ref = (quote: string): EvidenceRef => ({ evidenceId: 'e', revision: 1, start: text.indexOf(quote), end: text.indexOf(quote) + quote.length, quote });
  s.scopes = ['Ada','Ben'].map(id => ({ id, kind: 'person', label: id, anchors: [ref(id)], qualifiers: [], identity: 'aligned' }));
  s.task.requirements = ['Ada','Ben'].map(id => ({ id: 'quote-'+id, selector: { scopeId: id, predicate: 'quotation' }, label: id+'可公开原话', reason: '采访稿需要此人的原话', whyNeeded: '采访稿需要此人的原话', refs: [ref(id)], necessity: 'blocking', resolution: 'omit_or_replace' }));
  return { s, ref };
};
describe('independent gaps', () => {
  it('only exact scoped evidence closes its own requirement and unrelated detail cannot erase others', () => {
    const { s, ref } = fixture(); s.claims = [{ id: 'c', selector: { scopeId: 'Ada', predicate: 'quotation' }, value: 'Ada quote', refs: [ref('Ada quote')], statusBasis: [], epistemic: 'supported', visibility: 'public' }];
    const gaps = deriveGaps(s); expect(gaps.find(g => g.requirementId === 'quote-Ada')?.state).toBe('resolved'); expect(gaps.find(g => g.requirementId === 'quote-Ben')?.state).toBe('open');
    s.claims[0].selector.predicate = 'detail'; expect(deriveGaps(s).filter(g => g.blocking && g.state === 'open')).toHaveLength(2);
  });
  it('asks only selected gaps, names the object/purpose and offers explicit alternatives', () => {
    const { s } = fixture(); const gaps = deriveGaps(s), question = buildQuestion(s, [gaps[1].id]);
    expect(question.gapIds).toEqual([gaps[1].id]); expect(question.items[0].subject).toBe('Ben'); expect(question.items[0].requested).toContain('原话'); expect(question.items[0].options.length).toBeGreaterThan(0);
  });
  it('does not repeat a gap while its batch is active and allows it after the batch closes', () => {
    const { s } = fixture(); const gaps = deriveGaps(s); const batch = { id: 'q-1', createdAtMessageId: 'm1', gapIds: [gaps[0].id], status: 'active' as const, items: [{ gapId: gaps[0].id, gapClass: 'fact' as const, subject: 'Ada', requested: gaps[0].label, why: gaps[0].reason, expected: 'free_text' as const, answerSlot: 'slot-1' }] };
    s.gaps = gaps; s.questionBatches = [batch]; s.activeBatchId = batch.id;
    expect(() => buildQuestion(s, [gaps[0].id])).toThrow('awaiting_editor_reply');
    s.questionBatches = [{ ...batch, status: 'answered' }]; delete s.activeBatchId;
    expect(buildQuestion(s, [gaps[0].id]).items).toHaveLength(1);
  });
  it('keeps all gaps when asking a maximum-three batch and stable IDs survive reordering', () => {
    const { s } = fixture(); s.task.requirements = Array.from({ length: 8 }, (_, i) => ({ ...s.task.requirements[0], id: 'r'+i, selector: { scopeId: 'Ada', predicate: 'item'+i }, label: '信息'+i }));
    const gaps = deriveGaps(s); const q = buildQuestion(s, gaps.map(g => g.id)); expect(q.items).toHaveLength(3); expect(q.remainingGapIds).toHaveLength(5); expect(s.task.requirements).toHaveLength(8);
    s.task.requirements.reverse(); expect(new Set(deriveGaps(s).map(g => g.id))).toEqual(new Set(gaps.map(g => g.id)));
  });
  it('records only an explicit editor omission, never model resolution', () => {
    const { s, ref } = fixture(); s.task = { ...s.task, objective: '采访', revision: 1, intents: ['interview'] };
    const next = applyGapChoice(s, deriveGaps(s)[1].id, 'omit', [ref('Omit Ben quote')]);
    expect(deriveGaps(next).find(g => g.requirementId === 'quote-Ben')?.state).toBe('waived'); expect(deriveGaps(next).find(g => g.requirementId === 'quote-Ada')?.state).toBe('open');
  });
});
describe('material shortfall becomes a blocking question', () => {
  const criterion = (id: string, verification: 'semantic' | 'human', severity: 'blocking' | 'advisory', instruction = '每位对谈者均须有一段真实相处经历和一句可公开引用的采访原话') => ({
    id, origin: 'user' as const, refs: [], severity, verification,
    rule: { kind: 'semantic' as const, instruction },
  });
  it('asks the editor instead of delivering a placeholder draft', () => {
    const { s } = fixture();
    s.task.criteria = [criterion('crit-quote', 'semantic', 'blocking'), criterion('crit-human', 'human', 'blocking')];
    withCandidate(s, '素材检查结果：缺项清单如下。素材卡明确说明当前材料没有提供，暂不能进入人物故事写作。');
    const gap = deriveGaps(s).find(item => item.requirementId === 'material_insufficiency');
    expect(gap).toMatchObject({ kind: 'missing', gapClass: 'fact', blocking: true, askable: true, state: 'open' });
    expect(gap!.label).toContain('素材');
    const question = buildQuestion(s, [gap!.id]);
    expect(question.items[0].requested).toContain('素材');
    expect(question.items[0].options).toEqual(['补充所需素材', '编辑确认按现有素材交付']);
  });
  it('asks when the draft says the existing statistics cannot support required verified numbers', () => {
    const { s } = fixture();
    s.task.criteria = [criterion('crit-check-stats', 'semantic', 'blocking', '先核查现有统计对两项数据的支撑，不足时明确列出需补的两项')];
    withCandidate(s, '经核查，现有统计尚不足以支撑这两项数据。因此，需补的两项数据为：实际结项队伍总数与参与学生总人数。在补齐前不以立项数替代。');
    expect(deriveGaps(s).some(item => item.requirementId === 'material_insufficiency')).toBe(true);
  });
  it('keeps a trailing editor note from blocking a draft that is otherwise complete', () => {
    const { s } = fixture();
    s.task.criteria = [criterion('crit-quote', 'semantic', 'blocking')];
    withCandidate(s, '新生资源导读：图书馆开放时间与借阅流程见正文。\n\n备注：「阅读原文」地址待补（地址尚未收到，需编辑补充）');
    expect(deriveGaps(s).some(item => item.requirementId === 'material_insufficiency')).toBe(false);
  });
  it('ignores advisory-only criteria and drafts that never admit a shortfall', () => {
    const { s } = fixture();
    // An advisory criterion alone, with no blocking fact still owed to the editor, does not stop delivery.
    s.task.requirements = s.task.requirements.map(requirement => ({ ...requirement, necessity: 'optional' as const }));
    s.task.criteria = [criterion('crit-quote', 'semantic', 'advisory')];
    withCandidate(s, '缺项清单：素材卡明确说明当前材料没有提供。');
    expect(deriveGaps(s).some(item => item.requirementId === 'material_insufficiency')).toBe(false);
    // A clean draft is not turned into a question even when a blocking criterion is semantic.
    s.task.requirements = fixture().s.task.requirements;
    s.task.criteria = [criterion('crit-quote', 'semantic', 'blocking')];
    withCandidate(s, '国际友谊日专题稿：两名同学的对谈记录如下。');
    expect(deriveGaps(s).some(item => item.requirementId === 'material_insufficiency')).toBe(false);
  });
});
