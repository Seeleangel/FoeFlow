import {it,expect,vi,afterEach} from 'vitest';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {main} from '../run';
import {runCase,StageReplay,type EvalCase,type Recipe} from '../replay';
import {caseMetrics} from '../metrics';
import {caseHash,type ApprovedCaseProtocol} from '../authority';
import {uiReady} from '../../../src/lib/__tests__/editorialUiFixture';
afterEach(()=>vi.restoreAllMocks());
const frozen=():EvalCase=>({id:'RECOVERY',input:{initial_message:'Write a public note.',fixtures:[],followups:[{after:'first attempt ends',message:'Keep the original task and try again.'}],operator_events:[]},oracle:{end_state:'pending',checks:[{id:'draft',criterion:'A final draft is observed',required:true,evidence:'outcome'}]}});
async function wire(){return JSON.parse(await readFile('scripts/editorial-eval/fixtures/smoke-v2.recipe.json','utf8')).SAMPLE01.responses;}
const followup=(c:EvalCase)=>({type:'message' as const,text:c.input.followups[0].message,source:{kind:'followup' as const,index:0}});
async function cli(c:EvalCase,recipe:Recipe,protocol?:ApprovedCaseProtocol){
 const d=await mkdtemp('.git/sticky-failures-'),bytes=JSON.stringify(c)+'\n';await writeFile(d+'/cases.jsonl',bytes);await writeFile(d+'/recipe.json',JSON.stringify({[c.id]:recipe}));const args=['--mock','--cases',d+'/cases.jsonl','--recipe',d+'/recipe.json','--out',d+'/out'];
 if(protocol){const approval=JSON.stringify({schemaVersion:1,caseFileSha256:createHash('sha256').update(bytes).digest('hex'),approvedBy:protocol.approvedBy,approvalRef:protocol.approvalRef,cases:{[c.id]:protocol}});await writeFile(d+'/protocol.json',approval);args.push('--allow-acceptance','--protocol',d+'/protocol.json','--protocol-sha256',createHash('sha256').update(approval).digest('hex'));}
 const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('test_network_forbidden'));vi.spyOn(console,'log').mockImplementation(()=>{});
 const summary=await main(args,{});if(!('counts'in summary))throw Error('expected_mock_summary');const artifact=JSON.parse(await readFile(d+'/out/'+c.id+'-1.json','utf8')),persisted=JSON.parse(await readFile(d+'/out/summary.json','utf8'));expect(fetch).not.toHaveBeenCalled();return {summary,artifact,persisted};
}
it.each([false,true])('CLI keeps missing repair fixture sticky after an actual successful followup, later action failure=%s',async badAction=>{
 const c=frozen(),s=await wire();if(badAction)c.input.operator_events=[{kind:'editor_action',action:{type:'verify',criterionId:'not-a-criterion'}}];const recipe:Recipe={actions:[followup(c),...(badAction?[{type:'verify' as const,criterionId:'not-a-criterion',source:{kind:'operator' as const,index:0}}]:[])],assertions:[{checkId:'draft',path:'outcome.type',op:'equals',value:'draft'}],responses:{preflight:[s.preflight[0],'{"factPatch":{}}'],decide:[s.decide[0],s.decide[0],s.decide[1]],write:['{',s.write[0]],review:s.review}};
 const {summary,artifact,persisted}=await cli(c,recipe);expect(artifact.outcome.type).toBe('draft');expect(artifact.modelCalls).toBe(9);expect(artifact.metrics.status).toBe('fixture_error');expect(summary.counts.fixture_error).toBe(1);expect(summary.counts.PASS).toBe(0);expect(persisted.counts.fixture_error).toBe(1);expect(artifact.modelFailures).toContainEqual(expect.objectContaining({stage:'repair',kind:'fixture',code:'fixture_error:repair',turn:1}));expect(artifact.trace).toContainEqual(expect.objectContaining({type:'model_failure',stage:'repair',code:'fixture_error:repair'}));
});
it('historical candidate cannot hide an actually missing write fixture by later successful review',async()=>{
 const c=frozen(),s=await wire(),protocol:ApprovedCaseProtocol={caseSha256:caseHash(c),kind:'historical',approvedBy:'independent test editor',approvalRef:'synthetic historical approval',initialSession:uiReady('history'),steps:{}};
 const {summary,artifact}=await cli(c,{actions:[followup(c)],assertions:[{checkId:'draft',path:'outcome.type',op:'equals',value:'draft'}],responses:{preflight:['{"factPatch":{}}','{"factPatch":{}}'],decide:[s.decide[0],s.decide[1]],review:s.review}},protocol);
 expect(artifact.outcome.type).toBe('draft');expect(summary.counts.fixture_error).toBe(1);expect(summary.counts.PASS).toBe(0);expect(artifact.modelFailures).toContainEqual(expect.objectContaining({stage:'write',kind:'fixture',code:'fixture_error:write'}));
});
it('ordinary successful product syntax repair is not an infrastructure failure',async()=>{
 const c=frozen(),s=await wire();c.input.followups=[];const {summary,artifact}=await cli(c,{assertions:[{checkId:'draft',path:'outcome.type',op:'equals',value:'draft'}],responses:{...s,write:['{'],repair:[s.write[0]]}});expect(artifact.outcome.type).toBe('draft');expect(summary.counts.PASS).toBe(1);expect(artifact.error).toBeUndefined();
});
it('service failures remain failed trials even when the product recovers on a later authorized turn',async()=>{
 const c=frozen(),s=await wire(),recipe:Recipe={actions:[followup(c)],assertions:[{checkId:'draft',path:'outcome.type',op:'equals',value:'draft'}]},q=new StageReplay({preflight:[{error:'HTTP_502'},s.preflight[0]],decide:s.decide,write:s.write,review:s.review});const r=await runCase(c,{mode:'mock',model:q.call,runId:'service-recovery',trial:1,recipe});expect(r.outcome?.type).toBe('draft');expect(caseMetrics(c,r,recipe).status).toBe('FAIL');expect(r.modelFailures).toContainEqual(expect.objectContaining({kind:'service',code:'HTTP_502'}));
});

it('a later cancellation does not downgrade an earlier fixture error',async()=>{
 const c=frozen(),s=await wire();c.input.operator_events=[{kind:'editor_action',action:{type:'cancel',afterCalls:5}}];const recipe:Recipe={actions:[followup(c),{type:'cancel',afterCalls:5,source:{kind:'operator',index:0}}],assertions:[{checkId:'draft',path:'cancelled',op:'equals',value:true}]};const q=new StageReplay({preflight:[s.preflight[0]],decide:[s.decide[0]],write:['{']});const r=await runCase(c,{mode:'mock',model:q.call,runId:'cancel-after-fixture',trial:1,recipe});expect(r.cancelled).toBe(true);expect(caseMetrics(c,r,recipe).status).toBe('fixture_error');
});
