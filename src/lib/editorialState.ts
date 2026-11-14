import { applyFactPatch } from './editorialFacts';
import { taskContractValid, taskSnapshotMonotonic } from './editorialContract';
import { validatePublicArtifact } from './editorialDocument';
import { artifactContentHash, ControlEventSchema, EditorialSessionSchema, ToolEventSchema, sameEntitySet, hashText, stableJson, gateEffectOf, type EditorialSession, type EditorialToolEvent, type EditorialControlEvent, type EventEnvelope, currentInputKey, sameInputKey } from './editorialTypes';
export { currentInputKey, sameInputKey } from './editorialTypes';
import { validateAcceptance } from './editorialAcceptance';
import { batchFromQuestion } from './editorialTurnState';
import { buildQuestion, deriveGaps } from './editorialGaps';
import type { GapDecision } from './editorialTypesV3';
export function invalidateEditorialStamps(s: EditorialSession): EditorialSession {
  const next = structuredClone(s); delete next.review; delete next.layout; delete next.gate; next.humanVerifications = [];
  next.phase = next.candidate ? 'writing' : 'planning'; next.selectedOutput = 'candidate'; return next;
}
function ownership(s: EditorialSession, e: EventEnvelope) {
  if (e.sessionId !== s.sessionId || !s.activeRunId || e.runId !== s.activeRunId || e.expectedRevision !== s.revision) throw new Error('stale_ownership');
}
export function startEditorialRun(s: EditorialSession, runId: string): EditorialSession {
  if (!runId.trim()) throw new Error('invalid_run');
  return { ...EditorialSessionSchema.parse(s), activeRunId: runId, revision: s.revision + 1 };
}
function validContent(s: EditorialSession) {
  const a = s.candidate;
  if (!a || a.contentHash !== artifactContentHash(a.title, a.bodyMarkdown, a.assets)) throw new Error('content_key_mismatch');
}
export function assertConfirmable(s: EditorialSession): void {
  validContent(s); const key = currentInputKey(s);
  if (!s.review || !sameInputKey(s.review.inputKey, key) || s.review.blocking.length || s.review.issues.some(i => i.severity === 'blocking') ||
      !s.gate || !sameInputKey(s.gate.inputKey, key) || s.gate.blockers.length || !s.gate.checks.length ||
      !s.layout || s.layout.contentHash !== key.contentHash || s.layout.htmlHash !== hashText(s.layout.html) ||
      validateAcceptance(s, s.layout).blockers.length || s.gaps.some(g => g.blocking && (g.state === 'open' || g.state === 'asked')) || s.diagnostics.some(diagnostic => gateEffectOf(diagnostic) === 'block')) throw new Error('confirmation_blocked');
}
export function applyToolEvents(session: EditorialSession, events: readonly EditorialToolEvent[]): EditorialSession {
  const checked = events.map(e => ToolEventSchema.parse(e)); checked.forEach(e => ownership(session, e));
  if (!checked.length) return structuredClone(session);
  let s = EditorialSessionSchema.parse(session);
  for (const e of checked) {
    switch (e.type) {
      case 'evidence_loaded': {
        const byId = new Map(s.evidence.map(v => [v.id, v]));
        for (const record of e.records) {
          const old = byId.get(record.id);
          if (record.contentHash !== hashText(record.text) || (old && (record.revision < old.revision || (record.revision === old.revision && stableJson(record) !== stableJson(old))))) throw new Error('invalid_evidence_revision');
          byId.set(record.id, record);
        }
        const records = [...byId.values()], receipts = [...new Map([...s.readReceipts, ...e.receipts].map(v => [v.id, v])).values()];
        if (sameEntitySet(s.evidence, records) && sameEntitySet(s.readReceipts, receipts)) break;
        s = invalidateEditorialStamps(s); s.evidence = records; s.readReceipts = receipts; s.evidenceRevision++; break;
      }
      case 'facts_resolved': {
        const validated = applyFactPatch(s, { scopes: e.scopes, claims: e.claims, permissions: e.permissions, ...(e.alignments ? { alignments: e.alignments } : {}) });
        if (!sameEntitySet(validated.claims, e.claims) || !sameEntitySet(validated.permissions, e.permissions) || !sameEntitySet(validated.scopes, e.scopes) || e.alignments && !sameEntitySet(validated.alignments, e.alignments)) throw new Error('unsafe_fact_snapshot');
        const diagnostics = [...new Map([...validated.diagnostics,...e.diagnostics??[]].map(d=>[stableJson([d.owner,d.code,d.refs]),d])).values()];
        const blocks = diagnostics.filter(diagnostic => gateEffectOf(diagnostic) === 'block');
        const agents = diagnostics.filter(diagnostic => gateEffectOf(diagnostic) !== 'block').map(diagnostic => ({ ...diagnostic, gateEffect: gateEffectOf(diagnostic) }));
        const mergedAgents = [...new Map([...(s.agentDiagnostics ?? []), ...agents].map(d=>[stableJson([d.owner,d.code,d.message,d.refs]),d])).values()];
        if (!sameEntitySet(s.agentDiagnostics ?? [], mergedAgents)) s.agentDiagnostics = mergedAgents;
        if (!sameEntitySet(s.diagnostics, blocks)) { s = invalidateEditorialStamps(s); s.diagnostics = blocks; }
        if (sameEntitySet(s.scopes, e.scopes) && sameEntitySet(s.claims, e.claims) && sameEntitySet(s.permissions, e.permissions) && sameEntitySet(s.alignments, e.alignments ?? s.alignments)) break;
        s = invalidateEditorialStamps(s); s.scopes = e.scopes; s.claims = e.claims; s.permissions = e.permissions; s.alignments = e.alignments ?? s.alignments; s.evidenceRevision++; s.policyRevision++; break;
      }
      case 'task_revised':
        if (!taskContractValid(s, e.task) || !taskSnapshotMonotonic(s.task, e.task)) throw new Error('invalid_task_contract');
        if (e.task.revision <= s.task.revision) throw new Error('invalid_task_revision');
        if (stableJson({ ...s.task, revision: 0 }) === stableJson({ ...e.task, revision: 0 })) break;
        s = invalidateEditorialStamps(s); s.task = e.task; break;
      case 'diagnostics_updated': {
        const blocks = e.diagnostics.filter(diagnostic => gateEffectOf(diagnostic) === 'block');
        const agents = e.diagnostics.filter(diagnostic => gateEffectOf(diagnostic) !== 'block').map(diagnostic => ({ ...diagnostic, gateEffect: gateEffectOf(diagnostic) }));
        s = invalidateEditorialStamps(s); s.diagnostics = blocks;
        s.agentDiagnostics = [...new Map([...(s.agentDiagnostics ?? []), ...agents].map(d=>[stableJson([d.owner,d.code,d.message,d.refs]),d])).values()];
        break;
      }
      case 'notes_recorded': s.editorialNotes = mergeEditorialNotes(s.editorialNotes ?? [], e.notes); if (s.candidate) s.candidate.editorialNotes = mergeEditorialNotes(s.candidate.editorialNotes, s.editorialNotes); break;
      case 'handoff_ready': assertConfirmable(s); s.phase = 'pending_confirmation'; break;
      case 'gaps_updated': s.gaps = e.gaps; break;
      case 'candidate_updated': {
        if (e.artifact.contentHash !== artifactContentHash(e.artifact.title, e.artifact.bodyMarkdown, e.artifact.assets)) throw new Error('content_key_mismatch');
        if (s.candidate && s.candidate.id === e.artifact.id && e.artifact.revision <= s.candidate.revision) throw new Error('invalid_candidate_revision');
        s = invalidateEditorialStamps(s); s.candidate = { ...e.artifact, editorialNotes: mergeEditorialNotes(mergeEditorialNotes(s.editorialNotes ?? [], s.candidate?.editorialNotes ?? []), e.artifact.editorialNotes) }; break;
      }
      case 'review_recorded':
        validContent(s); if (!sameInputKey(e.review.inputKey, currentInputKey(s))) throw new Error('stale_review'); s.review = e.review; s.phase = 'reviewing';
        if (s.candidate) s.candidate.editorialNotes = mergeEditorialNotes(s.candidate.editorialNotes, e.review.notes);
        if (s.candidate?.origin !== 'legacy' && taskContractValid(s) && !validatePublicArtifact(s).length) s.diagnostics = s.diagnostics.filter(d => d.owner !== 'compatibility');
        break;
      case 'layout_recorded':
        validContent(s); if (e.layout.contentHash !== s.candidate!.contentHash || e.layout.htmlHash !== hashText(e.layout.html)) throw new Error('stale_layout'); s.layout = e.layout; break;
      case 'gate_recorded':
        if (!sameInputKey(e.gate.inputKey, currentInputKey(s))) throw new Error('stale_gate'); s.gate = e.gate; break;
      case 'question_recorded': {
        const batch = batchFromQuestion(s, e.question);
        const messageId = s.evidence.filter(record => record.kind === 'editor_message').slice(-1)[0]?.provenance.messageId;
        s.questionBatches = [...(s.questionBatches ?? []).filter(existing => existing.id !== batch.id), batch];
        s.activeBatchId = batch.id;
        s.gaps = s.gaps.map(gap => {
          if (!e.question.gapIds.includes(gap.id)) return gap;
          const history = gap.askHistory ?? [];
          const entry = { batchId: batch.id, messageId: messageId ?? batch.createdAtMessageId, promptHash: hashText(gap.label + '\n' + gap.reason), reasonCode: 'question_opened' };
          return { ...gap, state: 'asked', askHistory: history.some(item => item.batchId === batch.id) ? history : [...history, entry] };
        });
        s.phase = 'waiting_input'; break;
      }
      case 'agent_diagnostic_recorded': {
        const diagnostic = { ...e.diagnostic, gateEffect: gateEffectOf(e.diagnostic) };
        const key = stableJson([diagnostic.owner ?? '', diagnostic.code, diagnostic.message, diagnostic.refs]);
        const current = s.agentDiagnostics ?? [];
        if (!current.some(item => stableJson([item.owner ?? '', item.code, item.message, item.refs]) === key)) s.agentDiagnostics = [...current, diagnostic];
        break;
      }
      case 'stopped': s.phase = e.phase; break;
    }
  }
  s.revision++; return s;
}
/** Program-side batch opener for failure actions: no model call, no evidence write, no EditorTurn. */
export function openQuestionBatch(session: EditorialSession, gapIds: string[]): EditorialSession {
  const s = structuredClone(session);
  s.gaps = deriveGaps(s);
  const question = buildQuestion(s, gapIds);
  const batch = batchFromQuestion(s, question);
  const messageId = batch.createdAtMessageId;
  s.questionBatches = [...(s.questionBatches ?? []).filter(existing => existing.id !== batch.id), batch];
  s.activeBatchId = batch.id;
  s.gaps = s.gaps.map(gap => batch.gapIds.includes(gap.id) ? {
    ...gap, state: 'asked' as const,
    askHistory: [...(gap.askHistory ?? []), { batchId: batch.id, messageId, promptHash: hashText(gap.label + '\n' + gap.reason), reasonCode: 'program_open' }],
  } : gap);
  s.phase = 'waiting_input';
  s.revision++;
  return s;
}

