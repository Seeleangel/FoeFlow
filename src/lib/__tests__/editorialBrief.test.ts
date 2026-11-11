import { it, expect } from 'vitest';
import { createEditorialSession, hashText } from '../editorialTypes';
import { legacyBriefCandidates } from '../editorialBrief';
it('old detail facts become independent provisional candidates, never scoped authority', () => {
  const s = createEditorialSession('s'); const text = 'Alpha one Beta two';
  s.evidence = [{ id: 'e', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: {}, context: { scenario: 'unknown' } }];
  const result = legacyBriefCandidates({ mode: 'general', needed: ['detail'], facts: [{ field: 'detail', value: 'one', source: 'e', quote: 'Alpha one', status: 'known' }, { field: 'detail', value: 'two', source: 'e', quote: 'Beta two', status: 'known' }] }, s);
  expect(result.claims).toHaveLength(2); expect(new Set(result.claims.map(c => c.selector.scopeId)).size).toBe(2);
  expect(result.scopes.every(scope => scope.identity === 'provisional')).toBe(true);
  expect(result.diagnostics.some(d => d.code === 'legacy_scope_unresolved')).toBe(true);
});
