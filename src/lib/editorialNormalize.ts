import { hashText, type Diagnostics, type EditorialSession, type EvidenceRef } from './editorialTypes';
import { directiveConstraints, directivesToPatches, guardTaskPatchRequirements, normalizeDirectives } from './editorialDirectives';

const INTENTS = ['inform', 'call_to_action', 'retrospective', 'interview', 'edit', 'example', 'other'] as const;
const SCOPE_KINDS = ['event', 'person', 'organization', 'asset', 'project', 'other'] as const;
const EPISTEMIC: Record<string, 'supported' | 'pending' | 'disputed' | 'unknown'> = {
  supported: 'supported', pending: 'pending', disputed: 'disputed', unknown: 'unknown',
  asserted: 'supported', verified: 'supported', confirmed: 'supported', explicit: 'supported', stated: 'supported',
};

function arrays(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function mergeTaskPatches(session: EditorialSession, legacy: Record<string, unknown> | undefined, directive: Record<string, unknown>): Record<string, unknown> {
  if (!legacy) return directive;
  const refs = [...new Map([...arrays(legacy.refs), ...arrays(directive.refs)].map(ref => [JSON.stringify(ref), ref])).values()];
  const intents = [...new Set([...arrays(legacy.intents), ...arrays(directive.intents)])];
  return {
    ...legacy, ...directive, baseRevision: session.task.revision, refs,
    objective: directive.objective ?? legacy.objective,
    ...(intents.length ? { intents } : {}),
    targetScopes: [...new Set([...arrays(legacy.targetScopes), ...arrays(directive.targetScopes)])],
    requirements: [...arrays(legacy.requirements), ...arrays(directive.requirements)],
    requiredSources: [...arrays(legacy.requiredSources), ...arrays(directive.requiredSources)],
    criteria: [...arrays(legacy.criteria), ...arrays(directive.criteria)],
  };
}

/** Model preflight JSON is consistently off-schema: wrong enums, nested rules, string notes, and quote offsets. Repair only spans whose quote is an exact source substring. */
export function normalizeModelExtraction(session: EditorialSession, raw: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  const directiveResult = raw.directives !== undefined ? normalizeDirectives(session, raw.directives) : { directives: [], diagnostics: [] as Diagnostics[] };
  const diagnostics: Diagnostics[] = [...directiveResult.diagnostics];
  const directivePatches = directiveResult.directives.length ? directivesToPatches(session, directiveResult.directives, diagnostics) : undefined;
  const constraints = directiveConstraints(directiveResult.directives);
  const fact = raw.factPatch && typeof raw.factPatch === 'object' && !Array.isArray(raw.factPatch) ? raw.factPatch as Record<string, unknown> : {};
  const directiveFact = directivePatches?.factPatch;
  next.factPatch = {
    scopes: [...items(fact.scopes).flatMap(item => normalizeScope(session, item)), ...arrays(directiveFact?.scopes)],
    claims: [...items(fact.claims).flatMap(item => normalizeClaim(session, item)), ...arrays(directiveFact?.claims)],
    permissions: [...items(fact.permissions).flatMap(item => normalizePermission(session, item)), ...arrays(directiveFact?.permissions)],
    alignments: [...items(fact.alignments).flatMap(item => normalizeAlignment(session, item)), ...arrays(directiveFact?.alignments)],
  };
  let taskPatch = raw.taskPatch && typeof raw.taskPatch === 'object' && !Array.isArray(raw.taskPatch) ? normalizeTaskPatch(session, raw.taskPatch as Record<string, unknown>) : undefined;
  const directiveTask = directivePatches?.taskPatch;
  const hasDirectiveTask = !!directiveTask && (
    arrays(directiveTask.criteria).length > 0 || arrays(directiveTask.requirements).length > 0 || arrays(directiveTask.requiredSources).length > 0 ||
    directiveTask.objective !== undefined || directiveTask.intents !== undefined
  );
  if (directiveTask && hasDirectiveTask) taskPatch = mergeTaskPatches(session, taskPatch, directiveTask);
  if (taskPatch && constraints.length) taskPatch = guardTaskPatchRequirements(taskPatch, constraints, diagnostics);
  if (taskPatch) next.taskPatch = taskPatch;
  if (raw.editorialNotes !== undefined) next.editorialNotes = normalizeNotes(raw.editorialNotes);
  if (diagnostics.length) next.diagnostics = diagnostics;
  return next;
}

function items(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function id(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function obj(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }

function repairRef(session: EditorialSession, raw: unknown): EvidenceRef | undefined {
  const ref = obj(raw); const evidenceId = id(ref?.evidenceId); const quote = typeof ref?.quote === 'string' ? ref.quote : '';
  if (!evidenceId || !quote || typeof ref?.revision !== 'number' || !Number.isInteger(ref.revision)) return;
  const source = session.evidence.find(e => e.id === evidenceId && e.revision === ref.revision);
  if (!source) return;
  const start = source.text.indexOf(quote);
  if (start < 0) return;
  return { evidenceId, revision: ref.revision, start, end: start + quote.length, quote };
}
function repairRefs(session: EditorialSession, raw: unknown): EvidenceRef[] {
  const seen = new Set<string>(); const refs: EvidenceRef[] = [];
  for (const item of items(raw)) {
    const ref = repairRef(session, item); if (!ref) continue;
    const key = JSON.stringify(ref); if (seen.has(key)) continue;
    seen.add(key); refs.push(ref);
  }
  return refs;
}
function editorRefs(session: EditorialSession, raw: unknown): EvidenceRef[] {
  return repairRefs(session, raw).filter(ref => {
    const kind = session.evidence.find(e => e.id === ref.evidenceId)?.kind;
    return kind === 'editor_message' || kind === 'import';
  });
}
function editorSpan(session: EditorialSession): EvidenceRef | undefined {
  const source = session.evidence.find(e => (e.kind === 'editor_message' || e.kind === 'import') && e.text.length);
  return source ? { evidenceId: source.id, revision: source.revision, start: 0, end: source.text.length, quote: source.text } : undefined;
}

function normalizeScope(session: EditorialSession, raw: unknown): Record<string, unknown>[] {
  const scope = obj(raw); const scopeId = id(scope?.id); const label = id(scope?.label); if (!scope || !scopeId || !label) return [];
  const anchors = repairRefs(session, scope.anchors); if (!anchors.length) return [];
  const kind = (SCOPE_KINDS as readonly string[]).includes(String(scope.kind)) ? scope.kind : 'other';
  const qualifierObject = obj(scope.qualifiers);
  const qualifiers = Array.isArray(scope.qualifiers)
    ? scope.qualifiers.flatMap(item => { const q = obj(item); const key = id(q?.key); const value = id(q?.value) ?? (typeof q?.value === 'number' ? String(q.value) : undefined); const refs = repairRefs(session, q?.refs); return key && value && refs.length ? [{ key, value, refs }] : []; })
    : qualifierObject ? Object.entries(qualifierObject).flatMap(([key, value]) => id(key) && (typeof value === 'string' || typeof value === 'number') ? [{ key, value: String(value), refs: anchors }] : []) : [];
  return [{ id: scopeId, kind, label, anchors, qualifiers, identity: scope.identity === 'aligned' ? 'aligned' : 'provisional' }];
}
function normalizeClaim(session: EditorialSession, raw: unknown): Record<string, unknown>[] {
  const claim = obj(raw); const claimId = id(claim?.id); const selector = obj(claim?.selector); const scopeId = id(selector?.scopeId); const predicate = id(selector?.predicate)?.slice(0, 120); const value = id(claim?.value);
  if (!claim || !claimId || !scopeId || !predicate || !value) return [];
  const refs = repairRefs(session, claim.refs); if (!refs.length) return [];
  // A missing or empty basis must stay empty so resolveFacts can still report missing_status_basis.
  // Only a non-array shape (e.g. a model prose label) keeps the legacy repair-by-refs fallback.
  const statusBasis = claim.statusBasis === undefined || claim.statusBasis === null ? [] : Array.isArray(claim.statusBasis) ? repairRefs(session, claim.statusBasis) : refs;
  const next: Record<string, unknown> = { id: claimId, selector: { scopeId, predicate }, value, refs, epistemic: EPISTEMIC[String(claim.epistemic)] ?? 'pending', visibility: claim.visibility === 'editor_only' || claim.visibility === 'private' ? claim.visibility : 'public', statusBasis };
  if (selector?.cardinality === 'single' || selector?.cardinality === 'set') next.selector = { ...next.selector as object, cardinality: selector.cardinality };
  return [next];
}
function normalizePermission(session: EditorialSession, raw: unknown): Record<string, unknown>[] {
  const permission = obj(raw); const permissionId = id(permission?.id); const subjectId = id(permission?.subjectId); if (!permission || !permissionId || !subjectId) return [];
  const uses = items(permission.uses).flatMap(item => { const use = obj(item); const channel = id(use?.channel); const purpose = id(use?.purpose); if (!channel || !purpose) return []; return [{ channel, purpose, identity: use?.identity === 'named' || use?.identity === 'anonymous' ? use.identity : 'not_applicable' }]; });
  const refs = repairRefs(session, permission.refs);
  const state = ['allowed', 'denied', 'unknown', 'withdrawn'].includes(String(permission.state)) ? permission.state : 'unknown';
  return uses.length && refs.length ? [{ id: permissionId, subjectId, uses, state, refs }] : [];
}
function normalizeAlignment(session: EditorialSession, raw: unknown): Record<string, unknown>[] {
  const alignment = obj(raw); const leftId = id(alignment?.leftId); const rightId = id(alignment?.rightId); const refs = repairRefs(session, alignment?.refs);
  return leftId && rightId && refs.length ? [{ leftId, rightId, refs }] : [];
}

function mapIntent(value: unknown): typeof INTENTS[number] {
  if (typeof value === 'string' && (INTENTS as readonly string[]).includes(value)) return value as typeof INTENTS[number];
  const text = typeof value === 'string' ? value : String(obj(value)?.label ?? obj(value)?.id ?? '');
  if (/提醒|号召|报名|参加|行动/.test(text)) return 'call_to_action';
  if (/回顾|复盘/.test(text)) return 'retrospective';
  if (/访谈|采访/.test(text)) return 'interview';
  if (/修改|改写/.test(text)) return 'edit';
  if (/示例/.test(text)) return 'example';
  if (/通知|告知|介绍|说明/.test(text)) return 'inform';
  return 'other';
}
function coerceRule(raw: unknown): Record<string, unknown> | undefined {
  const rule = obj(raw); if (!rule) return;
  const nested = ['include_facts', 'exclude_claims', 'length', 'preserve_blocks', 'permission', 'source_read', 'semantic'].find(kind => kind in rule);
  const kind = id(rule.kind) ?? id(rule.type) ?? nested;
  const inner = nested && !rule.kind && !rule.type ? rule[nested] : rule;
  const body = obj(inner) ?? {};
  if (kind === 'include_facts') {
    const factIds = items(body.factIds).map(id).filter((item): item is string => !!item);
    return factIds.length ? { kind, factIds, location: body.location === 'first_body_paragraph' ? 'first_body_paragraph' : 'body' } : undefined;
  }
  if (kind === 'exclude_claims') {
    const factIds = items(body.factIds).map(id).filter((item): item is string => !!item);
    if (factIds.length) return { kind, factIds };
    const phrases = items(Array.isArray(inner) ? inner : rule.exclude_claims).filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    return phrases.length ? { kind: 'semantic', instruction: '不要写入未授权说法：' + phrases.join('、') } : undefined;
  }
  if (kind === 'length') {
    if (body.unit === 'visible_characters' && (typeof body.min === 'number' || typeof body.max === 'number')) {
      const next: Record<string, unknown> = { kind, unit: 'visible_characters' };
      if (typeof body.min === 'number') next.min = body.min;
      if (typeof body.max === 'number') next.max = body.max;
      return next;
    }
    return { kind: 'semantic', instruction: '长度约束无法按字符校验，保留为语义要求：' + JSON.stringify({ min: body.min, max: body.max, unit: body.unit }) };
  }
  if (kind === 'preserve_blocks') {
    const blockHashes = items(body.blockHashes).map(id).filter((item): item is string => !!item);
    return blockHashes.length ? { kind, blockHashes } : undefined;
  }
  if (kind === 'permission') {
    const subjectIds = items(body.subjectIds).map(id).filter((item): item is string => !!item); const use = id(body.use);
    if (!subjectIds.length || !use) return;
    const next: Record<string, unknown> = { kind, subjectIds, use };
    if (id(body.channel)) next.channel = body.channel;
    if (body.identity === 'named' || body.identity === 'anonymous' || body.identity === 'not_applicable') next.identity = body.identity;
    return next;
  }
  if (kind === 'source_read') {
    const sourceRequirementId = id(body.sourceRequirementId) ?? items(body.sourceIds).map(id).find((item): item is string => !!item) ?? items(rule.sourceIds).map(id).find((item): item is string => !!item);
    return sourceRequirementId ? { kind, sourceRequirementId } : undefined;
  }
  const instruction = id(body.instruction) ?? id(body.description) ?? id(rule.semantic) ?? id(rule.description) ?? (typeof inner === 'string' ? inner : undefined);
  return kind === 'semantic' && instruction ? { kind: 'semantic', instruction } : undefined;
}
function normalizeTaskPatch(session: EditorialSession, patch: Record<string, unknown>): Record<string, unknown> | undefined {
  const span = editorSpan(session); if (!span) return;
  const used = new Set<string>();
  const take = (preferred: unknown, prefix: string) => { let next = id(preferred) ?? prefix; let n = 2; while (used.has(next)) next = (id(preferred) ?? prefix) + '-' + n++; used.add(next); return next; };
  const sources = items(patch.requiredSources).flatMap(item => {
    const source = obj(item); const selector = obj(source?.selector); const title = id(selector?.title); const documentId = id(selector?.documentId); const refs = editorRefs(session, source?.refs);
    if (!source || (!title && !documentId) || !refs.length) return [];
    return [{ id: take(source.id, 'source'), selector: { ...(documentId ? { documentId } : {}), ...(title ? { title } : {}) }, purpose: id(source.purpose) ?? 'source', refs, depth: source.depth === 'full_document' ? 'full_document' : 'relevant_excerpt', state: source.state === 'satisfied' || source.state === 'unavailable' ? source.state : 'pending' }];
  });
  const sourceIds = new Set(sources.map(source => source.id));
  const requirements = items(patch.requirements).flatMap(item => {
    const requirement = obj(item); const selector = obj(requirement?.selector); const scopeId = id(selector?.scopeId); const predicate = id(selector?.predicate)?.slice(0, 120); const refs = editorRefs(session, requirement?.refs);
    if (!requirement || !scopeId || !predicate || !refs.length) return [];
    const whyNeeded = id(requirement.whyNeeded) ?? id(requirement.why_needed);
    return [{ id: take(requirement.id, 'requirement'), selector: { scopeId, predicate }, label: id(requirement.label) ?? predicate, reason: id(requirement.reason) ?? predicate, ...(whyNeeded ? { whyNeeded } : {}), refs, necessity: requirement.necessity === 'optional' ? 'optional' : 'blocking', resolution: requirement.resolution === 'select_option' || requirement.resolution === 'omit_or_replace' ? requirement.resolution : 'supply_fact' }];
  });
  const criteria = items(patch.criteria).flatMap(item => {
    const criterion = obj(item); const rule = coerceRule(criterion?.rule); const refs = editorRefs(session, criterion?.refs);
    if (!criterion || !rule || !refs.length) return [];
    if (rule.kind === 'source_read' && !sourceIds.has(String(rule.sourceRequirementId))) return [];
    const verification = rule.kind === 'semantic' ? 'semantic' : criterion.verification === 'semantic' || criterion.verification === 'human' ? criterion.verification : 'deterministic';
    return [{ id: take(criterion.id, 'criterion'), origin: 'user', refs, rule, severity: criterion.severity === 'advisory' ? 'advisory' : 'blocking', verification }];
  });
  const itemRefs = [...requirements, ...criteria, ...sources].flatMap(item => item.refs as EvidenceRef[]);
  const covered = editorRefs(session, patch.refs);
  for (const ref of [span, ...itemRefs]) {
    if (!covered.some(basis => JSON.stringify(basis) === JSON.stringify(ref))) covered.push(ref);
  }
  const intents = [...new Set(items(patch.intents).map(mapIntent))];
  return { baseRevision: session.task.revision, refs: covered, objective: id(patch.objective) ?? span.quote.slice(0, 200), intents: intents.length ? intents : ['other'], targetScopes: items(patch.targetScopes).map(id).filter((item): item is string => !!item), requirements, requiredSources: sources, criteria };
}
function normalizeNotes(raw: unknown): Record<string, unknown>[] {
  return items(Array.isArray(raw) ? raw : [raw]).flatMap(item => {
    const text = typeof item === 'string' ? item.trim() : id(obj(item)?.text);
    if (!text) return [];
    const note = obj(item);
    const kind = note?.kind === 'asset' || note?.kind === 'fact_check' || note?.kind === 'advisory' ? note.kind : 'process';
    return [{ id: id(note?.id) ?? 'note-' + hashText(text).slice(0, 24), kind, text, relatedIds: items(note?.relatedIds).map(id).filter((related): related is string => !!related) }];
  });
}
