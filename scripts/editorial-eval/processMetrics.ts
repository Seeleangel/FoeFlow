import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Process metrics for the editorial evaluation harness.
 *
 * Input is the raw per-trial JSON produced by replay.ts (CaseResult). Nothing here
 * calls a model or mutates a session: this module only derives observable metrics
 * from already-recorded artifacts, so it can be re-run on any historical run.
 *
 * Deliberately conservative: when a metric cannot be computed from the recorded
 * artifacts, the field is null and a warning explains what is missing, instead of
 * inventing a number. Definitions are documented in the evaluation report
 * "FoeFlow Agent 评测方法调研 v1" section 3.9.
 */

type Json = Record<string, unknown>;

interface RequestRecord {
  stage?: string;
  sentAt?: string;
  status?: number;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}
interface ToolResult { tool?: string; status?: string; code?: string; diagnostics?: unknown[] }
interface TraceEvent {
  type?: string;
  stage?: string;
  turn?: number;
  attempt?: number;
  result?: ToolResult;
  outcome?: string;
  reason?: string;
  action?: { type?: string };
  authorityId?: string;
}
interface Assertion { id?: string; required?: boolean; status?: string; evidence?: { observed?: boolean } }
interface GeneratedMetrics { status?: string; actualOutcome?: string; modelCalls?: number; assertions?: Assertion[] }
interface ExecutionLedger {
  kind?: string;
  trialStatus?: string;
  requiredSteps?: string[];
  completedSteps?: string[];
  actions?: { index?: number; type?: string; status?: string }[];
  terminalObserved?: boolean;
}
export interface CaseResultLike {
  id?: string;
  runId?: string;
  trial?: number;
  trace?: TraceEvent[];
  requests?: RequestRecord[];
  outputs?: unknown[];
  checkpoints?: { hash?: string; revision?: number }[];
  execution?: ExecutionLedger;
  outcome?: { type?: string; reason?: string };
  metrics?: GeneratedMetrics;
  modelFailures?: unknown[];
}

export interface ToolMetric {
  calls: number;
  success: number;
  successOther: number;
  unproductive: number;
  error: number;
  rejected: number;
  successRate: number | null;
  codes: Record<string, number>;
}

export interface ProcessMetrics {
  schemaVersion: 1;
  runDir: string;
  generatedAt: string;
  coverage: {
    trials: number;
    cases: number;
    duplicatesRemoved: number;
    trialsPerCase: { min: number; max: number };
    outcomeTypes: Record<string, number>;
    metricsStatus: Record<string, number>;
    assertions: { total: number; pass: number; fail: number; unreviewed: number; required: number; observed: number };
    modelFailures: number;
    terminalObserved: number;
  };
  task: {
    delivered: number;
    deliveredRate: number | null;
    successMeasurable: boolean;
    passRate: number | null;
    gateBlocked: number;
    gateViolations: number;
    needsReview: number;
  };
  steps: {
    turns: number;
    turnsPerTrial: number;
    singleTurnTrials: number;
    stages: Record<string, number>;
    turnsByOutcome: Record<string, number>;
    actionStatus: Record<string, number>;
    actionTypes: Record<string, number>;
    operatorActions: Record<string, number>;
    requiredStepCoverage: number | null;
  };
  tools: {
    calls: number;
    byTool: Record<string, ToolMetric>;
    overall: Omit<ToolMetric, 'codes'>;
    categories: Record<string, number>;
  };
  experience: {
    wallClockMs: { p50: number | null; p90: number | null; max: number | null; mean: number | null };
    callsPerTrial: { p50: number | null; p90: number | null; max: number | null; mean: number | null };
    tokens: { total: number; perTrialP50: number | null; perTrialMean: number | null; byStage: Record<string, number> };
    clarify: { asks: number; questionOutcomes: number; questionRate: number | null };
    interCallGapMs: { p50: number | null; p90: number | null };
    stall: { trialsWithTwoNoProgress: number; stallRate: number | null };
  };
  risk: {
    rejectedCalls: number;
    rejectedRate: number | null;
    productErrors: number;
    unconfirmedGateAttempts: number;
    gateBlocks: number;
    gateViolations: number;
    failedOutcomes: number;
    failedReasons: Record<string, number>;
  };
  warnings: string[];
}

