/** Step 4 failure taxonomy (design §7.1/§7.3). Structured stops are authoritative; old lastStop stays compatible. */
import { currentInputKey, gateEffectOf, hashText, type Diagnostics, type EditorialSession } from './editorialTypes';
import type { StopAction, StopClass, StopFields, StopRecord } from './editorialTypesV3';

export interface FailureDescriptor {
  code: string; class: StopClass; stage?: string; retryable: boolean;
  headline: string; detail: string; fields?: StopFields; actions: StopAction[];
}

const CORE: Record<string, { class: StopClass; headline: string; actions: StopAction[] }> = {
  model_unavailable: { class: 'external', headline: '模型服务暂时不可用', actions: ['retry'] },
  source_unavailable: { class: 'external', headline: '无法读取素材', actions: ['supply', 'waive'] },
  deadline_exceeded: { class: 'external', headline: '本轮处理超过时间上限', actions: ['retry'] },
  task_plan_incomplete: { class: 'input', headline: '任务还缺少必要信息', actions: ['edit_task'] },
  gap_unresolved: { class: 'input', headline: '还有未解决的信息缺口', actions: ['answer', 'waive'] },
  confirmation_blocked: { class: 'input', headline: '还不能确认成稿', actions: ['retry'] },
  permission_denied: { class: 'input', headline: '缺少必要授权', actions: ['waive', 'edit_task'] },
  model_output_invalid: { class: 'internal', headline: '模型返回内容不符合本步骤格式', actions: ['retry', 'report'] },
  artifact_invalid: { class: 'internal', headline: '生成的正文未通过校验', actions: ['retry', 'report'] },
  review_invalid: { class: 'internal', headline: '审稿结果无法读取，暂不能确认', actions: ['retry', 'report'] },
  review_unavailable: { class: 'internal', headline: '审稿结果无法读取，暂不能确认', actions: ['retry', 'report'] },
  internal_invariant: { class: 'internal', headline: '处理过程中出现内部一致性问题', actions: ['retry', 'report'] },
  context_capacity: { class: 'internal', headline: '上下文容量超出可判定范围', actions: ['retry', 'report'] },
  no_progress: { class: 'internal', headline: '没有新的证据或质量进展', actions: ['retry', 'report'] },
  decision_budget_exhausted: { class: 'internal', headline: '本轮决策预算已用尽', actions: ['retry', 'report'] },
  write_budget_exhausted: { class: 'internal', headline: '本轮改写预算已用尽', actions: ['retry', 'report'] },
  model_budget_exhausted: { class: 'internal', headline: '模型调用预算已用尽', actions: ['retry', 'report'] },
  ask_limit_reached: { class: 'input', headline: '同一缺口的提问次数已达上限', actions: ['answer', 'edit_task'] },
  invalid_action: { class: 'internal', headline: '模型返回了不可执行的动作', actions: ['retry', 'report'] },
  run_cancelled: { class: 'input', headline: '本轮已取消', actions: ['retry'] },
  confirmation_without_pending: { class: 'input', headline: '当前没有待确认的问题', actions: ['confirm', 'edit_task'] },
  confirmation_requires_control_event: { class: 'input', headline: '成稿确认请使用确认按钮', actions: ['confirm'] },
  already_confirmed: { class: 'input', headline: '当前稿已确认', actions: ['edit_task'] },
};

const RETRYABLE_FALSE = new Set(['task_plan_incomplete', 'gap_unresolved', 'permission_denied', 'ask_limit_reached', 'already_confirmed']);
const RETRYABLE_TRUE = new Set(['run_cancelled', 'confirmation_blocked']);
/** A new run re-validates review/layout/gate; only editorial decisions are terminal. */
function retryableFor(code: string, cls: StopClass): boolean {
  if (RETRYABLE_FALSE.has(code)) return false;
  if (RETRYABLE_TRUE.has(code)) return true;
  return cls !== 'input';
}
export function classifyFailure(code: string, stage?: string): FailureDescriptor {
  const core = CORE[code] ?? CORE.internal_invariant;
  const structuredCode = CORE[code] ? code : 'internal_invariant';
  return {
    code: structuredCode, class: core.class, stage, retryable: retryableFor(structuredCode, core.class),
    headline: core.headline + (stage && (structuredCode === 'model_output_invalid' || structuredCode === 'artifact_invalid' || structuredCode === 'review_invalid' || structuredCode === 'internal_invariant') ? '（' + stage + '）' : ''),
    detail: core.headline + '；已保留当前检查点。', fields: stage ? { stage } : undefined, actions: core.actions,
  };
}

