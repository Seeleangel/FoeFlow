# FoeFlow Agent 运行架构

## Agent 创作

`editorialAgent.ts` 将当前任务、稿件、工具结果和剩余操作次数交给模型，由模型选择一个工具。应用校验参数、素材出处和工具执行条件，串行执行并反馈结果。工具调用使用受限的 JSON 协议，沿用现有 OpenAI 兼容文本接口。

| 工具 | 执行范围 |
| --- | --- |
| `search` | 按关键词查找当前工作区的文章库与已保存草稿，单次最多返回 3 段。查询按需执行，匹配片段会进入模型上下文。 |
| `write` | 根据已确认事实、草稿和阻断问题返回标题与 Markdown 正文。 |
| `review` | 单独调用模型审稿，返回阻断问题和需人工核对的事项。 |
| `layout` | 按模型选定的内置主题渲染当前正文，排版阶段保留正文内容。 |
| `ask` | 根据需要补充或确认的字段生成追问。 |
| `submit` | 仅在当前版本有正文、审稿结果无阻断问题且已排版时，将稿件送到待确认预览。 |

带来源的事实先与编辑消息或检索片段核对。本轮编辑的明确事实优先于工作台素材，同优先级的不同值会触发澄清。正式报名稿必须取得时间、地点和报名方式，示例稿可使用占位符。

审稿无阻断项时，程序推进排版和待确认预览。待核引语和明确标为内部的信息经过正文校验，编辑待核事项放在独立的备注字段。

每次运行最多 12 个工具选择轮次、3 次素材查询及 3 次写作。正文变更会清除旧审稿与排版，新查到的素材也会使旧审稿失效。取消沿用活动任务的中止机制。模型无法确认成稿，确认状态由编辑操作并写入会话历史。确认后才可复制、存入草稿箱或导出。新稿默认待确认。

## 手动共创的共享运行循环

优化重点为稳定性：避免重复生成、取消后结果写回，以及无效数据覆盖现有内容。

## 参考依据

查阅 Pi 主仓库 `earendil-works/pi`，参考版本 `42a3497d03ad17e308a2299fa824727894f2c0ec`：

