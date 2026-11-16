import { EditorialSessionSchema, FactClaimSchema, ScopeSchema, PermissionSchema, hashText, stableJson, sameEntitySet, type EditorialSession, type EvidenceRef, type FactClaim, type FactSelector, type FactResolution, type Diagnostics, type Gap, type PermissionUse, type Permission, type Scope } from './editorialTypes';
export const FACT_CAPACITY = Object.freeze({ claims: 256, evidenceCharacters: 120_000 });
export function validateEvidenceRef(s: EditorialSession, ref: EvidenceRef): boolean {
  const source = s.evidence.find(e => e.id === ref.evidenceId);
  return !!source && source.revision === ref.revision && source.contentHash === hashText(source.text) && Number.isInteger(ref.start) && Number.isInteger(ref.end) && ref.start >= 0 && ref.end > ref.start && ref.end <= source.text.length && source.text.slice(ref.start, ref.end) === ref.quote;
}
export function validRefs(s: EditorialSession, refs: EvidenceRef[]): boolean { return refs.length > 0 && refs.every(ref => validateEvidenceRef(s, ref)); }
export function selectorKey(selector: FactSelector, scopeIds?: Map<string, string>): string { return stableJson({ predicate: selector.predicate, metric: selector.metric, scopeId: scopeIds?.get(selector.scopeId) ?? selector.scopeId }); }
export function sameSelector(a: FactSelector, b: FactSelector): boolean { return selectorKey(a) === selectorKey(b); }
/** Canonical identity is shared by every fact/permission/requirement consumer. Original IDs remain auditable. */
export function canonicalScopeId(s: EditorialSession, id: string): string { return alignFactScopes(s).scopeIds.get(id) ?? id; }
export function selectorsEquivalent(s: EditorialSession, a: FactSelector, b: FactSelector): boolean {
  const ids = alignFactScopes(s).scopeIds; return selectorKey(a, ids) === selectorKey(b, ids);
}
function subjectKey(s: EditorialSession, id: string): string {
  const claim = s.claims.find(c => c.id === id);
  return claim ? 'claim:' + selectorKey(claim.selector, alignFactScopes(s).scopeIds) + ':' + normalized(claim.value) : 'scope:' + canonicalScopeId(s, id);
}
export function hasSubjectPermissions(s: EditorialSession, id: string): boolean { return s.permissions.some(p => subjectKey(s, p.subjectId) === subjectKey(s, id)); }
const normalized = (s: string) => s.normalize('NFKC').replace(/\s+/g, '');
function covers(ref: EvidenceRef, anchor: EvidenceRef) { return ref.evidenceId === anchor.evidenceId && ref.revision === anchor.revision && ref.start <= anchor.start && ref.end >= anchor.end; }
export function alignFactScopes(s: EditorialSession): { scopeIds: Map<string, string>; alignedScopeIds: Set<string>; diagnostics: Diagnostics[] } {
  const scopeIds = new Map(s.scopes.map(scope => [scope.id, scope.id])), diagnostics: Diagnostics[] = [], alignedScopeIds = new Set<string>();
  for (const alignment of s.alignments) {
    const left = s.scopes.find(scope => scope.id === alignment.leftId), right = s.scopes.find(scope => scope.id === alignment.rightId);
    if (!left || !right || left.id === right.id || left.kind !== right.kind || !validRefs(s, alignment.refs) || ![left, right].every(scope => scope.anchors.some(anchor => alignment.refs.some(ref => covers(ref, anchor))))) {
      diagnostics.push({ owner:'facts:alignments:'+alignment.leftId+':'+alignment.rightId, code: 'invalid_alignment', message: 'Scope alignment requires valid evidence for both identities.', refs: alignment.refs }); continue;
    }
    alignedScopeIds.add(left.id); alignedScopeIds.add(right.id);
    const a = scopeIds.get(left.id)!, b = scopeIds.get(right.id)!, canonical = [a, b].sort()[0];
    for (const [id, value] of scopeIds) if (value === a || value === b) scopeIds.set(id, canonical);
  }
  return { scopeIds, alignedScopeIds, diagnostics };
}
function makeGap(claim: FactClaim, kind: 'scope' | 'conflict', ids: string[], values: string[]): Gap {
  const key = selectorKey(claim.selector); const id = kind + '-' + hashText(key).slice(0, 24);
  return { id, requirementId: id, kind, selector: claim.selector, label: claim.selector.predicate, reason: kind === 'scope' ? 'Object or event identity requires alignment.' : 'Exclusive values disagree within the same scoped metric.', state: 'open', blocking: true, alternatives: values.map((label, i) => ({ id: ids[i], label, refs: [] })), resolutionClaimIds: [] };
}
/** Model candidates remain candidates: structural evidence validation cannot prove entailment or negation semantics. */
export function resolveFacts(s: EditorialSession): FactResolution {
  const diagnostics: Diagnostics[] = [];
  let owner='facts:resolution';
  const report = (code: string, message: string, refs: EvidenceRef[] = []) => diagnostics.push({ owner, code, message, refs });
  if (s.claims.length > FACT_CAPACITY.claims || s.evidence.reduce((n, e) => n + e.text.length, 0) > FACT_CAPACITY.evidenceCharacters) return { claims: [], permissions: [], conflicts: [], diagnostics: [{ owner:'facts:capacity', code: 'context_capacity', message: 'Process evidence in explicit batches; no truncated fact set is publishable.', refs: [] }] };
  const scopes: Scope[] = [];
  const scopeIdsSeen = new Set<string>();
  for (const scope of s.scopes) {
    owner='facts:scopes:'+scope.id;
    if (!ScopeSchema.is(scope) || scopeIdsSeen.has(scope.id) || !validRefs(s, scope.anchors) || scope.qualifiers.some(q => !validRefs(s, q.refs))) report('invalid_scope', 'Scope anchors/qualifiers must identify original evidence.', scope.anchors ?? []);
    else { scopes.push(scope); scopeIdsSeen.add(scope.id); }
  }
  const aligned = alignFactScopes({ ...s, scopes }); diagnostics.push(...aligned.diagnostics);
  const claims: FactClaim[] = [], seen = new Set<string>();
  for (const raw of s.claims) {
    owner='facts:claims:'+raw.id;
    if (!FactClaimSchema.is(raw) || seen.has(raw.id)) { report('invalid_claim', 'Malformed or duplicate fact identity.'); continue; }
    seen.add(raw.id); const claim = structuredClone(raw);
    if (!scopes.some(scope => scope.id === claim.selector.scopeId)) { report('scope_unresolved', 'Fact has no validated scope.', claim.refs); continue; }
    if (!validRefs(s, claim.refs) || !claim.refs.some(ref => normalized(ref.quote).includes(normalized(claim.value)))) { report('invalid_reference', 'Value must be anchored to the unchanged source revision and offsets.', claim.refs); continue; }
    const basis = validRefs(s, claim.statusBasis) && claim.statusBasis.some(ref => normalized(ref.quote).includes(normalized(claim.value)));
    if ((claim.epistemic !== 'supported' && claim.epistemic !== 'unknown' || claim.visibility !== 'public') && !basis) {
      report('missing_status_basis', 'Non-public or uncertain status requires related source evidence; a model label is not authority.', claim.statusBasis); continue;
    }
    if (claim.selector.cardinality === 'set' && !validRefs(s, claim.selector.cardinalityRefs ?? [])) { report('invalid_cardinality_basis', 'Additive assertions need a grounded cardinality decision.', claim.refs); continue; }
    const legacyRefs = claim.refs.filter(ref => s.evidence.find(e => e.id === ref.evidenceId)?.kind === 'legacy_draft');
    if (legacyRefs.length) {
      const original = legacyRefs.flatMap(ref => s.evidence.find(e => e.id === ref.evidenceId)?.provenance.originClaimIds ?? []).flatMap(id => s.claims.filter(c => c.id === id && c.id !== claim.id && c.epistemic === 'supported' && sameSelector(c.selector, claim.selector) && normalized(c.value) === normalized(claim.value) && validRefs(s, c.refs) && c.refs.every(r => s.evidence.find(e => e.id === r.evidenceId)?.kind !== 'legacy_draft')));
      if (original.length) claim.refs = original.flatMap(c => c.refs);
      else { claim.epistemic = 'unknown'; report('legacy_not_evidence', 'Generated prose cannot attest its own claims.', claim.refs); }
    }
    claims.push(claim);
  }
  const superseded = new Set<string>();
  for (const claim of claims) for (const id of claim.supersedes ?? []) {
    owner='facts:claims:'+claim.id;
    const old = claims.find(c => c.id === id);
    if (!old || id === claim.id || selectorKey(old.selector, aligned.scopeIds) !== selectorKey(claim.selector, aligned.scopeIds) || !validRefs(s, claim.statusBasis) || !claim.statusBasis.some(ref => normalized(ref.quote).includes(normalized(claim.value)) && s.evidence.find(e => e.id === ref.evidenceId)?.kind === 'editor_message') || (old.supersedes ?? []).includes(claim.id)) report('invalid_supersedes', 'Correction must target a same-selector claim and carry editor evidence.', claim.statusBasis);
    else superseded.add(id);
  }
  const current = claims.filter(c => !superseded.has(c.id)); const groups = new Map<string, FactClaim[]>(); const conflicts: Gap[] = [];
  const relevant = new Set([...s.task.targetScopes, ...s.task.requirements.map(r => r.selector.scopeId), ...s.candidate?.claimLinks.flatMap(link => link.claimIds.flatMap(id => current.filter(c => c.id === id).map(c => c.selector.scopeId))) ?? []]);
  const publicText = normalized((s.candidate?.title ?? '') + (s.candidate?.bodyMarkdown ?? '') + (s.candidate?.assets.map(a => a.publicCaption ?? '').join('') ?? ''));
  for (const claim of current) if (publicText && publicText.includes(normalized(claim.value))) relevant.add(claim.selector.scopeId);
  for (const criterion of s.task.criteria) if (criterion.rule.kind === 'include_facts') for (const id of criterion.rule.factIds) { const claim = current.find(c => c.id === id); if (claim) relevant.add(claim.selector.scopeId); }
  const relevantCanonical = new Set([...relevant].map(id => aligned.scopeIds.get(id) ?? id));
  for (const claim of current) {
    const scope = scopes.find(scope => scope.id === claim.selector.scopeId)!;
    // The synthetic 'editor' scope anchors the editor's own message and 'authorization:*' scopes record
    // preview confirmation attempts; neither is a second content subject, so they must not be read as a
    // same-kind identity that makes every provisional content scope look ambiguous.
    const contentScopes = scopes.filter(other => other.id !== 'editor' && !other.id.startsWith('authorization:'));
    const duplicateIdentity = contentScopes.some(other => other.id !== scope.id && other.kind === scope.kind && stableJson(other.anchors) === stableJson(scope.anchors) && stableJson(other.qualifiers) === stableJson(scope.qualifiers) && aligned.scopeIds.get(other.id) !== aligned.scopeIds.get(scope.id));
    // A provisional identity is only genuinely ambiguous when another same-kind identity exists or an alignment
    // attempt names this scope. A lone scope described by one authoritative editor message is not ambiguity;
    // asking the editor to "align" it would demand information the editor never withheld.
    const ambiguousIdentity = contentScopes.some(other => other.id !== scope.id && other.kind === scope.kind && aligned.scopeIds.get(other.id) !== aligned.scopeIds.get(scope.id)) || s.alignments.some(alignment => alignment.leftId === scope.id || alignment.rightId === scope.id);
    if ((scope.identity === 'provisional' && !aligned.alignedScopeIds.has(scope.id) && ambiguousIdentity) || duplicateIdentity) {
      if (relevantCanonical.has(aligned.scopeIds.get(scope.id) ?? scope.id)) conflicts.push(makeGap(claim, 'scope', [claim.id], [claim.value])); continue;
    }
    if (claim.epistemic !== 'supported' && claim.epistemic !== 'disputed') continue;
    const key = selectorKey(claim.selector, aligned.scopeIds); groups.set(key, [...groups.get(key) ?? [], claim]);
  }
  // An editor who lists several references in one sentence intends them together ("参考A和B"), not as an exclusive value.
  const editorSentences = s.evidence.filter(e => e.kind === 'editor_message').map(e => normalized(e.text).split(/[。；;！!？?\n]/));
  const jointReferences = (predicate: string, values: string[]) => /参考|来源|素材|材料|依据|引用/.test(predicate) && values.length > 1 && editorSentences.some(sentences => sentences.some(sentence => {
    const positions = values.map(value => sentence.indexOf(value));
    if (positions.some(position => position < 0)) return false;
    return !/[或]|不是|而非|而不是/.test(sentence.slice(Math.min(...positions), Math.max(...positions)));
  }));
  for (const group of groups.values()) {
    const values = [...new Set(group.map(c => normalized(c.value)))];
    const additive = group.every(c => c.selector.cardinality === 'set' && validRefs(s, c.selector.cardinalityRefs ?? []));
    if (values.length > 1 && !additive && !jointReferences(group[0].selector.predicate, values) || group.some(c => c.epistemic === 'disputed')) conflicts.push({ ...makeGap({ ...group[0], selector: { ...group[0].selector, scopeId: aligned.scopeIds.get(group[0].selector.scopeId)! } }, 'conflict', group.map(c => c.id), group.map(c => c.value)), blocking: relevantCanonical.has(aligned.scopeIds.get(group[0].selector.scopeId) ?? group[0].selector.scopeId) });
  }
  const permissions = s.permissions.filter(p => {
    const valid = PermissionSchema.is(p) && validRefs(s, p.refs) && (scopes.some(scope => scope.id === p.subjectId) || claims.some(c => c.id === p.subjectId));
    if (!valid) {owner='facts:permissions:'+p.id;report('invalid_permission', 'Permission needs an identified subject, use and evidence.', p.refs);} return valid;
  });
  return { claims: current, conflicts: [...new Map(conflicts.map(g => [g.id, g])).values()], diagnostics, permissions: structuredClone(permissions) };
}
/** Denied/withdrawn/unknown matching uses cannot be cancelled by a separate allowed record. */
export function permissionAllows(s: EditorialSession, subjectId: string, use: PermissionUse): boolean {
  const permissions = resolveFacts(s).permissions.filter(p => subjectKey(s, p.subjectId) === subjectKey(s, subjectId) && p.uses.some(u => stableJson(u) === stableJson(use)));
  return permissions.length > 0 && permissions.every(p => p.state === 'allowed');
}

