import { DraftArtifactSchema, artifactContentHash, hashText, stableJson, type EditorialSession, type DraftArtifact, type ContentBlock, type Diagnostics, type EditorialNote, type FactSelector, type PublicDocument, type CriterionRule } from './editorialTypes';
import { claimPublicationUses, permissionAllows, resolveFacts, canonicalScopeId, hasSubjectPermissions } from './editorialFacts';
/** v1 line semantics are intentional: a single newline creates a new body paragraph. */
export function parseContentBlocks(bodyMarkdown: string): ContentBlock[] {
  const occurrences = new Map<string, number>();
  return bodyMarkdown.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(text => {
    const kind: ContentBlock['kind'] = /^#{1,6}\s/.test(text) ? 'heading' : /^(?:[-*] |\d+\. )/.test(text) ? 'list' : /^> /.test(text) ? 'quote' : /^\{\{asset:[^{}]+\}\}$/.test(text) || /^!\[/.test(text) || text.startsWith('【此处配图') ? 'asset_slot' : 'paragraph';
    const hash = hashText(kind + ':' + text).slice(0, 24), count = occurrences.get(hash) ?? 0; occurrences.set(hash, count + 1);
    return { id: 'b-' + hash + '-' + count, kind, text };
  });
}
export function parseDraftArtifact(raw: string, options: { id: string; revision: number; legacyTitle?: string }): { artifact?: DraftArtifact; diagnostics: Diagnostics[] } {
  const diagnostics: Diagnostics[] = []; const invalid = () => ({ diagnostics: [{ code: 'invalid_artifact', message: 'Expected an article-shaped JSON object or explicit legacy markdown; no response was silently repaired.', refs: [] }] });
  try {
    let input: Record<string, unknown>, originalMarkdown: string | undefined;
    const clean = raw.trim();
    if (clean.startsWith('{') || clean.startsWith('```')) {
      const value: unknown = JSON.parse(clean.replace(/^```(?:json)?\s*\n/, '').replace(/\n```$/, ''));
      if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(); input = value as Record<string, unknown>;
    } else {
      const match = raw.match(/^# ([^\r\n]+)\r?\n([\s\S]+)$/);
      if (!match && !options.legacyTitle) return invalid();
      input = { title: match?.[1] ?? options.legacyTitle, bodyMarkdown: match?.[2] ?? raw }; originalMarkdown = raw;
      diagnostics.push({ code: 'legacy_requires_validation', message: 'Legacy markdown retained as an unchecked candidate, not confirmed output.', refs: [] });
    }
    if (Object.keys(input).some(key => !['title', 'bodyMarkdown', 'editorialNotes', 'assets', 'claimLinks'].includes(key))) return invalid();
    if (typeof input.title !== 'string' || typeof input.bodyMarkdown !== 'string') return invalid();
    const title = input.title.trim(), bodyMarkdown = input.bodyMarkdown;
    if (!title || title.length > 150 || /[\r\n]/.test(title) || !bodyMarkdown.trim() || bodyMarkdown.length > 24_000 || /^\s*#\s/m.test(bodyMarkdown) || /<[a-z!/?]|^\s*(?:::|```)/im.test(title + '\n' + bodyMarkdown)) return invalid();
    const candidate: unknown = { schemaVersion: 2, id: options.id, revision: options.revision, title, bodyMarkdown, blocks: parseContentBlocks(bodyMarkdown), contentHash: 'pending', editorialNotes: input.editorialNotes ?? [], assets: input.assets ?? [], claimLinks: input.claimLinks ?? [], origin: originalMarkdown === undefined ? 'model' : 'legacy', ...(originalMarkdown !== undefined ? { originalMarkdown } : {}) };
    const artifact = DraftArtifactSchema.parse(candidate); artifact.contentHash = artifactContentHash(title, bodyMarkdown, artifact.assets);
    if (!artifact.blocks.length || new Set(artifact.assets.map(a => a.slotId)).size !== artifact.assets.length) return invalid();
    return { artifact, diagnostics };
  } catch { return invalid(); }
}
export function protectedValues(s: EditorialSession): string[] { return s.claims.filter(c => c.visibility !== 'public').map(c => c.value); }
export const publicTextKey = (text: string): string => text.normalize('NFKC').replace(/\*|`|\s/g, '');
export function containsProtectedText(s: EditorialSession, text: string): boolean { return protectedValues(s).some(value => !!publicTextKey(value) && publicTextKey(text).includes(publicTextKey(value))); }
export interface WriterContext {
  objective: string; intents: EditorialSession['task']['intents'];
  claims: { id: string; selector: FactSelector; value: string; evidenceIds: string[] }[];
  constraints: { id: string; kind: string; rule: CriterionRule; relatedIds: string[] }[];
  currentDraft?: { title: string; bodyMarkdown: string }; repairCriterionIds: string[];
  assetSlots: { assetId: string; slotId: string; state: 'omitted' | 'placeholder' | 'included' }[];
}
/** No conversation, raw enclosing quotes, internal notes or unfiltered evidence enters writer input. */
export function buildWriterContext(s: EditorialSession, repairCriterionIds: string[] = []): WriterContext {
  const result = resolveFacts(s); const conflictScopes = new Set(result.conflicts.map(g => canonicalScopeId(s, g.selector.scopeId)));
  const claims = result.claims.filter(c => c.epistemic === 'supported' && c.visibility === 'public' && !conflictScopes.has(canonicalScopeId(s, c.selector.scopeId)) && !containsProtectedText(s, c.value) && [c.id, c.selector.scopeId].every(subject => !hasSubjectPermissions(s, subject) || claimPublicationUses(s, subject).every(use => permissionAllows(s, subject, use))));
  const current = s.candidate && !containsProtectedText(s, s.candidate.title + s.candidate.bodyMarkdown) ? { title: s.candidate.title, bodyMarkdown: s.candidate.bodyMarkdown } : undefined;
  return { objective: containsProtectedText(s, s.task.objective) ? 'Prepare the public article using the approved claims and constraints.' : s.task.objective,
    intents: [...s.task.intents], claims: claims.map(c => ({ id: c.id, selector: structuredClone(c.selector), value: c.value, evidenceIds: [...new Set(c.refs.map(r => r.evidenceId))] })),
    constraints: s.task.criteria.map(c => ({ id: c.id, kind: c.rule.kind, rule: c.rule.kind === 'semantic' && containsProtectedText(s, c.rule.instruction) ? { kind: 'semantic', instruction: 'Follow the public task constraints without disclosing restricted material.' } : structuredClone(c.rule), relatedIds: c.rule.kind === 'include_facts' || c.rule.kind === 'exclude_claims' ? [...c.rule.factIds] : c.rule.kind === 'permission' ? [...c.rule.subjectIds] : [] })),
    currentDraft: current, repairCriterionIds: repairCriterionIds.filter(id => s.task.criteria.some(c => c.id === id)), assetSlots: s.candidate?.assets.map(a => ({ assetId: a.assetId, slotId: a.slotId, state: a.state })) ?? [] };
}
/** Safe sidebar summaries are separate from the public document and the full local evidence. */
export function summarizeEditorialNotes(s: EditorialSession): EditorialNote[] {
  return [...new Map((s.candidate?.editorialNotes ?? []).map(note => [stableJson({ kind: note.kind, relatedIds: [...note.relatedIds].sort(), text: note.text }), { ...note, text: containsProtectedText(s, note.text) ? 'Restricted material was not used.' : note.text }])).values()];
}

/** Permission-independent canonical projection, used only after validation or for historical snapshots. */
export function publicArtifactBlocks(artifact: DraftArtifact): ContentBlock[] {
  return parseContentBlocks(artifact.bodyMarkdown).map(block => {
    const asset = artifact.assets.find(a => a.state === 'included' && block.text === '{{asset:' + a.slotId + '}}');
    return asset ? { ...block, text: asset.publicCaption ?? '' } : block;
  });
}
export function projectPublicArtifact(artifact: DraftArtifact): PublicDocument {
  const blocks = publicArtifactBlocks(artifact);
  const bodyMarkdown = artifact.bodyMarkdown.split(/\r?\n/).map(line => {
    const asset = artifact.assets.find(a => a.state === 'included' && line.trim() === '{{asset:' + a.slotId + '}}');
    return asset ? asset.publicCaption ?? '' : line;
  }).join('\n');
  return { title: artifact.title, bodyMarkdown, blocks, assets: artifact.assets.filter(a => a.state === 'included').map(a => ({ assetId: a.assetId, slotId: a.slotId, ...(a.publicCaption ? { publicCaption: a.publicCaption } : {}) })), contentHash: artifact.contentHash };
}
export function validatePublicArtifact(s: EditorialSession): Diagnostics[] {
  const blockers: Diagnostics[] = []; const block = (code: string, message: string) => blockers.push({ code, message, refs: [] });
  const artifact = s.candidate;
  if (!artifact || !DraftArtifactSchema.is(artifact)) return [{ code: 'invalid_artifact', message: 'No valid current candidate.', refs: [] }];
  if (artifact.contentHash !== artifactContentHash(artifact.title, artifact.bodyMarkdown, artifact.assets) || stableJson(artifact.blocks) !== stableJson(parseContentBlocks(artifact.bodyMarkdown))) block('content_integrity', 'Content key and shared parser blocks must match.');
  if (/<[a-z!/?]|^\s*(?:::|```)/im.test(artifact.title + '\n' + artifact.bodyMarkdown)) block('unsafe_content', 'Markup requires revision, never silent stripping.');
  const publicText = artifact.title + '\n' + publicArtifactBlocks(artifact).map(b => b.text).join('\n') + '\n' + artifact.assets.filter(a => a.state !== 'omitted').map(a => a.publicCaption ?? '').join('\n');
  if (containsProtectedText(s, publicText)) block('protected_span', 'Protected source content appears in public prose; revise and re-review.');
  if ([...s.editorialNotes ?? [], ...artifact.editorialNotes].some(note => !!publicTextKey(note.text) && publicTextKey(publicText).includes(publicTextKey(note.text)))) block('workflow_note_span', 'An explicit private note was duplicated into public prose; revise without deleting the note.');
  const facts = resolveFacts(s); blockers.push(...facts.diagnostics);
  for (const link of artifact.claimLinks) if (!artifact.blocks.some(b => b.id === link.blockId) || link.claimIds.some(id => !facts.claims.some(c => c.id === id && c.epistemic === 'supported' && c.visibility === 'public'))) block('unknown_claim_link', 'Claim links do not attest truth or unknown claims.');
  const text = publicText;
  for (const claim of facts.claims) {
    const referenced = artifact.claimLinks.some(link => link.claimIds.includes(claim.id)) || publicTextKey(text).includes(publicTextKey(claim.value));
    if (!referenced) continue;
    for (const subject of [claim.id, claim.selector.scopeId]) {
      if (!hasSubjectPermissions(s, subject)) continue;
      if (!claimPublicationUses(s, subject).every(use => permissionAllows(s, subject, use))) block('claim_permission', 'Included claim needs permission for the publication use, independent from truth.');
    }
  }
  for (const asset of artifact.assets) {
    if (asset.state === 'omitted') continue;
    if (asset.state !== 'included') { block('asset_pending', 'An unresolved asset cannot enter public output.'); continue; }
    if (!permissionAllows(s, asset.assetId, { channel: asset.channel ?? 'public', purpose: asset.use, identity: asset.identity ?? 'not_applicable' })) block('asset_permission', 'No current authorization for this subject, channel, purpose and identity.');
    if (asset.publicCaption && containsProtectedText(s, asset.publicCaption)) block('protected_span', 'Protected information appears in an asset caption.');
    if (!artifact.blocks.some(b => b.kind === 'asset_slot' && b.text === '{{asset:' + asset.slotId + '}}')) block('asset_slot_missing', 'An asset must be explicitly placed; no automatic insertion.');
  }
  for (const slot of artifact.blocks.filter(b => b.kind === 'asset_slot')) if (!artifact.assets.some(a => a.state === 'included' && slot.text === '{{asset:' + a.slotId + '}}')) block('unbound_asset', 'Image markup/placeholder has no authorized structured slot.');
  return blockers;
}
