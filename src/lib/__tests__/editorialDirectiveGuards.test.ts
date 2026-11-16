import { describe, it, expect } from 'vitest';
import { createEditorialSession, hashText, type EvidenceRef, type InformationRequirement, type RequiredSource } from '../editorialTypes';
import { directivesToPatches, type Directive } from '../editorialDirectives';
function fixture(text: string) {
  const s = createEditorialSession('s');
  s.evidence = [{ id: 'e', revision: 1, contentHash: hashText(text), text, kind: 'editor_message', provenance: { messageId: 'm' }, context: { scenario: 'real' } }];
  const ref = (quote: string): EvidenceRef => ({ evidenceId: 'e', revision: 1, start: text.indexOf(quote), end: text.indexOf(quote) + quote.length, quote });
  return { s, ref };
}
const directive = (partial: Partial<Directive> & { kind: Directive['kind']; text: string; refs: EvidenceRef[] }): Directive => ({ confidence: 1, ...partial });
describe('directive guards', () => {
  it('treats "可以先交/不阻断交付" as a permission waiver, not an authorization question', () => {
    const text = '简讯可以先交（统计口径未定不阻断交付）。'; const { s, ref } = fixture(text);
    const result = directivesToPatches(s, [directive({ kind: 'authorization', text: '简讯可以先交（统计口径未定不阻断交付）', refs: [ref('简讯可以先交')], subjectId: 'authorization:abc', use: '简讯发布' })], []);
    expect(result.taskPatch.criteria).toEqual([]);
    expect(result.diagnostics.some(item => item.code === 'permission_not_required')).toBe(true);
  });
  it('asks for a figure the editor explicitly asked to check and supply, even without a model-supplied whyNeeded', () => {
    const text = '先检查现有统计能否支撑，不够就列明该补哪两项。'; const { s, ref } = fixture(text);
    const result = directivesToPatches(s, [directive({ kind: 'missing_value', text: '开头必须有经核验的实际结项队伍总数和参与学生总人数', label: '实际结项队伍总数和参与学生总人数', refs: [ref('该补哪两项')] })], []);
    const requirements = result.taskPatch.requirements as InformationRequirement[];
    expect(requirements).toHaveLength(1);
    expect(requirements[0].whyNeeded).toContain('核对');
    expect(requirements[0].askable).not.toBe(false);
    expect(result.diagnostics.some(item => item.code === 'requirement_without_dependency')).toBe(false);
  });
  it('reuses a required source with an identical title instead of creating an unreadable duplicate', () => {
    const text = '参考工作台的团学组织招新导读和理论科创中心材料。'; const { s, ref } = fixture(text);
    const result = directivesToPatches(s, [
      directive({ kind: 'source', text: '团学组织招新导读', title: '团学组织招新导读', refs: [ref('团学组织招新导读')] }),
      directive({ kind: 'source', text: '团学组织招新导读', title: '团学组织招新导读', refs: [ref('团学组织招新导读')] }),
    ], []);
    expect((result.taskPatch.requiredSources as RequiredSource[])).toHaveLength(1);
    expect(result.diagnostics.some(item => item.code === 'source_duplicate_title')).toBe(true);
  });
});