/** A permission attached to the claim itself is authoritative for every publication use (fail closed); a scope-wide permission only constrains the uses it declares, so an unrelated denial cannot block the whole scope's facts. */
export function claimPublicationAllowed(s: EditorialSession, subjectId: string, permissions: Permission[] = resolveFacts(s).permissions): boolean {
  if (!hasSubjectPermissions(s, subjectId)) return true;
  const claimScoped = s.claims.some(claim => subjectKey(s, claim.id) === subjectKey(s, subjectId));
  return claimPublicationUses(s, subjectId).every(use => {
    const matching = permissions.filter(permission => subjectKey(s, permission.subjectId) === subjectKey(s, subjectId) && permission.uses.some(item => stableJson(item) === stableJson(use)));
    return matching.length ? matching.every(permission => permission.state === 'allowed') : !claimScoped;
  });
}

/** Evidence-backed upserts; omissions never delete prior claims and invalid changes cannot downgrade them.
 * Preflight-only: this returns a new invalidated session. Runtime integration may instead emit its fact arrays as one facts_resolved event. */
function patchFacts(session: EditorialSession, raw: unknown, authority: 'model' | 'editor'): EditorialSession {
  const next = structuredClone(session);
  const touched = new Set<string>();
  if (raw && typeof raw === 'object') for (const key of ['claims', 'scopes', 'permissions'] as const) {
    const values: unknown = (raw as Record<string, unknown>)[key];
    if (Array.isArray(values)) for (const value of values) if (value && typeof value === 'object' && typeof value.id === 'string') touched.add('facts:' + key + ':' + value.id);
  }
  const successfulOwners=new Set<string>(); // A mention is not a validated repair.
  const diagnose = (code: string, message: string, owner = 'facts:patch') => {
    next.diagnostics = [...next.diagnostics.filter(d => d.code !== code || d.owner !== owner), { owner, code, message, refs: [] }]; return next;
  };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !['scopes', 'alignments', 'claims', 'permissions'].includes(key))) return diagnose('invalid_fact_patch', 'Expected structured candidate upserts.');
  try {
    const patch = raw as Record<string, unknown>;
    const merge = <T extends { id: string }>(old: T[], candidates: unknown): T[] => {
      if (candidates === undefined) return old;
      if (!Array.isArray(candidates)) throw new Error('invalid_patch');
      const map = new Map(old.map(item => [item.id, item]));
      for (const item of candidates as T[]) { if (!item || typeof item.id !== 'string') throw new Error('invalid_patch'); map.set(item.id, item); }
      return [...map.values()];
    };
    let schemaInvalid=false;
    for(const [key,schema] of [['claims',FactClaimSchema],['scopes',ScopeSchema],['permissions',PermissionSchema]] as const) {
      const values=patch[key];if(values===undefined)continue;
      if(!Array.isArray(values)){diagnose('invalid_fact_patch','Expected candidate arrays.','facts:operation:'+key);schemaInvalid=true;continue;}
      for(const item of values)if(!schema.is(item)){diagnose('invalid_'+key,'Malformed candidate retained as an owned failure.','facts:'+key+':'+(item&&typeof item==='object'&&typeof item.id==='string'?item.id:hashText(stableJson(item)).slice(0,24)));schemaInvalid=true;}
    }
    if(schemaInvalid){
      // Reject the batch transactionally; no owner is resolved merely by appearing before a malformed peer.
      for(const owner of touched)if(!next.diagnostics.some(d=>d.owner===owner))diagnose('batch_candidate_not_validated','Candidate was not applied because its batch failed validation; resend this owner or explicitly dismiss it.',owner);
      return next;
    }
    const candidate = EditorialSessionSchema.parse({ ...next, scopes: merge(next.scopes, patch.scopes), claims: merge(next.claims, patch.claims), permissions: merge(next.permissions, patch.permissions), alignments: patch.alignments === undefined ? next.alignments : [...new Map([...next.alignments, ...(patch.alignments as EditorialSession['alignments'])].map(item => [stableJson(item), item])).values()] });
    const resolved = resolveFacts(candidate);const failedOwners=new Set(resolved.diagnostics.map(d=>d.owner));
    for (const diagnostic of resolved.diagnostics) next.diagnostics.push(diagnostic);
    if (resolved.diagnostics.some(d => d.code === 'context_capacity')) return next;
    const claims = new Map(session.claims.map(c => [c.id, c]));
    for (const claim of resolved.claims) {
      const previous = claims.get(claim.id);
      if (previous && (stableJson(previous.selector) !== stableJson(claim.selector) || previous.value !== claim.value)) { diagnose('claim_identity_changed', 'Changed assertions require a new ID and targeted supersedes evidence.', 'facts:claims:' + claim.id); continue; }
      if (previous) {
        const rank = { public: 0, editor_only: 1, private: 2 };
        const relatedNewBasis = validRefs(candidate, claim.statusBasis) && claim.statusBasis.some(ref =>
          normalized(ref.quote).includes(normalized(claim.value)) &&
          ![...previous.refs, ...previous.statusBasis].some(old => old.evidenceId === ref.evidenceId && old.revision === ref.revision && old.start <= ref.start && old.end >= ref.end));
        if (rank[claim.visibility] < rank[previous.visibility] && (authority !== 'editor' || !relatedNewBasis || claim.statusBasis.some(ref => candidate.evidence.find(e => e.id === ref.evidenceId)?.kind !== 'editor_message'))) {
          diagnose('declassification_requires_editor', 'Confidentiality relaxation needs a new related editor decision.', 'facts:claims:' + claim.id); continue;
        }
        if (previous.epistemic === 'supported' && claim.epistemic !== 'supported' && !relatedNewBasis) {
          diagnose('status_transition_without_basis', 'An uncertain extraction cannot erase an established assertion.', 'facts:claims:' + claim.id); continue;
        }
      }
      claims.set(claim.id, claim);const owner='facts:claims:'+claim.id;if(touched.has(owner)&&!failedOwners.has(owner))successfulOwners.add(owner);
    }
    next.claims = [...claims.values()]; next.scopes = candidate.scopes; next.alignments = candidate.alignments;
    const permissions = new Map(session.permissions.map(p => [p.id, p]));
    for (const permission of resolved.permissions) {
      const previous = permissions.get(permission.id);
      if (previous && (previous.subjectId !== permission.subjectId || !sameEntitySet(previous.uses, permission.uses))) {
        diagnose('permission_identity_immutable', 'Permission subject and use history cannot be rebound; create a distinct decision.', 'facts:permissions:' + permission.id); continue;
      }
      if (previous && previous.state !== 'allowed' && permission.state === 'allowed' && (authority !== 'editor' || !permission.refs.some(ref => candidate.evidence.find(e => e.id === ref.evidenceId)?.kind === 'editor_message' && !previous.refs.some(old => old.evidenceId === ref.evidenceId && old.revision === ref.revision)))) { diagnose('permission_upgrade_requires_editor', 'Restricted permission cannot be promoted by a model candidate.', 'facts:permissions:' + permission.id); continue; }
      permissions.set(permission.id, permission);const owner='facts:permissions:'+permission.id;if(touched.has(owner)&&!failedOwners.has(owner))successfulOwners.add(owner);
    }
    next.permissions = [...permissions.values()];
    for(const scope of candidate.scopes){const owner='facts:scopes:'+scope.id;if(touched.has(owner)&&!failedOwners.has(owner))successfulOwners.add(owner);}
    for(const key of ['claims','scopes','permissions'] as const){const items=patch[key];if(Array.isArray(items)&&items.every(item=>successfulOwners.has('facts:'+key+':'+item.id)))successfulOwners.add('facts:operation:'+key);}
    next.diagnostics=[...new Map(next.diagnostics.filter(d=>!d.owner||!successfulOwners.has(d.owner)).map(d=>[stableJson([d.owner,d.code,d.refs]),d])).values()];
    if (sameEntitySet(next.claims, session.claims) && sameEntitySet(next.scopes, session.scopes) && sameEntitySet(next.permissions, session.permissions) && sameEntitySet(next.alignments, session.alignments)) return next;
    delete next.review; delete next.layout; delete next.gate; next.humanVerifications = []; next.phase = next.candidate ? 'writing' : 'planning'; next.selectedOutput = 'candidate';
    next.evidenceRevision++; next.policyRevision++; next.revision++; return next;
  } catch { return diagnose('invalid_fact_patch', 'Malformed candidate patch; prior facts retained.'); }
}

