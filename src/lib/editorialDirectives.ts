/**
 * Step 3 directive pipeline (design §4.2/§4.5). The model classifies spans into
 * directives; the program decides which structure each directive becomes. G1-G4
 * guards keep output requirements out of the editor question list.
 */
import { hashText, stableJson, type AcceptanceCriterion, type Diagnostics, type EditorialSession, type EvidenceRef, type FactClaim, type InformationRequirement, type Permission, type RequiredSource, type Scope } from './editorialTypes';

export type DirectiveKind = 'constraint' | 'fact' | 'missing_value' | 'authorization' | 'source' | 'goal';
const KINDS: readonly DirectiveKind[] = ['constraint', 'fact', 'missing_value', 'authorization', 'source', 'goal'];

export interface Directive {
  kind: DirectiveKind;
  text: string;
  refs: EvidenceRef[];
  confidence: number;
  entityId?: string;
  rule?: Record<string, unknown>;
  scopeId?: string;
  predicate?: string;
  value?: string;
  label?: string;
  whyNeeded?: string;
  subjectId?: string;
  use?: string;
  channel?: string;
  identity?: 'named' | 'anonymous' | 'not_applicable';
  documentId?: string;
  title?: string;
  purpose?: string;
  intents?: string[];
}

export interface DirectiveDiagnostics { diagnostics: Diagnostics[] }

