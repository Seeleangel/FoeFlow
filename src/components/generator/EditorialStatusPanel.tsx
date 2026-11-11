import type { EditorialSession } from '@/lib/editorialTypes';
import { editorialStopExplanation } from '@/lib/editorialStatus';
import { deriveGaps } from '@/lib/editorialGaps';
export function EditorialStatusPanel({session:s,onWaiveSource,onVerify,onSelectOutput,onResolveDiagnostic,disabled=false}:{session:EditorialSession;onWaiveSource?:(id:string)=>void;onVerify?:(id:string)=>void;onResolveDiagnostic?:(owner:string)=>void;onSelectOutput?:(output:'candidate'|'committed'|'legacy')=>void;disabled?:boolean}) {
 const notes=[...new Map([...(s.editorialNotes??[]),...(s.candidate?.editorialNotes??[]),...(s.review?.notes??[])].map(n=>[n.text,n])).values()];
 const gaps=[...new Map([...s.gaps,...deriveGaps(s)].map(g=>[g.id,g])).values()].filter(g=>g.state!=='resolved');
 return <aside aria-label="编辑状态与备注" className="space-y-3 rounded-xl border bg-stone-50 p-4 text-sm">
  <p role="status" className="font-semibold">{s.selectedOutput==='committed'?'正在查看原确认稿':s.selectedOutput==='legacy'?'正在查看历史确认稿':editorialStopExplanation(s)}</p>
  {s.lastStop?.nextActions.map((a,i)=><p key={i}>{a}</p>)}
  {s.committed?.confirmation && <button disabled={disabled} onClick={()=>onSelectOutput?.('committed')}>查看原确认稿</button>}
  {s.legacy?.confirmed && <button disabled={disabled} onClick={()=>onSelectOutput?.('legacy')}>查看历史确认稿</button>}
  {s.candidate && <button disabled={disabled} onClick={()=>onSelectOutput?.('candidate')}>查看当前候选稿</button>}
  {notes.length>0 && <section><h3>编辑备注（不进入公开输出）</h3><ul>{notes.map(n=><li key={n.id}>{n.text}</li>)}</ul></section>}
  {gaps.length>0 && <section><h3>待补事项</h3><ul>{gaps.map(g=><li key={g.id}>{g.label}：{g.reason}（{g.state}）{g.kind==='source_unavailable' && g.state!=='waived' && onWaiveSource && <button disabled={disabled} onClick={()=>onWaiveSource(g.requirementId)}>明确豁免此指定来源</button>}</li>)}</ul></section>}
  <section><h3>素材状态</h3><ul>{s.candidate?.assets.map(a=><li key={a.slotId}>{s.scopes.find(x=>x.id===a.assetId)?.label??a.assetId}：{a.state}；{s.permissions.filter(p=>p.subjectId===a.assetId).map(p=>p.state).join('、')||'未确认授权'}（不会自动插入图片）</li>)}</ul></section>
  {s.task.sourceWaivers.length>0 && <section><h3>编辑来源豁免</h3><ul>{s.task.sourceWaivers.map(w=><li key={w.sourceRequirementId}>{s.task.requiredSources.find(x=>x.id===w.sourceRequirementId)?.selector.title??w.sourceRequirementId}：{w.reason}</li>)}</ul></section>}
  {s.diagnostics.filter(d=>d.owner && d.owner!=='compatibility').map(d=><p key={d.owner+':'+d.code}>{d.owner}：{d.message}{onResolveDiagnostic && <button disabled={disabled} onClick={()=>onResolveDiagnostic(d.owner!)}>编辑明确处理此诊断</button>}</p>)}
  {s.task.criteria.filter(c=>c.verification==='human'&&!s.humanVerifications.some(v=>v.criterionId===c.id&&v.status==='pass')).map(c=><p key={c.id}>人工待核：{c.rule.kind==='semantic'?c.rule.instruction:c.id}{onVerify&&<button disabled={disabled} onClick={()=>onVerify(c.id)}>编辑已核实此项</button>}</p>)}
 </aside>;
}
