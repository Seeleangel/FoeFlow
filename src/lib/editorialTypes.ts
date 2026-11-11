/** Shared v2 contracts. Runtime schemas reject malformed/unrecognised fields at trust boundaries. */
export type Id = string;
export type Hash = string;
export interface EvidenceRef { evidenceId: Id; revision: number; start: number; end: number; quote: string }
export interface EvidenceRecord { id: Id; revision: number; contentHash: Hash; kind: 'editor_message' | 'library' | 'import' | 'legacy_draft'; text: string; provenance: { documentId?: Id; documentTitle?: string; complete?: boolean; messageId?: Id; originClaimIds?: Id[] }; context: { scenario: 'real' | 'simulation' | 'unknown'; asOf?: string } }
export interface Scope { id: Id; kind: 'event' | 'person' | 'organization' | 'asset' | 'project' | 'other'; label: string; parentId?: Id; qualifiers: { key: string; value: string; refs: EvidenceRef[] }[]; anchors: EvidenceRef[]; identity: 'provisional' | 'aligned' }
export interface ScopeAlignment { leftId: Id; rightId: Id; refs: EvidenceRef[] }
export interface MetricSpec { measure: string; unit: string; population: string; phase?: string; period?: string; aggregation: 'single' | 'total' | 'sample' | 'cumulative' | 'unknown'; precision: 'exact' | 'approximate' | 'unknown' }
export interface FactSelector { scopeId: Id; predicate: string; metric?: MetricSpec; cardinality?: 'single' | 'set'; cardinalityRefs?: EvidenceRef[] }
export interface FactClaim { id: Id; selector: FactSelector; value: string; refs: EvidenceRef[]; epistemic: 'supported' | 'pending' | 'disputed' | 'unknown'; visibility: 'public' | 'editor_only' | 'private'; statusBasis: EvidenceRef[]; supersedes?: Id[] }
export interface PermissionUse { channel: string; purpose: string; identity: 'named' | 'anonymous' | 'not_applicable' }
export interface Permission { id: Id; subjectId: Id; uses: PermissionUse[]; state: 'allowed' | 'denied' | 'unknown' | 'withdrawn'; refs: EvidenceRef[] }
export interface RequiredSource { id: Id; selector: { documentId?: Id; title?: string }; purpose: string; refs: EvidenceRef[]; depth: 'relevant_excerpt' | 'full_document'; state: 'pending' | 'satisfied' | 'unavailable' }
export type CriterionRule =
  | { kind: 'include_facts'; factIds: Id[]; location: 'body' | 'first_body_paragraph' }
  | { kind: 'exclude_claims'; factIds: Id[] }
  | { kind: 'length'; min?: number; max?: number; unit: 'visible_characters' }
  | { kind: 'preserve_blocks'; blockHashes: Hash[] }
  | { kind: 'permission'; subjectIds: Id[]; use: string; channel?: string; identity?: PermissionUse['identity'] }
  | { kind: 'source_read'; sourceRequirementId: Id }
  | { kind: 'semantic'; instruction: string };