function obj(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function id(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function items(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function clamp(value: number): number { return Math.max(0, Math.min(1, value)); }

function repairRef(session: EditorialSession, raw: unknown): EvidenceRef | undefined {
  const ref = obj(raw); const evidenceId = id(ref?.evidenceId); const quote = typeof ref?.quote === 'string' ? ref.quote.trim() : '';
  if (!evidenceId || !quote || typeof ref?.revision !== 'number' || !Number.isInteger(ref.revision)) return undefined;
  const source = session.evidence.find(evidence => evidence.id === evidenceId && evidence.revision === ref.revision);
  if (!source) return undefined;
  const start = source.text.indexOf(quote);
  return start < 0 ? undefined : { evidenceId, revision: ref.revision, start, end: start + quote.length, quote };
}
function repairRefs(session: EditorialSession, raw: unknown): EvidenceRef[] {
  const seen = new Set<string>(); const refs: EvidenceRef[] = [];
  for (const item of items(raw)) { const ref = repairRef(session, item); if (!ref) continue; const key = stableJson(ref); if (seen.has(key)) continue; seen.add(key); refs.push(ref); }
  return refs;
}
function quoteRef(session: EditorialSession, quote: string): EvidenceRef | undefined {
  for (const evidence of session.evidence) {
    if (evidence.kind !== 'editor_message' && evidence.kind !== 'import') continue;
    const start = evidence.text.indexOf(quote);
    if (start >= 0) return { evidenceId: evidence.id, revision: evidence.revision, start, end: start + quote.length, quote };
  }
  return undefined;
}
function editorSpan(session: EditorialSession): EvidenceRef | undefined {
  const evidence = session.evidence.find(record => (record.kind === 'editor_message' || record.kind === 'import') && record.text.length);
  return evidence ? { evidenceId: evidence.id, revision: evidence.revision, start: 0, end: evidence.text.length, quote: evidence.text } : undefined;
}
function resolveRefs(session: EditorialSession, raw: Record<string, unknown>, text: string): EvidenceRef[] {
  const explicit = repairRefs(session, raw.refs);
  if (explicit.length) return explicit;
  const quote = id(raw.quote) ?? id(obj(raw.span)?.quote) ?? id(obj(raw.sourceSpan)?.quote) ?? text;
  const found = quoteRef(session, quote);
  if (found) return [found];
  const span = editorSpan(session);
  return span ? [span] : [];
}

export function normalizeDirectives(session: EditorialSession, raw: unknown): { directives: Directive[]; diagnostics: Diagnostics[] } {
  const diagnostics: Diagnostics[] = [];
  const directives: Directive[] = [];
  for (const entry of items(raw)) {
    const item = obj(entry); if (!item) continue;
    const kindValue = id(item.kind) ?? id(item.type);
    const kind = kindValue && (KINDS as readonly string[]).includes(kindValue) ? kindValue as DirectiveKind : undefined;
    const text = id(item.text) ?? id(item.instruction) ?? id(item.value) ?? id(item.label) ?? id(item.content);
    if (!kind || !text) { diagnostics.push({ owner: 'directive:normalize', code: 'invalid_directive', message: 'Directive needs a known kind and nonempty text.', refs: [] }); continue; }
    const refs = resolveRefs(session, item, text);
    if (!refs.length) { diagnostics.push({ owner: 'directive:normalize', code: 'invalid_directive_reference', message: 'Directive text is not an exact editor evidence span.', refs: [] }); continue; }
    const confidence = typeof item.confidence === 'number' && Number.isFinite(item.confidence) ? clamp(item.confidence) : 1;
    const downgrade = confidence < 0.5 && (kind === 'missing_value' || kind === 'authorization' || kind === 'source');
    const effectiveKind: DirectiveKind = downgrade ? 'constraint' : kind;
    if (downgrade) diagnostics.push({ owner: 'directive:guard:g4', code: 'low_confidence_directive', message: 'Uncertain classification defaults to a constraint; no editor question is raised.', refs });
    const rule = obj(item.rule);
    const identity = item.identity === 'named' || item.identity === 'anonymous' || item.identity === 'not_applicable' ? item.identity : undefined;
    const directive: Directive = {
      kind: effectiveKind, text, refs, confidence,
      ...(id(item.id) ? { entityId: id(item.id) } : {}),
      ...(rule ? { rule } : {}),
      ...(id(item.scopeId) ?? id(item.scope_id) ? { scopeId: id(item.scopeId) ?? id(item.scope_id) } : {}),
      ...(id(item.predicate) ? { predicate: id(item.predicate) } : {}),
      ...(id(item.value) ? { value: id(item.value) } : {}),
      ...(id(item.label) ? { label: id(item.label) } : {}),
      ...(id(item.whyNeeded) ?? id(item.why_needed) ?? id(item.dependsOn) ?? id(item.depends_on) ?? id(item.reason) ? { whyNeeded: id(item.whyNeeded) ?? id(item.why_needed) ?? id(item.dependsOn) ?? id(item.depends_on) ?? id(item.reason) } : {}),
      ...(id(item.subjectId) ?? id(item.subject_id) ? { subjectId: id(item.subjectId) ?? id(item.subject_id) } : {}),
      ...(id(item.use) ?? id(item.purpose) ? { use: id(item.use) ?? id(item.purpose) } : {}),
      ...(id(item.channel) ? { channel: id(item.channel) } : {}),
      ...(identity ? { identity } : {}),
      ...(id(obj(item.selector)?.documentId) ?? id(item.documentId) ? { documentId: id(obj(item.selector)?.documentId) ?? id(item.documentId) } : {}),
      ...(id(obj(item.selector)?.title) ?? id(item.title) ? { title: id(obj(item.selector)?.title) ?? id(item.title) } : {}),
      ...(id(item.purpose) ? { purpose: id(item.purpose) } : {}),
      ...(items(item.intents).map(id).some(Boolean) ? { intents: items(item.intents).map(id).filter((value): value is string => !!value) } : {}),
    };
    directives.push(directive);
  }
  return { directives, diagnostics };
}

function sameScope(left: string | undefined, right: string | undefined): boolean { return !left || !right || left === right; }
function normalizedText(value: string): string { return value.replace(/[\s，。；、：:,.!?！？"'“”‘’（）()\[\]【】]/g, '').toLowerCase(); }
function lexicalOverlap(left: string, right: string): boolean {
  const a = normalizedText(left), b = normalizedText(right);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) >= 4;
  const bigrams = (text: string) => { const chars = [...text]; const set = new Set<string>(); for (let index = 0; index < chars.length - 1; index++) set.add(chars[index] + chars[index + 1]); return set; };
  const aSet = bigrams(a), bSet = bigrams(b);
  const shared = [...aSet].filter(item => bSet.has(item)).length;
  return shared >= 2 && shared / Math.max(1, Math.min(aSet.size, bSet.size)) >= 0.4;
}
function refsOverlap(left: EvidenceRef[], right: EvidenceRef[]): boolean {
  return left.some(a => right.some(b => a.evidenceId === b.evidenceId && (a.quote === b.quote || (a.start < b.end && b.start < a.end))));
}

export interface ConstraintSpan { text: string; refs: EvidenceRef[]; scopeId?: string }

/** G1/G2 run only where the model explicitly classified a span as a constraint. */
export function guardTaskPatchRequirements(taskPatch: Record<string, unknown>, constraints: ConstraintSpan[], diagnostics: Diagnostics[]): Record<string, unknown> {
  const requirements = items(taskPatch.requirements).flatMap(requirement => { const item = obj(requirement); return item ? [item] : []; });
  if (!requirements.length || !constraints.length) return taskPatch;
  const criteria = items(taskPatch.criteria).flatMap(criterion => { const item = obj(criterion); return item ? [item] : []; });
  const kept: Record<string, unknown>[] = [];
  for (const requirement of requirements) {
    const refs = items(requirement.refs).flatMap(ref => { const item = obj(ref); return item ? [item as unknown as EvidenceRef] : []; });
    const duplicate = constraints.find(constraint => refsOverlap(refs, constraint.refs));
    if (duplicate) {
      const label = id(requirement.label) ?? id(requirement.id) ?? '要求';
      const why = id(requirement.whyNeeded) ?? id(requirement.reason) ?? '';
      criteria.push({
        id: 'from-requirement-' + hashText(String(requirement.id ?? label)).slice(0, 20), origin: 'user', refs,
        rule: { kind: 'semantic', instruction: label + (why ? '：' + why : '') }, severity: 'blocking', verification: 'semantic',
      });
      diagnostics.push({ owner: 'directive:guard:g1', code: 'requirement_duplicates_constraint', message: 'Requirement span was classified as a constraint and became a criterion: ' + label, refs });
      continue;
    }
    const overlap = constraints.find(constraint => sameScope(constraint.scopeId, id(obj(requirement.selector)?.scopeId)) &&
      (lexicalOverlap(id(requirement.label) ?? '', constraint.text) || lexicalOverlap(id(obj(requirement.selector)?.predicate) ?? '', constraint.text)));
    if (overlap) {
      requirement.askable = false; requirement.requiresReview = true;
      diagnostics.push({ owner: 'directive:guard:g2', code: 'requirement_overlaps_constraint', message: 'Requirement overlaps an output constraint; defaulted to non-askable pending review.', refs });
    }
    kept.push(requirement);
  }
  return { ...taskPatch, requirements: kept, criteria };
}

function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim()) : []; }
/** Malformed structured rules degrade to a semantic criterion instead of rejecting the whole task patch. */
function coerceDirectiveRule(directive: Directive): AcceptanceCriterion['rule'] {
  const rule = directive.rule; const kind = rule && typeof rule.kind === 'string' ? rule.kind : undefined;
  const semantic = (): AcceptanceCriterion['rule'] => ({ kind: 'semantic', instruction: String(directive.rule?.instruction ?? directive.text) });
  if (!rule || !kind) return semantic();
  if (kind === 'semantic') return { kind: 'semantic', instruction: id(rule.instruction) ?? id(rule.description) ?? directive.text };
  if (kind === 'include_facts' || kind === 'exclude_claims') {
    const factIds = stringArray(rule.factIds); if (!factIds.length) return semantic();
    return kind === 'include_facts' ? { kind, factIds, location: rule.location === 'first_body_paragraph' ? 'first_body_paragraph' : 'body' } : { kind, factIds };
  }
  if (kind === 'length') {
    const min = typeof rule.min === 'number' && Number.isFinite(rule.min) ? rule.min : undefined;
    const max = typeof rule.max === 'number' && Number.isFinite(rule.max) ? rule.max : undefined;
    if (min === undefined && max === undefined) return semantic();
    return { kind: 'length', unit: 'visible_characters', ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
  }
  if (kind === 'preserve_blocks') { const blockHashes = stringArray(rule.blockHashes); return blockHashes.length ? { kind, blockHashes } : semantic(); }
  if (kind === 'permission') {
    const subjectIds = stringArray(rule.subjectIds), use = id(rule.use);
    if (!subjectIds.length || !use) return semantic();
    return { kind, subjectIds, use, ...(id(rule.channel) ? { channel: id(rule.channel) } : {}), ...(rule.identity === 'named' || rule.identity === 'anonymous' || rule.identity === 'not_applicable' ? { identity: rule.identity } : {}) };
  }
  if (kind === 'source_read') { const sourceRequirementId = id(rule.sourceRequirementId); return sourceRequirementId ? { kind, sourceRequirementId } : semantic(); }
  return semantic();
}

export function directivesToPatches(session: EditorialSession, directives: Directive[], diagnostics: Diagnostics[] = []): { factPatch: Record<string, unknown>; taskPatch: Record<string, unknown>; diagnostics: Diagnostics[] } {
  const scopes: Scope[] = []; const claims: FactClaim[] = []; const permissions: Permission[] = [];
  const criteria: AcceptanceCriterion[] = []; const requirements: InformationRequirement[] = []; const requiredSources: RequiredSource[] = [];
  const goals: string[] = []; const intents: string[] = [];
  const scopeIds = new Set(session.scopes.map(scope => scope.id));
  const usedIds = new Set([...session.task.requirements, ...session.task.criteria, ...session.task.requiredSources].map(item => item.id));
  const takeId = (preferred: string | undefined, prefix: string): string => {
    const base = preferred ?? prefix + '-' + hashText(stableJson(directives.map(directive => [directive.kind, directive.text]))).slice(0, 16);
    let candidate = base, index = 2; while (usedIds.has(candidate)) candidate = base + '-' + index++; usedIds.add(candidate); return candidate;
  };
  const ensureScope = (scopeId: string, label: string, refs: EvidenceRef[]) => {
    if (scopeIds.has(scopeId) || !refs.length) return; scopeIds.add(scopeId);
    scopes.push({ id: scopeId, kind: 'other', label: label.slice(0, 120) || scopeId, anchors: [refs[0]], qualifiers: [], identity: 'aligned' });
  };
  const INTENTS = ['inform', 'call_to_action', 'retrospective', 'interview', 'edit', 'example', 'other'] as const;
  const mapIntent = (text: string): typeof INTENTS[number] => {
    if (/报名|号召|参加|行动|订阅/.test(text)) return 'call_to_action';
    if (/回顾|复盘/.test(text)) return 'retrospective';
    if (/访谈|采访/.test(text)) return 'interview';
    if (/修改|改写/.test(text)) return 'edit';
    if (/示例/.test(text)) return 'example';
    if (/通知|告知|介绍|说明|发布/.test(text)) return 'inform';
    return 'other';
  };
  for (const directive of directives) {
    if (directive.kind === 'constraint') {
      const rule = coerceDirectiveRule(directive);
      criteria.push({ id: takeId(directive.entityId, 'directive-criterion'), origin: 'user', refs: directive.refs, rule, severity: 'blocking', verification: rule.kind === 'semantic' ? 'semantic' : 'deterministic' });
      continue;
    }
    if (directive.kind === 'fact') {
      const scopeId = directive.scopeId ?? 'editor';
      ensureScope(scopeId, '编辑消息', directive.refs);
      claims.push({ id: takeId(directive.entityId, 'directive-fact'), selector: { scopeId, predicate: (directive.predicate ?? directive.text).slice(0, 120) }, value: directive.value ?? directive.text, refs: directive.refs, epistemic: 'supported', visibility: 'public', statusBasis: directive.refs });
      continue;
    }
    if (directive.kind === 'missing_value') {
      if (!directive.whyNeeded) {
        diagnostics.push({ owner: 'directive:guard:g3', code: 'requirement_without_dependency', message: 'Missing-value directive has no whyNeeded; no question is created.', refs: directive.refs });
        continue;
      }
      const scopeId = directive.scopeId ?? 'editor';
      ensureScope(scopeId, '编辑消息', directive.refs);
      requirements.push({ id: takeId(directive.entityId, 'directive-requirement'), selector: { scopeId, predicate: (directive.predicate ?? directive.text).slice(0, 120) }, label: directive.label ?? directive.text, reason: directive.whyNeeded, whyNeeded: directive.whyNeeded, refs: directive.refs, necessity: 'blocking', resolution: 'supply_fact' });
      continue;
    }
    if (directive.kind === 'authorization') {
      const subjectId = directive.subjectId ?? 'authorization:' + hashText(directive.text).slice(0, 12);
      const use = directive.use ?? directive.text;
      const channel = directive.channel ?? 'public';
      const identity = directive.identity ?? 'not_applicable';
      ensureScope(subjectId, directive.text, directive.refs);
      criteria.push({ id: takeId(directive.entityId, 'directive-criterion'), origin: 'user', refs: directive.refs, rule: { kind: 'permission', subjectIds: [subjectId], use, channel, identity }, severity: 'blocking', verification: 'deterministic' });
      permissions.push({ id: takeId(undefined, 'directive-permission'), subjectId, uses: [{ channel, purpose: use, identity }], state: 'unknown', refs: directive.refs });
      continue;
    }
    if (directive.kind === 'source') {
      requiredSources.push({ id: takeId(directive.entityId, 'directive-source'), selector: { ...(directive.documentId ? { documentId: directive.documentId } : {}), ...(directive.title ?? directive.text ? { title: directive.title ?? directive.text } : {}) }, purpose: directive.purpose ?? directive.text, refs: directive.refs, depth: 'relevant_excerpt', state: 'pending' });
      continue;
    }
    goals.push(directive.text);
    for (const intent of directive.intents ?? [mapIntent(directive.text)]) if ((INTENTS as readonly string[]).includes(intent)) intents.push(intent);
  }
  const allRefs = [...new Map(directives.flatMap(directive => directive.refs).map(ref => [stableJson(ref), ref])).values()];
  return {
    factPatch: { scopes, claims, permissions, alignments: [] },
    taskPatch: {
      baseRevision: session.task.revision, refs: allRefs,
      ...(goals.length ? { objective: goals.join('；') } : {}),
      ...(intents.length ? { intents: [...new Set(intents)] } : {}),
      criteria, requirements, requiredSources,
    },
    diagnostics,
  };
}

export function directiveConstraints(directives: Directive[]): ConstraintSpan[] {
  return directives.filter(directive => directive.kind === 'constraint').map(directive => ({ text: directive.text, refs: directive.refs, ...(directive.scopeId ? { scopeId: directive.scopeId } : {}) }));
}