/** Editor waiver of unresolved gaps from a failure card; closes them without a model run. */
export function deferGaps(session: EditorialSession, gapIds: string[], note = '编辑选择按现有信息继续'): EditorialSession {
  const unique = [...new Set(gapIds)];
  if (!unique.length) return structuredClone(session);
  const s = structuredClone(session);
  const createdAt = new Date().toISOString();
  const messageId = 'editor-defer-' + hashText([s.sessionId, ...unique, s.revision].join(':')).slice(0, 24);
  const labels = unique.map(id => s.gaps.find(gap => gap.id === id)?.label ?? id);
  const text = note + '：' + labels.join('、');
  s.evidence = [...s.evidence, { id: messageId, revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: { messageId }, context: { scenario: 'unknown' } }];
  s.evidenceRevision++;
  const refs = [{ evidenceId: messageId, revision: 1, start: 0, end: text.length, quote: text }];
  const decisions: GapDecision[] = unique.map(gapId => ({ id: 'gd-' + hashText(gapId + ':defer:' + messageId).slice(0, 24), gapId, by: 'editor', kind: 'defer', refs, note, createdAt }));
  s.gapDecisions = [...(s.gapDecisions ?? []), ...decisions];
  s.gaps = s.gaps.map(gap => unique.includes(gap.id) ? { ...gap, state: 'waived' as const } : gap);
  delete s.review; delete s.layout; delete s.gate; s.humanVerifications = []; s.selectedOutput = 'candidate';
  s.revision++;
  return s;
}

