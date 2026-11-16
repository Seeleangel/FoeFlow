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
  if (taskPatch) taskPatch = guardOutputRequirements(session, taskPatch, diagnostics);
  if (taskPatch) next.taskPatch = taskPatch;
  if (raw.editorialNotes !== undefined) next.editorialNotes = normalizeNotes(raw.editorialNotes);
  if (diagnostics.length) next.diagnostics = diagnostics;
  return next;
}

function items(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function id(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function obj(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }

function repairRef(session: EditorialSession, raw: unknown): EvidenceRef | undefined {
  const ref = obj(raw); const evidenceId = id(ref?.evidenceId) ?? id(ref?.refId); const quote = typeof ref?.quote === 'string' ? ref.quote : '';
  // Models legitimately abbreviate the protocol: refId instead of evidenceId, or no revision at all.
  // Accept both shapes when the quote still anchors to exactly one evidence record; never invent text.
  if (!evidenceId) return;
  const revision = typeof ref?.revision === 'number' && Number.isInteger(ref.revision) ? ref.revision : undefined;
  const source = revision === undefined ? session.evidence.find(e => e.id === evidenceId) : session.evidence.find(e => e.id === evidenceId && e.revision === revision);
  if (!source) return;
  const evidenceRevision = source.revision;
  if (quote) {
    const start = source.text.indexOf(quote);
    if (start < 0) return;
    return { evidenceId, revision: evidenceRevision, start, end: start + quote.length, quote };
  }
  // Live models sometimes emit refs with an empty quote. An empty quote must never
  // discard the whole obligation: fall back to the exact span the model pointed at,
  // or to the full evidence span, so the claim stays grounded and the task survives.
  const start = typeof ref?.start === 'number' && Number.isInteger(ref.start) ? ref.start : -1;
  const end = typeof ref?.end === 'number' && Number.isInteger(ref.end) ? ref.end : -1;
  if (start >= 0 && end > start && end <= source.text.length) return { evidenceId, revision: evidenceRevision, start, end, quote: source.text.slice(start, end) };
  if (!source.text.length) return;
  return { evidenceId, revision: evidenceRevision, start: 0, end: source.text.length, quote: source.text };
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
  // Live models sometimes wrap anchors as { refs: [...], text: "..." } instead of a flat ref.
  // Flatten that shape so a valid scope is not dropped (and its claims with it).
  const anchorItems = items(scope.anchors).flatMap(item => { const anchor = obj(item); return anchor && anchor.refs !== undefined ? items(anchor.refs) : [item]; });
  const anchors = repairRefs(session, anchorItems); if (!anchors.length) return [];
  const kind = (SCOPE_KINDS as readonly string[]).includes(String(scope.kind)) ? scope.kind : 'other';
  const qualifierObject = obj(scope.qualifiers);
  const qualifiers = Array.isArray(scope.qualifiers)
    ? scope.qualifiers.flatMap(item => { const q = obj(item); const key = id(q?.key); const value = id(q?.value) ?? (typeof q?.value === 'number' ? String(q.value) : undefined); const refs = repairRefs(session, q?.refs); return key && value && refs.length ? [{ key, value, refs }] : []; })
    : qualifierObject ? Object.entries(qualifierObject).flatMap(([key, value]) => id(key) && (typeof value === 'string' || typeof value === 'number') ? [{ key, value: String(value), refs: anchors }] : []) : [];
  return [{ id: scopeId, kind, label, anchors, qualifiers, identity: scope.identity === 'aligned' ? 'aligned' : 'provisional' }];
}
/** Models often normalize an editor's date into ISO; fact values must stay anchored to the source spelling. */
function claimValue(value: string, refs: EvidenceRef[]): string {
  const squash = (text: string): string => text.replace(/\s+/g, '');
  if (refs.some(ref => squash(ref.quote).includes(squash(value)))) return value;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    for (const ref of refs) {
      const match = ref.quote.match(/(?:\d{4}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*日(?:\s*\d{1,2}:\d{2})?/);
      const fragment = match ? match[0].trim() : '';
      if (fragment && refs.some(candidate => squash(candidate.quote).includes(squash(fragment)))) return fragment;
    }
  }
  return value;
}
/** Re-anchor a claim whose model-selected quote does not actually contain its value.
 * Ref drift is extremely common in live output ("quote":"帮" for a paragraph of facts); the claim must stay
 * grounded, so pick the exact occurrence of the value in the untouched evidence text instead of dropping it.
 * Only exact substrings are used; nothing is invented. ISO timestamps are mapped back to the date text. */
function reanchorClaimRef(session: EditorialSession, value: string): { ref: EvidenceRef; value: string } | undefined {
  const sources = session.evidence.filter(evidence => evidence.text.length);
  for (const source of sources) {
    const start = source.text.indexOf(value);
    if (start >= 0) return { ref: { evidenceId: source.id, revision: source.revision, start, end: start + value.length, quote: value }, value };
  }
  const timestamp = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!timestamp) return;
  const [, , , day, hour, minute] = timestamp;
  for (const source of sources) {
    const pattern = /(?:\d{4}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*日(?:\s*\d{1,2}:\d{2})?/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source.text))) {
      const parts = /(?:\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*(\d{1,2}):(\d{2}))?/.exec(match[0]);
      if (!parts) continue;
      const [, matchDay, matchHour, matchMinute] = parts;
      if (Number(matchDay) !== Number(day) || matchHour === undefined || Number(matchHour) !== Number(hour) || Number(matchMinute) !== Number(minute)) continue;
      const quote = source.text.slice(match.index, match.index + match[0].length);
      return { ref: { evidenceId: source.id, revision: source.revision, start: match.index, end: match.index + match[0].length, quote }, value: quote.trim() };
    }
  }
  return undefined;
}
function normalizeClaim(session: EditorialSession, raw: unknown): Record<string, unknown>[] {
  const claim = obj(raw); const claimId = id(claim?.id); const selector = obj(claim?.selector); const scopeId = id(selector?.scopeId); const predicate = id(selector?.predicate)?.slice(0, 120); const value = id(claim?.value) ?? (typeof claim?.value === 'number' && Number.isFinite(claim.value) ? String(claim.value) : undefined);
  if (!claim || !claimId || !scopeId || !predicate || !value) return [];
  let refs = repairRefs(session, claim.refs); if (!refs.length) return [];
  let anchoredValue = claimValue(value, refs);
  const squashValue = (text: string): string => text.replace(/\s+/g, '');
  if (!refs.some(ref => squashValue(ref.quote).includes(squashValue(anchoredValue)))) {
    const reanchored = reanchorClaimRef(session, anchoredValue);
    if (reanchored) { refs = [reanchored.ref]; anchoredValue = reanchored.value; }
  }
  // A missing or empty basis must stay empty so resolveFacts can still report missing_status_basis.
  // Only a non-array shape (e.g. a model prose label) keeps the legacy repair-by-refs fallback.
  const statusBasis = claim.statusBasis === undefined || claim.statusBasis === null ? [] : Array.isArray(claim.statusBasis) ? repairRefs(session, claim.statusBasis) : refs;
  const next: Record<string, unknown> = { id: claimId, selector: { scopeId, predicate }, value: anchoredValue, refs, epistemic: EPISTEMIC[String(claim.epistemic)] ?? 'pending', visibility: claim.visibility === 'editor_only' || claim.visibility === 'private' ? claim.visibility : 'public', statusBasis };
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

/** A requirement that restates the writing task or a source lookup is not an unknown fact.
 * Asking it stalls a draft the agent could already write; keep it as a review obligation instead.
 * Applies to legacy model task patches and to direct/merged directive patches alike. */
function guardOutputRequirements(session: EditorialSession, taskPatch: Record<string, unknown>, diagnostics: Diagnostics[]): Record<string, unknown> {
  const requirements = items(taskPatch.requirements).flatMap(requirement => { const item = obj(requirement); return item ? [item] : []; });
  if (!requirements.length) return taskPatch;
  const sourceTask = items(taskPatch.requiredSources).length > 0;
  const editorText = session.evidence.filter(evidence => evidence.kind === 'editor_message').map(evidence => evidence.text).join('\n');
  const deferToReview = /可以先交|可先交|先交|先发|放编辑备注/.test(editorText);
  const outputWords = /正文|草稿|备注|字数|篇幅|结构|标题|语气|格式|文体|写法|句子|段落|导语|首句|末句|口径|文案|措辞|文章内容/;
  const sourceWords = /工作台|素材|材料|来源|查取|查阅|记录单|结果单|原通知|外宣稿/;
  const kept = requirements.map(requirement => {
    const description = [id(requirement.label), id(obj(requirement.selector)?.predicate), id(requirement.reason), id(requirement.whyNeeded)].filter((part): part is string => !!part).join('｜');
    const looksLikeOutput = outputWords.test(description);
    const looksLikeSourceTask = sourceTask && sourceWords.test(description);
    if (!looksLikeOutput && !looksLikeSourceTask && !deferToReview) return requirement;
    const refs = items(requirement.refs).flatMap(ref => { const item = obj(ref); return item ? [item as unknown as EvidenceRef] : []; });
    diagnostics.push({ owner: 'directive:guard:g6', code: 'requirement_is_output_or_source_task', message: 'Requirement restates the output/source task rather than an unknown fact; defaulted to non-askable pending review: ' + (id(requirement.label) ?? ''), refs });
    return { ...requirement, askable: false, requiresReview: true };
  });
  return { ...taskPatch, requirements: kept };
}

