import type { EditorialSession } from '@/lib/editorialTypes';
import { gateEffectOf } from '@/lib/editorialTypes';
import type { StopAction } from '@/lib/editorialTypesV3';
import { editorialStopExplanation } from '@/lib/editorialStatus';
import { deriveGaps } from '@/lib/editorialGaps';
import { deriveFailureView } from '@/lib/editorialFailure';
import { ASSET_STATE_LABEL, PERMISSION_STATE_LABEL, formatConstraint, formatGapReason, gapStateLabel, hasCjk } from '@/lib/editorialDisplay';
import { EditorialFailureCard } from './EditorialFailureCard';

const SECTION = 'rounded-lg border border-stone-200 bg-white p-3';
const HEADING = 'text-sm font-semibold text-stone-900';
const BODY = 'mt-1.5 text-sm text-stone-700';
const MINOR = 'text-xs text-stone-600';
const BADGE = 'ml-2 rounded-full border border-stone-300 px-2 py-0.5 text-xs font-normal text-stone-600';

export function EditorialStatusPanel({ session: s, onWaiveSource, onVerify, onSelectOutput, onResolveDiagnostic, onStopAction, retryBlockedReason, disabled = false, canConfirm = false }: {
  session: EditorialSession; onWaiveSource?: (id: string) => void; onVerify?: (id: string) => void;
  onResolveDiagnostic?: (owner: string) => void; onSelectOutput?: (output: 'candidate' | 'committed' | 'legacy') => void;
  onStopAction: (action: StopAction) => void; retryBlockedReason?: string; disabled?: boolean; canConfirm?: boolean;
}) {
  const notes = [...new Map([...(s.editorialNotes ?? []), ...(s.candidate?.editorialNotes ?? []), ...(s.review?.notes ?? [])].map(note => [note.text, note])).values()];
  const allGaps = [...new Map([...s.gaps, ...deriveGaps(s)].map(gap => [gap.id, gap])).values()];
  const gaps = allGaps.filter(gap => gap.state !== 'resolved' && gap.state !== 'waived' && gap.askable !== false && (gap.gapClass === undefined || gap.gapClass === 'fact' || gap.gapClass === 'authorization'));
  const visibleGaps = allGaps.filter(gap => gap.gapClass !== 'internal');
  const deliveryConstraints = visibleGaps.filter(gap => gap.gapClass === 'constraint' && (gap.state === 'unmet' || gap.state === 'blocked_by_constraint'));
  const failure = deriveFailureView(s);
  const editorDecisions = [...(s.gapDecisions ?? [])].filter(decision => decision.kind === 'defer' || decision.kind === 'deny' || decision.kind === 'omit');
  const decisionText = (kind: string) => kind === 'deny' ? '编辑不允许使用该素材' : kind === 'omit' ? '编辑选择省略该项' : '编辑已知悉并选择继续';
  return <aside aria-label="编辑状态与备注" className="space-y-2 rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm">
    {failure.stop
      ? <EditorialFailureCard stop={failure.stop} candidateRevision={s.candidate?.revision} onAction={onStopAction} retryBlockedReason={retryBlockedReason} disabled={disabled} canConfirm={canConfirm} />
      : <p role="status" className="font-semibold">{s.selectedOutput === 'committed' ? '正在查看原确认稿' : s.selectedOutput === 'legacy' ? '正在查看历史确认稿' : editorialStopExplanation(s)}</p>}
    {(s.committed?.confirmation || s.legacy?.confirmed || s.candidate) && <div className={`${SECTION} flex flex-wrap gap-2`}>
      {s.committed?.confirmation && <button disabled={disabled} onClick={() => onSelectOutput?.('committed')}>查看原确认稿</button>}
      {s.legacy?.confirmed && <button disabled={disabled} onClick={() => onSelectOutput?.('legacy')}>查看历史确认稿</button>}
      {s.candidate && <button disabled={disabled} onClick={() => onSelectOutput?.('candidate')}>查看当前候选稿</button>}
    </div>}
    {notes.length > 0 && <section className={SECTION}>
      <h3 className={HEADING}>编辑备注（不进入公开输出）</h3>
      <ul className={`${BODY} list-disc space-y-1 pl-5 break-words`}>{notes.map(note => <li key={note.id}>{note.text}</li>)}</ul>
    </section>}
    {gaps.length > 0 && <section className={SECTION}>
      <h3 className={HEADING}>待补事项</h3>
      <ul className={`${BODY} space-y-1`}>{gaps.map(gap => <li key={gap.id} id={'gap-row-' + gap.id} tabIndex={-1} className="rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400">
        <span className="font-medium">{gap.label}</span>：{formatGapReason(gap)}<span className={BADGE}>{gapStateLabel(gap.state)}</span>
        {gap.kind === 'source_unavailable' && gap.state !== 'waived' && onWaiveSource && <button disabled={disabled} className="ml-2 underline" onClick={() => onWaiveSource(gap.requirementId)}>明确豁免此指定来源</button>}
      </li>)}</ul>
    </section>}
    {deliveryConstraints.length > 0 && <section className={SECTION}>
      <h3 className={HEADING}>交付约束</h3>
      <ul className={`${BODY} space-y-1`}>{deliveryConstraints.map(gap => {
        const display = formatConstraint(gap);
        return <li key={gap.id}>
          <span className="font-medium">{display.label}</span>：{display.detail}<span className={BADGE}>{gapStateLabel(gap.state)}</span>
          {display.technical ? <details className={`mt-1 ${MINOR}`}><summary className="cursor-pointer">技术详情</summary><p className="break-words">{display.technical}</p></details> : null}
        </li>;
      })}</ul>
    </section>}
    {editorDecisions.length > 0 && <section className={SECTION}>
      <h3 className={HEADING}>编辑已知悉</h3>
      <ul className={`${BODY} space-y-1`}>{editorDecisions.map(decision => {
        const name = allGaps.find(candidate => candidate.id === decision.gapId)?.label
          ?? s.task.requiredSources.find(source => source.id === decision.gapId)?.selector.title;
        return <li key={decision.id}>{name ? name + '：' : ''}{decisionText(decision.kind)}</li>;
      })}</ul>
    </section>}
    {failure.diagnostics.length > 0 && <section className={SECTION}>
      <h3 className={HEADING}>Agent 诊断</h3>
      <ul className={`${BODY} space-y-1`}>{failure.diagnostics.map((diagnostic, index) => {
        const block = gateEffectOf(diagnostic) === 'block';
        return <li key={(diagnostic.owner ?? 'agent') + ':' + diagnostic.code + ':' + index} className="break-words">
          {hasCjk(diagnostic.message) ? diagnostic.message : 'Agent 报告了一个内部问题'}
          {block && <span className={BADGE}>会阻止成稿</span>}
          <span className={`ml-2 ${MINOR}`}>诊断码：{diagnostic.code}</span>
          {!hasCjk(diagnostic.message) && <details className={MINOR}><summary className="cursor-pointer">技术详情</summary><p>{diagnostic.message}</p></details>}
          {onResolveDiagnostic && diagnostic.owner && <button disabled={disabled} className="ml-2 underline" onClick={() => onResolveDiagnostic(diagnostic.owner!)}>编辑明确处理此诊断</button>}
        </li>;
      })}</ul>
    </section>}
    {!!s.candidate?.assets.length && <section className={SECTION}>
      <h3 className={HEADING}>素材状态</h3>
      <ul className={`${BODY} space-y-1`}>{s.candidate.assets.map(asset => <li key={asset.slotId}>
        {s.scopes.find(scope => scope.id === asset.assetId)?.label ?? asset.assetId}：{ASSET_STATE_LABEL[asset.state] ?? asset.state}；{s.permissions.filter(permission => permission.subjectId === asset.assetId).map(permission => PERMISSION_STATE_LABEL[permission.state] ?? permission.state).join('、') || '未确认授权'}（不会自动插入图片）
      </li>)}</ul>
    </section>}
    {s.task.sourceWaivers.length > 0 && <section className={SECTION}>
      <h3 className={HEADING}>编辑来源豁免</h3>
      <ul className={`${BODY} space-y-1`}>{s.task.sourceWaivers.map(waiver => <li key={waiver.sourceRequirementId}>{s.task.requiredSources.find(source => source.id === waiver.sourceRequirementId)?.selector.title ?? waiver.sourceRequirementId}：{waiver.reason}</li>)}</ul>
    </section>}
    {s.task.criteria.some(criterion => criterion.verification === 'human' && !s.humanVerifications.some(verification => verification.criterionId === criterion.id && verification.status === 'pass')) && <section className={SECTION}>
      <h3 className={HEADING}>人工待核</h3>
      <ul className={`${BODY} space-y-1`}>{s.task.criteria.filter(criterion => criterion.verification === 'human' && !s.humanVerifications.some(verification => verification.criterionId === criterion.id && verification.status === 'pass')).map(criterion => <li key={criterion.id}>
        {criterion.rule.kind === 'semantic' ? criterion.rule.instruction : criterion.id}
        {onVerify && <button disabled={disabled} className="ml-2 underline" onClick={() => onVerify(criterion.id)}>编辑已核实此项</button>}
      </li>)}</ul>
    </section>}
  </aside>;
}
