import { describe, it, expect } from 'vitest';
import { createEditorialSession, hashText } from '../editorialTypes';
import { parseDraftArtifact, parseContentBlocks, buildWriterContext } from '../editorialDocument';
describe('one public content model', () => {
  it('parses old JSON and structured metadata without making notes public', () => {
    const raw = { title: 'Article', bodyMarkdown: 'Public body', editorialNotes: [{ id: 'n', kind: 'asset', text: '**(private processing state)**', relatedIds: [] }], assets: [] };
    const result = parseDraftArtifact(JSON.stringify(raw), { id: 'd', revision: 1 }); expect(result.artifact?.editorialNotes).toEqual(raw.editorialNotes); expect(result.artifact?.bodyMarkdown).toBe('Public body');
    expect(parseDraftArtifact(JSON.stringify({ title: 'Old', bodyMarkdown: 'Old body' }), { id: 'd', revision: 1 }).artifact?.origin).toBe('model');
  });
  it('preserves legacy markdown but only accepts article-shaped responses', () => {
    const raw = '# Legacy\n\n**Original** body\nSecond line'; const result = parseDraftArtifact(raw, { id: 'd', revision: 1 });
    expect(result.artifact?.origin).toBe('legacy'); expect(result.artifact?.originalMarkdown).toBe(raw); expect(result.diagnostics.some(d => d.code === 'legacy_requires_validation')).toBe(true);
    expect(parseDraftArtifact('not an article response', { id: 'd', revision: 1 }).artifact).toBeUndefined();
    expect(parseDraftArtifact('{bad json', { id: 'd', revision: 1 }).artifact).toBeUndefined();
  });
  it('retains v1 nonempty-line paragraph semantics and stable block IDs', () => {
    const blocks = parseContentBlocks('## Subhead\nFirst line\nSecond line\n\n- List\n> Quote');
    expect(blocks.map(b => b.kind)).toEqual(['heading', 'paragraph', 'paragraph', 'list', 'quote']); expect(parseContentBlocks('## Subhead\nFirst line\nSecond line\n\n- List\n> Quote')).toEqual(blocks);
  });
  it('rejects unsafe markup and does not accept model-authored block hashes or arbitrary fields', () => {
    for (const bodyMarkdown of ['<script>alert(1)</script>', '```html\nHi\n```', '# Second title', '::: container']) expect(parseDraftArtifact(JSON.stringify({ title: 'X', bodyMarkdown }), { id: 'd', revision: 1 }).artifact).toBeUndefined();
    expect(parseDraftArtifact(JSON.stringify({ title: 'X', bodyMarkdown: 'Text', blocks: [] }), { id: 'd', revision: 1 }).artifact).toBeUndefined();
  });
  it('writer constraints retain executable bounds and placement instead of losing the rules', () => {
    const s = createEditorialSession('s'); s.task.criteria = [{ id: 'length', origin: 'policy', refs: [], rule: { kind: 'length', min: 50, max: 100, unit: 'visible_characters' }, severity: 'blocking', verification: 'deterministic' }];
    expect(buildWriterContext(s).constraints[0].rule).toEqual(s.task.criteria[0].rule);
  });
  it('writer input carries only public supported values, never raw conversation or enclosing private quotes', () => {
    const s = createEditorialSession('s'); const text = 'Public number 12. Hidden identifier SECRET-Z. Internal permission memo.';
    s.evidence = [{ id: 'e', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: {}, context: { scenario: 'real' } }];
    const ref = (value: string) => ({ evidenceId: 'e', revision: 1, start: text.indexOf(value), end: text.indexOf(value) + value.length, quote: value });
    s.scopes = [{ id: 'p', kind: 'project', label: 'Project', anchors: [ref('Public number')], qualifiers: [], identity: 'aligned' }];
    s.claims = [{ id: 'public', selector: { scopeId: 'p', predicate: 'count' }, value: '12', refs: [ref(text)], epistemic: 'supported', visibility: 'public', statusBasis: [] }, { id: 'secret', selector: { scopeId: 'p', predicate: 'identifier' }, value: 'SECRET-Z', refs: [ref('SECRET-Z')], epistemic: 'supported', visibility: 'private', statusBasis: [ref('Hidden identifier SECRET-Z')] }];
    s.task.objective = 'Do not expose SECRET-Z'; const context = buildWriterContext(s); const serialized = JSON.stringify(context);
    expect(serialized).toContain('12'); expect(serialized).not.toContain('SECRET-Z'); expect(serialized).not.toContain('Internal permission memo'); expect(serialized).not.toContain('conversation');
  });
});
