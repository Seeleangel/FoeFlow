import { abortable, throwIfAborted } from './agentRuntime';
import { parseJsonObject } from './agentValidation';
import { applyFactPatch, canonicalScopeId, resolveFacts } from './editorialFacts';
import { applyTaskPatch } from './editorialTask';
import { normalizeModelExtraction } from './editorialNormalize';
import { taskContractValid } from './editorialContract';
import { deriveGaps, buildQuestion, buildIntakeQuestion } from './editorialGaps';
import { buildWriterContext, parseDraftArtifact } from './editorialDocument';
import { makePublicDocument, renderPublicDocument } from './editorialOutput';
import { validateAcceptance, sourceRequirementSatisfied, sourceWaiver } from './editorialAcceptance';
import { applyToolEvents, startEditorialRun } from './editorialState';
import { applyEditorTurn, ensureQuestionState, activeBatch, latestUnprocessedEditorMessage, questionProjection, sessionAsTurnView } from './editorialTurnState';
import { processEditorTurn, validateAnswerMappings, type AnswerMappingResult } from './editorialTurnProcessor';
import type { ModelCallRecord, RunReport, StopRecord } from './editorialTypesV3';
import { classifyFailure, failureFromError, makeStopRecord, type FailureDescriptor } from './editorialFailure';
import { loadRequiredSource, readSourceDocument, recordSourceConsumption, SourceSearchCache, localSourcePort, type SourcePort } from './editorialSources';
import { getAllThemes, getDefaultTheme } from './themeLoader';
import { DEFAULT_RUN_BUDGET, RunBudgetSchema, ToolActionSchema, ReviewStampSchema, EditorialNoteSchema, gateEffectOf, hashText, stableJson, sameEntitySet, currentInputKey, sameInputKey, type EditorialSession, type EditorialOutcome, type EditorialToolEvent, type ToolAction, type ToolResult, type RunBudget, type GateReport, type LoadedSource, type EditorialNote, type ReviewStamp } from './editorialTypes';
export type EditorialStage = 'preflight' | 'extract' | 'decide' | 'write' | 'review' | 'repair' | 'mapping';
export type EditorialModelPort = (request: { stage: EditorialStage; data: Record<string, unknown> }, signal: AbortSignal) => Promise<string>;
export interface ControllerOptions {
  session: EditorialSession; model: EditorialModelPort; signal: AbortSignal; sources?: SourcePort; budget?: Partial<RunBudget>;
  template?: { name: string; structureJson: Record<string, unknown> }; runId?: string; now?: () => number; isCurrent?: () => boolean;
  onEvent?: (event: EditorialToolEvent) => void; onCheckpoint?: (session: EditorialSession) => void; onToolResult?: (result: ToolResult) => void; onStep?: (label: string) => void;
  /** Retry after a structured stop: reuse the persisted contract instead of re-planning it. */
  resumeFromStop?: boolean;
}
type Payload = EditorialToolEvent extends infer E ? E extends EditorialToolEvent ? Omit<E, 'sessionId' | 'runId' | 'expectedRevision'> : never : never;
const openGaps = (s: EditorialSession) => deriveGaps(s).filter(g => g.blocking && (g.state === 'open' || g.state === 'asked'));
/** One gate for review shortcuts, submit, resume and final confirmation. */
export function canHandoff(s: EditorialSession): GateReport {
  const gate = validateAcceptance(s, s.layout); const key = currentInputKey(s);
  const require = (id: string, passed: boolean, detail: string) => { gate.checks.push({ criterionId: id, status: passed ? 'pass' : 'unknown', verifier: 'controller', detail }); if (!passed) gate.blockers.push(id); };
  require('review_current', !!s.review && sameInputKey(s.review.inputKey, key) && !s.review.blocking.length && !s.review.issues.some(issue => issue.severity === 'blocking'), '同一输入版本须完成无阻断审稿。');
  require('layout_current', !!s.layout && s.layout.contentHash === key.contentHash && s.layout.htmlHash === hashText(s.layout.html), '同版公开正文须完成排版。');
  for (const gap of openGaps(s)) require(gap.id, false, gap.label + '：' + gap.reason);
  gate.blockers = [...new Set(gate.blockers)]; return gate;
}
export function allowedActions(s: EditorialSession, budget: RunBudget): ToolAction['tool'][] {
  const actions: ToolAction['tool'][] = [];
  if (budget.searches > 0) actions.push('search');
  if (s.task.requiredSources.some(source => !sourceRequirementSatisfied(s, source) && !sourceWaiver(s, source.id))) actions.push('read');
  if (openGaps(s).length) actions.push('ask');
  if (budget.writes > 0 && budget.modelCalls > 0 && taskContractValid(s) && !openGaps(s).length) actions.push('write');
  if (s.candidate && budget.modelCalls > 0 && (!s.review || !sameInputKey(s.review.inputKey, currentInputKey(s)))) actions.push('review');
  if (s.candidate && makePublicDocument(s).document && (!s.layout || s.layout.contentHash !== s.candidate.contentHash)) actions.push('layout');
  if (!canHandoff(s).blockers.length) actions.push('submit'); return actions;
}
/** Canonical semantic identities exclude envelope/entity UUIDs and cosmetic wording. */
function semanticState(s: EditorialSession) {
  const sortedSet = (values: unknown[]) => [...new Set(values.map(stableJson))].sort();
  const reference = (id: string, start: number, end: number) => { const e = s.evidence.find(e => e.id === id); return [e?.contentHash, e?.provenance.documentId, start, end]; };
  const scope = (id: string): unknown => { const item = s.scopes.find(scope => scope.id === id); return item ? [item.kind, sortedSet(item.anchors.map(ref => reference(ref.evidenceId,ref.start,ref.end))), sortedSet(item.qualifiers.map(q => [q.key,q.value]))] : ['unresolved']; };
  const selector = (item: EditorialSession['claims'][number]['selector']) => [scope(item.scopeId), item.predicate, item.metric, item.cardinality ?? 'single'];
  const claim = (id: string): unknown => { const item = s.claims.find(claim => claim.id === id); return item ? [selector(item.selector),item.value,item.epistemic,item.visibility] : ['unresolved']; };
  const subject = (id: string): unknown => s.claims.some(claim => claim.id === id) ? claim(id) : scope(id);
  const source = (id: string): unknown => { const item = s.task.requiredSources.find(source => source.id === id); return item ? [item.selector,item.depth] : ['unresolved']; };
  const rule = (item: EditorialSession['task']['criteria'][number]['rule']): unknown => {
    if (item.kind === 'include_facts' || item.kind === 'exclude_claims') return [item.kind, sortedSet(item.factIds.map(claim)), 'location' in item ? item.location : undefined];
    if (item.kind === 'permission') return [item.kind,sortedSet(item.subjectIds.map(subject)),item.use,item.channel,item.identity];
    if (item.kind === 'source_read') return [item.kind,source(item.sourceRequirementId)];
    if (item.kind === 'semantic') return [item.kind]; // A rephrased judgment is not measurable quality progress.
    return item;
  };
  const check = (id: string): unknown => {
    const criterion = s.task.criteria.find(c => c.id === id); if (criterion) return [rule(criterion.rule),criterion.severity,criterion.verification];
    const requirement = s.task.requirements.find(r => 'requirement:' + r.id === id); if (requirement) return ['requirement',selector(requirement.selector)];
    const required = s.task.requiredSources.find(source => 'source:' + source.id === id); if (required) return ['source',source(required.id)];
    const gap = deriveGaps(s).find(g => g.id === id); return gap ? ['gap',gap.kind,selector(gap.selector)] : id;
  };
  const task = { requirements: sortedSet(s.task.requirements.map(r => [selector(r.selector),r.necessity,r.resolution])), criteria: sortedSet(s.task.criteria.map(c => [rule(c.rule),c.verification,c.severity])), sources: sortedSet(s.task.requiredSources.map(item => [source(item.id),sourceRequirementSatisfied(s,item),sourceWaiver(s,item.id) !== undefined])) };
  return { sortedSet, selector, claim, subject, check, task };
}
/** Discovery is not progress: only task dependencies, executable checks and usable public inputs count. */
function relevantClaims(s:EditorialSession) {
 const scopes=new Set([...s.task.targetScopes,...s.task.requirements.map(r=>r.selector.scopeId)].map(id=>canonicalScopeId(s,id)));
 const ids=new Set(s.task.criteria.flatMap(c=>c.rule.kind==='include_facts'||c.rule.kind==='exclude_claims'?c.rule.factIds:[]));
 return s.claims.filter(c=>!scopes.size&&!ids.size || scopes.has(canonicalScopeId(s,c.selector.scopeId))||ids.has(c.id));
}
function qualityMarks(s:EditorialSession) {
 const semantic=semanticState(s),good=new Set<string>(),bad=new Set(openGaps(s).map(g=>stableJson([g.kind,semantic.selector(g.selector)])));
 if(s.candidate)good.add('candidate');
 if(s.review&&sameInputKey(s.review.inputKey,currentInputKey(s)))good.add('reviewed');
 if(s.layout&&s.layout.contentHash===s.candidate?.contentHash)good.add('layout');
 for(const check of canHandoff(s).checks)if(check.status==='pass')good.add(stableJson(['check',semantic.check(check.criterionId)]));
 for(const c of relevantClaims(s))if(c.visibility==='public'&&c.epistemic==='supported')good.add(stableJson(['claim',semantic.claim(c.id)]));
 return {good,bad};
}
/** Envelope revisions, prose/diagnostic wording, UUIDs and remaining budget are not quality progress. */
export function qualityFingerprint(s: EditorialSession): string {
  const gate = canHandoff(s), semantic = semanticState(s);
  return hashText(stableJson({ claims: semantic.sortedSet(relevantClaims(s).map(c => semantic.claim(c.id))), permissions: semantic.sortedSet(s.permissions.map(p => [semantic.subject(p.subjectId),p.uses,p.state])), task: semantic.task,
    gaps: semantic.sortedSet(openGaps(s).map(g => [g.kind,semantic.selector(g.selector)])), candidate: !!s.candidate,
    review: !!s.review && sameInputKey(s.review.inputKey,currentInputKey(s)), blockingReview: !!s.review && (!!s.review.blocking.length || s.review.issues.some(i => i.severity === 'blocking')),
    layout: !!s.layout && s.layout.contentHash === s.candidate?.contentHash, checks: semantic.sortedSet(gate.checks.map(check => [semantic.check(check.criterionId),check.status])),
  }));
}
function normalizeAction(raw: Record<string, unknown>, s: EditorialSession): ToolAction {
  const strings = (value: unknown): string[] => Array.isArray(value) && value.every(v => typeof v === 'string') ? value : [];
  switch (raw.tool) {
    case 'search': return ToolActionSchema.parse({ tool: 'search', query: raw.query, forRequirementIds: strings(raw.forRequirementIds) });
    case 'write': return ToolActionSchema.parse({ tool: 'write', instructions: raw.instructions, repairCriterionIds: strings(raw.repairCriterionIds) });
    case 'ask': {
      let ids = strings(raw.gapIds);
      if (!ids.length) ids = openGaps(s).filter(g => g.state === 'open' && (g.askable ?? (g.gapClass ? g.gapClass === 'fact' || g.gapClass === 'authorization' : g.kind !== 'plan_ambiguity'))).map(g => g.id);
      return ToolActionSchema.parse({ tool: 'ask', gapIds: ids });
    }
    case 'read': return ToolActionSchema.parse({ tool: 'read', documentId: raw.documentId, sourceRequirementId: raw.sourceRequirementId, ...(raw.range ? { range: raw.range } : {}) });
    case 'review': case 'submit': return { tool: raw.tool };
    case 'layout': return ToolActionSchema.parse({ tool: 'layout', themeId: raw.themeId ?? raw.theme ?? getDefaultTheme().name });
    default: throw new Error('unknown_tool');
  }
}
export async function runEditorialController(options: ControllerOptions): Promise<EditorialOutcome> {
  const config = RunBudgetSchema.parse({ ...DEFAULT_RUN_BUDGET, ...options.budget });
  const now = options.now ?? Date.now; const started = now(); const controller = new AbortController(); let expired = false;
  const parentAbort = () => controller.abort(); options.signal.addEventListener('abort', parentAbort, { once: true }); if (options.signal.aborted) controller.abort();
  const timer = setTimeout(() => { expired = true; controller.abort(); }, config.maxElapsedMs);
  const signal = controller.signal; const guard = () => { throwIfAborted(signal); if (options.isCurrent && !options.isCurrent()) throw new DOMException('stale_ownership', 'AbortError'); if (now() - started >= config.maxElapsedMs) { expired = true; throw new Error('deadline_exceeded'); } };
  let s = startEditorialRun(options.session, options.runId ?? 'run-' + hashText(options.session.sessionId + ':' + options.session.revision + ':' + started).slice(0,24));
  {
    const legacyAgents = s.diagnostics.filter(diagnostic => gateEffectOf(diagnostic) !== 'block').map(diagnostic => ({ ...diagnostic, gateEffect: gateEffectOf(diagnostic) }));
    if (legacyAgents.length) {
      s = { ...s, diagnostics: s.diagnostics.filter(diagnostic => gateEffectOf(diagnostic) === 'block'), agentDiagnostics: [...new Map([...(s.agentDiagnostics ?? []), ...legacyAgents].map(d => [stableJson([d.owner, d.code, d.message, d.refs]), d])).values()] };
    }
  }
  const priorStop = options.resumeFromStop ? s.lastRun?.stop : undefined;
  s = { ...s, lastRun: { runId: s.activeRunId!, startedAt: new Date(now()).toISOString(), endedAt: '', outcome: 'needs_editor', ...(priorStop ? { stop: priorStop } : {}), modelCalls: [], agentDiagnostics: s.agentDiagnostics ?? [] } };
  const used = { decisions: 0, writes: 0, searches: 0, modelCalls: 0 }; let currentStage: EditorialStage | undefined; let stalls = 0; let writeFailures = 0; let observation = '开始任务预检。'; let lastWriteFailure = ''; let repairReview:ReviewStamp|undefined=options.session.review;
  const sources = options.sources ?? localSourcePort; const cache = new SourceSearchCache(sources); const attemptedRequired = new Set<string>(); const writeKeys = new Set<string>(); const contentHistory = new Set(s.candidate ? [s.candidate.contentHash] : []); const fingerprints = new Set<string>();
  const remaining = (): RunBudget => ({ ...config, decisions: config.decisions - used.decisions, writes: config.writes - used.writes, searches: config.searches - used.searches, modelCalls: config.modelCalls - used.modelCalls });
  const closeRun = (outcome: RunReport['outcome']) => {
    if (!s.lastRun) return;
    const report: RunReport = { ...s.lastRun, endedAt: new Date(now()).toISOString(), outcome, agentDiagnostics: s.agentDiagnostics ?? [] };
    if (outcome !== 'stopped' && outcome !== 'cancelled') delete report.stop;
    s = { ...s, lastRun: report, revision: s.revision + 1, ...(outcome === 'needs_editor' ? { phase: 'waiting_input' as const } : {}) };
    if (outcome !== 'ready') options.onCheckpoint?.(structuredClone(s));
  };
  const recordModelCall = (record: ModelCallRecord) => { if (!s.lastRun) return; s = { ...s, lastRun: { ...s.lastRun, modelCalls: [...s.lastRun.modelCalls, record] } }; };
  const recordModelAttempt = (stage: string, attempt: number, result: ModelCallRecord['result'], startedAt: string, endedAt: string, acceptedCount = 0, quarantinedCount = 0, errorCodes: string[] = []) => recordModelCall({
    callId: stage + '-' + hashText(s.sessionId + ':' + s.revision + ':' + stage + ':' + attempt + ':' + startedAt).slice(0, 16),
    stage, attempt, contractVersion: 'v3', startedAt, endedAt, result, acceptedCount, quarantinedCount, errorCodes,
  });
  const mutateLastModelCall = (stage: string, patch: Partial<ModelCallRecord>) => {
    if (!s.lastRun) return;
    const calls = s.lastRun.modelCalls; const index = [...calls.keys()].reverse().find(i => calls[i].stage === stage);
    if (index === undefined) return;
    s = { ...s, lastRun: { ...s.lastRun, modelCalls: calls.map((call, i) => i === index ? { ...call, ...patch } : call) } };
  };
  const logicalStage = (stage: EditorialStage, data: Record<string, unknown>): EditorialStage => stage === 'repair' && typeof data.stage === 'string' ? data.stage as EditorialStage : stage;
  const internalCard = (): StopRecord | undefined => {
    const diagnostic = [...s.diagnostics, ...resolveFacts(s).diagnostics].find(item => gateEffectOf(item) === 'block');
    if (!diagnostic) return undefined;
    const stage = currentStage ?? 'controller';
    return {
      code: diagnostic.code, class: 'internal', stage, retryable: true,
      headline: '处理过程中出现内部一致性问题（' + stage + '）', detail: diagnostic.message,
      ...(diagnostic.owner ? { fields: { owner: diagnostic.owner } } : {}),
      actions: ['retry', 'report'],
      traceId: 'diag-' + hashText(s.sessionId + ':' + (diagnostic.owner ?? '') + ':' + diagnostic.code).slice(0, 20),
      preserved: { ...(s.candidate ? { candidateRevision: s.candidate.revision } : {}), ...(s.committed ? { committedRevision: s.committed.artifact.revision } : {}), inputKey: currentInputKey(s) },
    };
  };
  const emit = (payloads: Payload[]) => {
    guard(); const events = payloads.map(payload => ({ ...payload, sessionId: s.sessionId, runId: s.activeRunId!, expectedRevision: s.revision } as EditorialToolEvent));
    s = applyToolEvents(s, events); guard(); for (const event of events) { guard(); options.onEvent?.(structuredClone(event)); } guard(); options.onCheckpoint?.(structuredClone(s));
  };
  const updateGaps = () => { const gaps = deriveGaps(s); if (!sameEntitySet(s.gaps, gaps)) emit([{ type: 'gaps_updated', gaps }]); };
  const toolResult = (tool: ToolAction['tool'], status: ToolResult['status'], code: string) => { guard(); observation = code; options.onToolResult?.({ tool, status, code, changedIds: [], events: [], allowedNext: allowedActions(s, remaining()), diagnostics: [] }); };
  const ask = async (stage: EditorialStage, data: Record<string, unknown>, attempt = 1): Promise<string> => {
    const logical = logicalStage(stage, data);
    currentStage = logical; guard(); if (used.modelCalls >= config.modelCalls) throw new Error('model_budget_exhausted');
    if (stableJson(data).length > 120000) throw new Error('context_capacity');
    used.modelCalls++; options.onStep?.(stage === 'decide' ? 'Agent 正在选择下一步' : stage === 'mapping' ? 'Agent 正在对应编辑的回复' : 'Agent：' + stage); guard();
    const startedAt = new Date(now()).toISOString();
    try {
      const reply = await abortable(options.model({ stage, data }, signal), signal); guard();
      recordModelAttempt(logical, attempt, 'ok', startedAt, new Date(now()).toISOString());
      return reply;
    } catch (error) {
      recordModelAttempt(logical, attempt, 'transport_error', startedAt, new Date(now()).toISOString(), 0, 0, [error instanceof Error ? error.message : 'transport_error']);
      throw error;
    }
  };
  const requestAnswerMapping = async (batch: NonNullable<ReturnType<typeof activeBatch>>, message: { messageId: string; text: string }): Promise<AnswerMappingResult | undefined> => {
    const data = {
      messageId: message.messageId, text: message.text,
      batch: { id: batch.id, items: batch.items.map(item => ({ gapId: item.gapId, subject: item.subject, requested: item.requested, why: item.why, expected: item.expected, ...(item.options ? { options: item.options } : {}) })) },
    };
    let raw: string;
    try { raw = await ask('mapping', data); }
    catch (error) {
      if ((error instanceof Error && error.name === 'AbortError') || options.signal.aborted) throw error;
      if (failureFromError(error, currentStage ?? 'mapping').class === 'external' || (error instanceof Error && error.message.startsWith('fixture_error:'))) throw error;
      return undefined;
    }
    let parsed: Record<string, unknown>;
    try { parsed = parseJsonObject(raw); }
    catch { mutateLastModelCall('mapping', { result: 'syntax_error', errorCodes: ['invalid_json'] }); return undefined; }
    const result = validateAnswerMappings(batch, message.text, parsed);
    if (!result.shapeValid) { mutateLastModelCall('mapping', { result: 'schema_error', errorCodes: ['invalid_mapping_shape'] }); return undefined; }
    mutateLastModelCall('mapping', { result: result.mappings.length ? 'ok' : 'semantic_error', acceptedCount: result.mappings.length, quarantinedCount: result.rejected, errorCodes: result.rejected ? ['mapping_rejected'] : [] });
    return result;
  };
  const SYNTAX_REPAIRS = 2;
  const json = async (stage: EditorialStage, data: Record<string, unknown>, attemptStart = 1): Promise<Record<string, unknown>> => {
    const logical = logicalStage(stage, data);
    let attempt = attemptStart; let raw = await ask(stage, data, attempt);
    for (;;) {
      try { const parsed = parseJsonObject(raw); mutateLastModelCall(logical, { result: 'ok' }); return parsed; }
      catch (error) {
        mutateLastModelCall(logical, { result: 'syntax_error', errorCodes: ['invalid_json'] });
        if (attempt >= attemptStart + SYNTAX_REPAIRS) throw new Error('invalid_json');
        attempt++;
        raw = await ask('repair', { stage, parseError: error instanceof Error ? error.message : 'invalid_json', invalidResponse: raw.slice(0, 4000), attempt }, attempt);
      }
    }
  };
  const applyExtraction = (stage: EditorialStage, raw: Record<string, unknown>) => {
    const rawFact = raw.factPatch && typeof raw.factPatch === 'object' && !Array.isArray(raw.factPatch) ? raw.factPatch as Record<string, unknown> : {};
    const rawClaims = Array.isArray(rawFact.claims) ? rawFact.claims.filter((claim): claim is Record<string, unknown> => !!claim && typeof claim === 'object' && !Array.isArray(claim)) : [];
    raw = normalizeModelExtraction(s, raw);
    if (Object.keys(raw).some(key => !['factPatch','taskPatch','editorialNotes','diagnostics'].includes(key)) || !raw.factPatch || typeof raw.factPatch !== 'object') throw new Error('invalid_extraction');
    const next = applyFactPatch(s, raw.factPatch);
    const acceptedClaims = rawClaims.filter(claim => typeof claim.id === 'string' && next.claims.some(candidate => candidate.id === claim.id));
    const quarantined = Math.max(0, rawClaims.length - acceptedClaims.length);
    const newDiagnostics = next.diagnostics.filter(diagnostic => !s.diagnostics.some(old => stableJson([old.owner, old.code, old.message, old.refs]) === stableJson([diagnostic.owner, diagnostic.code, diagnostic.message, diagnostic.refs])));
    mutateLastModelCall(stage, { result: acceptedClaims.length || !quarantined ? 'ok' : 'semantic_error', acceptedCount: acceptedClaims.length, quarantinedCount: quarantined, errorCodes: [...new Set(newDiagnostics.map(diagnostic => diagnostic.code))] });
    emit([{ type: 'facts_resolved', scopes: next.scopes, claims: next.claims, permissions: next.permissions, alignments: next.alignments, diagnostics: next.diagnostics }]);
    if (!acceptedClaims.length && quarantined > 0) emit([{ type: 'agent_diagnostic_recorded', diagnostic: { owner: 'stage:' + stage, code: 'model_output_quarantined', message: quarantined + ' 条模型输出被隔离；已继续使用既有状态。', refs: [] } }]);
    if (raw.taskPatch !== undefined) {
      const planned = applyTaskPatch(s, raw.taskPatch); const payloads: Payload[] = [];
      if (planned.task.revision !== s.task.revision) payloads.push({ type: 'task_revised', task: planned.task });
      if (!sameEntitySet(planned.diagnostics, s.diagnostics)) payloads.push({ type: 'diagnostics_updated', diagnostics: planned.diagnostics });
      if (payloads.length) emit(payloads);
    }
    if (raw.editorialNotes !== undefined) {
      if (!Array.isArray(raw.editorialNotes)) throw new Error('invalid_notes');
      const notes = raw.editorialNotes.flatMap(note => { try { return [EditorialNoteSchema.parse(note)]; } catch { return []; } });
      if (notes.length) emit([{ type: 'notes_recorded', notes }]);
    }
    if (raw.diagnostics !== undefined) {
      if (!Array.isArray(raw.diagnostics)) throw new Error('invalid_diagnostics');
      for (const diagnostic of raw.diagnostics) emit([{ type: 'agent_diagnostic_recorded', diagnostic }]);
    }
    updateGaps();
    return { acceptedCount: acceptedClaims.length, quarantinedCount: quarantined, quarantinedItems: rawClaims.filter(claim => !new Set(acceptedClaims).has(claim)) };
  };
  const consume = async (loads: LoadedSource[]) => {
    if (!loads.length) return;
    const data = { task: s.task, evidence: s.evidence, scopes: s.scopes, claims: s.claims, permissions: s.permissions, loadedSources: loads };
    const context = JSON.stringify(data);
    const extracted = await json('extract', data);
    const first = applyExtraction('extract', extracted);
    if (first.acceptedCount === 0 && first.quarantinedCount > 0 && used.modelCalls < config.modelCalls) {
      try {
        const retried = await json('extract', { ...data, quarantinedCandidates: first.quarantinedItems, attempt: 2 }, 2);
        applyExtraction('extract', retried);
      } catch (error) {
        if (signal.aborted || (error instanceof Error && error.name === 'AbortError') || failureFromError(error, 'extract').class === 'external' || (error instanceof Error && ['model_budget_exhausted', 'context_capacity', 'deadline_exceeded'].includes(error.message))) throw error;
        emit([{ type: 'agent_diagnostic_recorded', diagnostic: { owner: 'stage:extract', code: 'extract_repair_failed', message: '隔离条目的条目级修复未成功；已保留既有状态继续。', refs: [] } }]);
      }
    }
    const receipt = recordSourceConsumption(s, loads, 'brief', context); if (receipt.status === 'rejected') throw new Error(receipt.code);
    if (receipt.events.length) { guard(); s = applyToolEvents(s, receipt.events); for (const event of receipt.events) { guard(); options.onEvent?.(event); } guard(); options.onCheckpoint?.(structuredClone(s)); }
    guard(); options.onToolResult?.(receipt); updateGaps();
  };
  const performRead = async (sourceId: string) => {
    attemptedRequired.add(sourceId); const load = await loadRequiredSource(s, sourceId, signal, sources); guard();
    if (load.events.length) { s = applyToolEvents(s, load.events); for (const event of load.events) { guard(); options.onEvent?.(event); } guard(); options.onCheckpoint?.(structuredClone(s)); }
    guard(); options.onToolResult?.(load); if (load.status === 'failed' || load.status === 'rejected') { observation = sourceId + ':' + load.code; return; }
    const needed = (load.loadedSources ?? []).filter(load => { const requirement = s.task.requiredSources.find(source => source.id === load.sourceRequirementId); return requirement ? !sourceRequirementSatisfied(s, requirement) : !s.readReceipts.some(r => r.documentId === load.documentId && r.contentHash === s.evidence.find(e => e.id === load.evidenceId)?.contentHash); });
    await consume(needed);
  };
  const finish = (): EditorialOutcome | undefined => {
    updateGaps(); const gate = canHandoff(s); if (gate.blockers.length) return;
    closeRun('ready');
    emit([{ type: 'gate_recorded', gate }]); emit([{ type: 'handoff_ready' }]);
    return { type: 'draft', session: s, artifact: s.candidate!, handoff: { status: 'pending' } };
  };
  const stop = (code: string, failed = false, failure?: FailureDescriptor): EditorialOutcome => {
    updateGaps(); const outstanding = activeBatch(s);
    if (!failed && outstanding) { closeRun('needs_editor'); return { type: 'question', session: s, question: questionProjection(outstanding) }; }
    const gaps = openGaps(s), fresh = gaps.filter(g => g.state === 'open');
    const askable = fresh.filter(g => (g.askHistory?.length ?? 0) < 2);
    const exhausted = fresh.filter(g => (g.askHistory?.length ?? 0) >= 2);
    if (exhausted.length) {
      s = { ...s, gapDecisions: [...(s.gapDecisions ?? []), ...exhausted.map(gap => ({ id: 'gd-' + hashText(gap.id + ':ask_limit').slice(0, 24), gapId: gap.id, by: 'editor' as const, kind: 'defer' as const, refs: [], note: '提问上限已到，按现有信息继续', createdAt: '' }))], gaps: s.gaps.map(gap => exhausted.some(item => item.id === gap.id) ? { ...gap, state: 'waived' as const } : gap) };
      if (!askable.length) code = 'ask_limit_reached';
    }
    if (!failed && askable.length) { const question = buildQuestion(s, askable.map(g => g.id)); closeRun('needs_editor'); emit([{ type: 'question_recorded', question }]); return { type: 'question', session: s, question }; }
    const gate = canHandoff(s);
    const descriptor = failure ?? classifyFailure(code, currentStage);
    const card = failure ? makeStopRecord(s, descriptor) : internalCard() ?? makeStopRecord(s, descriptor);
    if (s.lastRun) s = { ...s, lastRun: { ...s.lastRun, stop: card } };
    closeRun('stopped'); emit([{ type: 'stopped', phase: 'incomplete', code, unresolvedIds: gate.blockers, nextActions: [card.headline, card.detail] }]);
    return { type: failed ? 'failed' : 'incomplete', session: s, reason: code };
  };
  const isAskableGap = (gap: EditorialSession['gaps'][number]) => gap.askable ?? (gap.gapClass ? gap.gapClass === 'fact' || gap.gapClass === 'authorization' : gap.kind !== 'plan_ambiguity');
  const failedConstraintIds = (): string[] => s.candidate
    ? validateAcceptance(s).checks.filter(check => check.status === 'fail' && s.task.criteria.some(criterion => criterion.id === check.criterionId)).map(check => check.criterionId)
    : [];
  const markConstraintBudgetExhausted = () => {
    const gaps = deriveGaps(s);
    const next = gaps.map(gap => gap.gapClass === 'constraint' && gap.state === 'unmet' ? { ...gap, state: 'blocked_by_constraint' as const } : gap);
    if (!sameEntitySet(s.gaps, next)) emit([{ type: 'gaps_updated', gaps: next }]);
  };
  const deterministicNext = (): ToolAction | 'ready' | undefined => {
    const source = s.task.requiredSources.find(item => !sourceWaiver(s, item.id) && !sourceRequirementSatisfied(s, item) && !attemptedRequired.has(item.id));
    if (source) return { tool: 'read', documentId: source.selector.documentId ?? source.id, sourceRequirementId: source.id };
    const askable = openGaps(s).filter(gap => gap.state === 'open' && isAskableGap(gap));
    if (askable.length && !activeBatch(s)) return { tool: 'ask', gapIds: askable.map(gap => gap.id) };
    if (taskContractValid(s) && !s.candidate && remaining().writes > 0 && remaining().modelCalls > 0 && !openGaps(s).length) return { tool: 'write', instructions: '按当前任务与验收项写作', repairCriterionIds: [] };
    if (s.candidate && (!s.review || !sameInputKey(s.review.inputKey, currentInputKey(s)))) return { tool: 'review' };
    if (s.candidate && (!s.layout || s.layout.contentHash !== s.candidate.contentHash)) return { tool: 'layout', themeId: getDefaultTheme().name };
    if (!canHandoff(s).blockers.length) return 'ready';
    return undefined;
  };
  const layout = (themeId?: string) => {
    const projected = makePublicDocument(s); if (!projected.document) { toolResult('layout', 'rejected', 'public_projection_blocked'); return; }
    const theme = getAllThemes().find(theme => theme.name === themeId) ?? getDefaultTheme();
    emit([{ type: 'layout_recorded', layout: renderPublicDocument(projected.document, theme) }]); toolResult('layout', 'progress', 'layout_recorded');
    return true;
  };
  const describeDraftFailure = (raw: string, diagnostics: import('./editorialTypes').Diagnostics[]): string => {
    try {
      const value: unknown = JSON.parse(raw.trim().replace(/^```(?:json)?\s*\n/, '').replace(/\n```$/, ''));
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        if (typeof record.title !== 'string' || !record.title.trim()) return '生成的正文缺少标题（title）';
        if (typeof record.bodyMarkdown !== 'string' || !record.bodyMarkdown.trim()) return '生成的正文缺少正文（bodyMarkdown）';
      }
    } catch { /* not JSON */ }
    return diagnostics.map(diagnostic => diagnostic.message).filter(Boolean).join('；') || '生成的正文不符合正文契约';
  };
  const review = async () => {
    if (!s.candidate || s.review && sameInputKey(s.review.inputKey, currentInputKey(s))) { toolResult('review', 'no_progress', 'review_reused'); return; }
    const data = { task: s.task, evidence: s.evidence, claims: s.claims, permissions: s.permissions, artifact: s.candidate, programGate: validateAcceptance(s) };
    const reviewUnavailable = (detail: string): never => {
      const diagnostic = { owner: 'review:validation', code: 'review_unavailable', message: detail, refs: [] };
      emit([{ type: 'diagnostics_updated', diagnostics: [...s.diagnostics.filter(item => item.code !== 'review_unavailable'), diagnostic] }]);
      mutateLastModelCall('review', { result: 'schema_error', acceptedCount: 0, quarantinedCount: 1, errorCodes: ['review_unavailable'] });
      throw new Error('review_invalid');
    };
    const parseReview = (raw: Record<string, unknown>): ReviewStamp | undefined => {
      try {
        const lines = (value: unknown): string[] => { if (!Array.isArray(value) || value.length > 64 || value.some(line => typeof line !== 'string' || line.length > 2000)) throw new Error('invalid_review'); return value; };
        const notes: EditorialNote[] = lines(raw.notes).map(text => ({ id: 'review-note-' + hashText(text).slice(0,24), kind: 'advisory', text, relatedIds: [] }));
        return ReviewStampSchema.parse({ inputKey: currentInputKey(s), blocking: lines(raw.blocking), notes, issues: raw.issues ?? [], ...(raw.criterionChecks ? { criterionChecks: raw.criterionChecks } : {}) });
      } catch { return undefined; }
    };
    let raw: Record<string, unknown>;
    try { raw = await json('review', data); }
    catch (error) {
      if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
      const message = error instanceof Error ? error.message : '';
      const failure = failureFromError(error, currentStage);
      if (message !== 'invalid_json' && (failure.class === 'external' || message.startsWith('fixture_error:') || ['model_budget_exhausted', 'context_capacity', 'deadline_exceeded'].includes(message))) throw error;
      return reviewUnavailable('审稿结果连续无法解析；交付门暂不能确认。');
    }
    let stamp = parseReview(raw);
    if (!stamp) {
      raw = parseJsonObject(await ask('repair', { stage: 'review', invalidResponse: raw, diagnostics: ['invalid_review'], attempt: 2 }, 2));
      stamp = parseReview(raw);
    }
    if (!stamp) return reviewUnavailable('审稿结果不符合结构；交付门暂不能确认。');
    try {
      if (raw.humanChecks !== undefined) {
        if (!Array.isArray(raw.humanChecks)) throw new Error('invalid_human_checks');
        const human = raw.humanChecks.map(item => { if (!item || typeof item.id !== 'string' || typeof item.instruction !== 'string' || !item.instruction.trim()) throw new Error('invalid_human_checks'); return { id: 'human:' + item.id, origin: 'policy' as const, refs: s.task.coverage?.refs ?? [], severity: 'blocking' as const, verification: 'human' as const, rule: { kind: 'semantic' as const, instruction: item.instruction } }; });
        const added = human.filter(c => !s.task.criteria.some(old => old.id === c.id));
        if (added.length) emit([{ type: 'task_revised', task: { ...s.task, revision: s.task.revision + 1, criteria: [...s.task.criteria, ...added] } }]);
      }
    } catch { return reviewUnavailable('审稿结果中的人工检查项无效；交付门暂不能确认。'); }
    // Human checks may have revised the task; the stamp must bind the current input key.
    stamp = { ...stamp, inputKey: currentInputKey(s) };
    repairReview=stamp; emit([{ type: 'review_recorded', review: stamp }]); toolResult('review', 'progress', 'review_recorded');
    if (!stamp.blocking.length && !stamp.issues.some(issue => issue.severity === 'blocking')) layout();
  };
  try {
    guard();
    s = ensureQuestionState(s);
    let skipPreflight = !!options.resumeFromStop && taskContractValid(s) && !latestUnprocessedEditorMessage(s);
    const turnMessage = latestUnprocessedEditorMessage(s);
    if (turnMessage) {
      let projection = processEditorTurn(sessionAsTurnView(s), { ...turnMessage, evidenceAlreadyAppended: true });
      if (projection.outcome.type === 'needs_assignment') {
        const batch = activeBatch(s);
        if (batch && batch.items.length > 1) {
          const mapping = await requestAnswerMapping(batch, turnMessage);
          if (mapping) projection = processEditorTurn(sessionAsTurnView(s), { ...turnMessage, evidenceAlreadyAppended: true, mappedAnswers: mapping.mappings, mappingAttempted: true });
        }
      }
      const applied = applyEditorTurn(s, turnMessage, projection);
      if (applied.session !== s) { s = applied.session; guard(); options.onCheckpoint?.(structuredClone(s)); }
      if (applied.next === 'question') {
        const batch = activeBatch(s);
        if (batch) { closeRun('needs_editor'); return { type: 'question', session: s, question: questionProjection(batch), ...(applied.notice ? { notice: applied.notice } : {}) }; }
      }
      if (applied.next === 'stop') {
        const descriptor = classifyFailure(applied.stopCode ?? 'internal_invariant', currentStage);
        const record = makeStopRecord(s, descriptor);
        s = { ...s, lastRun: s.lastRun ? { ...s.lastRun, stop: record } : s.lastRun };
        closeRun(applied.stopCode === 'run_cancelled' ? 'cancelled' : 'stopped');
        return { type: 'incomplete', session: s, reason: applied.stopCode ?? 'stopped' };
      }
      skipPreflight = applied.skippedPreflight;
      if (skipPreflight) observation = '编辑已处理所问事项，按当前任务继续。';
    }
    const outstanding = activeBatch(s);
    if (outstanding) { closeRun('needs_editor'); return { type: 'question', session: s, question: questionProjection(outstanding) }; }
    updateGaps();
    if (!skipPreflight) {
      const preflightData = { task: s.task, evidence: s.evidence, scopes: s.scopes, claims: s.claims, permissions: s.permissions, template: options.template };
      const preflight = await json('preflight', preflightData);
      applyExtraction('preflight', preflight);
      if (!taskContractValid(s)) applyExtraction('preflight', await json('repair', { stage: 'preflight', data: preflightData, invalidResponse: preflight, diagnostics: s.diagnostics.map(d => d.code) }, 2));
      if (!taskContractValid(s)) {
        const question = buildIntakeQuestion(s);
        closeRun('needs_editor');
        emit([{ type: 'question_recorded', question }]);
        return { type: 'question', session: s, question };
      }
    }
    for (const source of s.task.requiredSources) if (!sourceWaiver(s, source.id)) await performRead(source.id);
    updateGaps(); fingerprints.add(qualityFingerprint(s)); let previousQuality=qualityMarks(s);
    while (used.decisions < config.decisions) {
      guard(); const done = finish(); if (done) return done;
      let action: ToolAction | undefined;
      let invalidAction = false;
      let actionProgress = false;
      let rawDecision: Record<string, unknown> | undefined;
      try {
        rawDecision = await json('decide', { task: s.task, gaps: s.gaps, claims: s.claims, permissions: s.permissions, draft: s.candidate, review: s.review, layoutReady: !!s.layout, sources: cache.discovered(), allowedActions: allowedActions(s, remaining()), observation, remaining: remaining(), programGate: canHandoff(s) });
        used.decisions++;
      } catch (error) {
        if (signal.aborted || (error instanceof Error && error.name === 'AbortError') || (error instanceof Error && ['model_budget_exhausted', 'context_capacity', 'deadline_exceeded'].includes(error.message))) throw error;
        if (failureFromError(error, currentStage ?? 'decide').class === 'external' || (error instanceof Error && error.message.startsWith('fixture_error:'))) throw error;
        used.decisions++;
        invalidAction = true;
      }
      if (rawDecision) {
        try {
          action = normalizeAction(rawDecision, s);
          const askableIds = new Set(openGaps(s).filter(gap => gap.state === 'open' && isAskableGap(gap)).map(gap => gap.id));
          if (action.tool === 'ask' && (!action.gapIds.length || action.gapIds.some(id => !askableIds.has(id)))) {
            toolResult('ask', 'rejected', 'ask_selection_rejected:invalid_gap_selection');
            stalls++;
            if (stalls >= Math.max(1, config.maxNoProgress)) return stop('no_progress');
            continue;
          }
        } catch { invalidAction = true; }
      }
      if (invalidAction) {
        action = undefined;
        mutateLastModelCall('decide', { result: 'semantic_error', errorCodes: ['invalid_action'] });
        emit([{ type: 'agent_diagnostic_recorded', diagnostic: { owner: 'decide:scheduler', code: 'invalid_action', message: '模型动作不在 allowedActions 内，已由确定性调度器接管。', refs: [] } }]);
        observation = 'invalid_action';
      }
      if (action && action.tool !== 'write' && !allowedActions(s, remaining()).includes(action.tool)) {
        toolResult(action.tool, 'rejected', 'invalid_or_unknown_action');
        stalls++;
        if (stalls >= Math.max(1, config.maxNoProgress)) return stop('no_progress');
        continue;
      }
      const scheduled = action ?? deterministicNext();
      if (scheduled === 'ready') { const ready = finish(); if (ready) return ready; stalls++; if (stalls >= Math.max(1, config.maxNoProgress)) return stop('no_progress'); continue; }
      if (!scheduled) return stop('no_progress');
      action = scheduled;
      const failedConstraints = failedConstraintIds();
      const writeAllowed = allowedActions(s, remaining()).includes('write');
      if (s.candidate && failedConstraints.length && writeAllowed && action.tool !== 'write') {
        action = { tool: 'write', instructions: '修复未满足的验收要求', repairCriterionIds: failedConstraints };
        observation = 'constraint_repair';
      } else if (s.candidate && failedConstraints.length && remaining().writes <= 0 && !openGaps(s).length) {
        markConstraintBudgetExhausted();
        return stop('write_budget_exhausted');
      }
      if (action.tool === 'search') {
        if (!cache.has(action.query) && used.searches >= config.searches) toolResult('search', 'rejected', 'search_budget_exhausted');
        else {
          const found = await cache.search(action.query, signal); guard(); if (!found.cached) used.searches++;
          const loads: LoadedSource[] = [];
          for (const descriptor of found.sources.slice(0,3)) {
            if (s.evidence.some(e => e.provenance.documentId === descriptor.documentId && (!descriptor.contentHash || e.contentHash === descriptor.contentHash))) continue;
            const load = await readSourceDocument(s, descriptor.documentId, signal, sources); guard(); if (load.events.length) { s = applyToolEvents(s, load.events); for (const event of load.events) { guard(); options.onEvent?.(event); } guard(); options.onCheckpoint?.(structuredClone(s)); } loads.push(...load.loadedSources ?? []);
          }
          await consume(loads); toolResult('search', found.status, found.cached ? 'query_cached' : found.sources.length ? 'sources_discovered' : 'query_empty');
        }
      } else if (action.tool === 'read') {
        const source = s.task.requiredSources.find(source => source.id === action.sourceRequirementId);
        if (!source || attemptedRequired.has(source.id)) toolResult('read', 'no_progress', 'required_read_already_attempted'); else await performRead(source.id);
      } else if (action.tool === 'ask') {
        if (action.gapIds.length) {
          try { const question=buildQuestion(s,action.gapIds);closeRun('needs_editor');emit([{type:'question_recorded',question}]);toolResult('ask','progress','waiting_editor');return {type:'question',session:s,question}; }
          catch(error) { const code=error instanceof Error && ['invalid_gap_selection','awaiting_editor_reply','non_askable_gap','ask_limit_reached'].includes(error.message)?error.message:'invalid_gap_selection';toolResult('ask','rejected','ask_selection_rejected:'+code); }
        } else toolResult('ask','rejected','no_selected_gap');
      } else if (action.tool === 'write') {
        const repairs = s.candidate ? canHandoff(s).blockers.filter(id => !['candidate','review_current','layout_current'].includes(id)).sort() : lastWriteFailure ? [lastWriteFailure] : [];
        const feedback=s.review??repairReview;
        if (feedback?.blocking.length) repairs.push('review:blocking');
        for (const issue of feedback?.issues ?? []) if (issue.severity === 'blocking') repairs.push('review:' + issue.category + ':' + [...issue.relatedIds].sort().join(','));
        const semantic = semanticState(s);
        const key = hashText(stableJson({ claims:semantic.sortedSet(relevantClaims(s).map(c=>semantic.claim(c.id))), task: semantic.task, repairs: semantic.sortedSet(repairs.map(semantic.check)), failure: lastWriteFailure }));
        if (!allowedActions(s, remaining()).includes('write')) {
          toolResult('write', 'rejected', used.writes >= config.writes ? 'write_budget_exhausted' : 'blocking_gaps');
          if (s.candidate && used.writes >= config.writes && !openGaps(s).length) { markConstraintBudgetExhausted(); await review(); const ready = finish(); return ready ?? stop('write_budget_exhausted'); }
        } else if (writeKeys.has(key)) {
          toolResult('write', 'no_progress', 'write_idempotency_hit'); if (s.candidate && !s.review) { await review(); const ready = finish(); if (ready) return ready; }
        } else {
          writeKeys.add(key); used.writes++; const draftOptions = { id: 'candidate', revision: (s.candidate?.revision ?? 0) + 1 };
          let rawDraft = await ask('write', buildWriterContext({...s,review:feedback}, repairs, {instructions:action.instructions,invalidArtifact:!!lastWriteFailure}) as unknown as Record<string, unknown>);
          let parsed = parseDraftArtifact(rawDraft, draftOptions);
          const syntaxInvalid = (value: string): boolean => { if (!/^[{`]/.test(value.trim())) return false; try { parseJsonObject(value); return false; } catch { return true; } };
          const recordWriteArtifact = () => mutateLastModelCall('write', parsed.artifact ? { result: 'ok', acceptedCount: 1, quarantinedCount: 0, errorCodes: [] } : syntaxInvalid(rawDraft) ? { result: 'syntax_error', acceptedCount: 0, quarantinedCount: 1, errorCodes: ['invalid_json'] } : { result: 'schema_error', acceptedCount: 0, quarantinedCount: 1, errorCodes: ['artifact_invalid'] });
          recordWriteArtifact();
          if (!parsed.artifact && syntaxInvalid(rawDraft)) {
            for (let attempt = 0; !parsed.artifact && attempt < 2 && syntaxInvalid(rawDraft); attempt++) {
              rawDraft = await ask('repair', { stage: 'write', invalidResponse: rawDraft, diagnostics: parsed.diagnostics.map(diagnostic => ({ code: diagnostic.code, message: diagnostic.message })), attempt: attempt + 2 }, attempt + 2);
              parsed = parseDraftArtifact(rawDraft, draftOptions);
              recordWriteArtifact();
            }
          }
          // A fresh model response is fresh provenance, including the supported Markdown wire format.
          if (parsed.artifact) parsed.artifact.origin='model';
          if (!parsed.artifact) {
            writeFailures++;
            const reason = describeDraftFailure(rawDraft, parsed.diagnostics);
            lastWriteFailure = reason;
            toolResult('write', 'rejected', 'invalid_artifact');
            if (writeFailures >= 2) return stop('artifact_invalid', false, { ...classifyFailure('artifact_invalid', 'write'), detail: reason, fields: { reason } });
          }
          else if (contentHistory.has(parsed.artifact.contentHash) && s.candidate?.origin !== 'legacy') { if (parsed.artifact.editorialNotes.length) emit([{ type: 'notes_recorded', notes: parsed.artifact.editorialNotes }]); toolResult('write', 'no_progress', 'content_cycle'); }
          else { lastWriteFailure = ''; repairReview=undefined; contentHistory.add(parsed.artifact.contentHash); emit([{ type: 'candidate_updated', artifact: parsed.artifact }]); actionProgress = true; toolResult('write', 'progress', 'candidate_updated'); }
        }
      } else if (action.tool === 'review') await review();
      else if (action.tool === 'layout') actionProgress = !!layout(action.themeId);
      else { const ready = finish(); if (ready) return ready; toolResult('submit', 'rejected', 'delivery_gate_blocked'); }
      updateGaps(); const fingerprint = qualityFingerprint(s),quality=qualityMarks(s);
      const improved=[...quality.good].some(mark=>!previousQuality.good.has(mark))||[...previousQuality.bad].some(mark=>!quality.bad.has(mark));
      if (!actionProgress && (fingerprints.has(fingerprint) || !improved)) stalls++; else stalls=0;
      fingerprints.add(fingerprint);previousQuality=quality;
      const ready = finish(); if (ready) return ready;
      if (stalls >= Math.max(1, config.maxNoProgress)) { if (s.candidate && !s.review && !openGaps(s).length) { await review(); const ready = finish(); if (ready) return ready; } return stop('no_progress'); }
    }
    if (s.candidate && !s.review && used.modelCalls < config.modelCalls) { await review(); const ready = finish(); if (ready) return ready; }
    return stop('decision_budget_exhausted');
  } catch (error) {
    if (options.signal.aborted || options.isCurrent && !options.isCurrent()) throw new DOMException('任务已停止', 'AbortError');
    // Deadline interrupts in-flight I/O; stopping still records a local checkpoint without reopening I/O.
    if (expired) { controller.abort(); const record = makeStopRecord(s, failureFromError(new Error('deadline_exceeded'), 'controller')); s = { ...s, phase: 'incomplete', lastRun: s.lastRun ? { ...s.lastRun, stop: record } : s.lastRun }; closeRun('stopped'); options.onCheckpoint?.(structuredClone(s)); return { type: 'incomplete', session: s, reason: 'deadline_exceeded' }; }
    const message = error instanceof Error ? error.message : 'internal_invariant';
    if (currentStage && ['invalid_extraction', 'invalid_review', 'invalid_schema', 'invalid_task_contract'].includes(message)) mutateLastModelCall(currentStage, { result: 'schema_error', errorCodes: [message] });
    const failure = failureFromError(error, currentStage);
    const legacyCode = ['invalid_json','context_capacity','model_budget_exhausted','deadline_exceeded','invalid_extraction','invalid_review','review_invalid'].includes(message) ? message
      : message.startsWith('fixture_error:') ? message : failure.code;
    const failed = failure.class === 'external' || message.startsWith('fixture_error:');
    return stop(legacyCode, failed, failure);
  } finally { clearTimeout(timer); options.signal.removeEventListener('abort', parentAbort); }
}
