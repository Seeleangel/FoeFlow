import { FactClaimSchema, ScopeSchema, PermissionSchema, hashText, stableJson, type EditorialSession, type EvidenceRef, type FactClaim, type FactSelector, type FactResolution, type Diagnostics, type Gap, type PermissionUse, type Scope } from './editorialTypes';
export const FACT_CAPACITY = Object.freeze({ claims: 256, evidenceCharacters: 120_000 });
export function validateEvidenceRef(s: EditorialSession, ref: EvidenceRef): boolean {
  const source = s.evidence.find(e => e.id === ref.evidenceId);
  return !!source && source.revision === ref.revision && source.contentHash === hashText(source.text) && Number.isInteger(ref.start) && Number.isInteger(ref.end) && ref.start >= 0 && ref.end > ref.start && ref.end <= source.text.length && source.text.slice(ref.start, ref.end) === ref.quote;
}
export function validRefs(s: EditorialSession, refs: EvidenceRef[]): boolean { return refs.length > 0 && refs.every(ref => validateEvidenceRef(s, ref)); }
export function selectorKey(selector: FactSelector, scopeIds?: Map<string, string>): string { return stableJson({ ...selector, scopeId: scopeIds?.get(selector.scopeId) ?? selector.scopeId }); }
export function sameSelector(a: FactSelector, b: FactSelector): boolean { return selectorKey(a) === selectorKey(b); }
const normalized = (s: string) => s.normalize('NFKC').replace(/\s+/g, '');
function covers(ref: EvidenceRef, anchor: EvidenceRef) { return ref.evidenceId === anchor.evidenceId && ref.revision === anchor.revision && ref.start <= anchor.start && ref.end >= anchor.end; }
export function alignFactScopes(s: EditorialSession): { scopeIds: Map<string, string>; diagnostics: Diagnostics[] } {
  const scopeIds = new Map(s.scopes.map(scope => [scope.id, scope.id])), diagnostics: Diagnostics[] = [];
  for (const alignment of s.alignments) {
    const left = s.scopes.find(scope => scope.id === alignment.leftId), right = s.scopes.find(scope => scope.id === alignment.rightId);
    if (!left || !right || left.kind !== right.kind || !validRefs(s, alignment.refs) || ![left, right].every(scope => scope.anchors.some(anchor => alignment.refs.some(ref => covers(ref, anchor))))) {
      diagnostics.push({ code: 'invalid_alignment', message: 'Scope alignment requires valid evidence for both identities.', refs: alignment.refs }); continue;
    }
    const a = scopeIds.get(left.id)!, b = scopeIds.get(right.id)!, canonical = [a, b].sort()[0];
    for (const [id, value] of scopeIds) if (value === a || value === b) scopeIds.set(id, canonical);
  }
  return { scopeIds, diagnostics };
}
function makeGap(claim: FactClaim, kind: 'scope' | 'conflict', ids: string[], values: string[]): Gap {
  const key = selectorKey(claim.selector); const id = kind + '-' + hashText(key).slice(0, 24);
  return { id, requirementId: id, kind, selector: claim.selector, label: claim.selector.predicate, reason: kind === 'scope' ? 'Object or event identity requires alignment.' : 'Exclusive values disagree within the same scoped metric.', state: 'open', blocking: true, alternatives: values.map((label, i) => ({ id: ids[i], label, refs: [] })), resolutionClaimIds: [] };
}
/** Model candidates remain candidates: structural evidence validation cannot prove entailment or negation semantics. */
export function resolveFacts(s: EditorialSession): FactResolution {
  const diagnostics: Diagnostics[] = [];
  const report = (code: string, message: string, refs: EvidenceRef[] = []) => diagnostics.push({ code, message, refs });
  if (s.claims.length > FACT_CAPACITY.claims || s.evidence.reduce((n, e) => n + e.text.length, 0) > FACT_CAPACITY.evidenceCharacters) return { claims: [], permissions: [], conflicts: [], diagnostics: [{ code: 'context_capacity', message: 'Process evidence in explicit batches; no truncated fact set is publishable.', refs: [] }] };
  const scopes: Scope[] = [];
  const scopeIdsSeen = new Set<string>();
  for (const scope of s.scopes) {
    if (!ScopeSchema.is(scope) || scopeIdsSeen.has(scope.id) || !validRefs(s, scope.anchors) || scope.qualifiers.some(q => !validRefs(s, q.refs))) report('invalid_scope', 'Scope anchors/qualifiers must identify original evidence.', scope.anchors ?? []);
    else { scopes.push(scope); scopeIdsSeen.add(scope.id); }
  }
  const aligned = alignFactScopes({ ...s, scopes }); diagnostics.push(...aligned.diagnostics);
  const claims: FactClaim[] = [], seen = new Set<string>();
  for (const raw of s.claims) {
    if (!FactClaimSchema.is(raw) || seen.has(raw.id)) { report('invalid_claim', 'Malformed or duplicate fact identity.'); continue; }
    seen.add(raw.id); const claim = structuredClone(raw);
    if (!scopes.some(scope => scope.id === claim.selector.scopeId)) { report('scope_unresolved', 'Fact has no validated scope.', claim.refs); continue; }
    if (!validRefs(s, claim.refs) || !claim.refs.some(ref => normalized(ref.quote).includes(normalized(claim.value)))) { report('invalid_reference', 'Value must be anchored to the unchanged source revision and offsets.', claim.refs); continue; }
    const basis = validRefs(s, claim.statusBasis) && claim.statusBasis.some(ref => normalized(ref.quote).includes(normalized(claim.value)));
    if ((claim.epistemic !== 'supported' && claim.epistemic !== 'unknown' || claim.visibility !== 'public') && !basis) {
      report('missing_status_basis', 'Non-public or uncertain status requires related source evidence; a model label is not authority.', claim.statusBasis); continue;
    }
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
    const old = claims.find(c => c.id === id);
    if (!old || id === claim.id || selectorKey(old.selector, aligned.scopeIds) !== selectorKey(claim.selector, aligned.scopeIds) || !validRefs(s, claim.statusBasis) || !claim.statusBasis.some(ref => normalized(ref.quote).includes(normalized(claim.value)) && s.evidence.find(e => e.id === ref.evidenceId)?.kind === 'editor_message') || (old.supersedes ?? []).includes(claim.id)) report('invalid_supersedes', 'Correction must target a same-selector claim and carry editor evidence.', claim.statusBasis);
    else superseded.add(id);
  }
  const current = claims.filter(c => !superseded.has(c.id)); const groups = new Map<string, FactClaim[]>(); const conflicts: Gap[] = [];
  const relevant = new Set([...s.task.targetScopes, ...s.task.requirements.map(r => r.selector.scopeId), ...s.candidate?.claimLinks.flatMap(link => link.claimIds.flatMap(id => current.filter(c => c.id === id).map(c => c.selector.scopeId))) ?? []]);
  for (const claim of current) {
    const scope = scopes.find(scope => scope.id === claim.selector.scopeId)!;
    if (scope.identity === 'provisional' && !s.alignments.some(a => a.leftId === scope.id || a.rightId === scope.id)) {
      if (relevant.has(scope.id)) conflicts.push(makeGap(claim, 'scope', [claim.id], [claim.value])); continue;
    }
    if (claim.epistemic !== 'supported' && claim.epistemic !== 'disputed') continue;
    const key = selectorKey(claim.selector, aligned.scopeIds); groups.set(key, [...groups.get(key) ?? [], claim]);
  }
  for (const group of groups.values()) {
    const values = [...new Set(group.map(c => normalized(c.value)))];
    if (values.length > 1 || group.some(c => c.epistemic === 'disputed')) conflicts.push(makeGap({ ...group[0], selector: { ...group[0].selector, scopeId: aligned.scopeIds.get(group[0].selector.scopeId)! } }, 'conflict', group.map(c => c.id), group.map(c => c.value)));
  }
  const permissions = s.permissions.filter(p => {
    const valid = PermissionSchema.is(p) && validRefs(s, p.refs) && (scopes.some(scope => scope.id === p.subjectId) || claims.some(c => c.id === p.subjectId));
    if (!valid) report('invalid_permission', 'Permission needs an identified subject, use and evidence.', p.refs); return valid;
  });
  return { claims: current, conflicts: [...new Map(conflicts.map(g => [g.id, g])).values()], diagnostics, permissions: structuredClone(permissions) };
}
/** Denied/withdrawn/unknown matching uses cannot be cancelled by a separate allowed record. */
export function permissionAllows(s: EditorialSession, subjectId: string, use: PermissionUse): boolean {
  const permissions = resolveFacts(s).permissions.filter(p => p.subjectId === subjectId && p.uses.some(u => stableJson(u) === stableJson(use)));
  return permissions.length > 0 && permissions.every(p => p.state === 'allowed');
}
