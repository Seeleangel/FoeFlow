# Editorial evaluation (WP08)

Local, reproducible evaluation of the **actual default `runEditorialAgent` controller**, not a prompt-only surrogate. No new agent framework. Node + the repository's Vite loader and JSDOM run the same TypeScript, renderer and DOM gate. All artifacts are local; nothing is pushed or deployed.

## Modes and safety

Choose exactly one: `--dry-run`, `--mock`, or `--real`. There is no network fallback. Dry-run validates frozen JSONL, SHA-256, selection, model configuration and optional recipes, writes a manifest and estimate, and makes **zero model calls**. Mock consumes independent per-stage queues; missing responses yield `fixture_error:<stage>` and unconsumed responses are reported. Model stages introduced since an original fixture must be supplied in a **separate versioned recipe**, never by editing original bytes.

`--real` is an explicit paid/network execution opt-in for the acceptance operator. Credentials are read **only from the inherited `FOEFLOW_API_KEY` (or `OPENAI_API_KEY`) environment**. Configure that environment through your existing secure workflow; do not put secrets in arguments, case files, recipes or source. The CLI deliberately does not scrape a browser/native settings database. `FOEFLOW_API_URL` and `FOEFLOW_MODEL` supply the existing endpoint/model configuration. HTTPS endpoints with userinfo, query or fragment are rejected. No POST retry. All stages use temperature 0.2 by default; token limits are write=8192, decide=1500, other=6000. CLI overrides and exact per-request values are recorded. No real call was made during implementation.

Historical H and blind/sealed paths require `--allow-acceptance`; development selection defaults to non-H cases. Do not use that flag during implementation. The supplied v0.4 original file is schema/hash validated as a whole, but unselected cases never enter the agent/model. Do not copy original cases into this repository. `fixtures/smoke-v2.*` are independently authored, versioned harness self-tests, not replacements for the original corpus.

## Commands

Run from the repository root. Always use a new output directory (existing directories are never overwritten); without `--out`, a fresh `.git/editorial-eval/<UUID>` is used. These commands never print the credential.

```sh
# Any platform: point to the external frozen input, and independently verify its hash.
CASES=/absolute/path/to/eval-v0.4/cases.jsonl
SHA=564829f8aad24d8b863e619175f102ca49b134cc16f5ec6b78e3a07a8a334792
npm run editorial:eval -- --dry-run --cases "$CASES" --sha256 "$SHA" --select 'R*,F*,D*'

# No network: original R01–R15 module/operator replays plus selected old-effect mocks.
npm run editorial:regression
# No network: independent CLI self-test through the real controller, confirmation and output adapters.
npm run editorial:eval -- --mock --cases scripts/editorial-eval/fixtures/smoke-v2.cases.jsonl --recipe scripts/editorial-eval/fixtures/smoke-v2.recipe.json
# UI smoke (all remote routes intercepted, no real service):
npm run dev:web -- --host 127.0.0.1 --port 5189 --strictPort
FOEFLOW_UI_URL=http://127.0.0.1:5189/foeflow/ npm run test:editorial-ui
```

Acceptance-only real commands (after secure environment setup and independent freeze/review of any operator recipe):

```sh
# Old-effect acceptance: 4 cases × 3 trials; H requires explicit acceptance mode.
npm run editorial:eval -- --real --allow-acceptance --cases "$CASES" --sha256 "$SHA" --select 'D02,D04,H04,H05' --trials 3 --recipe /absolute/path/to/frozen-operator-recipes.json
# Known failures: 9 × 3.
npm run editorial:eval -- --real --cases "$CASES" --sha256 "$SHA" --select 'F*' --trials 3 --recipe /absolute/path/to/frozen-operator-recipes.json
# Exposed historical audit set, NOT unseen generalization: 16 × 3.
npm run editorial:eval -- --real --allow-acceptance --cases "$CASES" --sha256 "$SHA" --select 'H09,H10,H11,H12,H13,H14,H15,H16,H17,H18,H19,H20,H21,H22,H23,H24' --trials 3 --recipe /absolute/path/to/frozen-operator-recipes.json
# Arbitrary independently frozen acceptance JSONL (including a future blind set):
npm run editorial:eval -- --real --allow-acceptance --cases /absolute/path/to/frozen.jsonl --sha256 "$FROZEN_SHA" --trials 3 --recipe /absolute/path/to/frozen-operator-recipes.json
```

Cases without conditional followups/operator actions do not need a recipe. A real run with natural-language `operator_events`, conditional followups, or null initial state **stops before any paid call unless an explicit recipe supplies the editor actions/initial state**. This is intentional: the harness does not guess that a condition fired, auto-confirm, grant a waiver, or clear human-pending based on prose. Acceptance must freeze this translation before model runs. Dry-run lists affected IDs. `setup`, original operator scripts, oracle, provenance and case/fixture IDs never become model input; only editor message text, selected material titles/text, and typed product state do.