export interface AcceptanceCriterion { id: Id; origin: 'user' | 'template' | 'policy'; refs: EvidenceRef[]; rule: CriterionRule; severity: 'blocking' | 'advisory'; verification: 'deterministic' | 'semantic' | 'human' }
export interface InformationRequirement { id: Id; selector: FactSelector; label: string; reason: string; refs: EvidenceRef[]; necessity: 'blocking' | 'optional'; resolution: 'supply_fact' | 'select_option' | 'omit_or_replace' }
export interface SourceWaiver { sourceRequirementId: Id; refs: EvidenceRef[]; actor: 'editor'; reason: string }
export interface TaskContract { schemaVersion: 2; revision: number; objective: string; intents: ('inform' | 'call_to_action' | 'retrospective' | 'interview' | 'edit' | 'example' | 'other')[]; readerAction?: string; targetScopes: Id[]; requirements: InformationRequirement[]; requiredSources: RequiredSource[]; criteria: AcceptanceCriterion[]; permittedOmissions: { requirementId: Id; refs: EvidenceRef[] }[]; sourceWaivers: SourceWaiver[]; coverage?: { status: 'validated' | 'pending'; refs: EvidenceRef[] } }
export interface Gap { id: Id; requirementId: Id; kind: 'missing' | 'conflict' | 'permission' | 'scope' | 'source_unavailable' | 'plan_ambiguity'; selector: FactSelector; label: string; reason: string; state: 'open' | 'asked' | 'resolved' | 'waived'; blocking: boolean; alternatives: { id: Id; label: string; refs: EvidenceRef[] }[]; resolutionClaimIds: Id[]; askedAtMessageId?: Id }
export interface QuestionBatch { id: Id; gapIds: Id[]; remainingGapIds?: Id[]; items: { gapId: Id; subject: string; requested: string; why: string; options: string[] }[] }
export interface EditorialNote { id: Id; kind: 'asset' | 'fact_check' | 'process' | 'advisory'; text: string; relatedIds: Id[] }
export interface AssetUse { assetId: Id; slotId: Id; use: string; channel?: string; identity?: PermissionUse['identity']; publicCaption?: string; state: 'included' | 'placeholder' | 'omitted' }
export interface ContentBlock { id: Id; kind: 'paragraph' | 'heading' | 'list' | 'quote' | 'asset_slot'; text: string }
export interface DraftArtifact { schemaVersion: 2; id: Id; revision: number; title: string; bodyMarkdown: string; contentHash: Hash; blocks: ContentBlock[]; claimLinks: { blockId: Id; claimIds: Id[] }[]; editorialNotes: EditorialNote[]; assets: AssetUse[]; origin: 'model' | 'editor' | 'legacy'; originalMarkdown?: string }
export interface InputKey { contentHash: Hash; evidenceRevision: number; taskRevision: number; policyRevision: number }
export interface GateCheck { criterionId: Id; status: 'pass' | 'fail' | 'unknown'; verifier: string; detail: string }
export interface GateReport { inputKey: InputKey; checks: GateCheck[]; blockers: string[] }
export interface ReviewIssue { id: Id; category: 'unsupported_claim' | 'scope' | 'privacy' | 'permission' | 'workflow_leak' | 'constraint' | 'style'; severity: 'blocking' | 'advisory'; relatedIds: Id[]; span?: { blockId: Id; start: number; end: number }; detail: string }
export interface ReviewStamp { inputKey: InputKey; issues: ReviewIssue[]; blocking: string[]; notes: EditorialNote[]; criterionChecks?: GateCheck[] }
export interface LayoutStamp { contentHash: Hash; themeId: string; themeVersion: string; html: string; htmlHash: Hash }
export interface Confirmation { inputKey: InputKey; htmlHash: Hash; actor: 'editor'; confirmedAt: string }
export interface HumanVerification { criterionId: Id; inputKey: InputKey; status: 'pass' | 'fail'; actor: 'editor'; verifiedAt: string }
export interface PublicDocument { title: string; bodyMarkdown: string; blocks: ContentBlock[]; assets: { assetId: Id; slotId: Id; publicCaption?: string }[]; contentHash: Hash }
export interface ReadReceipt { id: Id; documentId: Id; contentHash: Hash; range: [number, number]; evidenceIds: Id[]; consumedByStage: 'brief' | 'write' | 'review'; contextHash: Hash; sourceRequirementId?: Id }
export interface RunBudget { decisions: number; writes: number; searches: number; modelCalls: number; maxNoProgress: number; maxElapsedMs: number }
export const DEFAULT_RUN_BUDGET: Readonly<RunBudget> = Object.freeze({ decisions: 12, writes: 3, searches: 3, modelCalls: 24, maxNoProgress: 2, maxElapsedMs: 600_000 });
/** Stable core reason codes. New modules may add domain-specific diagnostic codes. */
export const EDITORIAL_CODES = Object.freeze({ invalidSchema: 'invalid_schema', staleOwnership: 'stale_ownership', contextCapacity: 'context_capacity', invalidReference: 'invalid_reference', scopeUnresolved: 'scope_unresolved', taskPatchRejected: 'task_patch_rejected', protectedSpan: 'protected_span', assetPermission: 'asset_permission', claimPermission: 'claim_permission', outputNotConfirmed: 'output_not_confirmed', sourceUnavailable: 'source_unavailable', noProgress: 'no_progress', budgetExhausted: 'budget_exhausted' });
export interface Diagnostics { owner?: string; code: string; message: string; refs: EvidenceRef[] }
export interface FactResolution { claims: FactClaim[]; conflicts: Gap[]; diagnostics: Diagnostics[]; permissions: Permission[] }
export interface ProjectionResult { document?: PublicDocument; blockers: Diagnostics[] }
export interface OutputBundle { document: PublicDocument; layout: LayoutStamp }
export interface LegacySnapshot { mode: 'pending' | 'confirmed' | 'legacy-manual' | 'damaged'; title: string; text: string; html: string; confirmed: boolean; originalConfirmation?: unknown; raw: unknown }
export interface EditorialSession {
  schemaVersion: 2; sessionId: Id; revision: number; evidenceRevision: number; policyRevision: number;
  evidence: EvidenceRecord[]; readReceipts: ReadReceipt[]; scopes: Scope[]; alignments: ScopeAlignment[]; claims: FactClaim[]; permissions: Permission[];
  task: TaskContract; gaps: Gap[]; candidate?: DraftArtifact; review?: ReviewStamp; layout?: LayoutStamp; gate?: GateReport;
  committed?: { artifact: DraftArtifact; layout: LayoutStamp; confirmation?: Confirmation };
  phase: 'planning' | 'gathering' | 'writing' | 'reviewing' | 'waiting_input' | 'pending_confirmation' | 'confirmed' | 'incomplete' | 'failed';
  activeRunId?: Id; lastQuestion?: QuestionBatch; lastStop?: { code: string; unresolvedIds: Id[]; nextActions: string[] };
  diagnostics: Diagnostics[]; humanVerifications: HumanVerification[]; legacy?: LegacySnapshot;
  selectedOutput?: 'candidate' | 'committed' | 'legacy';
}
export type EditorialOutcome =
  | { type: 'question'; session: EditorialSession; question: QuestionBatch }
  | { type: 'draft'; session: EditorialSession; artifact: DraftArtifact; handoff: { status: 'pending' } }
  | { type: 'incomplete' | 'failed'; session: EditorialSession; reason: string };
