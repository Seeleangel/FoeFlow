import { useState } from 'react';
import { Check } from 'lucide-react';
import type { AnswerChoice, QuestionBatch } from '@/lib/editorialTypesV3';
export interface QuestionAnswerSlot { gapId: string; optionId?: string; value?: string; choice?: AnswerChoice }
export function QuestionBatchCard({ batch, disabled = false, processing = false, onSubmit }: { batch: QuestionBatch; disabled?: boolean; processing?: boolean; onSubmit: (payload: { batchId: string; slots: QuestionAnswerSlot[] }) => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [selectedOptionId, setSelectedOptionId] = useState<Record<string, string>>({});
  const [declined, setDeclined] = useState<Record<string, boolean>>({});
  const slots: QuestionAnswerSlot[] = batch.items.flatMap((item): QuestionAnswerSlot[] => {
    if (declined[item.gapId]) return [{ gapId: item.gapId, choice: 'defer' as const }];
    const optionId = selectedOptionId[item.gapId];
    if (optionId) {
      const option = item.options?.find(candidate => candidate.id === optionId);
      if (option) return [{ gapId: item.gapId, optionId, choice: option.choice ?? 'supply' }];
    }
    const value = (values[item.gapId] ?? '').trim();
    return value ? [{ gapId: item.gapId, value }] : [];
  });
  const hint = processing
    ? '正在处理，提交暂不可用'
    : !slots.length ? '至少回答一项，或选择「无法提供」后才能提交' : '';
  const toggleOption = (gapId: string, optionId: string) => {
    setDeclined(current => ({ ...current, [gapId]: false }));
    setSelectedOptionId(current => ({ ...current, [gapId]: current[gapId] === optionId ? '' : optionId }));
  };
  const toggleDeclined = (gapId: string) => {
    setSelectedOptionId(current => ({ ...current, [gapId]: '' }));
    setDeclined(current => ({ ...current, [gapId]: !current[gapId] }));
  };
  return <section aria-label="待回答的问题批次" className="flex min-h-0 max-h-full flex-col rounded-xl border bg-stone-50 p-3 text-sm">
    <div className="shrink-0">
      <h3 className="font-semibold">{batch.intake ? '请先明确任务' : '请补充以下信息'}</h3>
      {batch.understood?.length ? <p className="mt-1 text-xs text-stone-600">已了解：{batch.understood.join('、')}</p> : null}
    </div>
    <ol role="group" aria-label="问题列表（可滚动）" tabIndex={0} className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400">
      {batch.items.map((item, index) => {
        const titleId = `batch-item-title-${batch.id}-${index}`;
        return <li key={item.gapId} id={'batch-item-' + item.gapId} data-gap-id={item.gapId} tabIndex={-1} className="rounded-lg border border-stone-200 bg-white p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400">
          <p id={titleId} className="font-medium">{index + 1}. {item.subject}：{item.requested}</p>
          <p className="text-xs text-stone-600">{item.why}</p>
          {item.options?.length ? <div role="group" aria-labelledby={titleId} className="mt-2 flex flex-wrap gap-1.5">{item.options.map(option => {
            const selected = selectedOptionId[item.gapId] === option.id;
            return <button key={option.id} type="button" aria-pressed={selected} disabled={disabled} onClick={() => toggleOption(item.gapId, option.id)}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-sm ${selected ? 'border-red-600 bg-red-50 font-medium text-red-800 ring-1 ring-red-600' : 'border-stone-300 bg-white text-stone-700'}`}>
              {selected && <Check className="size-4" aria-hidden="true" />}{option.label}
            </button>;
          })}</div>
            : <input aria-label={item.requested} className="mt-2 min-h-11 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" disabled={disabled || declined[item.gapId]} value={values[item.gapId] ?? ''} onChange={event => setValues(current => ({ ...current, [item.gapId]: event.target.value }))} />}
          <button type="button" aria-pressed={!!declined[item.gapId]} disabled={disabled} onClick={() => toggleDeclined(item.gapId)}
            className={`mt-2 inline-flex min-h-11 items-center rounded-lg border px-3 text-sm ${declined[item.gapId] ? 'border-amber-600 bg-amber-50 text-amber-900' : 'border-stone-300 bg-white text-stone-700'}`}>{declined[item.gapId] ? '取消「无法提供」' : '无法提供'}</button>
        </li>;
      })}
    </ol>
    <div className="shrink-0 pt-2">
      <button type="button" className="h-11 w-full rounded-lg bg-stone-900 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-500" disabled={disabled || processing || !slots.length} aria-describedby="batch-submit-hint" onClick={() => onSubmit({ batchId: batch.id, slots })}>提交回答</button>
      {hint ? <p id="batch-submit-hint" className="mt-1 text-xs text-stone-600">{hint}</p> : <span id="batch-submit-hint" className="sr-only">提交回答</span>}
    </div>
  </section>;
}