const INTERNAL_INVARIANT = new Set(['unsafe_fact_snapshot', 'invalid_task_contract', 'invalid_schema', 'content_key_mismatch', 'invalid_extraction']);
export function failureFromError(error: unknown, stage?: string): FailureDescriptor {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'deadline_exceeded') return { ...classifyFailure('deadline_exceeded', stage), detail: '本轮到达时间上限；已保留候选与检查点。' };
  if (message === 'model_budget_exhausted') return { ...classifyFailure('model_budget_exhausted', stage), detail: '模型调用预算已用尽；已保留检查点。' };
  if (message === 'context_capacity') return { ...classifyFailure('context_capacity', stage), detail: '上下文超出可判定容量；请缩小素材或分批处理。' };
  if (message === 'invalid_extraction') return { ...classifyFailure('model_output_invalid', stage), detail: '阶段 ' + (stage ?? '未知') + ' 的返回结构无效；已保留既有任务与事实。' };
  if (message === 'invalid_review' || message === 'review_invalid') return { ...classifyFailure('review_invalid', stage), detail: '审稿结果无法读取；交付门暂不能确认。' };
  if (message === 'artifact_invalid' || message === 'invalid_artifact') return { ...classifyFailure('artifact_invalid', stage), detail: '生成的正文未通过校验；旧候选未被修改。' };
  if (message === 'invalid_json') return { ...classifyFailure('model_output_invalid', stage), detail: '阶段 ' + (stage ?? '未知') + ' 连续返回无法解析的内容；已保留既有任务与事实。' };
  if (INTERNAL_INVARIANT.has(message) || message.startsWith('stale_')) {
    return { ...classifyFailure('internal_invariant', stage), detail: '内部校验失败（' + message + '）；已保留当前证据、答案与批次。' };
  }
  const status = Number(message.match(/\b(?:HTTP[\s_-]*)?(5\d\d|429)\b/)?.[1]);
  if (status || /timeout|network|fetch failed|ECONN|socket/i.test(message)) {
    return { ...classifyFailure('model_unavailable', stage), ...(status ? { fields: { status } } : {}), ...(status ? { headline: '模型服务暂时不可用（HTTP ' + status + '）' } : {}), detail: status ? '模型服务返回 HTTP ' + status + '，未自动重试。' : '模型服务暂时不可用，未自动重试。' };
  }
  return { ...classifyFailure('internal_invariant', stage), detail: message.slice(0, 300) || '未分类的内部错误。' };
}

export function makeStopRecord(session: EditorialSession, failure: FailureDescriptor): StopRecord {
  return {
    code: failure.code, class: failure.class, ...(failure.stage ? { stage: failure.stage } : {}),
    retryable: failure.retryable, headline: failure.headline, detail: failure.detail,
    ...(failure.fields ? { fields: failure.fields } : {}), actions: failure.actions,
    traceId: 'trace-' + hashText([session.sessionId, session.activeRunId ?? '', failure.code, failure.stage ?? '', session.revision].join(':')).slice(0, 24),
    preserved: {
      ...(session.candidate ? { candidateRevision: session.candidate.revision } : {}),
      ...(session.committed ? { committedRevision: session.committed.artifact.revision } : {}),
      inputKey: currentInputKey(session),
    },
  };
}

/** One failure card at most: the structured stop wins, otherwise the first block diagnostic. */
export function deriveFailureView(session: EditorialSession): { stop?: StopRecord; diagnostics: Diagnostics[] } {
  const blocks = session.diagnostics.filter(diagnostic => gateEffectOf(diagnostic) === 'block');
  const stop = session.lastRun?.stop;
  let synthesized: StopRecord | undefined;
  let remainingBlocks = blocks;
  if (stop) {
    remainingBlocks = blocks.filter(diagnostic => diagnostic.code !== stop.code);
  } else {
    const sorted = [...blocks].sort((a, b) => (a.owner ?? '').localeCompare(b.owner ?? '') || a.code.localeCompare(b.code));
    const first = sorted[0];
    if (first) {
      synthesized = stopFromBlockDiagnostic(session, first);
      remainingBlocks = sorted.slice(1);
    }
  }
  const diagnostics = dedupeDiagnostics([
    ...(session.agentDiagnostics ?? []),
    ...(session.lastRun?.agentDiagnostics ?? []),
    ...session.diagnostics.filter(diagnostic => gateEffectOf(diagnostic) !== 'block'),
    ...remainingBlocks,
  ]);
  return { ...(stop ? { stop } : synthesized ? { stop: synthesized } : {}), diagnostics };
}

export function stopFromBlockDiagnostic(session: EditorialSession, diagnostic: Diagnostics): StopRecord {
  const stage = diagnostic.owner ?? 'diagnostic';
  const failure = classifyFailure(diagnostic.code, diagnostic.owner);
  return {
    code: diagnostic.code, class: 'internal', stage, retryable: true,
    headline: failure.headline, detail: diagnostic.message,
    actions: ['retry', 'report'],
    traceId: 'diag-' + hashText([session.sessionId, diagnostic.owner ?? '', diagnostic.code].join(':')).slice(0, 20),
    preserved: {
      ...(session.candidate ? { candidateRevision: session.candidate.revision } : {}),
      ...(session.committed ? { committedRevision: session.committed.artifact.revision } : {}),
      inputKey: currentInputKey(session),
    },
  };
}

function dedupeDiagnostics(items: Diagnostics[]): Diagnostics[] {
  const seen = new Set<string>();
  return items.filter(diagnostic => {
    const key = [diagnostic.owner ?? '', diagnostic.code, diagnostic.message].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