- [agent-loop.ts](https://github.com/earendil-works/pi/blob/42a3497d03ad17e308a2299fa824727894f2c0ec/packages/agent/src/agent-loop.ts)：独立循环、请求边界的上下文转换、每轮事件及错误/中止停止条件。
- [agent.ts](https://github.com/earendil-works/pi/blob/42a3497d03ad17e308a2299fa824727894f2c0ec/packages/agent/src/agent.ts)：活动任务、AbortController 和状态订阅。

FoeFlow 采用这些分层思路，运行代码自行实现，继续使用当前 OpenAI 兼容 API 和 Tauri HTTP 插件。项目自行实现运行循环。手动共创使用预设的业务流程，文章库检索由应用调用。

## 模块职责

| 模块 | 职责 |
| --- | --- |
| `agentRuntime.ts` | 统一轮次、状态事件、上下文边界、反馈续轮、中止与停止原因 |
| `ai.ts` / `apiClient.ts` | 模型适配、输出长度、单次 HTTP 请求、中止及超时、空内容和截断检查 |
| `agentValidation.ts` | 分析结果的字段、数组、方向数量和 ID、配色校验 |
| `analysisAgents.ts` | 文章与排版的风格分析，格式无效时修复一次，仍无效则提示失败 |
| `articleAgent.ts` / `layoutAgent.ts` | 业务提示词、文章/HTML 提取、质量反馈与产物 |
| `useAgentRun.ts` | 每个活动任务的所有权，取消、替代及组件卸载后不能发布结果 |
| Pipeline hooks / Generator | 界面状态、停止入口、结果显示与会话切换 |

## 运行规则

- 每次模型调用保留原始系统规则、任务素材，追加最新候选结果和明确的修复反馈；旧候选版本不会全部累积进下一轮。
- 上下文设为 120,000 字符上限。它不是模型专属 token 估算；超限时要求用户缩短或拆分，不静默删除素材事实。
- 文章最多调用 4 轮；排版 HTML 最多调用 3 轮（可另有一次风格分析）；分析 JSON 最多 2 轮。连续两个相同的未通过结果会提前停止。
- 网络错误直接报告，不跨 HTTP 适配器重发同一个 POST。桌面使用 Tauri HTTP 插件，浏览器开发环境使用原生 fetch；每次请求有 120 秒超时。
- 中止信号传到 HTTP 层；取消或切换会话后迟到的响应不能更新状态。中止本地请求不保证远端供应商已停止推理或计费。
- 成功格式校验才允许发布产物。模型空响应、截断内容和无效 HTML 不生成替代占位文章。修改途中网络失败可保留上一份有效候选，但标记待检查。
- HTML 校验要求单一 `data-role="outer"` 容器，并拒绝脚本、事件处理器及活动嵌入元素；该校验不是完整 HTML/CSS 安全审计。
- 文章完成判断会排除“未通过”“不能定稿”“需要修改”等否定状态。分数与排版质量仍来自模型自审，不代表独立事实核查；未通过或未经完整自审时提示用户检查。
- 自定义文章、排版及分析提示词从设置读取。精修失败时保留原排版，并返回失败状态，界面不再显示“已调整完成”。

## 验证边界

254 项自动测试通过，包含 HTTP 中止、空/截断返回、轮次限制、重复结果、无效字段、取消后迟到响应、任务替代和卸载。原生 Mac 测试副本使用本地模拟模型接口，验证需求→分析→写作反馈修订→排版反馈修订，以及停止后无结果写回、精修失败保留预览；不使用生产 API 密钥或修改用户的设置。

这些测试验证机制和状态一致性，不证明真实模型的文章质量提升。真实 AI 与邮箱账号的完整业务验收仍需在用户配置的服务上完成。Mac 分发仍采用 ad-hoc 签名，未 Apple 公证。


## Editorial v2 contracts (WP00, local phase A)

The shared runtime schemas and types live in `src/lib/editorialTypes.ts`; all model/tool input is `unknown` until parsed. `editorialState.ts` owns revisions, immutable tool-event batches and the separate editor-control entry. A batch has one expectedRevision; cancelled/run/session mismatches reject the entire batch. All content/evidence/task/permission changes invalidate current review/layout/gate/human stamps, never the committed snapshot. Confirmation requires same inputKey and htmlHash and is applied only after `persistConfirmation` succeeds. UI ownership must be rechecked after asynchronous persistence (WP07).

`editorialCompatibility.ts` migrates at read time without rewriting storage. A v1 confirmed record is an exact historical snapshot, not a v2 gate pass. Manual records remain explicitly legacy-manual; invalid v2/corrupt records never acquire confirmation.

Frozen additions to plan sketches: `TaskContract.sourceWaivers`, `EditorialSession.alignments`, `diagnostics`, `humanVerifications`, `legacy`, `selectedOutput`; `ReadReceipt.sourceRequirementId` is optional for old callers. `PermissionUse` is channel/purpose/identity, not just an asset boolean. Hashes are portable SHA-256. Scopes, facts and permissions are candidate data until WP01 resolution. Task changes must go through WP02's evidence-backed patch port before emitting task_revised. Human decisions are control events, never tool events.

Verified repository dependencies: npm/package-lock, installed Vitest 4.1.4/TypeScript 5.7; tests `./node_modules/.bin/vitest run`, typecheck `./node_modules/.bin/tsc -b`, lint `npm run lint`. Tests live in both `tests/` and `src/lib/__tests__/`. HTML currently renders each nonempty source line as a separate block; Word takes string[]. articleSearch returns title/snippet only, libraryStorage retains full article IDs/content; source receipts need a WP05 adapter. Generator/draft storage use SQL `generated_drafts` and v1 JSON; WP07 owns storage integration. Existing agentRuntime cancellation/120s HTTP paths are unchanged.

Baseline 2026-11-11 Asia/Shanghai: 46 test files, 265 tests pass; tsc -b passes; lint has 47 errors/9 warnings (including generated src-tauri target files), unchanged work must not increase these. No real-model requests are part of phase A.


### Phase A landed module ports (WP01/WP02/WP04)

- `resolveFacts(session)` validates exact original offsets/revisions/SHA-256, keeps metric qualifiers separate and returns claims, permissions, conflicts and diagnostics. `applyFactPatch(session, unknown)` is an immutable upsert port: no omitted claim disappears and an ungrounded downgrade cannot replace a known assertion. Runtime integration may emit its arrays as one facts_resolved batch rather than applying two revisions. Scope alignment needs evidence covering both anchors; unresolved/duplicate identities remain gaps. Legacy brief candidates are provisional/unknown, with hashed IDs (not private values in IDs).
- `applyTaskPatch` consumes `{baseRevision, refs, objective?, intents?, readerAction?, targetScopes?, requirements?, requiredSources?, criteria?}`. Arrays upsert by ID; removal arrays, sourceWaivers and permittedOmissions belong only to `applyEditorTaskPatch`. `applyTemplateTaskPatch` is a trusted-loader port, never callable from library instructions; user criteria cannot be replaced by template defaults. Patch baseRevision is the task revision, not the session envelope revision. All original evaluation files remain read-only.
- `validateAcceptance(session, layout?)` returns pass/fail/unknown, not a boolean. Unavailable source obligations can only pass via a current consumed ReadReceipt or recorded explicit editor waiver. A receipt binds documentId/full source hash/range/evidence IDs/contextHash; full_document requires the complete document range. Title-only selectors additionally require sourceRequirementId. `state: satisfied` from a model is ignored. Source ports must create receipts only when the actual source content has entered brief/write/review context.
- `ReviewStamp.criterionChecks` records explicit semantic verdicts per criterion. Blank blocking arrays are not pass verdicts. Human checks require editor-only human_verified events with the exact inputKey. Permission/source-read invariants cannot be waived by a semantic/human pass. Permission rules optionally specify channel and identity; defaults are public/not_applicable. Never infer named permission from anonymous permission.
- `parseDraftArtifact(raw, {id, revision, legacyTitle?})` accepts old JSON and structured notes/assets/claimLinks. Heading-based legacy markdown preserves originalMarkdown and requires validation. `parseContentBlocks` is the only block parser. Model-authored blocks/hashes and arbitrary extra fields are rejected.
- `buildWriterContext` includes public supported values, executable task rules, current safe prose and structured slot constraints, not the conversation, raw source quotes or private notes. Exact protected spans and explicit note-channel duplicates are blocked, never silently removed. Semantic paraphrase leakage and unsupported detail still need review.
- `makePublicDocument` validates the candidate before projecting. `renderPublicDocument`, `exportPublicDocumentToDocx` and `publicDraftFields` accept only PublicDocument/OutputBundle. HTML is sanitized on both platforms, stamped with data-editorial-block, and checked against visible block order/text. Images are represented as explicitly authorized caption slots; no binary images are fetched/inserted. Word keeps textual captions and existing plain-text list/quote limitations.
- `artifactContentHash` binds asset placements/use/channel/identity/captions as well as prose, not notes. Current inputKey helpers are exported from editorialTypes and re-exported by editorialState to avoid a dependency cycle. Confirmation recomputes program acceptance on the same content/HTML; a forged supplied gate cannot bypass it.
- `requireConfirmedOutput` rejects current unconfirmed candidates. `selectedOutput: committed` or `legacy` explicitly exports the unchanged historical confirmed snapshot, not a new candidate or a new permission grant. WP07 must label that selection and recheck ownership after async persistence. Persistence callback must be transactional/CAS against the expected session revision; this phase supplies the pure transition, not the SQL integration.

Phase A does not yet wire these mechanisms into runEditorialAgent/Generator/storage. WP03 owns gap/question UX; WP05 owns actual source loading/receipt creation; WP06 owns model preflight, extraction repair, semantic-review protocol, budgets and all handoff paths; WP07 owns live clipboard/storage/Word handlers. The owner-approved legacy unit-test criterion is now at-most-12 submits rather than exactly-12 (with a positive-call check); the legacy loop itself remains unchanged. WP06 must add parameterized controller budget tests. No external evaluation input or scoring assertion was edited here.
