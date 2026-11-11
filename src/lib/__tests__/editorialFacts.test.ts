import { describe, it, expect } from 'vitest';
import { createEditorialSession, hashText, type EvidenceRef, type FactClaim, type EditorialSession, type MetricSpec } from '../editorialTypes';
import { resolveFacts, validateEvidenceRef, alignFactScopes } from '../editorialFacts';
function fixture(names = ['Orchid', 'Pine'], values = ['Tuesday', 'Friday']) {
  const s = createEditorialSession('s');
  const text = `${names[0]} ${values[0]}. ${names[1]} ${values[1]}.`;
  s.evidence = [{ id: 'e', revision: 1, contentHash: hashText(text), text, kind: 'editor_message', provenance: { messageId: 'm' }, context: { scenario: 'simulation' } }];
  const ref = (value: string): EvidenceRef => ({ evidenceId: 'e', revision: 1, start: text.indexOf(value), end: text.indexOf(value) + value.length, quote: value });
  s.scopes = names.map((name, i) => ({ id: `s${i}`, kind: 'event', label: name, anchors: [ref(name)], qualifiers: [], identity: 'aligned' }));
  s.claims = values.map((value, i): FactClaim => ({ id: `c${i}`, selector: { scopeId: `s${i}`, predicate: 'time' }, value, refs: [ref(value)], epistemic: 'supported', visibility: 'public', statusBasis: [] }));
  return { s, ref };
}
describe('scoped evidence resolution', () => {
  it.each([[['Orchid', 'Pine'], ['Tuesday', 'Friday']], [['Nova', 'Sol'], ['03:00', '19:15']]])('preserves unrelated scopes regardless of names, numbers and source order', (names, values) => {
    const { s } = fixture(names, values); expect(resolveFacts(s).conflicts).toEqual([]); expect(resolveFacts(s).claims).toHaveLength(2);
    s.claims.reverse(); expect(resolveFacts(s).conflicts).toEqual([]);
    s.claims[0].selector.scopeId = s.claims[1].selector.scopeId; expect(resolveFacts(s).conflicts[0].kind).toBe('conflict');
  });
  it('does not ignore provisional scope ambiguity', () => {
    const { s } = fixture(); s.scopes.forEach(scope => { scope.identity = 'provisional'; }); s.task.targetScopes = ['s0', 's1'];
    expect(resolveFacts(s).conflicts.filter(g => g.kind === 'scope')).toHaveLength(2);
  });
  it('only merges scopes using evidence from both anchors', () => {
    const { s, ref } = fixture(); s.alignments = [{ leftId: 's0', rightId: 's1', refs: [ref('Orchid'), ref('Pine')] }];
    expect(alignFactScopes(s).scopeIds.get('s1')).toBe('s0'); expect(resolveFacts(s).conflicts).toHaveLength(1);
    s.alignments[0].refs = [ref('Orchid')]; expect(alignFactScopes(s).diagnostics[0].code).toBe('invalid_alignment');
  });
  it('preserves different metric units, stages, populations and approximate precision', () => {
    const { s } = fixture(); s.claims[1].selector.scopeId = 's0';
    const metric: MetricSpec = { measure: 'participants', unit: 'people', population: 'staff', phase: 'planned', aggregation: 'total', precision: 'exact' };
    for (const change of [{ unit: 'teams' }, { phase: 'completed' }, { population: 'visitors' }, { precision: 'approximate' as const }]) {
      s.claims[0].selector.metric = metric; s.claims[1].selector.metric = { ...metric, ...change }; expect(resolveFacts(s).conflicts).toEqual([]);
    }
  });
  it('diagnoses offsets, stale revisions, content tampering and capacity instead of dropping silently', () => {
    const { s, ref } = fixture(); expect(validateEvidenceRef(s, ref('Tuesday'))).toBe(true);
    s.claims[0].refs[0].start++; expect(resolveFacts(s).diagnostics.some(d => d.code === 'invalid_reference')).toBe(true);
    expect(validateEvidenceRef(s, { ...ref('Friday'), revision: 0 })).toBe(false);
    s.evidence[0].text += 'tamper'; expect(validateEvidenceRef(s, ref('Friday'))).toBe(false);
    const many = fixture().s; many.claims = Array.from({ length: 257 }, (_, i) => ({ ...many.claims[0], id: `c${i}` }));
    expect(resolveFacts(many).diagnostics[0].code).toBe('context_capacity'); expect(resolveFacts(many).claims).toEqual([]);
  });
  it('requires relevant status basis, never a scenario trust exemption', () => {
    const { s, ref } = fixture(); s.claims[0].epistemic = 'pending';
    expect(resolveFacts(s).diagnostics.some(d => d.code === 'missing_status_basis')).toBe(true);
    s.claims[0].statusBasis = [ref('Orchid Tuesday')]; expect(resolveFacts(s).claims.find(c => c.id === 'c0')?.epistemic).toBe('pending');
    s.claims[0].statusBasis = [ref('Pine Friday')]; expect(resolveFacts(s).diagnostics.some(d => d.code === 'missing_status_basis')).toBe(true);
  });
  it('supersedes only a targeted same-selector claim with editor evidence, not later unrelated facts', () => {
    const { s, ref } = fixture(); s.claims[1].selector.scopeId = 's0';
    s.claims[1].supersedes = ['c0']; expect(resolveFacts(s).conflicts).toHaveLength(1);
    s.claims[1].statusBasis = [ref('Pine Friday')]; expect(resolveFacts(s).claims.map(c => c.id)).toEqual(['c1']);
    s.claims[1].selector.scopeId = 's1'; expect(resolveFacts(s).claims).toHaveLength(2); expect(resolveFacts(s).diagnostics.some(d => d.code === 'invalid_supersedes')).toBe(true);
  });
  it('legacy generated text cannot support its own facts', () => {
    const { s } = fixture(); s.evidence[0].kind = 'legacy_draft';
    expect(resolveFacts(s).claims.every(c => c.epistemic === 'unknown')).toBe(true);
    expect(resolveFacts(s).diagnostics.some(d => d.code === 'legacy_not_evidence')).toBe(true);
  });
  it('permissions are separate from truth and restricted states remain restricted', () => {
    const { s, ref } = fixture(); s.permissions = [{ id: 'p', subjectId: 's0', uses: [{ channel: 'web', purpose: 'illustration', identity: 'not_applicable' }], state: 'denied', refs: [ref('Orchid Tuesday')] }];
    const r = resolveFacts(s); expect(r.claims[0].epistemic).toBe('supported'); expect(r.permissions[0].state).toBe('denied');
  });
});
export function scopedFixture(): EditorialSession { return fixture().s; }
