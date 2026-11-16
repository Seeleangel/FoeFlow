import { DraftArtifactSchema, artifactContentHash, hashText, stableJson, type EditorialSession, type DraftArtifact, type ContentBlock, type Diagnostics, type EditorialNote, type FactClaim, type FactSelector, type PublicDocument, type CriterionRule } from './editorialTypes';
import { validateAcceptance } from './editorialAcceptance';
import { claimPublicationAllowed, permissionAllows, resolveFacts, canonicalScopeId } from './editorialFacts';
/** v1 line semantics are intentional: a single newline creates a new body paragraph. */
export function parseContentBlocks(bodyMarkdown: string): ContentBlock[] {
  const occurrences = new Map<string, number>();
  return bodyMarkdown.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(text => {
    const kind: ContentBlock['kind'] = /^#{1,6}\s/.test(text) ? 'heading' : /^(?:[-*] |\d+\. )/.test(text) ? 'list' : /^> /.test(text) ? 'quote' : /^\{\{asset:[^{}]+\}\}$/.test(text) || /^!\[/.test(text) || text.startsWith('【此处配图') ? 'asset_slot' : 'paragraph';
    const hash = hashText(kind + ':' + text).slice(0, 24), count = occurrences.get(hash) ?? 0; occurrences.set(hash, count + 1);
    return { id: 'b-' + hash + '-' + count, kind, text };
  });
}
type ClaimLink = DraftArtifact['claimLinks'][number];
/**
 * Writers also drift on the two optional side channels: editorialNotes arrives as a bare string
 * (sometimes as an object) instead of the note array, and assets may be omitted or malformed.
 * None of that makes the public article unpublishable, so coerce them instead of rejecting the draft.
 */
export function normalizeEditorialNotes(value: unknown): EditorialNote[] {
  const entries = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  const notes: EditorialNote[] = [];
  entries.forEach((entry, index) => {
    if (typeof entry === 'string') { const text = entry.trim(); if (text) notes.push({ id: 'note-' + hashText('process:' + text + ':' + index).slice(0, 20), kind: 'process', text, relatedIds: [] }); return; }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    const record = entry as Record<string, unknown>;
    const text = typeof record.text === 'string' ? record.text.trim() : typeof record.note === 'string' ? record.note.trim() : '';
    if (!text) return;
    const kind = ['asset', 'fact_check', 'process', 'advisory'].includes(String(record.kind)) ? record.kind as EditorialNote['kind'] : 'process';
    const relatedIds = (Array.isArray(record.relatedIds) ? record.relatedIds : []).filter((item): item is string => typeof item === 'string');
    const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : 'note-' + hashText(kind + ':' + text + ':' + index).slice(0, 20);
    notes.push({ id, kind, text: text.slice(0, 4000), relatedIds });
  });
  return notes;
}
const normalizeAssets = (value: unknown): unknown => (Array.isArray(value) ? value : []);
/**
 * Writers drift on the claimLinks wire shape ({claimId,label} / {claimIds} / no block ids) and cannot see
 * block ids in their context. A malformed attribution must never invalidate an otherwise publishable draft:
 * accept only links that resolve to real blocks and known public supported claims, derive the rest from
 * claim values that actually occur in the body, and drop the rest.
 */
