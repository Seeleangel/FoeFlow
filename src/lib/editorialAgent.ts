import { callAI, type AIMessage } from './ai';
import { prepareAgentContext } from './agentRuntime';
import { createEditorialSession, hashText, type EditorialSession, type EditorialOutcome, type RunBudget } from './editorialTypes';
import { runEditorialController, type ControllerOptions, type EditorialModelPort } from './editorialController';
import { EDITORIAL_STAGE_PROMPTS } from './editorialPrompts';
import { formatQuestion } from './editorialGaps';
import { projectPublicArtifact, publicTextKey } from './editorialDocument';
import type { SourcePort } from './editorialSources';
export interface EditorialHandoff { status: 'pending' | 'confirmed'; notes: string[]; sources: string[] }
export type EditorialResult =
  | { type: 'question'; text: string; outcome?: EditorialOutcome }
  | { type: 'draft'; title: string; text: string; html: string; handoff: EditorialHandoff; outcome?: EditorialOutcome };
export interface LegacyEditorialOptions {
  messages: AIMessage[]; previousDraft: string; template: { name: string; structureJson: Record<string, unknown> };
  signal: AbortSignal; onStep: (label: string) => void; model?: EditorialModelPort; sources?: SourcePort; budget?: Partial<RunBudget>;
}
const productionModel: EditorialModelPort = async ({ stage, data }, signal) => {
  // A single POST per stage. The controller alone owns repair, cancellation, deadlines and total-call budgets.
  const response = await callAI({ messages: prepareAgentContext([{ role: 'system', content: EDITORIAL_STAGE_PROMPTS[stage] }, { role: 'user', content: JSON.stringify(data) }]), temperature: 0.2, maxTokens: stage === 'write' ? 8192 : stage === 'decide' ? 1500 : 6000, signal });
  return response.content;
};
/** User messages become evidence; assistant drafts remain untrusted legacy references. */
export function legacyEditorialSession(options: Pick<LegacyEditorialOptions, 'messages' | 'previousDraft'>): EditorialSession {
  const s = createEditorialSession('session-' + hashText(options.messages.map(message => message.content).join('\n')).slice(0,24));
  s.evidence = options.messages.flatMap((message, i) => {
    if (message.role !== 'user' || !message.content.trim()) return [];
    const id = 'message-' + hashText(i + ':' + message.content).slice(0,24);
    return [{ id, revision: 1, text: message.content, contentHash: hashText(message.content), kind: 'editor_message' as const, provenance: { messageId: id }, context: { scenario: 'unknown' as const } }];
  });
  if (options.previousDraft.trim()) s.evidence.push({ id: 'previous-draft', revision: 1, text: options.previousDraft, contentHash: hashText(options.previousDraft), kind: 'legacy_draft', provenance: {}, context: { scenario: 'unknown' } });
  return s;
}
export function legacyEditorialResult(outcome: EditorialOutcome): EditorialResult {
  const s = outcome.session;
  if (outcome.type === 'question') {
    const remaining = (outcome.question.remainingGapIds ?? []).map(id => s.gaps.find(g => g.id === id)).filter(Boolean).map(g => g!.label + '（' + g!.reason + '）');
    return { type: 'question', text: formatQuestion(outcome.question) + (remaining.length ? '\n其余待补事项：' + remaining.join('；') : ''), outcome };
  }
  if (outcome.type !== 'draft') return { type: 'question', text: '本轮尚未完成：' + outcome.reason + '。已保留当前候选与原确认稿。\n' + (s.lastStop?.nextActions.join('\n') ?? ''), outcome };
  const document = projectPublicArtifact(outcome.artifact);
  const notes = [...s.editorialNotes ?? [], ...outcome.artifact.editorialNotes, ...s.review?.notes ?? []].map(note => note.text).filter(text => !s.claims.some(c => c.visibility === 'private' && publicTextKey(text).includes(publicTextKey(c.value))));
  for (const waiver of s.task.sourceWaivers) notes.push('指定来源「' + (s.task.requiredSources.find(source => source.id === waiver.sourceRequirementId)?.selector.title ?? waiver.sourceRequirementId) + '」已由编辑明确豁免：' + waiver.reason);
  return { type: 'draft', title: document.title, text: '# ' + document.title + '\n' + document.bodyMarkdown, html: s.layout!.html, handoff: { status: 'pending', notes: [...new Set(notes)], sources: [...new Set(s.evidence.filter(e => s.readReceipts.some(receipt => receipt.evidenceIds.includes(e.id))).map(e => e.provenance.documentTitle ?? e.provenance.documentId ?? e.id))] }, outcome };
}
type SessionOptions = Omit<ControllerOptions, 'model'> & { model?: EditorialModelPort };
export function runEditorialAgent(options: SessionOptions): Promise<EditorialOutcome>;
export function runEditorialAgent(options: LegacyEditorialOptions): Promise<EditorialResult>;
/** The default and only runtime is v2. Legacy options are input/output adapters, not a legacy loop switch. */
export async function runEditorialAgent(options: SessionOptions | LegacyEditorialOptions): Promise<EditorialOutcome | EditorialResult> {
  if ('session' in options) return runEditorialController({ ...options, model: options.model ?? productionModel });
  const outcome = await runEditorialController({ ...options, session: legacyEditorialSession(options), model: options.model ?? productionModel });
  return legacyEditorialResult(outcome);
}