export type ToolAction =
  | { tool: 'search'; query: string; forRequirementIds: Id[] }
  | { tool: 'read'; documentId: Id; sourceRequirementId: Id; range?: [number, number] }
  | { tool: 'write'; instructions: string; repairCriterionIds: Id[] }
  | { tool: 'review' } | { tool: 'layout'; themeId: string } | { tool: 'ask'; gapIds: Id[] } | { tool: 'submit' };
export interface EventEnvelope { sessionId: Id; runId: Id; expectedRevision: number }
export type EditorialToolEvent = EventEnvelope & (
  | { type: 'evidence_loaded'; records: EvidenceRecord[]; receipts: ReadReceipt[] }
  | { type: 'facts_resolved'; scopes: Scope[]; claims: FactClaim[]; permissions: Permission[]; alignments?: ScopeAlignment[]; diagnostics?: Diagnostics[] }
  | { type: 'task_revised'; task: TaskContract }
  | { type: 'diagnostics_updated'; diagnostics: Diagnostics[] }
  | { type: 'handoff_ready' }
  | { type: 'gaps_updated'; gaps: Gap[] }
  | { type: 'candidate_updated'; artifact: DraftArtifact }
  | { type: 'review_recorded'; review: ReviewStamp }
  | { type: 'layout_recorded'; layout: LayoutStamp }
  | { type: 'gate_recorded'; gate: GateReport }
  | { type: 'question_recorded'; question: QuestionBatch }
  | { type: 'stopped'; phase: 'waiting_input' | 'incomplete' | 'failed'; code: string; unresolvedIds: Id[]; nextActions: string[] });
export type EditorialControlEvent = EventEnvelope & (
  | { type: 'editor_confirmed'; confirmation: Confirmation }
  | { type: 'human_verified'; verification: HumanVerification }
  | { type: 'run_cancelled' });