export function applyFactPatch(session: EditorialSession, raw: unknown): EditorialSession { return patchFacts(session, raw, 'model'); }
/** Explicit editor action, never exposed as a model tool. Identity rebinding is still forbidden. */
export function applyEditorFactPatch(session: EditorialSession, raw: unknown): EditorialSession { return patchFacts(session, raw, 'editor'); }

/** Explicit task use wins; never broaden anonymous permission into named publication. */
export function claimPublicationUses(s: EditorialSession, subjectId: string): PermissionUse[] {
  const uses = s.task.criteria.flatMap(c => c.rule.kind === 'permission' && c.rule.subjectIds.some(id => subjectKey(s, id) === subjectKey(s, subjectId)) ? [{ channel: c.rule.channel ?? 'public', purpose: c.rule.use, identity: c.rule.identity ?? 'not_applicable' }] : []);
  return uses.length ? uses : [{ channel: 'public', purpose: 'publication', identity: 'not_applicable' }];
}

/** Trusted editor dismissal of a rejected proposal, never an extractor/tool authority. */
export function resolveEditorDiagnostic(session:EditorialSession,owner:string,refs:EvidenceRef[]):EditorialSession {
 if(!session.diagnostics.some(d=>d.owner===owner)||!validRefs(session,refs)||refs.some(r=>session.evidence.find(e=>e.id===r.evidenceId)?.kind!=='editor_message'))throw Error('invalid_diagnostic_resolution');
 const next=structuredClone(session);next.diagnostics=next.diagnostics.filter(d=>d.owner!==owner);delete next.review;delete next.layout;delete next.gate;next.humanVerifications=[];next.selectedOutput='candidate';next.revision++;
 next.editorialNotes=[...next.editorialNotes??[],{id:'resolved-'+hashText(owner+stableJson(refs)).slice(0,24),kind:'process',text:'Editor explicitly rejected/resolved diagnostic owner '+owner,relatedIds:[owner]}];return next;
}
