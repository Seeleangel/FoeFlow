import { useState } from 'react';
import { hasCjk } from '@/lib/editorialDisplay';
import type { StopAction, StopRecord } from '@/lib/editorialTypesV3';

const LABELS: Record<StopAction, string> = {
  retry: '重试', supply: '补充素材', waive: '明确豁免', answer: '补充回答',
  edit_task: '修改任务', confirm: '确认成稿', report: '复制诊断编号',
};

export function EditorialFailureCard({ stop, candidateRevision, onAction, retryBlockedReason, disabled = false, canConfirm = true }: {
  stop: StopRecord; candidateRevision?: number; onAction: (action: StopAction) => void;
  retryBlockedReason?: string; disabled?: boolean; canConfirm?: boolean;
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copyTrace = async () => {
    try {
      if (!navigator.clipboard) throw new Error('clipboard_unavailable');
      await navigator.clipboard.writeText(stop.traceId);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 2000);
    } catch {
      setCopyState('failed');
    }
  };
  const internal = stop.class === 'internal';
  const detailHasCjk = hasCjk(stop.detail);
  const headline = internal ? (detailHasCjk ? stop.detail : 'Agent 报告了一个内部问题') : stop.headline;
  const actions = [...new Set(stop.actions)]
    .filter(action => action !== 'report')
    .filter(action => action !== 'retry' || stop.retryable)
    .filter(action => action !== 'confirm' || canConfirm)
    .slice(0, 2);
  const copyControl = internal;
  return <section aria-label="本轮失败" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-950">
    <p role="alert" className="font-semibold">{headline}</p>
    {!internal ? <details className="mt-1"><summary className="cursor-pointer text-xs text-red-800">详情</summary><p className="mt-1 whitespace-pre-wrap text-xs">{stop.detail}</p></details> : null}
    {internal && !detailHasCjk ? <details className="mt-1"><summary className="cursor-pointer text-xs text-red-800">技术详情</summary><p className="mt-1 whitespace-pre-wrap text-xs">{stop.detail}</p></details> : null}
    {internal ? <p className="mt-1 break-words text-xs text-red-900">诊断码：{stop.code} · 阶段：{stop.stage ?? 'diagnostic'} · 诊断编号：<span className="select-all">{stop.traceId}</span></p> : null}
    {candidateRevision !== undefined || stop.preserved.candidateRevision !== undefined ? <p className="mt-1 text-xs">当前候选来自第 {stop.preserved.candidateRevision ?? candidateRevision} 版，未被本次失败修改。</p> : null}
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {actions.map(action => {
        const retryBlocked = action === 'retry' && !!retryBlockedReason;
        return <button key={action} type="button" className="min-h-11 rounded-lg border bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          disabled={disabled || retryBlocked} aria-describedby={retryBlocked ? 'retry-blocked-reason' : undefined}
          onClick={() => onAction(action)}>{LABELS[action]}</button>;
      })}
      {copyControl ? <button type="button" className="min-h-11 rounded-lg border bg-white px-3 py-2 text-sm" onClick={() => { void copyTrace(); }}>{copyState === 'copied' ? '已复制' : LABELS.report}</button> : null}
    </div>
    {actions.some(action => action === 'retry') && retryBlockedReason ? <p id="retry-blocked-reason" className="mt-1 text-xs text-red-900">{retryBlockedReason}</p> : null}
    {copyState === 'copied' ? <p role="status" className="mt-1 text-xs">已复制诊断编号</p> : null}
    {copyState === 'failed' ? <p role="status" className="mt-1 text-xs">复制失败，请手动选择诊断编号</p> : null}
  </section>;
}
