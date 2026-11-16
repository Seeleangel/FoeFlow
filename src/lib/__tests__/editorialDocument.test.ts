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
  it('accepts a body that repeats the exact title as a leading H1 but still rejects any other heading', () => {
    const accepted = parseDraftArtifact(JSON.stringify({ title: 'X', bodyMarkdown: '# X\n\nPublic body' }), { id: 'd', revision: 1 });
    expect(accepted.artifact?.bodyMarkdown).toBe('Public body');
    expect(parseDraftArtifact(JSON.stringify({ title: 'X', bodyMarkdown: '# Y\n\nPublic body' }), { id: 'd', revision: 1 }).artifact).toBeUndefined();
    const prefixed = parseDraftArtifact(JSON.stringify({ title: '示例稿｜论坛预热', bodyMarkdown: '示例稿\n\n# 论坛预热\n\nPublic body' }), { id: 'd', revision: 1 });
    expect(prefixed.artifact?.title).toBe('示例稿｜论坛预热');
    expect(prefixed.artifact?.bodyMarkdown).not.toContain('# 论坛预热');
  });
  it('tolerates drifted claimLinks wire shapes and derives attribution from claim values in the body', () => {
    const s = createEditorialSession('s'); s.claims = [{ id: 'c1', selector: { scopeId: 'p', predicate: 'deadline' }, value: '2025年6月17日20:00', refs: [], epistemic: 'supported', visibility: 'public', statusBasis: [] }];
    const bodyMarkdown = '报名截止时间为2025年6月17日20:00。';
    const drifted = parseDraftArtifact(JSON.stringify({ title: 'T', bodyMarkdown, claimLinks: [{ claimId: 'c1', label: 'deadline' }, { claimIds: ['c1'] }, { claimId: 'made-up', blockId: 'b-never' }] }), { id: 'd', revision: 1, claims: s.claims });
    expect(drifted.artifact).toBeDefined();
    expect(drifted.artifact!.claimLinks).toEqual([{ blockId: drifted.artifact!.blocks[0].id, claimIds: ['c1'] }]);
    expect(drifted.artifact!.claimLinks.some(link => link.claimIds.includes('made-up'))).toBe(false);
    // Omitting claimLinks entirely is valid: the public claim value in the body is enough to derive the link.
    const derived = parseDraftArtifact(JSON.stringify({ title: 'T', bodyMarkdown }), { id: 'd', revision: 1, claims: s.claims });
    expect(derived.artifact!.claimLinks).toEqual([{ blockId: derived.artifact!.blocks[0].id, claimIds: ['c1'] }]);
    // A quoted claim in the title does not create a body link.
    const titleOnly = parseDraftArtifact(JSON.stringify({ title: '2025年6月17日20:00', bodyMarkdown: 'Other body' }), { id: 'd', revision: 1, claims: s.claims });
    expect(titleOnly.artifact!.claimLinks).toEqual([]);
  });
  it('tolerates editorialNotes sent as a bare string or a loose object instead of a note array', () => {
    const asString = parseDraftArtifact(JSON.stringify({ title: 'T', bodyMarkdown: 'Public body', editorialNotes: '已补齐时间与地点，未添加外部信息。' }), { id: 'd', revision: 1 });
    expect(asString.artifact).toBeDefined();
    expect(asString.artifact!.editorialNotes).toHaveLength(1);
    expect(asString.artifact!.editorialNotes[0].kind).toBe('process');
    expect(asString.artifact!.editorialNotes[0].text).toContain('已补齐');
    const loose = parseDraftArtifact(JSON.stringify({ title: 'T', bodyMarkdown: 'Public body', editorialNotes: [{ kind: 'unknown_kind', note: 'object note' }, 'second note'], assets: null }), { id: 'd', revision: 1 });
    expect(loose.artifact).toBeDefined();
    expect(loose.artifact!.editorialNotes.map(note => note.text)).toEqual(['object note', 'second note']);
    expect(loose.artifact!.editorialNotes.every(note => note.relatedIds.length === 0)).toBe(true);
    expect(loose.artifact!.assets).toEqual([]);
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
