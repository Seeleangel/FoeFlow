import { exportToDocx } from './wordExport';
import { artifactContentHash, hashText, stableJson, type EditorialSession, type ProjectionResult, type PublicDocument, type OutputBundle, type Diagnostics } from './editorialTypes';
import { parseContentBlocks, validatePublicArtifact, projectPublicArtifact } from './editorialDocument';
import { assertConfirmable, currentInputKey, sameInputKey } from './editorialState';
import { validateAcceptance, visibleBlockText } from './editorialAcceptance';
export class EditorialOutputError extends Error { constructor(public code: string, public diagnostics: Diagnostics[] = []) { super(code); this.name = 'EditorialOutputError'; } }
export function makePublicDocument(s: EditorialSession): ProjectionResult {
  const blockers = validatePublicArtifact(s);
  return blockers.length ? { blockers } : { document: projectPublicArtifact(s.candidate!), blockers: [] };
}
export { renderPublicDocument } from './editorialRender';
/** Plain-text block adapter preserves body boundaries; list/quote styling remains the legacy exporter's limitation. */
export async function exportPublicDocumentToDocx(document: PublicDocument): Promise<Blob> {
  return exportToDocx(document.title, document.blocks.map(block => block.kind === 'heading' ? block.text : visibleBlockText(block.text)));
}
export function publicDraftFields(bundle: OutputBundle): { contentText: string; contentHtml: string; paramsJson: { schemaVersion: 2; title: string; contentHash: string } } {
  return { contentText: '# ' + bundle.document.title + '\n' + bundle.document.bodyMarkdown, contentHtml: bundle.layout.html, paramsJson: { schemaVersion: 2, title: bundle.document.title, contentHash: bundle.document.contentHash } };
}
function checkedSnapshot(s: EditorialSession): OutputBundle {
  const committed = s.committed, c = committed?.confirmation;
  if (!committed || !c || c.actor !== 'editor' || c.inputKey.contentHash !== committed.artifact.contentHash || committed.artifact.contentHash !== artifactContentHash(committed.artifact.title, committed.artifact.bodyMarkdown, committed.artifact.assets) || committed.layout.contentHash !== committed.artifact.contentHash || c.htmlHash !== committed.layout.htmlHash || committed.layout.htmlHash !== hashText(committed.layout.html) || stableJson(committed.artifact.blocks) !== stableJson(parseContentBlocks(committed.artifact.bodyMarkdown))) throw new EditorialOutputError('unconfirmed_snapshot');
  const document = projectPublicArtifact(committed.artifact);
  return { document, layout: structuredClone(committed.layout) };
}
export function requireConfirmedOutput(s: EditorialSession): OutputBundle {
  if (s.selectedOutput === 'legacy') {
    const legacy = s.legacy; if (!legacy?.confirmed || legacy.mode !== 'confirmed' || !legacy.text || !legacy.html) throw new EditorialOutputError('unconfirmed_legacy');
    const bodyMarkdown = legacy.text.replace(/^# [^\r\n]+\r?\n/, ''); const contentHash = artifactContentHash(legacy.title, bodyMarkdown);
    return { document: { title: legacy.title, bodyMarkdown, blocks: parseContentBlocks(bodyMarkdown), assets: [], contentHash }, layout: { contentHash, themeId: 'legacy', themeVersion: 'original', html: legacy.html, htmlHash: hashText(legacy.html) } };
  }
  if (s.selectedOutput === 'committed') return checkedSnapshot(s);
  const c = s.committed?.confirmation;
  if (!c || !sameInputKey(c.inputKey, currentInputKey(s)) || c.htmlHash !== s.layout?.htmlHash || s.phase !== 'confirmed') throw new EditorialOutputError('output_not_confirmed');
  assertConfirmable(s); const projection = makePublicDocument(s); const gate = validateAcceptance(s, s.layout);
  if (!projection.document || gate.blockers.length) throw new EditorialOutputError('output_gate_failed', projection.blockers);
  return { document: projection.document, layout: structuredClone(s.layout!) };
}

/** Read-only UI/compatibility fields; no blocked body is promoted through legacy columns. */
export function editorialPreviewFields(s: EditorialSession) {
 let contentText='',contentHtml='',title='';
 if (s.selectedOutput==='committed'||s.selectedOutput==='legacy') {
  try { const b=requireConfirmedOutput(s); return {...publicDraftFields(b),title:b.document.title}; } catch { /* locked */ }
 } else {
  const doc=makePublicDocument(s).document;
  if (doc) {title=doc.title;contentText='# '+doc.title+'\n'+doc.bodyMarkdown;if(s.layout?.contentHash===doc.contentHash) contentHtml=s.layout.html;}
 }
 return {contentText,contentHtml,title};
}