## Recipe and assertions

JSON object keyed by case ID, each entry:
- `initialSession` and `initialMessage` are **forbidden in recipes**. Reviewed historical setup moves to a separately hash-pinned approval protocol (below).
- `actions`: source-bound ordered editor `message{text}`, `confirm`, `verify{criterionId}`, `waive{sourceRequirementId,reason}`, `select{output}`, `copy`, `save`, `word`; `cancel{afterCalls}` deterministically aborts dispatch at that attempt. These are operator authority, not model tools.
- `responses`: mock-only stage arrays. A string is a model response; `{error:"HTTP_502"}` injects a transport failure. Unknown stages/invalid recipes are rejected.
- `assertions`: frozen mechanical checks `{checkId,path,op,value}`; `op` is equals/includes/not_includes/nonempty over the **actual** CaseResult. See the independently authored smoke recipe for a complete example.

Natural-language oracle checks remain `unreviewed` until the independent acceptance reviewer evaluates them; **no expected PASS or FAIL overrides an observed result**. Metrics report PASS, FAIL, fixture_error, or NEEDS_REVIEW. No numeric passing-rate claim is made from unreviewed checks. Missing fixtures, cancelled runs, service errors and unexecuted followups remain explicit. The original R baseline is separately runnable with its frozen supplement and all stage leftovers; it is not silently replaced by the self-test.

## Evidence and limits

Each manifest includes exact source-tree hashes, git HEAD/dirty state, lockfile/case/prompt/schema/budget/platform hashes, recipe hash, configuration summary and stage parameters. Each case/trial JSON contains runId, raw stage responses (with known restricted spans/credentials redacted), model input, tool results, checkpoint hashes, actual outcome, adapter outputs and assertion evidence. Word evidence is obtained from the **actual generated DOCX**, with `word/document.xml` unpacked for inspection. The real adapter records local request ID, upstream request/response ID when available (otherwise null), HTTP status, parameters, timestamps and token usage. Raw authorization headers/settings are never recorded. Artifacts use restrictive file modes; stdout has summaries only. Known private values/editor-only spans are scrubbed across the complete case and aggregate assertion evidence; review artifacts before sharing.

CLI product actions exercise the shared reducers/gates/output adapters **in memory**. They do not certify native clipboard, Tauri persistence, browser CAS or workspace UI. The separate Playwright smoke exercises actual web clipboard, web database reload, saved public drafts, Word download and refresh. Native Mac UI acceptance remains WP09. Fixture search/read is isolated to that case and uses deterministic lexical discovery; receipts come from real fixture reads/extraction, never from discovery alone. No session checkpoints or internal metadata are inserted into the article library.

Budget estimates: one controller turn has at most 24 model requests (including preflight, extraction, review and repair). Required acceptance is 4×3 + 9×3 + 16×3 + 24×3 = **159 runs**, at most **3,816 calls for one turn/run** (rough planning estimate 5 calls/run = 795). Add at most 24 per explicitly scripted additional editor-message turn; dry-run computes this bound from recipes. Full supplied v0.4 corpus is 72×3 = 216 runs, at most 5,184 one-turn calls, but R are normally mock-only. Old-loop request counts are `null` (not measured), kept separate from actual v2 counts; zero is not fabricated as a historical result.

Validation:
```sh
npx vitest run scripts/editorial-eval/__tests__/runner.test.ts
npx tsc -p scripts/editorial-eval/tsconfig.json
```

## C-M2 queue-integrity update
Supplementary `responses` may name only stages absent from the original frozen case. **Any overlap is rejected as `fixture_stage_collision` before any model request**, including identical responses or empty arrays. Remove overlapping recipe stages; never clean the original fault. Case artifacts record original/effective per-stage SHA-256 plus actual mock consumption and leftovers. No recipe action schema change in this update.

## C-B2 authority schema migration (required before scored runs)

Recipe entries keep `responses`, `assertions`, and `actions`; any other top-level recipe field is rejected. Remove recipe `initialMessage` / `initialSession`. Every action now includes `source`:

```json
{"type":"message","text":"exact original followup","source":{"kind":"followup","index":0}}
{"type":"confirm","source":{"kind":"operator","index":2}}
{"type":"verify","criterionId":"human-check","source":{"kind":"protocol","step":"review-verdict"}}
```

- `followup.index` is zero-based in the **original frozen** `input.followups`; action must be exactly that message. A new message is not a substitute for an unrelated followup.
- `operator.index` is zero-based in original `operator_events`. It must already be structured as `{ "kind":"editor_action", "action":{...} }`; recipe payload must equal the frozen action. Stage-response objects are not editor actions. Natural-language scripts are not auto-interpreted.
- `protocol.step` must exactly match a separately reviewed protocol step. Recipe assertions cannot grant editorial authority. Reusing a source step twice is rejected.
- A non-null original editor message is **always used exactly**; even a protocol cannot replace it.

