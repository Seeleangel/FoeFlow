import { describe, it, expect } from 'vitest';
import { createEditorialSession, hashText, type AcceptanceCriterion, type DraftArtifact, type EditorialSession, type EvidenceRef } from '../editorialTypes';
import { parseContentBlocks } from '../editorialDocument';
import { validateAcceptance } from '../editorialAcceptance';
import { currentInputKey } from '../editorialState';
function fixture() {
  const s = createEditorialSession('s'); const text = 'Event Monday at Studio. Read reference.';
  s.evidence = [{ id: 'e', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: {}, context: { scenario: 'unknown' } }];
  const ref = (value: string): EvidenceRef => ({ evidenceId: 'e', revision: 1, start: text.indexOf(value), end: text.indexOf(value) + value.length, quote: value });
  s.scopes = [{ id: 'event', kind: 'event', label: 'Event', anchors: [ref('Event')], qualifiers: [], identity: 'aligned' }];
  s.claims = ['Monday', 'Studio'].map((value, i) => ({ id: `c${i}`, selector: { scopeId: 'event', predicate: i ? 'location' : 'time' }, value, refs: [ref(value)], epistemic: 'supported', visibility: 'public', statusBasis: [] }));
  s.task = { ...s.task, revision: 1, objective: 'Inform readers', intents: ['inform'] };
  const c: AcceptanceCriterion = { id: 'lead', origin: 'user', refs: [ref('Event Monday at Studio.')], severity: 'blocking', verification: 'deterministic', rule: { kind: 'include_facts', factIds: ['c0', 'c1'], location: 'first_body_paragraph' } };
  s.task.criteria = [c]; setBody(s, ['Monday at Studio.']); return { s, ref, c };
}
function setBody(s: EditorialSession, lines: string[], kinds: DraftArtifact['blocks'][number]['kind'][] = lines.map(() => 'paragraph')) {
  const bodyMarkdown = lines.map((line, i) => kinds[i] === 'heading' ? '## ' + line : line).join('\n'); s.candidate = { schemaVersion: 2, id: 'd', revision: 1, title: 'Monday Studio', bodyMarkdown, contentHash: hashText('Monday Studio\n' + bodyMarkdown), blocks: parseContentBlocks(bodyMarkdown), origin: 'model', claimLinks: [], assets: [], editorialNotes: [] };
}
describe('acceptance is task-specific and fail closed', () => {
  it('requires both facts in the first real body paragraph, never the title or adjacent blocks', () => {
    const { s } = fixture(); expect(validateAcceptance(s).blockers).toEqual([]);
    setBody(s, ['Monday', 'Studio']); expect(validateAcceptance(s).checks.find(c => c.criterionId === 'lead')?.status).toBe('fail');
    setBody(s, ['Monday Studio', 'Other'], ['heading', 'paragraph']); expect(validateAcceptance(s).blockers).toContain('lead');
    s.task.criteria = []; expect(validateAcceptance(s).blockers).not.toContain('lead');
  });
  it('checks the actual rendered paragraph and detects stale or altered HTML', () => {
    const { s } = fixture(); const html = `<article><h1>Monday Studio</h1><p data-editorial-block="${s.candidate!.blocks[0].id}">Monday at Studio.</p></article>`;
    const layout = { contentHash: s.candidate!.contentHash, themeId: 't', themeVersion: '1', html, htmlHash: hashText(html) };
    expect(validateAcceptance(s, layout).blockers).toEqual([]);
    const changed = '<article><h1>Monday Studio</h1><p data-editorial-block="b0">Monday</p><p>Studio</p></article>';
    expect(validateAcceptance(s, { ...layout, html: changed, htmlHash: hashText(changed) }).blockers.length).toBeGreaterThan(0);
  });
  it('rejects hidden paragraphs and unauthorized active/layout-only elements even when visible text hashes appear to match', () => {
    const { s } = fixture(); const blockId = s.candidate!.blocks[0].id;
    for (const extra of ['<img src="x" onerror="alert(1)">', '<script></script>']) {
      const html = `<article><h1>Monday Studio</h1><p data-editorial-block="${blockId}">Monday at Studio.</p>${extra}</article>`;
      expect(validateAcceptance(s, { contentHash: s.candidate!.contentHash, themeId: 't', themeVersion: '1', html, htmlHash: hashText(html) }).blockers).toContain('layout_integrity');
    }
    const html = `<article><h1>Monday Studio</h1><p style="display:none" data-editorial-block="${blockId}">Monday at Studio.</p></article>`;
    expect(validateAcceptance(s, { contentHash: s.candidate!.contentHash, themeId: 't', themeVersion: '1', html, htmlHash: hashText(html) }).blockers).toContain('layout_integrity');
  });
  it('checks visible length and exact preserved blocks without counting title or markdown markup', () => {
    const { s, c } = fixture(); s.task.criteria = [{ ...c, id: 'len', rule: { kind: 'length', min: 14, max: 16, unit: 'visible_characters' } }, { ...c, id: 'keep', rule: { kind: 'preserve_blocks', blockHashes: [hashText('Monday at Studio.')] } }];
    expect(validateAcceptance(s).blockers).toEqual([]); setBody(s, ['Changed']); expect(validateAcceptance(s).blockers).toEqual(expect.arrayContaining(['len', 'keep']));
  });
  it('semantic/human unknown is blocking; only editor can clear human-pending checks for the same key', () => {
    const { s, c } = fixture(); s.task.criteria = [{ ...c, id: 'human', verification: 'human', rule: { kind: 'semantic', instruction: 'Verify tone' } }];
    expect(validateAcceptance(s).checks.find(c => c.criterionId === 'human')?.status).toBe('unknown');
    s.review = { inputKey: currentInputKey(s), issues: [], blocking: [], notes: [] }; expect(validateAcceptance(s).blockers).toContain('human');
    s.humanVerifications = [{ criterionId: 'human', inputKey: currentInputKey(s), status: 'pass', actor: 'editor', verifiedAt: 'now' }]; expect(validateAcceptance(s).blockers).toEqual([]);
    s.task.revision++; expect(validateAcceptance(s).blockers).toContain('human');
  });
  it('search/source self-report does not satisfy reading; a valid consumed receipt does; new version invalidates it', () => {
    const { s, ref, c } = fixture(); s.task.requiredSources = [{ id: 'src', selector: { documentId: 'doc' }, purpose: 'compare', refs: [ref('Read reference.')], depth: 'full_document', state: 'satisfied' }];
    s.task.criteria = [{ ...c, id: 'read', rule: { kind: 'source_read', sourceRequirementId: 'src' } }]; expect(validateAcceptance(s).blockers).toContain('read');
    const content = 'Reference document'; s.evidence.push({ id: 'doc-e', revision: 1, contentHash: hashText(content), text: content, kind: 'library', provenance: { documentId: 'doc' }, context: { scenario: 'real' } });
    s.readReceipts = [{ id: 'rr', sourceRequirementId: 'src', documentId: 'doc', contentHash: hashText(content), evidenceIds: ['doc-e'], range: [0, content.length], consumedByStage: 'write', contextHash: hashText('writer context') }]; expect(validateAcceptance(s).blockers).toEqual([]);
    s.evidence[1].text += ' revised'; s.evidence[1].contentHash = hashText(s.evidence[1].text); expect(validateAcceptance(s).blockers).toContain('read');
  });
  it('source waivers are visible, but cannot waive permission or version invariants', () => {
    const { s, ref } = fixture(); s.task.requiredSources = [{ id: 'src', selector: { documentId: 'missing' }, purpose: 'read', refs: [ref('Read reference.')], depth: 'full_document', state: 'unavailable' }];
    s.task.sourceWaivers = [{ sourceRequirementId: 'src', actor: 'editor', refs: [ref('Read reference.')], reason: 'Proceed without source' }];
    expect(validateAcceptance(s).checks.some(c => c.detail.includes('waived'))).toBe(true);
  });
  it('semantic checks need an explicit same-version reviewer conclusion, not an empty blocking array', () => {
    const { s, c } = fixture(); s.task.criteria = [{ ...c, id: 'tone', verification: 'semantic', rule: { kind: 'semantic', instruction: 'Verify tone' } }];
    s.review = { inputKey: currentInputKey(s), issues: [], blocking: [], notes: [], criterionChecks: [{ criterionId: 'tone', status: 'pass', verifier: 'semantic-review', detail: 'Checked against the task.' }] };
    expect(validateAcceptance(s).blockers).toEqual([]); s.review.inputKey.taskRevision++; expect(validateAcceptance(s).blockers).toContain('tone');
  });
  it('an empty plan is not a successful extraction', () => { const { s } = fixture(); s.task = createEditorialSession('x').task; expect(validateAcceptance(s).blockers).toContain('task_plan'); });
});
