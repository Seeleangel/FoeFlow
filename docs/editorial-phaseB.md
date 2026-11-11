# Editorial v2 runtime — phase B handoff

## Default runtime and compatibility

`editorialAgent.ts` now calls `runEditorialController` by default. The v1 coordinator loop has been removed, not hidden behind an opt-in switch. Existing messages/previousDraft/template/signal/onStep options still return the old question/draft shape, plus an optional typed `outcome`. The overload with `session` returns `EditorialOutcome` directly. Markdown-only model output remains a candidate and is reviewed before handoff. Chat text never confirms.

Production model calls use versioned `EDITORIAL_STAGE_PROMPTS` for preflight, extract, decide, write, review and at most one JSON repair. Inject `model` and `sources` in tests; there is no network fallback when an injected queue is exhausted. No live model tests were run.

## Bounded controller and gate

Defaults remain decisions <=12, writes <=3, optional searches <=3, total model calls <=24, no-progress threshold 2, deadline 10 minutes. Preflight, source extraction, review and repair all count as model calls. A combined abort signal covers awaited I/O. Observer/dispatch boundaries recheck cancellation and ownership.

Program-derived gaps, deterministic acceptance, current review, canonical layout and publication permissions form one `canHandoff` gate. Review shortcuts, submit, auto-review after write exhaustion, and resume all use it. Delivery is pending only; confirmation is editor control. Quality/idempotency keys exclude envelope revisions, UUIDs, cosmetic prose/diagnostic wording and remaining budget; content A-B-A cannot reinstate a prior stamp. A safe candidate is retained on incomplete/failed outcomes.

## Sources and contexts

`SourcePort.search` discovers document IDs/title/version metadata. `read` returns full versioned text; SQL adapters only read user articles or public draft text, never generator-session checkpoints. Optional legacy search autoloads at most three results per query and retains all discovery metadata; explicit required reads are independent of the optional-query budget. Missing, ambiguous or insufficient-depth sources remain gaps. No required source is fulfilled by search snippets.

`loadRequiredSource` emits evidence, not fulfillment. `recordSourceConsumption` is called only after the exact serialized source-bearing extraction context succeeded. It binds actual range, content hash, document/evidence IDs, consumer stage and context hash. Required sources are revalidated on each run; unchanged versions reuse receipts, updated versions invalidate old receipts/reviews. Generated drafts retain `legacy_draft` provenance and cannot attest facts from their own prose.

## Review fixes and authority

- Model patches cannot relax visibility, erase supported assertions without new related basis, rebind permission subjects/uses, remove deny history or regrant restrictions. `applyEditorFactPatch` is a separate trusted action; regrant/declassification require new editor evidence. Scope aliases share restrictions and requirement identity transitively.
- Additive facts use evidence-backed selector `cardinality: set` with `cardinalityRefs`; exclusive facts remain conflicting. Unrelated conflicts stay inspectable but do not block unrelated publication.
- All public surfaces, including captions, are checked before serialization. Final HTML must equal the deterministic renderer for the registered theme/version: arbitrary attributes, comments and styles are not accepted. Historical confirmed snapshots are exported unchanged.
- `task.coverage` records validated basis; shared contract validation rejects positive-revision vacuous plans. Model task arrays are monotonic; objective/reader-action replacements, waivers, omissions and destructive edits remain editor-only. Additive intent/target-scope arrays are allowed.
- Diagnostics have owner-scoped repair and atomic event propagation. An unrelated successful patch cannot clear a rejected entity. Legacy validation locks clear only for a fresh grounded, valid candidate after review; historical bytes remain retained.
- Notes are an append-only ledger across preflight, review and body-only rewrites; omitted model metadata never removes a known note. Structured review `humanChecks` append human-only criteria, not model-cleared verdicts.

## WP07 requirements (not completed here)

Use one v2 session in Generator/Preview and persist checkpoints with transaction/CAS expectedRevision plus session/run ownership checked again after await. The callback/persistConfirmation helpers are not a concurrency-safe storage implementation. Ignore stale outcomes. Preserve original committed snapshots across errors, cancellation and session changes. An ordinary new user evidence event invalidates stamps; do not apply a non-draft compatibility result as replacement public output.

Render all gaps and remainingQuestion IDs, provide explicit editor source waivers/omissions/replacements and permission regrant UI, show source waivers and separate editor notes in preview, and expose exact-key human verification controls. Never automatically swap/insert images. Implement explicit trusted note resolution rather than deleting omitted metadata.

All three output handlers must call `requireConfirmedOutput`; historical export explicitly selects committed/legacy. The legacy UI boolean/storage flow is still WP07 work. Custom layouts must go through a registered deterministic renderer/theme, not arbitrary model HTML. Native Mac/browser button, refresh, clipboard and async storage races remain untested here.

## WP08 requirements (not completed here)

Deterministic development tests preserve original stage queues and version supplemental preflight/extract fixtures separately. Missing requested stages fail as fixture_error; unused original layout/decide/write responses are reported. The layout stage is programmatic, so original model-layout queues remain unused. These are known regression mock replays, not live quality/generalization/acceptance scores.

The current `.git/phaseB-runtime-replays.json` and `.git/phaseB-legacy-replays.json` contain development summaries. Build a full runner/manifest with frozen source/prompt/schema/budget/config/platform hashes, raw sanitized traces, assertions, queue integrity and UI/native evidence. Keep oracles/operator scripts/case IDs outside model context and keep blind acceptance assets isolated.
