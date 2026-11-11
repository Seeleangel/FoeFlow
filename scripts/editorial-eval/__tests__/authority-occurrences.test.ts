import {it,expect,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {runCase,type EvalAction,type EvalCase} from '../replay';
import {caseHash,type ApprovedCaseProtocol} from '../authority';
import {caseMetrics} from '../metrics';
const grant='Permission to publish the asset is granted.',withdraw='That permission is withdrawn.';
const message=(text:string):EvalAction=>({type:'message',text});
const followup=(index:number)=>({kind:'followup' as const,index});
const operator=(index:number)=>({kind:'operator' as const,index});
const translated=(step:string)=>({kind:'protocol' as const,step});
function scenario(kind:'followup'|'structured'|'prose'){
 const c:EvalCase={id:'OCCURRENCE',input:{initial_message:'Write a public note.',fixtures:[],followups:kind==='followup'?[{after:'editor reply',message:grant},{after:'later editor reply',message:withdraw}]:[],operator_events:kind==='structured'?[{kind:'editor_action',action:message(grant)},{kind:'editor_action',action:message(withdraw)}]:kind==='prose'?['Editor grants permission, then withdraws it.']:[]},oracle:{end_state:'draft',checks:[{id:'draft',criterion:'Observed a draft',required:true,evidence:'outcome'}]}};
 const origin=kind==='followup'?followup:operator;const p:ApprovedCaseProtocol={caseSha256:caseHash(c),kind:'agent',approvedBy:'independent synthetic editor',approvalRef:'frozen occurrence approval',steps:{grantA:message(grant),grantB:message(grant),withdrawal:message(withdraw)},bindings:{grantA:origin(0),grantB:origin(0),withdrawal:origin(kind==='prose'?0:1)}};return {c,p,origin};
}
async function cleanModel(){
 const wire=JSON.parse(await readFile('scripts/editorial-eval/fixtures/smoke-v2.recipe.json','utf8')).SAMPLE01.responses;
 return vi.fn(async({stage,data}:Parameters<import('../../../src/lib/editorialController').EditorialModelPort>[0])=>{
  if(stage==='preflight')return (data.task as {revision:number}).revision===0?wire.preflight[0]:'{"factPatch":{}}';
  if(stage==='decide')return data.draft?wire.decide[1]:wire.decide[0];
  if(stage==='write')return wire.write[0];if(stage==='review')return wire.review[0];throw Error('fixture_error:'+stage);
 });
}
const recipe=(actions:EvalAction[])=>({actions,assertions:[{checkId:'draft',path:'outcome.type',op:'equals' as const,value:'draft'}]});
it.each(['followup','structured'] as const)('direct/protocol %s grant aliases cannot replay after withdrawal',async kind=>{
 const {c,p,origin}=scenario(kind),model=await cleanModel();const actions=[{...message(grant),source:origin(0)},{...message(withdraw),source:origin(1)},{...message(grant),source:translated('grantA')}];await expect(runCase(c,{mode:'mock',model,runId:'alias',trial:1,recipe:recipe(actions),approvedProtocol:p})).rejects.toThrow('duplicate_editor_step');expect(model).not.toHaveBeenCalled();
});
it.each(['followup','structured','prose'] as const)('two bound %s protocol aliases consume one grant occurrence, even across withdrawal',async kind=>{
 const {c,p}=scenario(kind),model=await cleanModel();const actions=[{...message(grant),source:translated('grantA')},{...message(withdraw),source:translated('withdrawal')},{...message(grant),source:translated('grantB')}];await expect(runCase(c,{mode:'mock',model,runId:'alias',trial:1,recipe:recipe(actions),approvedProtocol:p})).rejects.toThrow('duplicate_editor_step');expect(model).not.toHaveBeenCalled();
});
it('ignored metadata cannot create another compound prose grant occurrence',async()=>{
 const {c,p}=scenario('prose'),model=await cleanModel();p.steps.grantB=Object.assign(message(grant),{annotation:'alternate label'});const actions=[{...p.steps.grantA,source:translated('grantA')},{...p.steps.withdrawal,source:translated('withdrawal')},{...p.steps.grantB,source:translated('grantB')}];await expect(runCase(c,{mode:'mock',model,runId:'alias',trial:1,recipe:recipe(actions),approvedProtocol:p})).rejects.toThrow('duplicate_editor_step');expect(model).not.toHaveBeenCalled();
});
it('reverse protocol/direct aliases also reject before any dispatch',async()=>{
 const {c,p}=scenario('followup'),model=await cleanModel();await expect(runCase(c,{mode:'mock',model,runId:'alias',trial:1,recipe:recipe([{...message(grant),source:translated('grantA')},{...message(withdraw),source:followup(1)},{...message(grant),source:followup(0)}]),approvedProtocol:p})).rejects.toThrow('duplicate_editor_step');expect(model).not.toHaveBeenCalled();
});
it('one translated representation consumes each original occurrence exactly once',async()=>{
 const {c,p}=scenario('followup'),r=await runCase(c,{mode:'mock',model:await cleanModel(),runId:'valid',trial:1,recipe:recipe([{...message(grant),source:translated('grantA')},{...message(withdraw),source:followup(1)}]),approvedProtocol:p});expect(r.error).toBeUndefined();expect(r.unappliedFollowups).toBe(0);expect(r.outcome?.session.evidence.filter(e=>e.text===grant)).toHaveLength(1);expect(r.outcome?.session.evidence.at(-1)?.text).toBe(withdraw);
});
it('an explicitly approved additional unbound protocol occurrence is distinct from a consumed original',async()=>{
 const {c,p}=scenario('followup');p.steps.newGrantAfterWithdrawal=message(grant);const r=await runCase(c,{mode:'mock',model:await cleanModel(),runId:'additional',trial:1,recipe:recipe([{...message(grant),source:followup(0)},{...message(withdraw),source:followup(1)},{...message(grant),source:translated('newGrantAfterWithdrawal')}]),approvedProtocol:p});expect(r.error).toBeUndefined();expect(r.unappliedFollowups).toBe(0);expect(r.outcome?.session.evidence.filter(e=>e.text===grant)).toHaveLength(2);expect(r.outcome?.session.evidence.at(-1)?.text).toBe(grant);
});
it('a compound prose operator supports distinct approved subactions without erasing a missing withdrawal',async()=>{
 const {c,p}=scenario('prose'),actions=[{...message(grant),source:translated('grantA')},{...message(withdraw),source:translated('withdrawal')}];const options={mode:'mock' as const,model:await cleanModel(),runId:'compound',trial:1,approvedProtocol:p};const complete=await runCase(c,{...options,recipe:recipe(actions)});expect(complete.error).toBeUndefined();expect(complete.operatorPlanRequired).toBe(false);expect(caseMetrics(c,complete,recipe(actions)).status).toBe('PASS');const partial=await runCase(c,{...options,recipe:recipe(actions.slice(0,1))});expect(partial.operatorPlanRequired).toBe(true);expect(caseMetrics(c,partial,recipe(actions.slice(0,1))).status).toBe('NEEDS_REVIEW');
});
