import { artifactContentHash, ControlEventSchema, EditorialSessionSchema, ToolEventSchema, sameEntitySet, hashText, stableJson, type EditorialSession, type EditorialToolEvent, type EditorialControlEvent, type EventEnvelope, currentInputKey, sameInputKey } from './editorialTypes';
export { currentInputKey, sameInputKey } from './editorialTypes';
import { validateAcceptance } from './editorialAcceptance';
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
      validateAcceptance(s, s.layout).blockers.length || s.gaps.some(g => g.blocking && (g.state === 'open' || g.state === 'asked')) || s.diagnostics.length) throw new Error('confirmation_blocked');
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
      case 'facts_resolved':
        if (sameEntitySet(s.scopes, e.scopes) && sameEntitySet(s.claims, e.claims) && sameEntitySet(s.permissions, e.permissions) && sameEntitySet(s.alignments, e.alignments ?? s.alignments)) break;
        s = invalidateEditorialStamps(s); s.scopes = e.scopes; s.claims = e.claims; s.permissions = e.permissions; s.alignments = e.alignments ?? s.alignments; s.evidenceRevision++; s.policyRevision++; break;
      case 'task_revised':
        if (e.task.revision <= s.task.revision) throw new Error('invalid_task_revision');
        if (stableJson({ ...s.task, revision: 0 }) === stableJson({ ...e.task, revision: 0 })) break;
        s = invalidateEditorialStamps(s); s.task = e.task; break;
      case 'gaps_updated': s.gaps = e.gaps; break;
      case 'candidate_updated': {
        if (e.artifact.contentHash !== artifactContentHash(e.artifact.title, e.artifact.bodyMarkdown, e.artifact.assets)) throw new Error('content_key_mismatch');
        if (s.candidate && s.candidate.id === e.artifact.id && e.artifact.revision <= s.candidate.revision) throw new Error('invalid_candidate_revision');
        s = invalidateEditorialStamps(s); s.candidate = e.artifact; break;
      }
      case 'review_recorded':
        validContent(s); if (!sameInputKey(e.review.inputKey, currentInputKey(s))) throw new Error('stale_review'); s.review = e.review; s.phase = 'reviewing'; break;
      case 'layout_recorded':
        validContent(s); if (e.layout.contentHash !== s.candidate!.contentHash || e.layout.htmlHash !== hashText(e.layout.html)) throw new Error('stale_layout'); s.layout = e.layout; break;
      case 'gate_recorded':
        if (!sameInputKey(e.gate.inputKey, currentInputKey(s))) throw new Error('stale_gate'); s.gate = e.gate; break;
      case 'question_recorded': s.lastQuestion = e.question; s.gaps = s.gaps.map(g => e.question.gapIds.includes(g.id) ? { ...g, state: 'asked', askedAtMessageId: s.evidence.filter(record => record.kind === 'editor_message').slice(-1)[0]?.provenance.messageId } : g); s.phase = 'waiting_input'; break;
      case 'stopped': s.phase = e.phase; s.lastStop = { code: e.code, unresolvedIds: e.unresolvedIds, nextActions: e.nextActions }; break;
    }
  }
  s.revision++; return s;
}
/** Control entry is intentionally separate from the model/tool port. */
export function applyControlEvent(session: EditorialSession, event: EditorialControlEvent): EditorialSession {
  const e = ControlEventSchema.parse(event); ownership(session, e); const s = EditorialSessionSchema.parse(session);
  if (e.type === 'run_cancelled') { delete s.activeRunId; s.phase = 'incomplete'; }
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
