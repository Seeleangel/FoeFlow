/** Pure routing for structured failure-card actions. The page owns DOM focus and toasts. */
import { deriveGaps } from './editorialGaps';
import { openQuestionBatch } from './editorialState';
import type { EditorialSession, Gap } from './editorialTypes';
import type { StopAction } from './editorialTypesV3';

export type StopActionPlan =
  | { kind: 'retry' }
  | { kind: 'confirm' }
  | { kind: 'focus_batch_item'; batchId: string; gapId: string }
  | { kind: 'prefill_input'; text: string; notice?: string }
  | { kind: 'waive_sources'; requirementIds: string[] }
  | { kind: 'defer_gaps'; gapIds: string[] }
  | { kind: 'focus_gaps'; gapIds: string[] }
  | { kind: 'open_question_batch'; session: EditorialSession }
  | { kind: 'notice'; text: string }
  | { kind: 'none' };

function stopFieldIds(session: EditorialSession): string[] {
  const raw = session.lastRun?.stop?.fields?.unresolvedIds;
  return typeof raw === 'string' ? raw.split(/[,，]/).map(value => value.trim()).filter(Boolean) : [];
}

function isOpen(gap: Gap): boolean {
  return gap.state === 'open' || gap.state === 'asked';
}

function baseAskable(gap: Gap): boolean {
  const askable = gap.askable ?? (gap.gapClass ? gap.gapClass === 'fact' || gap.gapClass === 'authorization' : gap.kind !== 'plan_ambiguity');
  return askable && gap.gapClass !== 'constraint' && gap.gapClass !== 'internal';
}

function isAskable(gap: Gap): boolean {
  return baseAskable(gap) && (gap.askHistory?.length ?? 0) < 2;
}

/** A stale reply state and an empty ask list are not the same thing as the ask limit. */
export function answerNoticeText(gaps: Gap[], error?: unknown): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'awaiting_editor_reply') return '当前问题状态已变化，请刷新会话后重试，或改用明确豁免或修改任务。';
  const exhausted = gaps.some(gap => gap.state === 'open' && baseAskable(gap) && (gap.askHistory?.length ?? 0) >= 2);
  if (code === 'ask_limit_reached' || exhausted) return '已达到提问上限，请改用明确豁免或修改任务';
  return '当前没有可继续提问的信息项，请改用明确豁免或修改任务。';
}

export function planStopAction(session: EditorialSession | undefined, action: StopAction): StopActionPlan {
  if (!session) return { kind: 'none' };
  const stop = session.lastRun?.stop;
  const active = session.activeBatchId ? (session.questionBatches ?? []).find(batch => batch.id === session.activeBatchId && batch.status === 'active') : undefined;
  const gaps = deriveGaps(session);
  const ids = stopFieldIds(session);

  if (action === 'retry') return { kind: 'retry' };
  if (action === 'confirm') return { kind: 'confirm' };
  if (action === 'report') return { kind: 'none' };

  if (action === 'supply') {
    if (active) {
      const gapId = ids.find(id => active.items.some(item => item.gapId === id));
      if (gapId) return { kind: 'focus_batch_item', batchId: active.id, gapId };
    }
    const source = gaps.find(gap => gap.kind === 'source_unavailable' && isOpen(gap)) ?? gaps.find(gap => isOpen(gap) && (ids.includes(gap.id) || ids.includes(gap.requirementId)));
    return { kind: 'prefill_input', text: `补充素材：${source?.label ?? stop?.headline ?? '指定素材'}（请粘贴内容或说明文件位置）` };
  }

  if (action === 'waive') {
    const matched = ids.map(id => gaps.find(gap => gap.id === id || gap.requirementId === id)).filter((gap): gap is Gap => !!gap && isOpen(gap));
    const matchedSource = matched.find(gap => gap.kind === 'source_unavailable');
    if (matchedSource) return { kind: 'waive_sources', requirementIds: [matchedSource.requirementId] };
    if (matched.length === 1) return { kind: 'defer_gaps', gapIds: [matched[0].id] };
    if (matched.length > 1) return { kind: 'focus_gaps', gapIds: matched.map(gap => gap.id) };
    const openSources = gaps.filter(gap => gap.kind === 'source_unavailable' && isOpen(gap));
    if (openSources.length === 1) return { kind: 'waive_sources', requirementIds: [openSources[0].requirementId] };
    if (openSources.length > 1) return { kind: 'focus_gaps', gapIds: openSources.map(gap => gap.id) };
    if (stop?.code === 'permission_denied' || stop?.code === 'gap_unresolved') {
      const open = gaps.filter(isOpen);
      if (open.length === 1) return { kind: 'defer_gaps', gapIds: [open[0].id] };
      if (open.length > 1) return { kind: 'focus_gaps', gapIds: open.map(gap => gap.id) };
    }
    return { kind: 'focus_gaps', gapIds: [] };
  }

  if (action === 'answer') {
    if (active && active.items.length) return { kind: 'focus_batch_item', batchId: active.id, gapId: active.items[0].gapId };
    const askable = gaps.filter(gap => gap.state === 'open' && isAskable(gap));
    if (!askable.length) return { kind: 'notice', text: answerNoticeText(gaps) };
    try {
      return { kind: 'open_question_batch', session: openQuestionBatch(session, askable.map(gap => gap.id)) };
    } catch (error) {
      return { kind: 'notice', text: answerNoticeText(gaps, error) };
    }
  }

  if (action === 'edit_task') return { kind: 'prefill_input', text: '修改任务要求：', notice: '请说明要修改的任务要求，发送后会重新规划任务' };
  return { kind: 'none' };
}