export function normalizeClaimLinks(value: unknown, blocks: ContentBlock[], claims: FactClaim[] = []): ClaimLink[] {
  const links: ClaimLink[] = [];
  const known = new Map(claims.map(claim => [claim.id, claim]));
  const blockFor = (claimIds: string[]): ContentBlock | undefined => blocks.find(block => claimIds.some(id => {
    const claim = known.get(id);
    return !!claim && claim.epistemic === 'supported' && claim.visibility === 'public' && !!claim.value.trim() && publicTextKey(block.text).includes(publicTextKey(claim.value));
  }));
  const add = (blockId: string, claimIds: string[]) => {
    const existing = links.find(link => link.blockId === blockId);
    const merged = [...new Set([...(existing?.claimIds ?? []), ...claimIds])];
    if (existing) existing.claimIds = merged; else links.push({ blockId, claimIds: merged });
  };
  for (const entry of Array.isArray(value) ? value : []) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const rawIds = [record.claimIds, record.claimId, record.claim, record.id].flatMap(item => Array.isArray(item) ? item : [item]).filter((item): item is string => typeof item === 'string');
    const claimIds = [...new Set(rawIds.filter(id => known.has(id) && known.get(id)!.epistemic === 'supported' && known.get(id)!.visibility === 'public'))];
    if (!claimIds.length) continue;
    const explicit = [record.blockId, record.anchor, record.location].find(item => typeof item === 'string' && blocks.some(block => block.id === item)) as string | undefined;
    const blockId = explicit ?? blockFor(claimIds)?.id;
    if (blockId) add(blockId, claimIds);
  }
  for (const claim of claims) {
    if (claim.epistemic !== 'supported' || claim.visibility !== 'public' || !claim.value.trim()) continue;
    const block = blockFor([claim.id]);
    if (block) add(block.id, [claim.id]);
  }
  return links;
}
export function parseDraftArtifact(raw: string, options: { id: string; revision: number; legacyTitle?: string; claims?: FactClaim[] }): { artifact?: DraftArtifact; diagnostics: Diagnostics[] } {
  const diagnostics: Diagnostics[] = []; const invalid = () => ({ diagnostics: [{ code: 'invalid_artifact', message: 'Expected an article-shaped JSON object or explicit legacy markdown. title=string, bodyMarkdown=string, editorialNotes=array of {id,kind,text,relatedIds} (a bare string is tolerated), assets=array, claimLinks omitted (the system derives them).', refs: [] }] });
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
    const title = input.title.trim();
    // Writers routinely repeat the headline as a level-1 Markdown heading although the title is a separate field.
    // Strip exactly that duplicate (never any other heading) before judging the body; the contract still forbids stray headings.
    const headingMatch = input.bodyMarkdown.match(/(^|\n)[ \t]*#[ \t]+([^\r\n]+)\r?\n?/);
    const headingText = headingMatch ? headingMatch[2].trim() : '';
    const repeatedTitle = !!headingMatch && (headingText === title || (headingText.length >= 4 && title.endsWith(headingText)));
    const bodyMarkdown = (repeatedTitle ? input.bodyMarkdown.replace(/(^|\n)[ \t]*#[ \t]+[^\r\n]+\r?\n?/, '$1') : input.bodyMarkdown).replace(/^\n+/, '');
    if (!title || title.length > 150 || /[\r\n]/.test(title) || !bodyMarkdown.trim() || bodyMarkdown.length > 24_000 || /^\s*#\s/m.test(bodyMarkdown) || /<[a-z!/?]|^\s*(?:::|```)/im.test(title + '\n' + bodyMarkdown)) return invalid();
    const blocks = parseContentBlocks(bodyMarkdown);
    const candidate: unknown = { schemaVersion: 2, id: options.id, revision: options.revision, title, bodyMarkdown, blocks, contentHash: 'pending', editorialNotes: normalizeEditorialNotes(input.editorialNotes), assets: normalizeAssets(input.assets), claimLinks: normalizeClaimLinks(input.claimLinks, blocks, options.claims), origin: originalMarkdown === undefined ? 'model' : 'legacy', ...(originalMarkdown !== undefined ? { originalMarkdown } : {}) };
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
  claims: { id: string; selector: Omit<FactSelector, 'cardinalityRefs'>; value: string; evidenceIds: string[] }[];
  constraints: { id: string; kind: string; rule: CriterionRule; relatedIds: string[] }[];
  currentDraft?: { title: string; bodyMarkdown: string }; repairCriterionIds: string[];
  instructions?: string;
  repairTargets: {id:string;category:string;detail:string;span?:{blockId:string;start:number;end:number};rule?:CriterionRule}[];
  assetSlots: { assetId: string; slotId: string; state: 'omitted' | 'placeholder' | 'included' }[];
}
/** All writer strings are bounded and scrubbed of known restricted values and note-channel text. */
export function writerSafeProjection<T>(s:EditorialSession,value:T):T {
 const restricted=[...protectedValues(s),...[...s.editorialNotes??[],...s.candidate?.editorialNotes??[],...s.review?.notes??[]].map(n=>n.text)].filter(Boolean);
 const safe=(v:unknown):unknown=> typeof v==='string' ? (containsProtectedText(s,v)||restricted.some(text=>publicTextKey(v).includes(publicTextKey(text))) ? '[restricted content withheld]' : v.slice(0,24000)) : Array.isArray(v) ? v.map(safe) : v&&typeof v==='object' ? Object.fromEntries(Object.entries(v).map(([k,x])=>[k,safe(x)])) : v;
 return safe(value) as T;
}
/** No conversation, raw enclosing quotes, internal notes or unfiltered evidence enters writer input. */
export function buildWriterContext(s: EditorialSession, repairCriterionIds: string[] = [], options:{instructions?:string;invalidArtifact?:boolean} = {}): WriterContext {
  const result = resolveFacts(s); const conflictScopes = new Set(result.conflicts.map(g => canonicalScopeId(s, g.selector.scopeId)));
  const claims = result.claims.filter(c => c.epistemic === 'supported' && c.visibility === 'public' && !conflictScopes.has(canonicalScopeId(s, c.selector.scopeId)) && !containsProtectedText(s, c.value) && [c.id, c.selector.scopeId].every(subject => claimPublicationAllowed(s, subject, result.permissions)));
  const surface=s.candidate ?? (s.legacy?.text ? parseDraftArtifact(s.legacy.text,{id:'legacy-edit-surface',revision:0,legacyTitle:s.legacy.title||'Previous draft'}).artifact : undefined);
  const current = surface && !containsProtectedText(s, surface.title + surface.bodyMarkdown) ? { title: surface.title, bodyMarkdown: surface.bodyMarkdown } : undefined;
  const repairs:WriterContext['repairTargets']=[];
  for(const id of repairCriterionIds) {const criterion=s.task.criteria.find(c=>c.id===id);if(criterion)repairs.push({id,category:'criterion',detail:'Satisfy this executable publication constraint.',rule:structuredClone(criterion.rule)});}
  for(const issue of s.review?.issues??[])if(issue.severity==='blocking')repairs.push({id:'review:'+issue.id,category:issue.category,detail:issue.detail.slice(0,2000),...(issue.span?{span:issue.span}:{})});
  for(const [i,detail] of (s.review?.blocking??[]).entries())repairs.push({id:'review:blocking:'+i,category:'review',detail:detail.slice(0,2000)});
  for(const diagnostic of validatePublicArtifact(s))repairs.push({id:'diagnostic:'+diagnostic.code,category:'public_projection',detail:diagnostic.message.slice(0,2000)});
  for(const check of validateAcceptance(s).checks)if(check.status!=='pass')repairs.push({id:check.criterionId,category:'acceptance',detail:check.detail.slice(0,2000)});
  if(options.invalidArtifact)repairs.push({id:'invalid_artifact',category:'format',detail:'Return only title, bodyMarkdown and optional editorialNotes/assets, with a nonempty public article. Do not output claimLinks; the system links claims to blocks from the body. Extra fields or invalid markup are not accepted.'});
  return writerSafeProjection(s, { objective: containsProtectedText(s, s.task.objective) ? 'Prepare the public article using the approved claims and constraints.' : s.task.objective,
    intents: [...s.task.intents], claims: claims.map(c => ({ id: c.id, selector: { scopeId:c.selector.scopeId, predicate:c.selector.predicate, ...(c.selector.metric?{metric:structuredClone(c.selector.metric)}:{}), ...(c.selector.cardinality?{cardinality:c.selector.cardinality}:{}) }, value: c.value, evidenceIds: [...new Set(c.refs.map(r => r.evidenceId))] })),
    constraints: s.task.criteria.map(c => ({ id: c.id, kind: c.rule.kind, rule: c.rule.kind === 'semantic' && containsProtectedText(s, c.rule.instruction) ? { kind: 'semantic', instruction: 'Follow the public task constraints without disclosing restricted material.' } : structuredClone(c.rule), relatedIds: c.rule.kind === 'include_facts' || c.rule.kind === 'exclude_claims' ? [...c.rule.factIds] : c.rule.kind === 'permission' ? [...c.rule.subjectIds] : [] })),
    currentDraft: current, instructions:options.instructions?.slice(0,2000), repairTargets:repairs.slice(0,48), repairCriterionIds:[...new Set([...repairCriterionIds,...repairs.map(r=>r.id)])].slice(0,64), assetSlots: s.candidate?.assets.map(a => ({ assetId: a.assetId, slotId: a.slotId, state: a.state })) ?? [] });
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
    for (const subject of [claim.id, claim.selector.scopeId]) if (!claimPublicationAllowed(s, subject, facts.permissions)) block('claim_permission', 'Included claim needs permission for the publication use, independent from truth.');
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