const TOOL_SUCCESS_CODES: Record<string, string[]> = {
  read: ['source_consumed', 'source_loaded'],
  search: ['sources_discovered', 'query_cached'],
  ask: ['waiting_editor'],
};
const PRODUCT_ERROR_CODES = new Set(['invalid_artifact', 'invalid_or_unknown_action', 'invalid_tool', 'invalid_arguments']);
const FIXTURE_CODES = new Set(['source_unavailable', 'fixture_error']);
const POLICY_CODES = new Set(['required_read_already_attempted', 'authority_rejected']);
const EMPTY_RESULT_CODES = new Set(['query_empty', 'no_result']);
const DUPLICATE_CODES = new Set(['query_cached']);
const GATE_ACTIONS = new Set(['copy', 'save', 'word']);

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return Math.round(sorted[index]);
}
function mean(values: number[]): number | null {
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
}
function rate(n: number, d: number): number | null {
  return d > 0 ? Math.round((n / d) * 10000) / 10000 : null;
}
function increment(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}
function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Walk a run directory and read every JSON file shaped like a replay CaseResult. */
export async function loadTrials(runDir: string): Promise<{ trials: CaseResultLike[]; filesRead: number }> {
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.git') continue;
        await walk(path);
      } else if (entry.name.endsWith('.json') && !/^scorecard/i.test(entry.name)) {
        files.push(path);
      }
    }
  };
  await walk(runDir);
  const trials: CaseResultLike[] = [];
  for (const path of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path, 'utf8'));
    } catch {
      continue;
    }
    if (isObject(parsed) && typeof parsed.id === 'string' && typeof parsed.trial === 'number' && Array.isArray(parsed.trace)) {
      trials.push(parsed as CaseResultLike);
    }
  }
  return { trials, filesRead: files.length };
}

export function dedupeTrials(trials: CaseResultLike[]): { unique: CaseResultLike[]; removed: number } {
  const seen = new Set<string>();
  const unique: CaseResultLike[] = [];
  for (const trial of trials) {
    const key = String(trial.id) + '#' + String(trial.trial);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(trial);
  }
  return { unique, removed: trials.length - unique.length };
}

function classifyToolCall(call: ToolResult): { category: string; success: boolean } {
  const status = call.status ?? 'unknown';
  const code = call.code ?? '';
  const tool = call.tool ?? 'unknown';
  if (status === 'rejected') {
    if (PRODUCT_ERROR_CODES.has(code)) return { category: 'product_error', success: false };
    if (FIXTURE_CODES.has(code)) return { category: 'fixture_unavailable', success: false };
    return { category: 'rejected', success: false };
  }
  if (status === 'failed') {
    if (FIXTURE_CODES.has(code)) return { category: 'fixture_unavailable', success: false };
    if (PRODUCT_ERROR_CODES.has(code)) return { category: 'product_error', success: false };
    return { category: 'failed_other', success: false };
  }
  if (status === 'no_progress') {
    if (POLICY_CODES.has(code)) return { category: 'policy_guard', success: false };
    if (EMPTY_RESULT_CODES.has(code)) return { category: 'empty_result', success: false };
    if (DUPLICATE_CODES.has(code)) return { category: 'duplicate_query', success: false };
    return { category: 'unproductive_other', success: false };
  }
  if (status === 'progress') {
    const codes = TOOL_SUCCESS_CODES[tool];
    return { category: codes && codes.includes(code) ? 'success' : 'success_other', success: true };
  }
  return { category: 'unknown', success: false };
}

