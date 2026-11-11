import type {EvalCase,CaseResult,Recipe} from './replay';
export function caseMetrics(c:EvalCase,r:CaseResult,recipe?:Recipe){
 const assertions=c.oracle.checks.map(check=>{
  const rule=recipe?.assertions?.find(a=>a.checkId===check.id);let status:'pass'|'fail'|'unreviewed'='unreviewed';let actual:unknown;
  if(rule){actual=rule.path.split('.').reduce<unknown>((v,k)=>v&&typeof v==='object'?(v as Record<string,unknown>)[k]:undefined,r);const expected=rule.value;
   const pass=rule.op==='equals'?JSON.stringify(actual)===JSON.stringify(expected):rule.op==='includes'?typeof actual==='string'&&actual.includes(String(expected)):rule.op==='not_includes'?typeof actual==='string'&&!actual.includes(String(expected)):actual!==undefined&&actual!==null&&String(actual).length>0;
   status=pass?'pass':'fail';}
  return {...check,status,evidence:{runId:r.runId,trial:r.trial,tracePath:r.id+'-'+r.trial+'.json',checkpointHashes:r.checkpoints.map(c=>c.hash),actual}};
 });
 const fixtureError=r.error?.startsWith('fixture_error:')||(r.outcome&&'reason'in r.outcome&&r.outcome.reason.startsWith('fixture_error:'));
 const required=assertions.filter(a=>a.required);
 const status=fixtureError?'fixture_error':r.error||r.outcome?.type==='failed'||required.some(a=>a.status==='fail')?'FAIL':r.operatorPlanRequired||r.unappliedFollowups||!required.length||required.some(a=>a.status==='unreviewed')?'NEEDS_REVIEW':'PASS';
 return {id:c.id,runId:r.runId,trial:r.trial,status,actualOutcome:r.outcome?.type??(r.cancelled?'cancelled':'error'),modelCalls:r.modelCalls,legacyModelCalls:r.legacyModelCalls,assertions};
}
export function groupedMetrics(rows:ReturnType<typeof caseMetrics>[]){return {total:rows.length,counts:Object.fromEntries(['PASS','FAIL','fixture_error','NEEDS_REVIEW'].map(s=>[s,rows.filter(r=>r.status===s).length])),modelCalls:rows.reduce((a,r)=>a+r.modelCalls,0),legacyModelCalls:rows.every(r=>r.legacyModelCalls===null)?null:rows.reduce((a,r)=>a+(r.legacyModelCalls??0),0)};}