/** Control entry is intentionally separate from the model/tool port. */
export function applyControlEvent(session: EditorialSession, event: EditorialControlEvent): EditorialSession {
  const e = ControlEventSchema.parse(event); ownership(session, e); const s = EditorialSessionSchema.parse(session);
  if (e.type === 'run_cancelled') { delete s.activeRunId; s.phase = 'incomplete'; if (s.lastRun) s.lastRun = { ...s.lastRun, outcome: 'cancelled' }; }
  else if (e.type === 'human_verified') {
    if (!sameInputKey(e.verification.inputKey, currentInputKey(s)) || !s.task.criteria.some(c => c.id === e.verification.criterionId && (c.verification !== 'deterministic' || c.rule.kind === 'semantic'))) throw new Error('invalid_human_verification');
    s.humanVerifications = [...s.humanVerifications.filter(v => v.criterionId !== e.verification.criterionId), e.verification]; delete s.gate;
  } else {
    assertConfirmable(s);
    if (!sameInputKey(e.confirmation.inputKey, currentInputKey(s)) || e.confirmation.htmlHash !== s.layout!.htmlHash) throw new Error('stale_confirmation');
    s.committed = { artifact: structuredClone(s.candidate!), layout: structuredClone(s.layout!), confirmation: e.confirmation }; s.phase = 'confirmed'; s.selectedOutput = 'committed';
  }
  s.revision++; return s;
}
/** The caller persists this exact next snapshot before applying it to UI state. A rejection leaves the old state untouched. */
export async function persistConfirmation(session: EditorialSession, event: Extract<EditorialControlEvent, { type: 'editor_confirmed' }>, persist: (next: EditorialSession) => Promise<void>): Promise<EditorialSession> {
  const next = applyControlEvent(session, event); await persist(structuredClone(next)); return next;
}

/** Append-only model metadata ledger. Omitting or rebinding an ID never removes a known restriction. */
function mergeEditorialNotes(previous: import('./editorialTypes').EditorialNote[], incoming: import('./editorialTypes').EditorialNote[]): import('./editorialTypes').EditorialNote[] {
  const items = new Map(previous.map(note => [stableJson({ kind: note.kind, text: note.text, relatedIds: [...note.relatedIds].sort() }), note]));
  for (const note of incoming) { const key = stableJson({ kind: note.kind, text: note.text, relatedIds: [...note.relatedIds].sort() }); if (!items.has(key)) items.set(key, { ...note, id: previous.some(old => old.id === note.id) ? 'note-' + hashText(key).slice(0,24) : note.id }); }
  return [...items.values()];
}
