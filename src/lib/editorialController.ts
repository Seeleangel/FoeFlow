import { abortable, throwIfAborted } from './agentRuntime';
import { parseJsonObject } from './agentValidation';
import { applyFactPatch } from './editorialFacts';
import { applyTaskPatch } from './editorialTask';
import { taskContractValid } from './editorialContract';
import { deriveGaps, buildQuestion, legacyFieldsToGapIds } from './editorialGaps';
import { buildWriterContext, parseDraftArtifact } from './editorialDocument';
import { makePublicDocument, renderPublicDocument } from './editorialOutput';
import { validateAcceptance, sourceRequirementSatisfied, sourceWaiver } from './editorialAcceptance';
import { applyToolEvents, startEditorialRun } from './editorialState';
import { loadRequiredSource, readSourceDocument, recordSourceConsumption, SourceSearchCache, localSourcePort, type SourcePort } from './editorialSources';
import { getAllThemes, getDefaultTheme } from './themeLoader';
import { DEFAULT_RUN_BUDGET, RunBudgetSchema, ToolActionSchema, ReviewStampSchema, EditorialNoteSchema, hashText, stableJson, sameEntitySet, currentInputKey, sameInputKey, type EditorialSession, type EditorialOutcome, type EditorialToolEvent, type ToolAction, type ToolResult, type RunBudget, type GateReport, type LoadedSource, type EditorialNote } from './editorialTypes';
export type EditorialStage = 'preflight' | 'extract' | 'decide' | 'write' | 'review' | 'repair';
export type EditorialModelPort = (request: { stage: EditorialStage; data: Record<string, unknown> }, signal: AbortSignal) => Promise<string>;
export interface ControllerOptions {
  session: EditorialSession; model: EditorialModelPort; signal: AbortSignal; sources?: SourcePort; budget?: Partial<RunBudget>;
  template?: { name: string; structureJson: Record<string, unknown> }; runId?: string; now?: () => number; isCurrent?: () => boolean;
  onEvent?: (event: EditorialToolEvent) => void; onCheckpoint?: (session: EditorialSession) => void; onToolResult?: (result: ToolResult) => void; onStep?: (label: string) => void;
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
  return { sortedSet, selector, claim, subject, check, task, evidence: sortedSet(s.evidence.map(e => [e.kind,e.provenance.documentId,e.contentHash])) };
}
/** Envelope revisions, prose/diagnostic wording, UUIDs and remaining budget are not quality progress. */
export function qualityFingerprint(s: EditorialSession): string {
  const gate = canHandoff(s), semantic = semanticState(s);
  return hashText(stableJson({ evidence: semantic.evidence, claims: semantic.sortedSet(s.claims.map(c => semantic.claim(c.id))), permissions: semantic.sortedSet(s.permissions.map(p => [semantic.subject(p.subjectId),p.uses,p.state])), task: semantic.task,
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
      if (!ids.length) { try { ids = legacyFieldsToGapIds(s, strings(raw.fields)); } catch { /* old detail is not authority; ask program-derived concrete gaps */ } }
      if (!ids.length) ids = openGaps(s).filter(g => g.state === 'open').map(g => g.id);
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
  const used = { decisions: 0, writes: 0, searches: 0, modelCalls: 0 }; let repairUsed = false; let stalls = 0; let observation = '开始任务预检。'; let lastWriteFailure = '';
  const sources = options.sources ?? localSourcePort; const cache = new SourceSearchCache(sources); const attemptedRequired = new Set<string>(); const writeKeys = new Set<string>(); const contentHistory = new Set(s.candidate ? [s.candidate.contentHash] : []); const fingerprints = new Set<string>();
  const remaining = (): RunBudget => ({ ...config, decisions: config.decisions - used.decisions, writes: config.writes - used.writes, searches: config.searches - used.searches, modelCalls: config.modelCalls - used.modelCalls });
  const emit = (payloads: Payload[]) => {
    guard(); const events = payloads.map(payload => ({ ...payload, sessionId: s.sessionId, runId: s.activeRunId!, expectedRevision: s.revision } as EditorialToolEvent));
    s = applyToolEvents(s, events); guard(); for (const event of events) { guard(); options.onEvent?.(structuredClone(event)); } guard(); options.onCheckpoint?.(structuredClone(s));
  };
  const updateGaps = () => { const gaps = deriveGaps(s); if (!sameEntitySet(s.gaps, gaps)) emit([{ type: 'gaps_updated', gaps }]); };
  const toolResult = (tool: ToolAction['tool'], status: ToolResult['status'], code: string) => { guard(); observation = code; options.onToolResult?.({ tool, status, code, changedIds: [], events: [], allowedNext: allowedActions(s, remaining()), diagnostics: [] }); };
  const ask = async (stage: EditorialStage, data: Record<string, unknown>): Promise<string> => {
    guard(); if (used.modelCalls >= config.modelCalls) throw new Error('model_budget_exhausted');
    if (stableJson(data).length > 120000) throw new Error('context_capacity');
    used.modelCalls++; options.onStep?.(stage === 'decide' ? 'Agent 正在选择下一步' : 'Agent：' + stage); guard();
    const reply = await abortable(options.model({ stage, data }, signal), signal); guard(); return reply;
  };
  const json = async (stage: EditorialStage, data: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const raw = await ask(stage, data); try { return parseJsonObject(raw); } catch { if (repairUsed) throw new Error('invalid_json'); repairUsed = true; return parseJsonObject(await ask('repair', { stage, data, invalidResponse: raw })); }
  };
  const applyExtraction = (raw: Record<string, unknown>) => {
    if (Object.keys(raw).some(key => !['factPatch','taskPatch','editorialNotes'].includes(key)) || !raw.factPatch || typeof raw.factPatch !== 'object') throw new Error('invalid_extraction');
    const next = applyFactPatch(s, raw.factPatch);
    emit([{ type: 'facts_resolved', scopes: next.scopes, claims: next.claims, permissions: next.permissions, alignments: next.alignments, diagnostics: next.diagnostics }]);
    if (raw.taskPatch !== undefined) {
      const planned = applyTaskPatch(s, raw.taskPatch); const payloads: Payload[] = [];
      if (planned.task.revision !== s.task.revision) payloads.push({ type: 'task_revised', task: planned.task });
      if (!sameEntitySet(planned.diagnostics, s.diagnostics)) payloads.push({ type: 'diagnostics_updated', diagnostics: planned.diagnostics });
      if (payloads.length) emit(payloads);
    }
    if (raw.editorialNotes !== undefined) { if (!Array.isArray(raw.editorialNotes)) throw new Error('invalid_notes'); emit([{ type: 'notes_recorded', notes: raw.editorialNotes.map(note => EditorialNoteSchema.parse(note)) }]); }
    updateGaps();
  };
  const consume = async (loads: LoadedSource[]) => {
    if (!loads.length) return;
    const data = { task: s.task, evidence: s.evidence, scopes: s.scopes, claims: s.claims, permissions: s.permissions, loadedSources: loads };
    const context = JSON.stringify(data); const extracted = await json('extract', data); applyExtraction(extracted);
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
    emit([{ type: 'gate_recorded', gate }]); emit([{ type: 'handoff_ready' }]);
    return { type: 'draft', session: s, artifact: s.candidate!, handoff: { status: 'pending' } };
  };
  const stop = (code: string, failed = false): EditorialOutcome => {
    updateGaps(); const gaps = openGaps(s), fresh = gaps.filter(g => g.state === 'open');
    if (!failed && fresh.length) { const question = buildQuestion(s, fresh.map(g => g.id)); emit([{ type: 'question_recorded', question }]); return { type: 'question', session: s, question }; }
    if (!failed && gaps.length && s.lastQuestion) return { type: 'question', session: s, question: s.lastQuestion };
    const gate = canHandoff(s); emit([{ type: 'stopped', phase: failed ? 'failed' : 'incomplete', code, unresolvedIds: gate.blockers, nextActions: gate.checks.filter(c => c.status !== 'pass').map(c => c.detail) }]);
    return { type: failed ? 'failed' : 'incomplete', session: s, reason: code };
  };
  const layout = (themeId?: string) => {
    const projected = makePublicDocument(s); if (!projected.document) { toolResult('layout', 'rejected', 'public_projection_blocked'); return; }
    const theme = getAllThemes().find(theme => theme.name === themeId) ?? getDefaultTheme();
    emit([{ type: 'layout_recorded', layout: renderPublicDocument(projected.document, theme) }]); toolResult('layout', 'progress', 'layout_recorded');
  };
  const review = async () => {
    if (!s.candidate || s.review && sameInputKey(s.review.inputKey, currentInputKey(s))) { toolResult('review', 'no_progress', 'review_reused'); return; }
    const raw = await json('review', { task: s.task, evidence: s.evidence, claims: s.claims, permissions: s.permissions, artifact: s.candidate, programGate: validateAcceptance(s) });
    const lines = (value: unknown): string[] => { if (!Array.isArray(value) || value.length > 64 || value.some(line => typeof line !== 'string' || line.length > 2000)) throw new Error('invalid_review'); return value; };
    if (raw.humanChecks !== undefined) {
      if (!Array.isArray(raw.humanChecks)) throw new Error('invalid_human_checks');
      const human = raw.humanChecks.map(item => { if (!item || typeof item.id !== 'string' || typeof item.instruction !== 'string' || !item.instruction.trim()) throw new Error('invalid_human_checks'); return { id: 'human:' + item.id, origin: 'policy' as const, refs: s.task.coverage?.refs ?? [], severity: 'blocking' as const, verification: 'human' as const, rule: { kind: 'semantic' as const, instruction: item.instruction } }; });
      const added = human.filter(c => !s.task.criteria.some(old => old.id === c.id));
      if (added.length) emit([{ type: 'task_revised', task: { ...s.task, revision: s.task.revision + 1, criteria: [...s.task.criteria, ...added] } }]);
    }
    const notes: EditorialNote[] = lines(raw.notes).map(text => ({ id: 'review-note-' + hashText(text).slice(0,24), kind: 'advisory', text, relatedIds: [] }));
    const stamp = ReviewStampSchema.parse({ inputKey: currentInputKey(s), blocking: lines(raw.blocking), notes, issues: raw.issues ?? [], ...(raw.criterionChecks ? { criterionChecks: raw.criterionChecks } : {}) });
    emit([{ type: 'review_recorded', review: stamp }]); toolResult('review', 'progress', 'review_recorded');
    if (!stamp.blocking.length && !stamp.issues.some(issue => issue.severity === 'blocking')) layout();
  };
  try {
    guard(); updateGaps();
    if (openGaps(s).some(g => g.state === 'asked') && !openGaps(s).some(g => g.state === 'open') && s.lastQuestion) return { type: 'question', session: s, question: s.lastQuestion };
    applyExtraction(await json('preflight', { task: s.task, evidence: s.evidence, scopes: s.scopes, claims: s.claims, permissions: s.permissions, template: options.template }));
    if (!taskContractValid(s)) return stop('task_plan_incomplete');
    for (const source of s.task.requiredSources) if (!sourceWaiver(s, source.id)) await performRead(source.id);
    updateGaps(); fingerprints.add(qualityFingerprint(s));
    while (used.decisions < config.decisions) {
      guard(); const done = finish(); if (done) return done;
      const raw = await json('decide', { task: s.task, gaps: s.gaps, claims: s.claims, permissions: s.permissions, draft: s.candidate, review: s.review, layoutReady: !!s.layout, sources: cache.discovered(), allowedActions: allowedActions(s, remaining()), observation, remaining: remaining(), programGate: canHandoff(s) }); used.decisions++;
      let action: ToolAction;
      try { action = normalizeAction(raw, s); } catch { toolResult('submit', 'rejected', 'invalid_or_unknown_action'); stalls++; if (stalls >= Math.max(1, config.maxNoProgress)) return stop('no_progress'); continue; }
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
        if (action.gapIds.length) { const question = buildQuestion(s, action.gapIds); emit([{ type: 'question_recorded', question }]); toolResult('ask', 'progress', 'waiting_editor'); return { type: 'question', session: s, question }; }
        toolResult('ask', 'rejected', 'no_selected_gap');
      } else if (action.tool === 'write') {
        const repairs = s.candidate ? canHandoff(s).blockers.filter(id => !['candidate','review_current','layout_current'].includes(id)).sort() : lastWriteFailure ? [lastWriteFailure] : [];
        if (s.review?.blocking.length) repairs.push('review:blocking');
        for (const issue of s.review?.issues ?? []) if (issue.severity === 'blocking') repairs.push('review:' + issue.category + ':' + [...issue.relatedIds].sort().join(','));
        const semantic = semanticState(s);
        const key = hashText(stableJson({ evidence: semantic.evidence, task: semantic.task, repairs: semantic.sortedSet(repairs.map(semantic.check)) }));
        if (!allowedActions(s, remaining()).includes('write')) {
          toolResult('write', 'rejected', used.writes >= config.writes ? 'write_budget_exhausted' : 'blocking_gaps');
          if (s.candidate && used.writes >= config.writes) { await review(); const ready = finish(); return ready ?? stop('write_budget_exhausted'); }
        } else if (writeKeys.has(key)) {
          toolResult('write', 'no_progress', 'write_idempotency_hit'); if (s.candidate && !s.review) { await review(); const ready = finish(); if (ready) return ready; }
        } else {
          writeKeys.add(key); used.writes++; const rawDraft = await ask('write', buildWriterContext(s, repairs, {instructions:action.instructions,invalidArtifact:!!lastWriteFailure}) as unknown as Record<string, unknown>);
          let parsed = parseDraftArtifact(rawDraft, { id: 'candidate', revision: (s.candidate?.revision ?? 0) + 1 });
          if (!parsed.artifact && !repairUsed && /^[{`]/.test(rawDraft.trim())) { try { parseJsonObject(rawDraft); } catch { repairUsed = true; parsed = parseDraftArtifact(await ask('repair', { stage: 'write', invalidResponse: rawDraft }), { id: 'candidate', revision: (s.candidate?.revision ?? 0) + 1 }); } }
          // A fresh model response is fresh provenance, including the supported Markdown wire format.
          if(parsed.artifact) parsed.artifact.origin='model';
          if (!parsed.artifact) { lastWriteFailure = 'invalid_artifact'; toolResult('write', 'rejected', 'invalid_artifact'); }
          else if (contentHistory.has(parsed.artifact.contentHash) && s.candidate?.origin !== 'legacy') { if (parsed.artifact.editorialNotes.length) emit([{ type: 'notes_recorded', notes: parsed.artifact.editorialNotes }]); toolResult('write', 'no_progress', 'content_cycle'); }
          else { lastWriteFailure = ''; contentHistory.add(parsed.artifact.contentHash); emit([{ type: 'candidate_updated', artifact: parsed.artifact }]); toolResult('write', 'progress', 'candidate_updated'); }
        }
      } else if (action.tool === 'review') await review();
      else if (action.tool === 'layout') layout(action.themeId);
      else { const ready = finish(); if (ready) return ready; toolResult('submit', 'rejected', 'delivery_gate_blocked'); }
      updateGaps(); const fingerprint = qualityFingerprint(s); if (fingerprints.has(fingerprint)) stalls++; else { fingerprints.add(fingerprint); stalls = 0; }
      const ready = finish(); if (ready) return ready;
      if (stalls >= Math.max(1, config.maxNoProgress)) { if (s.candidate && !s.review) { await review(); const ready = finish(); if (ready) return ready; } return stop('no_progress'); }
    }
    if (s.candidate && !s.review && used.modelCalls < config.modelCalls) { await review(); const ready = finish(); if (ready) return ready; }
    return stop('decision_budget_exhausted');
  } catch (error) {
    if (options.signal.aborted || options.isCurrent && !options.isCurrent()) throw new DOMException('任务已停止', 'AbortError');
    // Deadline interrupts in-flight I/O; stopping still records a local checkpoint without reopening I/O.
    if (expired) { controller.abort(); const gate = canHandoff(s); s = { ...s, phase: 'incomplete', lastStop: { code: 'deadline_exceeded', unresolvedIds: gate.blockers, nextActions: ['保留当前候选；由编辑选择重试或补充。'] } }; options.onCheckpoint?.(structuredClone(s)); return { type: 'incomplete', session: s, reason: 'deadline_exceeded' }; }
    const code = error instanceof Error && ['model_budget_exhausted','context_capacity','invalid_json','invalid_extraction','invalid_review'].includes(error.message) ? error.message : error instanceof Error && error.message.startsWith('fixture_error:') ? error.message : 'model_or_tool_failed';
    return stop(code, code === 'model_or_tool_failed' || code.startsWith('fixture_error:'));
  } finally { clearTimeout(timer); options.signal.removeEventListener('abort', parentAbort); }
}