export function computeProcessMetrics(input: CaseResultLike[], runDir = ''): ProcessMetrics {
  const { unique: trials, removed } = dedupeTrials(input);
  const warnings: string[] = [];
  const outcomeTypes: Record<string, number> = {};
  const metricsStatus: Record<string, number> = {};
  const stages: Record<string, number> = {};
  const turnsByOutcome: Record<string, number> = {};
  const actionStatus: Record<string, number> = {};
  const actionTypes: Record<string, number> = {};
  const operatorActions: Record<string, number> = {};
  const tokenByStage: Record<string, number> = {};

  let assertionTotal = 0;
  let assertionPass = 0;
  let assertionFail = 0;
  let assertionUnreviewed = 0;
  let assertionRequired = 0;
  let assertionObserved = 0;
  let modelFailures = 0;
  let terminalObserved = 0;
  let delivered = 0;
  let gateBlocked = 0;
  let gateViolations = 0;
  let needsReview = 0;
  let turns = 0;
  let singleTurnTrials = 0;
  let totalTokens = 0;
  let rejectedCalls = 0;
  let failedOutcomes = 0;
  let unconfirmedGateAttempts = 0;
  const failedReasons: Record<string, number> = {};
  const callsPerTrial: number[] = [];
  const spanPerTrial: number[] = [];
  const tokensPerTrial: number[] = [];
  const interCallGaps: number[] = [];
  const toolTotals = { calls: 0, success: 0, successOther: 0, unproductive: 0, error: 0, rejected: 0, successRate: null as number | null };
  const byTool: Record<string, ToolMetric> = {};
  const categories: Record<string, number> = {};
  let stallTrials = 0;

  for (const trial of trials) {
    const trace = trial.trace ?? [];
    const requests = trial.requests ?? [];

    increment(outcomeTypes, trial.outcome?.type ?? 'not_observed');
    if (trial.outcome?.type === 'draft') delivered++;
    if (trial.outcome?.type === 'failed') {
      failedOutcomes++;
      increment(failedReasons, trial.outcome.reason ?? 'unknown');
    }
    if (trial.metrics?.status) increment(metricsStatus, trial.metrics.status);
    if (trial.metrics?.status === 'NEEDS_REVIEW') needsReview++;
    modelFailures += (trial.modelFailures ?? []).length;
    if (trial.execution?.terminalObserved) terminalObserved++;

    for (const assertion of trial.metrics?.assertions ?? []) {
      assertionTotal++;
      if (assertion.required) assertionRequired++;
      if (assertion.evidence?.observed) assertionObserved++;
      if (assertion.status === 'pass') assertionPass++;
      else if (assertion.status === 'fail') assertionFail++;
      else if (assertion.status === 'unreviewed') assertionUnreviewed++;
    }

    let turnCount = 0;
    for (const event of trace) {
      if (event.type === 'turn_outcome') {
        turnCount++;
        increment(turnsByOutcome, event.reason ? String(event.outcome ?? 'unknown') + '|' + String(event.reason) : String(event.outcome ?? 'unknown'));
      }
      if (event.type === 'model_request') increment(stages, event.stage ?? 'unknown');
      if (event.type === 'operator_action') {
        const actionType = event.action?.type ?? 'unknown';
        increment(operatorActions, actionType);
        if (GATE_ACTIONS.has(actionType)) unconfirmedGateAttempts++;
      }
      if (event.type === 'tool' && event.result) {
        const call = event.result;
        const tool = call.tool ?? 'unknown';
        const classified = classifyToolCall(call);
        increment(categories, classified.category);
        const metric = byTool[tool] ?? { calls: 0, success: 0, successOther: 0, unproductive: 0, error: 0, rejected: 0, successRate: null, codes: {} };
        byTool[tool] = metric;
        metric.calls++;
        toolTotals.calls++;
        if (call.code) increment(metric.codes, call.code);
        if (classified.success) {
          toolTotals.success++;
          metric.success++;
        } else if (classified.category === 'success_other') {
          toolTotals.successOther++;
          metric.successOther++;
        } else if (classified.category === 'rejected') {
          toolTotals.rejected++;
          metric.rejected++;
          rejectedCalls++;
        } else if (call.status === 'failed' || classified.category === 'product_error' || classified.category === 'fixture_unavailable' || classified.category === 'failed_other') {
          toolTotals.error++;
          metric.error++;
        } else {
          toolTotals.unproductive++;
          metric.unproductive++;
        }
      }
    }
    turns += turnCount;
    if (turnCount <= 1) singleTurnTrials++;

    for (const action of trial.execution?.actions ?? []) {
      increment(actionStatus, action.status ?? 'unknown');
      increment(actionTypes, String(action.type ?? 'unknown'));
    }

    callsPerTrial.push(requests.length);
    const sentAt = requests.map((request) => (request.sentAt ? Date.parse(request.sentAt) : Number.NaN)).filter(Number.isFinite);
    if (sentAt.length >= 2) {
      spanPerTrial.push(Math.max.apply(null, sentAt) - Math.min.apply(null, sentAt));
      for (let index = 1; index < sentAt.length; index++) interCallGaps.push(sentAt[index] - sentAt[index - 1]);
    }

    let trialTokens = 0;
    for (const request of requests) {
      const tokens = request.usage?.total_tokens ?? 0;
      trialTokens += tokens;
      if (request.stage) tokenByStage[request.stage] = (tokenByStage[request.stage] ?? 0) + tokens;
    }
    totalTokens += trialTokens;
    tokensPerTrial.push(trialTokens);

    for (const output of trial.outputs ?? []) {
      if (isObject(output) && typeof output.type === 'string' && GATE_ACTIONS.has(output.type) && typeof output.allowed === 'boolean') {
        if (output.allowed) gateViolations++;
        else gateBlocked++;
      }
    }

    let streak = 0;
    let maxStreak = 0;
    for (const event of trace) {
      if (event.type !== 'tool' || !event.result) continue;
      if (event.result.status === 'no_progress') {
        streak++;
        maxStreak = Math.max(maxStreak, streak);
      } else {
        streak = 0;
      }
    }
    if (maxStreak >= 2) stallTrials++;
  }

  for (const metric of Object.values(byTool)) metric.successRate = rate(metric.success, metric.calls);
  toolTotals.successRate = rate(toolTotals.success, toolTotals.calls);

  const trialsPerCase: Record<string, number> = {};
  for (const trial of trials) increment(trialsPerCase, trial.id ?? '?');
  const perCaseValues = Object.values(trialsPerCase);

  let requiredSteps = 0;
  let completedSteps = 0;
  for (const trial of trials) {
    const ledger = trial.execution;
    for (const step of ledger?.requiredSteps ?? []) {
      requiredSteps++;
      if (ledger?.completedSteps?.includes(step)) completedSteps++;
    }
  }

  const metrics: ProcessMetrics = {
    schemaVersion: 1,
    runDir,
    generatedAt: new Date().toISOString(),
    coverage: {
      trials: trials.length,
      cases: perCaseValues.length,
      duplicatesRemoved: removed,
      trialsPerCase: { min: perCaseValues.length ? Math.min.apply(null, perCaseValues) : 0, max: perCaseValues.length ? Math.max.apply(null, perCaseValues) : 0 },
      outcomeTypes,
      metricsStatus,
      assertions: { total: assertionTotal, pass: assertionPass, fail: assertionFail, unreviewed: assertionUnreviewed, required: assertionRequired, observed: assertionObserved },
      modelFailures,
      terminalObserved,
    },
    task: {
      delivered,
      deliveredRate: rate(delivered, trials.length),
      // Measurable means at least one required assertion actually observed a value;
      // delivery alone is not enough, because a run can grade a clarify case that must ask.
      successMeasurable: assertionObserved > 0,
      passRate: assertionObserved > 0 ? rate(metricsStatus['PASS'] ?? 0, trials.length) : null,
      gateBlocked,
      gateViolations,
      needsReview,
    },
    steps: {
      turns,
      turnsPerTrial: trials.length ? Math.round((turns / trials.length) * 100) / 100 : 0,
      singleTurnTrials,
      stages,
      turnsByOutcome,
      actionStatus,
      actionTypes,
      operatorActions,
      requiredStepCoverage: requiredSteps ? Math.round((completedSteps / requiredSteps) * 10000) / 10000 : null,
    },
    tools: { calls: toolTotals.calls, byTool, overall: toolTotals, categories },
    experience: {
      wallClockMs: {
        p50: percentile(spanPerTrial, 0.5),
        p90: percentile(spanPerTrial, 0.9),
        max: spanPerTrial.length ? Math.max.apply(null, spanPerTrial) : null,
        mean: mean(spanPerTrial),
      },
      callsPerTrial: {
        p50: percentile(callsPerTrial, 0.5),
        p90: percentile(callsPerTrial, 0.9),
        max: callsPerTrial.length ? Math.max.apply(null, callsPerTrial) : null,
        mean: mean(callsPerTrial),
      },
      tokens: { total: totalTokens, perTrialP50: percentile(tokensPerTrial, 0.5), perTrialMean: mean(tokensPerTrial), byStage: tokenByStage },
      clarify: { asks: byTool['ask']?.calls ?? 0, questionOutcomes: outcomeTypes['question'] ?? 0, questionRate: rate(outcomeTypes['question'] ?? 0, trials.length) },
      interCallGapMs: { p50: percentile(interCallGaps, 0.5), p90: percentile(interCallGaps, 0.9) },
      stall: { trialsWithTwoNoProgress: stallTrials, stallRate: rate(stallTrials, trials.length) },
    },
    risk: {
      rejectedCalls,
      rejectedRate: rate(rejectedCalls, toolTotals.calls),
      productErrors: categories['product_error'] ?? 0,
      unconfirmedGateAttempts,
      gateBlocks: gateBlocked,
      gateViolations,
      failedOutcomes,
      failedReasons,
    },
    warnings,
  };

  if (trials.length === 0) warnings.push('no_trials: no trial JSON matched the replay artifact shape');
  if (!delivered) warnings.push('no_delivered_outcome: task success rate is not measurable until the user simulator answers clarification questions');
  if (assertionTotal > 0 && assertionObserved === 0) warnings.push('no_recipe_assertions: no assertion was evaluated (0 observed), so pass/fail cannot be graded');
  if (singleTurnTrials === trials.length && trials.length > 0) warnings.push('single_turn_only: no multi-turn experience data');
  const hasTimestamp = trials.some((trial) => (trial.trace ?? []).some((event) => 'timestamp' in event || 'ts' in event || 'durationMs' in event));
  if (!hasTimestamp) warnings.push('trace_timestamps_missing: per-step latency, TTFP and user wait time are unavailable');
  if (trials.some((trial) => (trial.requests ?? []).length > 0) && !trials.some((trial) => (trial.requests ?? []).some((request) => 'receivedAt' in request))) warnings.push('response_timestamps_missing: wall clock runs request-start to request-start, so it excludes the final response');
  if (metrics.coverage.trialsPerCase.max <= 1) warnings.push('single_trial_per_case: no consistency estimate');

  return metrics;
}

