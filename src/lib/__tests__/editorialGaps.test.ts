import { describe, it, expect } from 'vitest';
import { createEditorialSession, hashText, type EvidenceRef } from '../editorialTypes';
import { deriveGaps, buildQuestion, legacyFieldsToGapIds, applyGapChoice } from '../editorialGaps';
const fixture = () => {
  const s = createEditorialSession('s'), text = 'Ada quote. Ben quote. Omit Ben quote.';
  s.evidence = [{ id: 'e', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: { messageId: 'm1' }, context: { scenario: 'real' } }];
  const ref = (quote: string): EvidenceRef => ({ evidenceId: 'e', revision: 1, start: text.indexOf(quote), end: text.indexOf(quote) + quote.length, quote });
  s.scopes = ['Ada','Ben'].map(id => ({ id, kind: 'person', label: id, anchors: [ref(id)], qualifiers: [], identity: 'aligned' }));
  s.task.requirements = ['Ada','Ben'].map(id => ({ id: 'quote-'+id, selector: { scopeId: id, predicate: 'quotation' }, label: id+'可公开原话', reason: '采访稿需要此人的原话', refs: [ref(id)], necessity: 'blocking', resolution: 'omit_or_replace' }));
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
    expect(() => legacyFieldsToGapIds(s, ['detail'])).toThrow('ambiguous_legacy_fields');
  });
  it('does not repeat an asked gap until another editor message arrives', () => {
    const { s } = fixture(); s.gaps = deriveGaps(s).map(g => ({ ...g, state: 'asked', askedAtMessageId: 'm1' }));
    expect(() => buildQuestion(s, [s.gaps[0].id])).toThrow('awaiting_editor_reply');
    const text = 'Please clarify'; s.evidence.push({ ...s.evidence[0], id: 'e2', text, contentHash: hashText(text), provenance: { messageId: 'm2' } });
    expect(buildQuestion(s, [s.gaps[0].id]).items).toHaveLength(1);
  });
  it('keeps all gaps when asking a maximum-six batch and stable IDs survive reordering', () => {
    const { s } = fixture(); s.task.requirements = Array.from({ length: 8 }, (_, i) => ({ ...s.task.requirements[0], id: 'r'+i, selector: { scopeId: 'Ada', predicate: 'item'+i }, label: '信息'+i }));
    const gaps = deriveGaps(s); const q = buildQuestion(s, gaps.map(g => g.id)); expect(q.items).toHaveLength(6); expect(q.remainingGapIds).toHaveLength(2); expect(s.task.requirements).toHaveLength(8);
    s.task.requirements.reverse(); expect(new Set(deriveGaps(s).map(g => g.id))).toEqual(new Set(gaps.map(g => g.id)));
  });
  it('records only an explicit editor omission, never model resolution', () => {
    const { s, ref } = fixture(); s.task = { ...s.task, objective: '采访', revision: 1, intents: ['interview'] };
    const next = applyGapChoice(s, deriveGaps(s)[1].id, 'omit', [ref('Omit Ben quote')]);
    expect(deriveGaps(next).find(g => g.requirementId === 'quote-Ben')?.state).toBe('waived'); expect(deriveGaps(next).find(g => g.requirementId === 'quote-Ada')?.state).toBe('open');
  });
});
