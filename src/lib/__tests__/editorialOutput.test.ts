import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { createEditorialSession, hashText, type EditorialSession } from '../editorialTypes';
import { parseDraftArtifact } from '../editorialDocument';
import { makePublicDocument, requireConfirmedOutput, renderPublicDocument, exportPublicDocumentToDocx, publicDraftFields } from '../editorialOutput';
import { normalizeLegacySession } from '../editorialCompatibility';
import { currentInputKey, applyControlEvent, startEditorialRun } from '../editorialState';
import { validateAcceptance } from '../editorialAcceptance';
import { getDefaultTheme } from '../themeLoader';
function fixture() {
  const s = startEditorialRun(createEditorialSession('s'), 'r');
  s.task = { ...s.task, revision: 1, objective: 'Inform readers', intents: ['inform'] };
  s.candidate = parseDraftArtifact(JSON.stringify({ title: 'Public title', bodyMarkdown: 'Public **body**.\nSecond line', editorialNotes: [{ id: 'n', kind: 'process', text: 'INTERNAL-STATE', relatedIds: [] }] }), { id: 'd', revision: 1 }).artifact!;
  return s;
}
function ready(s: EditorialSession) {
  const doc = makePublicDocument(s).document!; s.layout = renderPublicDocument(doc, getDefaultTheme()); s.review = { inputKey: currentInputKey(s), issues: [], blocking: [], notes: [] }; s.gate = validateAcceptance(s, s.layout);
  return applyControlEvent(s, { sessionId: s.sessionId, runId: s.activeRunId!, expectedRevision: s.revision, type: 'editor_confirmed', confirmation: { inputKey: currentInputKey(s), htmlHash: s.layout.htmlHash, actor: 'editor', confirmedAt: '2026-11-11T23:00:00+08:00' } });
}
describe('public projection and same-version outputs', () => {
  it.each(['(PRIVATE-SPAN)', '**PRIVATE-SPAN**', '[^1]: PRIVATE-SPAN', '- PRIVATE-SPAN'])('blocks a protected span in %s without silently cutting body', body => {
    const s = fixture(); const text = 'PRIVATE-SPAN'; s.evidence = [{ id: 'e', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: {}, context: { scenario: 'real' } }];
    const ref = { evidenceId: 'e', revision: 1, start: 0, end: text.length, quote: text };
    s.scopes = [{ id: 'p', kind: 'person', label: 'Person', anchors: [ref], qualifiers: [], identity: 'aligned' }];
    s.claims = [{ id: 'secret', selector: { scopeId: 'p', predicate: 'story' }, value: text, refs: [ref], epistemic: 'supported', visibility: 'private', statusBasis: [ref] }];
    s.candidate = parseDraftArtifact(JSON.stringify({ title: 'Title', bodyMarkdown: body }), { id: 'd', revision: 1 }).artifact!;
    const result = makePublicDocument(s); expect(result.document).toBeUndefined(); expect(result.blockers.some(b => b.code === 'protected_span')).toBe(true); expect(s.candidate.bodyMarkdown).toBe(body);
  });
  it('duplicating the private notes channel into prose is blocked even without a separate private claim', () => {
    const s = fixture(); s.candidate = parseDraftArtifact(JSON.stringify({ title: 'Title', bodyMarkdown: '**(WORKFLOW-ONLY)**', editorialNotes: [{ id: 'n', kind: 'process', text: 'WORKFLOW-ONLY', relatedIds: [] }] }), { id: 'd', revision: 1 }).artifact!;
    expect(makePublicDocument(s).blockers.some(d => d.code === 'workflow_note_span')).toBe(true);
  });
  it('does not blacklist legitimate public discussion of permissions', () => {
    const s = fixture(); s.candidate = parseDraftArtifact(JSON.stringify({ title: 'Licensing explained', bodyMarkdown: 'Permission and authorization protect contributors.' }), { id: 'd', revision: 1 }).artifact!;
    expect(makePublicDocument(s).blockers).toEqual([]);
  });
  it('unknown claim links and unbound image markup cannot self-attest or bypass permissions', () => {
    const s = fixture(); s.candidate!.claimLinks = [{ blockId: s.candidate!.blocks[0].id, claimIds: ['invented'] }]; expect(makePublicDocument(s).blockers.some(b => b.code === 'unknown_claim_link')).toBe(true);
    s.candidate = parseDraftArtifact(JSON.stringify({ title: 'Images', bodyMarkdown: '![photo](https://example.org/a.png)' }), { id: 'd', revision: 1 }).artifact!;
    expect(makePublicDocument(s).document).toBeUndefined();
  });
  it('omitted optional assets allow a text-only document, but unknown or restricted included assets block', () => {
    const s = fixture(); s.candidate = parseDraftArtifact(JSON.stringify({ title: 'Text', bodyMarkdown: 'Text only', assets: [{ assetId: 'asset', slotId: 'slot', use: 'illustration', state: 'omitted' }] }), { id: 'd', revision: 1 }).artifact!;
    expect(makePublicDocument(s).document?.assets).toEqual([]);
    s.candidate = parseDraftArtifact(JSON.stringify({ title: 'Text', bodyMarkdown: '{{asset:slot}}', assets: [{ assetId: 'asset', slotId: 'slot', use: 'illustration', state: 'included' }] }), { id: 'd', revision: 1 }).artifact!;
    expect(makePublicDocument(s).blockers.some(b => b.code === 'asset_permission')).toBe(true);
  });
  it('HTML, copied bundle, workspace fields and actual DOCX XML only contain public projection', async () => {
    const s = ready(fixture()); const bundle = requireConfirmedOutput(s); const fields = publicDraftFields(bundle);
    expect(bundle.layout.html).toContain('data-editorial-block'); expect(bundle.layout.contentHash).toBe(bundle.document.contentHash); expect(JSON.stringify(fields)).not.toContain('INTERNAL-STATE');
    const docx = await exportPublicDocumentToDocx(bundle.document); const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result as ArrayBuffer); r.onerror = reject; r.readAsArrayBuffer(docx); });
    const zip = await JSZip.loadAsync(arrayBuffer); const xml = (await Promise.all(Object.keys(zip.files).filter(name => name.endsWith('.xml')).map(name => zip.file(name)!.async('string')))).join('');
    expect(xml).toContain('Public title'); expect(xml).toContain('Public body.'); expect(xml).not.toContain('INTERNAL-STATE'); expect(bundle.layout.html).not.toContain('INTERNAL-STATE');
  });
  it('blocks tampered or unconfirmed versions, while explicit previous-snapshot selection remains exact', () => {
    expect(() => requireConfirmedOutput(fixture())).toThrow(); const s = ready(fixture()); const original = requireConfirmedOutput(s);
    s.candidate = parseDraftArtifact(JSON.stringify({ title: 'New', bodyMarkdown: 'Unreviewed text' }), { id: 'd', revision: 2 }).artifact!; s.selectedOutput = 'candidate'; expect(() => requireConfirmedOutput(s)).toThrow();
    s.selectedOutput = 'committed'; expect(requireConfirmedOutput(s)).toEqual(original);
    s.committed!.layout.html += '<p>Injected</p>'; expect(() => requireConfirmedOutput(s)).toThrow();
  });
  it('exports only the unchanged historical confirmed snapshot, not a pending/manual or edited legacy draft', () => {
    const s = normalizeLegacySession({ id: 'old', generatedTitle: 'Old', generatedText: '# Old\nOriginal', generatedHtml: '<p>Original</p>', editorial: { status: 'confirmed' } }); s.selectedOutput = 'legacy';
    expect(requireConfirmedOutput(s).layout.html).toBe('<p>Original</p>');
    const pending = normalizeLegacySession({ generatedText: 'Pending', generatedHtml: '<p>Pending</p>', editorial: { status: 'pending' } }); pending.selectedOutput = 'legacy'; expect(() => requireConfirmedOutput(pending)).toThrow();
  });
  it('authorized assets project caption-only slots consistently across HTML, text and snapshot exports', () => {
    const s = fixture(); const text = 'Asset license'; const ref = { evidenceId: 'e', revision: 1, start: 0, end: text.length, quote: text };
    s.evidence = [{ id: 'e', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: {}, context: { scenario: 'real' } }];
    s.scopes = [{ id: 'asset', kind: 'asset', label: 'Image', anchors: [ref], qualifiers: [], identity: 'aligned' }];
    s.permissions = [{ id: 'p', subjectId: 'asset', state: 'allowed', refs: [ref], uses: [{ channel: 'public', purpose: 'illustration', identity: 'not_applicable' }] }];
    s.candidate = parseDraftArtifact(JSON.stringify({ title: 'Illustration', bodyMarkdown: 'Article body\n{{asset:slot}}', assets: [{ assetId: 'asset', slotId: 'slot', use: 'illustration', state: 'included', publicCaption: 'A public caption' }] }), { id: 'd', revision: 1 }).artifact!;
    const projected = makePublicDocument(s).document!; expect(projected.bodyMarkdown).toContain('A public caption'); expect(projected.bodyMarkdown).not.toContain('{{asset:');
    const confirmed = ready(s); const output = requireConfirmedOutput(confirmed); expect(output.document).toEqual(projected); expect(validateAcceptance(s, output.layout).blockers).toEqual([]);
  });
  it('confirmation itself rejects unauthorized assets even without a permission criterion', () => {
    const s = fixture(); s.candidate = parseDraftArtifact(JSON.stringify({ title: 'X', bodyMarkdown: 'Text', assets: [{ assetId: 'unknown', slotId: 's', use: 'illustration', state: 'included' }] }), { id: 'd', revision: 1 }).artifact!;
    const key = currentInputKey(s); s.review = { inputKey: key, blocking: [], issues: [], notes: [] }; s.layout = { contentHash: key.contentHash, themeId: 't', themeVersion: '1', html: '<p>Text</p>', htmlHash: hashText('<p>Text</p>') }; s.gate = { inputKey: key, checks: [{ criterionId: 'fake', status: 'pass', detail: '', verifier: 'model' }], blockers: [] };
    expect(() => applyControlEvent(s, { sessionId: 's', runId: 'r', expectedRevision: s.revision, type: 'editor_confirmed', confirmation: { inputKey: key, htmlHash: s.layout!.htmlHash, actor: 'editor', confirmedAt: 'now' } })).toThrow();
  });
  it('committed output does not trust a tampered block list independent from body hash', () => {
    const s = ready(fixture()); s.committed!.artifact.blocks[0].text = 'INTERNAL-STATE'; expect(() => requireConfirmedOutput(s)).toThrow();
  });
  it('denied quotation permissions cannot be bypassed by a public truth label', () => {
    const s = fixture(); const text = 'A verified quotation'; const ref = { evidenceId: 'e', revision: 1, start: 0, end: text.length, quote: text };
    s.evidence = [{ id: 'e', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: {}, context: { scenario: 'real' } }];
    s.scopes = [{ id: 'person', kind: 'person', label: 'Contributor', anchors: [ref], qualifiers: [], identity: 'aligned' }];
    s.claims = [{ id: 'q', selector: { scopeId: 'person', predicate: 'quotation' }, value: text, refs: [ref], statusBasis: [], epistemic: 'supported', visibility: 'public' }];
    s.permissions = [{ id: 'p', subjectId: 'q', state: 'denied', refs: [ref], uses: [{ channel: 'public', purpose: 'publication', identity: 'not_applicable' }] }];
    s.candidate = parseDraftArtifact(JSON.stringify({ title: 'Interview', bodyMarkdown: text }), { id: 'd', revision: 1 }).artifact!;
    expect(makePublicDocument(s).blockers.some(d => d.code === 'claim_permission')).toBe(true);
    s.permissions[0].state = 'allowed'; expect(makePublicDocument(s).blockers).toEqual([]);
    s.permissions[0].uses[0].identity = 'anonymous'; expect(makePublicDocument(s).document).toBeUndefined();
    s.task.criteria = [{ id: 'anon', origin: 'user', refs: [ref], severity: 'blocking', verification: 'deterministic', rule: { kind: 'permission', subjectIds: ['q'], use: 'publication', channel: 'public', identity: 'anonymous' } }];
    expect(makePublicDocument(s).blockers).toEqual([]); expect(validateAcceptance(s).blockers).toEqual([]);
  });
  it('asset captions and states are part of the same public content key', () => {
    const raw = { title: 'Title', bodyMarkdown: '{{asset:s}}', assets: [{ assetId: 'a', slotId: 's', use: 'illustration', state: 'included', publicCaption: 'Caption' }] };
    const first = parseDraftArtifact(JSON.stringify(raw), { id: 'd', revision: 1 }).artifact!;
    raw.assets[0].publicCaption = 'Changed'; const second = parseDraftArtifact(JSON.stringify(raw), { id: 'd', revision: 2 }).artifact!; expect(first.contentHash).not.toBe(second.contentHash);
  });
});