function percent(value: number | null): string {
  return value === null ? '—' : String(Math.round(value * 1000) / 10) + '%';
}
function ms(value: number | null): string {
  return value === null ? '—' : (value / 1000).toFixed(1) + 's';
}

export function renderMarkdown(metrics: ProcessMetrics): string {
  const toolRows = Object.entries(metrics.tools.byTool)
    .sort((a, b) => b[1].calls - a[1].calls)
    .map((entry) => '| ' + entry[0] + ' | ' + entry[1].calls + ' | ' + entry[1].success + ' | ' + entry[1].unproductive + ' | ' + entry[1].error + ' | ' + entry[1].rejected + ' | ' + percent(entry[1].successRate) + ' |')
    .join('\n');
  const entries = (map: Record<string, number>): string => Object.entries(map).map((entry) => entry[0] + '=' + entry[1]).join('、');
  const lines: string[] = [];
  lines.push('# 过程指标 scorecard（v0）', '');
  lines.push('- run: ' + metrics.runDir);
  lines.push('- generated: ' + metrics.generatedAt);
  lines.push('- trials: ' + metrics.coverage.trials + '（' + metrics.coverage.cases + ' 题，去重 ' + metrics.coverage.duplicatesRemoved + ' 条）', '');
  lines.push('## 1 任务成功率');
  lines.push('- 交付（draft）: ' + metrics.task.delivered + ' / ' + metrics.coverage.trials + ' = ' + percent(metrics.task.deliveredRate));
  lines.push('- 可判定: ' + (metrics.task.successMeasurable ? '是（已完成 ' + metrics.coverage.assertions.observed + ' 条必需断言）' : '否（无断言被实际判定）'));
  lines.push('- 判定结果: PASS ' + (metrics.coverage.metricsStatus['PASS'] ?? 0) + ' / FAIL ' + (metrics.coverage.metricsStatus['FAIL'] ?? 0) + ' / NEEDS_REVIEW ' + (metrics.coverage.metricsStatus['NEEDS_REVIEW'] ?? 0));
  lines.push('- 门禁拦截: ' + metrics.task.gateBlocked + '；违规: ' + metrics.task.gateViolations);
  lines.push('- 待审: ' + metrics.task.needsReview, '');
  lines.push('## 2 步骤');
  lines.push('- 轮次: ' + metrics.steps.turns + ' 总，' + metrics.steps.turnsPerTrial + '/trial，单轮 trial ' + metrics.steps.singleTurnTrials);
  lines.push('- 阶段: ' + entries(metrics.steps.stages));
  lines.push('- 轮次终态: ' + entries(metrics.steps.turnsByOutcome));
  lines.push('- 必做步骤覆盖: ' + percent(metrics.steps.requiredStepCoverage), '');
  lines.push('## 3 工具', '| 工具 | 调用 | 成功 | 无进展 | 错误 | 拒绝 | 成功率 |', '| --- | --- | --- | --- | --- | --- | --- |', toolRows, '');
  lines.push('分类：' + entries(metrics.tools.categories), '');
  lines.push('## 4 体验');
  lines.push('- 端到端: p50 ' + ms(metrics.experience.wallClockMs.p50) + ' / p90 ' + ms(metrics.experience.wallClockMs.p90) + ' / max ' + ms(metrics.experience.wallClockMs.max));
  lines.push('- 调用数: p50 ' + metrics.experience.callsPerTrial.p50 + ' / p90 ' + metrics.experience.callsPerTrial.p90);
  lines.push('- tokens: ' + metrics.experience.tokens.total + '（p50 ' + metrics.experience.tokens.perTrialP50 + '/trial）');
  lines.push('- 澄清: ask ' + metrics.experience.clarify.asks + ' 次；question 终态 ' + metrics.experience.clarify.questionOutcomes + '（' + percent(metrics.experience.clarify.questionRate) + '）');
  lines.push('- 卡点 trial: ' + metrics.experience.stall.trialsWithTwoNoProgress + '（' + percent(metrics.experience.stall.stallRate) + '）', '');
  lines.push('## 5 风险');
  lines.push('- 越权拒绝: ' + metrics.risk.rejectedCalls + ' / ' + metrics.tools.calls + ' = ' + percent(metrics.risk.rejectedRate));
  lines.push('- 产品错误调用: ' + metrics.risk.productErrors + ' 次（invalid_artifact / invalid_or_unknown_action）');
  lines.push('- 未确认导出探针: ' + metrics.risk.unconfirmedGateAttempts + ' 次，拦截 ' + metrics.risk.gateBlocks + '，违规 ' + metrics.risk.gateViolations);
  lines.push('- 失败终态: ' + metrics.risk.failedOutcomes + '（' + (entries(metrics.risk.failedReasons) || '—') + '）', '');
  lines.push('## 6 警告（口径未闭合处）');
  for (const warning of metrics.warnings) lines.push('- ' + warning);
  lines.push('');
  return lines.join('\n');
}
