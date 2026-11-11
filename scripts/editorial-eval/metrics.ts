import type {EvalCase,CaseResult,Recipe} from './replay';
import {evaluateAssertion,observedExecution} from './observations';
export function caseMetrics(c:EvalCase,r:CaseResult,recipe?:Recipe){
 const assertions=c.oracle.checks.map(check=>{const rule=recipe?.assertions?.find(a=>a.checkId===check.id);const result=rule?evaluateAssertion(r,rule):undefined;return {...check,status:result?(result.pass?'pass':'fail'):'unreviewed',evidence:{runId:r.runId,trial:r.trial,tracePath:r.id+'-'+r.trial+'.json',checkpointHashes:r.checkpoints.map(c=>c.hash),actual:result?.actual,observed:result?.exists??false}};});
 const fixtureError=r.modelFailures?.some(f=>f.kind==='fixture')||r.error?.startsWith('fixture_error:')||(r.outcome&&'reason'in r.outcome&&r.outcome.reason.startsWith('fixture_error:'));
 const required=assertions.filter(a=>a.required),executed=observedExecution(r);
 const status=r.execution?.trialStatus==='not_run'?'NOT_RUN':fixtureError?'fixture_error':r.modelFailures?.some(f=>f.kind==='service')||r.error||r.outcome?.type==='failed'||required.some(a=>a.status==='fail')?'FAIL':r.cancelled&&!executed?'CANCELLED':!executed||r.operatorPlanRequired||r.unappliedFollowups||!required.length||required.some(a=>a.status==='unreviewed')?'NEEDS_REVIEW':'PASS';
 return {id:c.id,runId:r.runId,trial:r.trial,status,actualOutcome:r.outcome?.type??(r.execution?.restorationObserved?'restored':r.cancelled?'cancelled':'not_observed'),executionStatus:r.execution?.trialStatus??'not_observed',modelCalls:r.modelCalls,legacyModelCalls:r.legacyModelCalls,assertions};
}
export function groupedMetrics(rows:ReturnType<typeof caseMetrics>[]){return {total:rows.length,counts:Object.fromEntries(['PASS','FAIL','fixture_error','NEEDS_REVIEW','NOT_RUN','CANCELLED'].map(s=>[s,rows.filter(r=>r.status===s).length])),modelCalls:rows.reduce((a,r)=>a+r.modelCalls,0),legacyModelCalls:rows.every(r=>r.legacyModelCalls===null)?null:rows.reduce((a,r)=>a+(r.legacyModelCalls??0),0)};}