export interface LoadedSource { sourceRequirementId?: Id; documentId: Id; evidenceId: Id; range: [number, number] }
export interface ToolResult { loadedSources?: LoadedSource[]; tool: ToolAction['tool']; status: 'progress' | 'no_progress' | 'rejected' | 'failed'; code: string; changedIds: Id[]; events: EditorialToolEvent[]; allowedNext: ToolAction['tool'][]; diagnostics: Diagnostics[] }

// Small dependency-free runtime schema combinators. Only the checked parse boundary asserts T.
type Check = (v: unknown) => boolean;
const str: Check = v => typeof v === 'string';
const id: Check = v => typeof v === 'string' && v.trim().length > 0;
const num: Check = v => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const bool: Check = v => typeof v === 'boolean';
const en = (...values: unknown[]): Check => v => values.includes(v);
const opt = (check: Check): Check => v => v === undefined || check(v);
const arr = (check: Check): Check => v => Array.isArray(v) && v.every(check);
const obj = (fields: Record<string, Check>): Check => v => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(k => k in fields) && Object.entries(fields).every(([k, check]) => check((v as Record<string, unknown>)[k]));
const union = (...checks: Check[]): Check => v => checks.some(check => check(v));
export interface RuntimeSchema<T> { parse(value: unknown): T; is(value: unknown): value is T }
function schema<T>(check: Check): RuntimeSchema<T> { return { parse(value) { if (!check(value)) throw new Error('invalid_schema'); return structuredClone(value) as T; }, is: (value): value is T => check(value) }; }
const ref = obj({ evidenceId: id, revision: num, start: num, end: num, quote: id });
const refs = arr(ref), ids = arr(id);
const evidence = obj({ id, revision: num, contentHash: id, kind: en('editor_message', 'library', 'import', 'legacy_draft'), text: str, provenance: obj({ documentId: opt(id), documentTitle: opt(str), complete: opt(bool), messageId: opt(id), originClaimIds: opt(ids) }), context: obj({ scenario: en('real', 'simulation', 'unknown'), asOf: opt(str) }) });
const scope = obj({ id, kind: en('event', 'person', 'organization', 'asset', 'project', 'other'), label: id, parentId: opt(id), qualifiers: arr(obj({ key: id, value: id, refs })), anchors: refs, identity: en('provisional', 'aligned') });
const alignment = obj({ leftId: id, rightId: id, refs });
const metric = obj({ measure: id, unit: id, population: id, phase: opt(str), period: opt(str), aggregation: en('single', 'total', 'sample', 'cumulative', 'unknown'), precision: en('exact', 'approximate', 'unknown') });
const selector = obj({ scopeId: id, predicate: v => id(v) && (v as string).length <= 120, metric: opt(metric), cardinality: opt(en('single', 'set')), cardinalityRefs: opt(refs) });
const claim = obj({ id, selector, value: id, refs, epistemic: en('supported', 'pending', 'disputed', 'unknown'), visibility: en('public', 'editor_only', 'private'), statusBasis: refs, supersedes: opt(ids) });
const permissionUse = obj({ channel: id, purpose: id, identity: en('named', 'anonymous', 'not_applicable') });
const permission = obj({ id, subjectId: id, uses: v => Array.isArray(v) && v.length > 0 && v.every(permissionUse), state: en('allowed', 'denied', 'unknown', 'withdrawn'), refs });
const source = obj({ id, selector: obj({ documentId: opt(id), title: opt(id) }), purpose: id, refs, depth: en('relevant_excerpt', 'full_document'), state: en('pending', 'satisfied', 'unavailable') });
const rule = union(
  obj({ kind: en('include_facts'), factIds: ids, location: en('body', 'first_body_paragraph') }),
  obj({ kind: en('exclude_claims'), factIds: ids }), obj({ kind: en('length'), min: opt(num), max: opt(num), unit: en('visible_characters') }),
  obj({ kind: en('preserve_blocks'), blockHashes: ids }), obj({ kind: en('permission'), subjectIds: ids, use: id, channel: opt(id), identity: opt(en('named', 'anonymous', 'not_applicable')) }),
  obj({ kind: en('source_read'), sourceRequirementId: id }), obj({ kind: en('semantic'), instruction: id }));