For historical setup / prose-script translation, acceptance must obtain independent approval of a separate protocol **and its SHA-256** before running. `approvedBy`/`approvalRef` are audit metadata, not self-approval: the trusted CLI operator must verify that the supplied hash is the independently approved version. Do not copy recipe assertions into protocol/editor messages. Protocol format:

```json
{"schemaVersion":1,"caseFileSha256":"<exact frozen input-file SHA>",
 "approvedBy":"independent acceptance editor","approvalRef":"reviewed protocol reference",
 "cases":{"CASE_ID":{"caseSha256":"<SHA-256 of stableJson(parsed original case)>",
   "kind":"historical","initialSession":{},"initialMessage":"only permitted if frozen message is null",
   "steps":{"review-verdict":{"type":"verify","criterionId":"human-check"}}}}}
```

`initialSession` must satisfy EditorialSessionSchema; the `{}` above is a shape placeholder, not a valid state. `kind` is `agent`, `historical`, or `restoration`; only historical/restoration may initialize state. Restoration requires null original message and a valid initial session. Omit `initialMessage` for non-null original messages. New CLI options `--protocol /path/to/approved.json --protocol-sha256 <approved-bytes-SHA>` require `--allow-acceptance`, including for dry-run. Full file SHA and individual case hashes are checked before dispatch; protocol hash/provenance are recorded. Example commands above that need setup or prose actions must append these options. A recipe path/hash alone never authorizes them.

`smoke-v2.*` independently freezes its editor actions in the synthetic case and adds sources to its recipe. `smoke-v1.*` bytes are retained for historical evidence but their unbound action recipe is no longer executable. Original evaluation case bytes remain unchanged.

## C-B3 scoring / execution-ledger migration

- `equals`, `includes`, `not_includes` **require an own `value` property**; includes/not_includes require a string. Explicit JSON `null` is a valid equals operand and is never equivalent to a missing observation. `nonempty` must omit `value` and accepts only nonempty strings/arrays/objects.
- Assertion check IDs must exist in the frozen oracle, be nonempty/unique, and may occur only once per recipe. Frozen oracle check IDs are also unique.
- Paths are dot-separated own properties / numeric array indexes, rooted only in `outcome`, `outputs`, `cancelled`, `modelCalls`, `legacyModelCalls`, `error`, `checkpoints`, `trace`, `execution`, `restoration`, `unappliedFollowups`, `operatorPlanRequired`. Static recipe/case identity and prototype paths cannot be scored. Missing/undefined actual values fail; null must be actually observed.
- Every case has a trial/initial/terminal/restoration/action ledger. All original followups and non-response operator steps must be completed, and every planned action must execute, before PASS. An empty action array does not fulfill an original operator plan.
- Approved prose translations add optional protocol `bindings: { "step-name": {"kind":"operator","index":0} }` (or `followup`). This maps an approved step to the original required step; indices are zero-based in frozen input. A protocol followup must still be the exact original message. Unmapped original steps remain unresolved even if a protocol exists. A protocol step can add an independently approved action, but cannot silently discharge an unrelated original obligation.
- Ordinary agent tests need an actual terminal observation; a zero-call assertion is not execution. Approved `kind: "restoration"` may legitimately make zero model calls and records actual decoded `restoration.phase`, `sessionHash`, `selectedOutput`. Use those paths, not nonexistent `outcome` fields.
- Cancellation records completed cancel injection and skipped required actions. A cancellation-only assertion cannot mask unexecuted required output. Every planned case × trial gets an artifact/metric row, including interruption. New aggregate statuses `NOT_RUN` and `CANCELLED` keep the denominator fixed; no silent break/removal.

These rules apply in dry-run validation before paid calls as well as runtime scoring. Mechanical assertions remain independently reviewed implementations of oracle criteria, not automatic natural-language adjudication.

## C-M3 editor verification behavior
A source-bound `verify` action now uses the same trusted version-bound transition as Generator: record the human verdict, recompute `canHandoff` and only enter pending confirmation if the authoritative gate has no blockers. A following explicit `confirm` can then unlock copy/save/Word without a new message (which would invalidate the human verdict). No recipe schema change; wrong/stale criteria, denied assets and unread required sources still block.

## C-M4 artifact safety
Upstream usage is limited to nonnegative safe-integer `prompt_tokens`, `completion_tokens`, `total_tokens`; unknown/nested usage data is discarded. Redaction recursively covers property names and values, including parseable JSON-in-string and escaped representations. Rejected-but-parseable `editorialNotes` (and review note channels) join privacy spans before acceptance, without granting artifact/fact authority. Every file/stdout JSON sink performs a final serialized credential check and fails with a static safe code on any residue. Redacted raw JSON may be canonicalized; its original hash is retained. No recipe schema change.
