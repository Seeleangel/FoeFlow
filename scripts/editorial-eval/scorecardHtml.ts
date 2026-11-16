import type { ProcessMetrics } from './processMetrics';

/**
 * Single-file HTML dashboard for a ProcessMetrics scorecard. No external assets:
 * the file can be opened directly or screenshotted for review.
 */

function esc(value: unknown): string {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function pct(value: number | null): string {
  return value === null ? '—' : String(Math.round(value * 1000) / 10) + '%';
}
function seconds(value: number | null): string {
  return value === null ? '—' : (value / 1000).toFixed(1) + 's';
}
function num(value: number): string {
  return value.toLocaleString('en-US');
}
function bar(value: number, max: number, tone: string): string {
  const width = max > 0 ? Math.max(1, Math.round((value / max) * 100)) : 0;
  return '<div class="track"><span class="fill ' + tone + '" style="width:' + width + '%"></span></div>';
}
function entries(map: Record<string, number>, max?: number): string {
  const list = Object.entries(map).sort((a, b) => b[1] - a[1]);
  const top = max ?? (list.length ? list[0][1] : 0);
  return list.map((entry) => {
    return '<div class="row"><span class="key">' + esc(entry[0]) + '</span>' + bar(entry[1], top, 'ink') + '<span class="val">' + num(entry[1]) + '</span></div>';
  }).join('');
}

export function renderHtml(metrics: ProcessMetrics): string {
  const totalTrials = metrics.coverage.trials;
  const toolTotal = metrics.tools.calls;
  const toolRows = Object.entries(metrics.tools.byTool)
    .sort((a, b) => b[1].calls - a[1].calls)
    .map((entry) => {
      const metric = entry[1];
      const codes = Object.entries(metric.codes).sort((a, b) => b[1] - a[1]).slice(0, 2).map((code) => code[0] + ' ' + code[1]).join(' / ');
      return '<tr><td class="strong">' + esc(entry[0]) + '</td><td>' + num(metric.calls) + '</td><td>' + num(metric.success) + '</td><td>' + num(metric.unproductive) + '</td><td>' + num(metric.error) + '</td><td>' + num(metric.rejected) + '</td><td class="strong">' + pct(metric.successRate) + '</td><td class="muted small">' + esc(codes) + '</td></tr>';
    }).join('');

  const failedReasons = Object.entries(metrics.risk.failedReasons).map((entry) => esc(entry[0]) + ' ×' + entry[1]).join('、') || '—';
  const warn = metrics.warnings.map((item) => '<li>' + esc(item) + '</li>').join('');

  const observedAssertions = metrics.coverage.assertions.observed;
  const statusRow = 'PASS ' + (metrics.coverage.metricsStatus['PASS'] ?? 0) + ' / FAIL ' + (metrics.coverage.metricsStatus['FAIL'] ?? 0) + ' / NEEDS_REVIEW ' + (metrics.coverage.metricsStatus['NEEDS_REVIEW'] ?? 0);
  const taskRows = [
    ['交付终态（draft）', metrics.task.delivered + ' / ' + totalTrials, pct(metrics.task.deliveredRate)],
    ['任务成功率可判定', metrics.task.successMeasurable ? '是' : '否', metrics.task.successMeasurable ? '已判定 ' + observedAssertions + ' 条必需断言' : '尚无断言被实际判定'],
    ['任务成功率（PASS/全部 trial）', pct(metrics.task.passRate), statusRow],
    ['断言完成判定', observedAssertions + ' / ' + metrics.coverage.assertions.total, '机械断言 + 语义待审断言合计'],
    ['门禁拦截 / 违规', metrics.task.gateBlocked + ' / ' + metrics.task.gateViolations, '未确认导出探针'],
    ['待审 trial', String(metrics.task.needsReview), '无 recipe 时必然'],
  ].map((row) => '<tr><td class="strong">' + esc(row[0]) + '</td><td>' + esc(row[1]) + '</td><td class="muted small">' + esc(row[2]) + '</td></tr>').join('');

  const cards = [
    { label: 'trials', value: num(totalTrials), note: metrics.coverage.cases + ' 题 · 每题 ' + metrics.coverage.trialsPerCase.min + '–' + metrics.coverage.trialsPerCase.max + ' 次' },
    { label: '任务成功率', value: metrics.task.successMeasurable ? pct(metrics.task.passRate) : '不可判定', note: '交付率 ' + pct(metrics.task.deliveredRate) + ' · 已判定 ' + observedAssertions + ' 条' },
    { label: '工具调用', value: num(toolTotal), note: '成功率 ' + pct(metrics.tools.overall.successRate) + ' · 无进展 ' + metrics.tools.overall.unproductive },
    { label: '越权拒绝率', value: pct(metrics.risk.rejectedRate), note: metrics.risk.rejectedCalls + ' / ' + toolTotal + ' 次调用' },
    { label: '端到端 p50', value: seconds(metrics.experience.wallClockMs.p50), note: 'p90 ' + seconds(metrics.experience.wallClockMs.p90) + ' · 请求起点到起点' },
    { label: 'tokens', value: (metrics.experience.tokens.total / 1000).toFixed(1) + 'K', note: 'p50 ' + num(metrics.experience.tokens.perTrialP50 ?? 0) + ' / trial' },
  ].map((card) => '<div class="card"><div class="card-label">' + esc(card.label) + '</div><div class="card-value">' + esc(card.value) + '</div><div class="card-note">' + esc(card.note) + '</div></div>').join('');

  const style = [
    ':root{--paper:#f5efe2;--ink:#1b1915;--muted:#6f6656;--rule:#c9bfa9;--accent:#a15c07;--wash:#ebe2cf;--good:#3d6b45;--bad:#8f2f21;}',
    '*{box-sizing:border-box}',
    'body{margin:0;background:var(--paper);color:var(--ink);font-family:"Songti SC","Noto Serif SC",Georgia,serif;font-size:14px;line-height:1.55;}',
    '.page{max-width:1180px;margin:0 auto;padding:44px 40px 72px;}',
    'header{border-bottom:3px double var(--ink);padding-bottom:18px;margin-bottom:28px;}',
    '.kicker{letter-spacing:.18em;font-size:11px;color:var(--muted);text-transform:uppercase;}',
    'h1{font-size:30px;margin:6px 0 8px;font-weight:700;letter-spacing:.01em;}',
    '.sub{color:var(--muted);font-size:12px;}',
    'h2{font-size:17px;margin:34px 0 12px;padding-bottom:6px;border-bottom:1px solid var(--rule);letter-spacing:.04em;}',
    'h2 .no{color:var(--accent);font-size:12px;margin-right:8px;letter-spacing:.12em;}',
    '.cards{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin:18px 0 6px;}',
    '.card{border:1px solid var(--rule);background:#faf6ec;padding:12px 12px 10px;}',
    '.card-label{font-size:11px;color:var(--muted);letter-spacing:.08em;}',
    '.card-value{font-size:24px;font-weight:700;margin:2px 0 3px;font-variant-numeric:tabular-nums;}',
    '.card-note{font-size:10.5px;color:var(--muted);line-height:1.35;}',
    'table{width:100%;border-collapse:collapse;margin:8px 0 4px;font-size:13px;}',
    'th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--rule);vertical-align:top;}',
    'th{font-size:10.5px;letter-spacing:.1em;color:var(--muted);text-transform:uppercase;font-weight:400;}',
    'td.strong{font-weight:700;}',
    'td.muted,.muted{color:var(--muted);}',
    '.small{font-size:11px;}',
    '.row{display:grid;grid-template-columns:120px 1fr 56px;align-items:center;gap:10px;margin:3px 0;}',
    '.row .key{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.row .val{text-align:right;font-variant-numeric:tabular-nums;font-size:12px;}',
    '.track{height:8px;background:var(--wash);position:relative;}',
    '.fill{display:block;height:100%;background:var(--ink);}',
    '.fill.accent{background:var(--accent);}',
    '.fill.bad{background:var(--bad);}',
    '.cols{display:grid;grid-template-columns:1fr 1fr;gap:28px;}',
    '.note{border-left:3px solid var(--accent);background:#faf6ec;padding:10px 14px;font-size:12px;color:var(--muted);margin:14px 0;}',
    '.warn{border:1px solid var(--rule);background:#f2ead8;padding:14px 18px;font-size:12px;}',
    '.warn ul{margin:6px 0 0;padding-left:18px;}',
    '.warn li{margin:2px 0;}',
    'footer{margin-top:38px;border-top:1px solid var(--rule);padding-top:12px;color:var(--muted);font-size:11px;display:flex;justify-content:space-between;}',
    '@media (max-width:900px){.cards{grid-template-columns:repeat(3,1fr)}.cols{grid-template-columns:1fr}}',
  ].join('\n');

  const parts: string[] = [];
  parts.push('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">');
  parts.push('<title>FoeFlow 评测过程指标</title><style>' + style + '</style></head><body><div class="page">');
  parts.push('<header><div class="kicker">FoeFlow · 写作 agent · 评测过程指标 v0</div>');
  parts.push('<h1>过程指标 scorecard</h1>');
  parts.push('<div class="sub">run ' + esc(metrics.runDir) + ' · 生成于 ' + esc(metrics.generatedAt) + ' · 仅从已落盘 trial 产物重算，无模型调用</div></header>');

  parts.push('<div class="cards">' + cards + '</div>');

  parts.push('<h2><span class="no">01</span>任务成功率</h2>');
  parts.push('<div class="cols"><div><table>' + taskRows + '</table></div>');
  parts.push('<div><div class="sub" style="margin-bottom:4px">题面终态分布</div>' + entries(metrics.coverage.outcomeTypes) + '</div></div>');
  parts.push('<div class="note">任务成功率 = 满足题面验收判据的 trial / 全部 trial。' + (metrics.task.successMeasurable ? '本次 run 有 ' + observedAssertions + ' 条必需断言由机械规则判定（' + statusRow + '）；未评审的语义断言另行计入 G1 评审待办。' : '本次 run 没有断言被实际判定（0 observed），因此这一项按定义不可判定——不是 0%，是缺判分。') + '</div>');

  parts.push('<h2><span class="no">02</span>步骤成功率</h2>');
  parts.push('<div class="cols"><div><div class="sub" style="margin-bottom:4px">阶段调用分布</div>' + entries(metrics.steps.stages) + '</div>');
  parts.push('<div><div class="sub" style="margin-bottom:4px">轮次终态</div>' + entries(metrics.steps.turnsByOutcome) + '</div></div>');
  parts.push('<div class="note">' + esc('轮次 ' + metrics.steps.turns + ' 总 · ' + metrics.steps.turnsPerTrial + '/trial · 单轮 trial ' + metrics.steps.singleTurnTrials + '。步骤级成功率需要 replay 记录每步起止时间与判定，当前只有阶段计数。') + '</div>');

  parts.push('<h2><span class="no">03</span>工具成功率</h2>');
  parts.push('<table><thead><tr><th>工具</th><th>调用</th><th>成功</th><th>无进展</th><th>错误</th><th>拒绝</th><th>成功率</th><th>主要状态码</th></tr></thead><tbody>' + toolRows + '</tbody></table>');
  parts.push('<div class="cols"><div><div class="sub" style="margin-bottom:4px">调用分类</div>' + entries(metrics.tools.categories) + '</div>');
  parts.push('<div class="note">成功率只统计语义成功（read 读到素材、search 发现来源、ask 挂起等）；source_unavailable 归夹具缺陷，required_read_already_attempted 归策略防护，不能算产品失败。</div></div>');

  parts.push('<h2><span class="no">04</span>体验指标</h2>');
  const expRows = [
    ['端到端 p50 / p90 / max', seconds(metrics.experience.wallClockMs.p50) + ' / ' + seconds(metrics.experience.wallClockMs.p90) + ' / ' + seconds(metrics.experience.wallClockMs.max)],
    ['模型调用数 p50 / p90', String(metrics.experience.callsPerTrial.p50) + ' / ' + String(metrics.experience.callsPerTrial.p90)],
    ['调用间隔 p50 / p90', seconds(metrics.experience.interCallGapMs.p50) + ' / ' + seconds(metrics.experience.interCallGapMs.p90)],
    ['澄清 ask 次数', String(metrics.experience.clarify.asks)],
    ['question 终态', metrics.experience.clarify.questionOutcomes + '（' + pct(metrics.experience.clarify.questionRate) + '）'],
    ['卡点 trial（连续 2 次无进展）', String(metrics.experience.stall.trialsWithTwoNoProgress) + '（' + pct(metrics.experience.stall.stallRate) + '）'],
  ].map((row) => '<tr><td class="strong">' + esc(row[0]) + '</td><td>' + esc(row[1]) + '</td></tr>').join('');
  parts.push('<div class="cols"><div><table>' + expRows + '</table></div><div><div class="sub" style="margin-bottom:4px">token 按阶段</div>' + entries(metrics.experience.tokens.byStage) + '</div></div>');
  parts.push('<div class="note">' + esc('时间轴目前只有请求 sentAt：端到端是首个请求到末个请求，缺首 token 等待、末次响应时间与用户等待；补齐 replay 时间戳后才能算 TTFP 和每步耗时。') + '</div>');

  parts.push('<h2><span class="no">05</span>风险指标</h2>');
  const riskRows = [
    ['越权拒绝', metrics.risk.rejectedCalls + ' / ' + toolTotal + ' = ' + pct(metrics.risk.rejectedRate)],
    ['产品错误调用', String(metrics.risk.productErrors) + '（invalid_artifact / invalid_or_unknown_action）'],
    ['未确认导出探针', metrics.risk.unconfirmedGateAttempts + ' 次'],
    ['其中被拦 / 违规', metrics.risk.gateBlocks + ' / ' + metrics.risk.gateViolations],
    ['失败终态', String(metrics.risk.failedOutcomes) + '（' + failedReasons + '）'],
    ['模型失败', String(metrics.coverage.modelFailures)],
  ].map((row) => '<tr><td class="strong">' + esc(row[0]) + '</td><td>' + esc(row[1]) + '</td></tr>').join('');
  parts.push('<div class="cols"><div><table>' + riskRows + '</table></div>');
  parts.push('<div class="note">注入、PII、事实错误目前没有负对照集，只能从断言层补；门禁违规为 0 是本 run 最重要的安全结论。</div></div>');

  parts.push('<h2><span class="no">06</span>口径警告</h2>');
  parts.push('<div class="warn"><strong>' + metrics.warnings.length + ' 条未闭合项</strong><ul>' + warn + '</ul></div>');

  parts.push('<footer><span>FoeFlow editorial eval · scorecard schema v1</span><span>trials ' + num(totalTrials) + ' · tool calls ' + num(toolTotal) + ' · tokens ' + num(metrics.experience.tokens.total) + '</span></footer>');
  parts.push('</div></body></html>');
  return parts.join('\n');
}