const criterion = obj({ id, origin: en('user', 'template', 'policy'), refs, rule, severity: en('blocking', 'advisory'), verification: en('deterministic', 'semantic', 'human') });
const requirement = obj({ id, selector, label: id, reason: id, refs, necessity: en('blocking', 'optional'), resolution: en('supply_fact', 'select_option', 'omit_or_replace') });
const waiver = obj({ sourceRequirementId: id, refs, actor: en('editor'), reason: id });
const task = obj({ schemaVersion: en(2), revision: num, objective: str, intents: arr(en('inform', 'call_to_action', 'retrospective', 'interview', 'edit', 'example', 'other')), readerAction: opt(id), targetScopes: ids, requirements: arr(requirement), requiredSources: arr(source), criteria: arr(criterion), permittedOmissions: arr(obj({ requirementId: id, refs })), sourceWaivers: arr(waiver), coverage: opt(obj({ status: en('validated', 'pending'), refs })) });
const gap = obj({ id, requirementId: id, kind: en('missing', 'conflict', 'permission', 'scope', 'source_unavailable', 'plan_ambiguity'), selector, label: id, reason: id, state: en('open', 'asked', 'resolved', 'waived'), blocking: bool, alternatives: arr(obj({ id, label: id, refs })), resolutionClaimIds: ids, askedAtMessageId: opt(id) });
const question = obj({ id, gapIds: ids, remainingGapIds: opt(ids), items: arr(obj({ gapId: id, subject: id, requested: id, why: id, options: arr(str) })) });
const note = obj({ id, kind: en('asset', 'fact_check', 'process', 'advisory'), text: str, relatedIds: ids });
const asset = obj({ assetId: id, slotId: id, use: id, channel: opt(id), identity: opt(en('named', 'anonymous', 'not_applicable')), publicCaption: opt(str), state: en('included', 'placeholder', 'omitted') });
const block = obj({ id, kind: en('paragraph', 'heading', 'list', 'quote', 'asset_slot'), text: str });
const draft = obj({ schemaVersion: en(2), id, revision: num, title: id, bodyMarkdown: id, contentHash: id, blocks: arr(block), claimLinks: arr(obj({ blockId: id, claimIds: ids })), editorialNotes: arr(note), assets: arr(asset), origin: en('model', 'editor', 'legacy'), originalMarkdown: opt(str) });
const inputKey = obj({ contentHash: str, evidenceRevision: num, taskRevision: num, policyRevision: num });
const gate = obj({ inputKey, checks: arr(obj({ criterionId: id, status: en('pass', 'fail', 'unknown'), verifier: id, detail: str })), blockers: arr(str) });
const issue = obj({ id, category: en('unsupported_claim', 'scope', 'privacy', 'permission', 'workflow_leak', 'constraint', 'style'), severity: en('blocking', 'advisory'), relatedIds: ids, span: opt(obj({ blockId: id, start: num, end: num })), detail: str });
const review = obj({ inputKey, issues: arr(issue), blocking: arr(str), notes: arr(note), criterionChecks: opt(arr(obj({ criterionId: id, status: en('pass', 'fail', 'unknown'), verifier: id, detail: str }))) });
const layout = obj({ contentHash: id, themeId: id, themeVersion: id, html: id, htmlHash: id });
const confirmation = obj({ inputKey, htmlHash: id, actor: en('editor'), confirmedAt: id });
const human = obj({ criterionId: id, inputKey, status: en('pass', 'fail'), actor: en('editor'), verifiedAt: id });
const receipt = obj({ id, documentId: id, contentHash: id, range: v => Array.isArray(v) && v.length === 2 && v.every(num) && v[1] > v[0], evidenceIds: ids, consumedByStage: en('brief', 'write', 'review'), contextHash: id, sourceRequirementId: opt(id) });
const diagnostic = obj({ owner: opt(id), code: id, message: str, refs });
const session = obj({ schemaVersion: en(2), sessionId: id, revision: num, evidenceRevision: num, policyRevision: num, evidence: arr(evidence), readReceipts: arr(receipt), scopes: arr(scope), alignments: arr(alignment), claims: arr(claim), permissions: arr(permission), task, gaps: arr(gap), candidate: opt(draft), review: opt(review), layout: opt(layout), gate: opt(gate), committed: opt(obj({ artifact: draft, layout, confirmation: opt(confirmation) })), phase: en('planning', 'gathering', 'writing', 'reviewing', 'waiting_input', 'pending_confirmation', 'confirmed', 'incomplete', 'failed'), activeRunId: opt(id), lastQuestion: opt(question), lastStop: opt(obj({ code: id, unresolvedIds: ids, nextActions: arr(str) })), diagnostics: arr(diagnostic), humanVerifications: arr(human), legacy: opt(obj({ mode: en('pending', 'confirmed', 'legacy-manual', 'damaged'), title: str, text: str, html: str, confirmed: bool, originalConfirmation: () => true, raw: () => true })), selectedOutput: opt(en('candidate', 'committed', 'legacy')) });
const envelope = { sessionId: id, runId: id, expectedRevision: num };
const eventShapes: Record<string, Check>[] = [
  { type: en('evidence_loaded'), records: arr(evidence), receipts: arr(receipt) },
  { type: en('facts_resolved'), scopes: arr(scope), claims: arr(claim), permissions: arr(permission), alignments: opt(arr(alignment)), diagnostics: opt(arr(diagnostic)) },
  { type: en('diagnostics_updated'), diagnostics: arr(diagnostic) }, { type: en('handoff_ready') },
  { type: en('task_revised'), task }, { type: en('gaps_updated'), gaps: arr(gap) }, { type: en('candidate_updated'), artifact: draft },
  { type: en('review_recorded'), review }, { type: en('layout_recorded'), layout }, { type: en('gate_recorded'), gate },
  { type: en('question_recorded'), question }, { type: en('stopped'), phase: en('waiting_input', 'incomplete', 'failed'), code: id, unresolvedIds: ids, nextActions: arr(str) },
];
const toolEvent = union(...eventShapes.map(fields => obj({ ...envelope, ...fields })));
export const EditorialSessionSchema = schema<EditorialSession>(session);
export const TaskContractSchema = schema<TaskContract>(task);
export const FactClaimSchema = schema<FactClaim>(claim);
export const EvidenceRecordSchema = schema<EvidenceRecord>(evidence);
export const ScopeSchema = schema<Scope>(scope);
export const PermissionSchema = schema<Permission>(permission);
export const DraftArtifactSchema = schema<DraftArtifact>(draft);
export const ToolEventSchema = schema<EditorialToolEvent>(toolEvent);
export const ControlEventSchema = schema<EditorialControlEvent>(union(obj({ ...envelope, type: en('editor_confirmed'), confirmation }), obj({ ...envelope, type: en('human_verified'), verification: human }), obj({ ...envelope, type: en('run_cancelled') })));
export const EvidenceRefSchema = schema<EvidenceRef>(ref);
export const InformationRequirementSchema = schema<InformationRequirement>(requirement);
export const ScopeAlignmentSchema = schema<ScopeAlignment>(alignment);
export const ReadReceiptSchema = schema<ReadReceipt>(receipt);
export const GateReportSchema = schema<GateReport>(gate);
export const ReviewStampSchema = schema<ReviewStamp>(review);
export const LayoutStampSchema = schema<LayoutStamp>(layout);
export const RunBudgetSchema = schema<RunBudget>(obj({ decisions: num, writes: num, searches: num, modelCalls: num, maxNoProgress: num, maxElapsedMs: num }));
const range: Check = v => Array.isArray(v) && v.length === 2 && v.every(num) && v[1] > v[0];
export const ToolActionSchema = schema<ToolAction>(union(
  obj({ tool: en('search'), query: id, forRequirementIds: ids }), obj({ tool: en('read'), documentId: id, sourceRequirementId: id, range: opt(range) }),
  obj({ tool: en('write'), instructions: id, repairCriterionIds: ids }), obj({ tool: en('review') }), obj({ tool: en('layout'), themeId: id }), obj({ tool: en('ask'), gapIds: ids }), obj({ tool: en('submit') })
));
export const ToolResultSchema = schema<ToolResult>(obj({ tool: en('search', 'read', 'write', 'review', 'layout', 'ask', 'submit'), status: en('progress', 'no_progress', 'rejected', 'failed'), code: id, changedIds: ids, events: arr(toolEvent), allowedNext: arr(en('search', 'read', 'write', 'review', 'layout', 'ask', 'submit')), diagnostics: arr(diagnostic), loadedSources: opt(arr(obj({ sourceRequirementId: opt(id), documentId: id, evidenceId: id, range }))) }));
export const EditorialOutcomeSchema = schema<EditorialOutcome>(union(
  obj({ type: en('question'), session, question }), obj({ type: en('draft'), session, artifact: draft, handoff: obj({ status: en('pending') }) }), obj({ type: en('incomplete', 'failed'), session, reason: id })
));
export function createEditorialSession(sessionId: string): EditorialSession {
  return { schemaVersion: 2, sessionId, revision: 0, evidenceRevision: 0, policyRevision: 0, evidence: [], readReceipts: [], scopes: [], alignments: [], claims: [], permissions: [], gaps: [], diagnostics: [], humanVerifications: [], task: { schemaVersion: 2, revision: 0, objective: '', intents: [], targetScopes: [], requirements: [], requiredSources: [], criteria: [], permittedOmissions: [], sourceWaivers: [] }, phase: 'planning' };
}
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + stableJson(v)).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}
/** Portable synchronous SHA-256, so Web/Tauri and reducers use identical content keys. */
export function hashText(text: string): Hash {
  const bytes = new TextEncoder().encode(text); const bitLength = bytes.length * 8;
  const data = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64); data.set(bytes); data[bytes.length] = 128;
  const view = new DataView(data.buffer); view.setUint32(data.length - 8, Math.floor(bitLength / 0x100000000)); view.setUint32(data.length - 4, bitLength >>> 0);
  const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const rot = (x: number, n: number) => (x >>> n) | (x << (32 - n)); const w = new Uint32Array(64);
  for (let offset = 0; offset < data.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) { const x = w[i-15], y = w[i-2]; w[i] = (rot(x,7)^rot(x,18)^(x>>>3)) + w[i-16] + (rot(y,17)^rot(y,19)^(y>>>10)) + w[i-7]; }
    let [a,b,c,d,e,f,g,z] = h;
    for (let i = 0; i < 64; i++) { const t1 = z + (rot(e,6)^rot(e,11)^rot(e,25)) + ((e&f)^(~e&g)) + k[i] + w[i]; const t2 = (rot(a,2)^rot(a,13)^rot(a,22)) + ((a&b)^(a&c)^(b&c)); z=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0; }
    [a,b,c,d,e,f,g,z].forEach((x,i) => { h[i] = (h[i]+x)|0; });
  }
  return h.map(x => (x>>>0).toString(16).padStart(8,'0')).join('');
}

/** Notes never affect this key; public asset identity, captions and inclusion do. */
export function artifactContentHash(title: string, bodyMarkdown: string, assets: AssetUse[] = []): Hash {
  const active = assets.filter(asset => asset.state !== 'omitted');
  return hashText(title + '\n' + bodyMarkdown + (active.length ? '\nassets:' + stableJson(active) : ''));
}

export function currentInputKey(s: EditorialSession): InputKey { return { contentHash: s.candidate?.contentHash ?? '', evidenceRevision: s.evidenceRevision, taskRevision: s.task.revision, policyRevision: s.policyRevision }; }
export function sameInputKey(a: InputKey, b: InputKey): boolean { return stableJson(a) === stableJson(b); }

/** Entity order is not evidence progress. */
export function sameEntitySet(a: readonly unknown[], b: readonly unknown[]): boolean { return stableJson(a.map(stableJson).sort()) === stableJson(b.map(stableJson).sort()); }
