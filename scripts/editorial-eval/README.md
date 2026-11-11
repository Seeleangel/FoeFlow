# Editorial evaluation (WP08)

Local, reproducible evaluation of the **actual default `runEditorialAgent` controller**, not a prompt-only surrogate. No new agent framework. Node + the repository's Vite loader and JSDOM run the same TypeScript, renderer and DOM gate. All artifacts are local; nothing is pushed or deployed.

## Modes and safety

Choose exactly one: `--dry-run`, `--mock`, or `--real`. There is no network fallback. Dry-run validates frozen JSONL, SHA-256, selection, model configuration and optional recipes, writes a manifest and estimate, and makes **zero model calls**. Mock consumes independent per-stage queues; missing responses yield `fixture_error:<stage>` and unconsumed responses are reported. Model stages introduced since an original fixture must be supplied in a **separate versioned recipe**, never by editing original bytes.

`--real` is an explicit paid/network execution opt-in for the acceptance operator. Credentials are read **only from the inherited `FOEFLOW_API_KEY` (or `OPENAI_API_KEY`) environment**. Configure that environment through your existing secure workflow; do not put secrets in arguments, case files, recipes or source. The CLI deliberately does not scrape a browser/native settings database. `FOEFLOW_API_URL` and `FOEFLOW_MODEL` supply the existing endpoint/model configuration. HTTPS endpoints with userinfo, query or fragment are rejected. No POST retry. All stages use temperature 0.2 by default; token limits are write=8192, decide=1500, other=6000. CLI overrides and exact per-request values are recorded. No real call was made during implementation.

Historical H and blind/sealed paths require `--allow-acceptance`; development selection defaults to non-H cases. Do not use that flag during implementation. The supplied v0.4 original file is schema/hash validated as a whole, but unselected cases never enter the agent/model. Do not copy original cases into this repository. `fixtures/smoke-v1.*` are independently authored, versioned harness self-tests, not replacements for the original corpus.

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
npm run editorial:eval -- --mock --cases scripts/editorial-eval/fixtures/smoke-v1.cases.jsonl --recipe scripts/editorial-eval/fixtures/smoke-v1.recipe.json
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
- `initialSession`: optional runtime-schema-validated state for historical product cases; never supplied to a model as a raw case object.
- `initialMessage`: optional editor message for a null initial message.
- `actions`: explicit ordered editor `message{text}`, `confirm`, `verify{criterionId}`, `waive{sourceRequirementId,reason}`, `select{output}`, `copy`, `save`, `word`; `cancel{afterCalls}` deterministically aborts dispatch at that attempt. These are operator authority, not model tools.
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
