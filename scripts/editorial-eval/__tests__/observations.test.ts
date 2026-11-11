import {it,expect,vi} from 'vitest';
import {evaluateAssertion} from '../observations';
import {caseMetrics} from '../metrics';
import {parseRecipes,runCase,type EvalCase} from '../replay';
import {main} from '../run';
import {createEditorialSession,hashText,stableJson} from '../../../src/lib/editorialTypes';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
const c:EvalCase={id:'OBS',input:{initial_message:null,fixtures:[],followups:[],operator_events:[]},oracle:{end_state:'restored',checks:[{id:'required',criterion:'Observe execution',required:true,evidence:'actual'}]}};
const empty={id:'OBS',runId:'r',trial:1,cancelled:false,modelCalls:0,legacyModelCalls:null,trace:[],outputs:[],checkpoints:[],privateSpans:[],operatorPlanRequired:false,unappliedFollowups:0};
it('missing observation and omitted expected operand cannot pass the zero-call counterexample',()=>{const m=caseMetrics(c,empty,{assertions:[{checkId:'required',path:'outcome.session.didNotExecute',op:'equals'}]});expect(m.status).not.toBe('PASS');expect(m.assertions[0].status).not.toBe('pass');expect(()=>parseRecipes({OBS:{assertions:[{checkId:'required',path:'outcome.type',op:'equals'}]}})).toThrow('assertion_operand')});
it('missing own paths fail even against explicit null; static/unsafe paths and duplicate checks reject',()=>{
 expect(caseMetrics(c,empty,{assertions:[{checkId:'required',path:'outcome.type',op:'equals',value:null}]}).assertions[0].status).toBe('fail');
 for(const path of ['id','outcome.__proto__.polluted','unknown.field'])expect(()=>parseRecipes({OBS:{assertions:[{checkId:'required',path,op:'equals',value:null}]}})).toThrow('assertion_path');
 expect(()=>parseRecipes({OBS:{assertions:[{checkId:'required',path:'error',op:'equals',value:null},{checkId:'required',path:'error',op:'equals',value:null}]}})).toThrow('duplicate_assertion');
});
it('zero-action agent plans never pass; a declared approved restoration observes actual decoded state',async()=>{
 const session=createEditorialSession('restore');const approved={caseSha256:hashText(stableJson(c)),kind:'restoration' as const,approvedBy:'editor',approvalRef:'review',initialSession:session,steps:{}};
 const r=await runCase(c,{mode:'mock',model:async()=>{throw Error('none')},runId:'r',trial:1,approvedProtocol:approved});
 expect(caseMetrics(c,r,{assertions:[{checkId:'required',path:'restoration.phase',op:'equals',value:session.phase}]}).status).toBe('PASS');expect(caseMetrics(c,empty,{assertions:[{checkId:'required',path:'modelCalls',op:'equals',value:0}]}).status).not.toBe('PASS');
});
it('unknown check IDs and empty required-operator plans cannot be reported as satisfied',async()=>{
 const x={...c,input:{...c.input,initial_message:'Write.',operator_events:[{kind:'editor_action',action:{type:'confirm'}}]}};await expect(runCase(x,{mode:'mock',model:async()=>'',runId:'r',trial:1,recipe:{assertions:[{checkId:'not-in-frozen-oracle',path:'modelCalls',op:'equals',value:0}]}})).rejects.toThrow('unknown_check_id');
 const r=await runCase(x,{mode:'mock',model:async()=>{throw Error('stopped')},runId:'r',trial:1,recipe:{actions:[]}});expect(r.operatorPlanRequired).toBe(true);
});
it('cancellation before a required output records the skipped action and cannot PASS a cancellation-only assertion',async()=>{
 const actions=[{type:'cancel',afterCalls:1},{type:'copy'}];const x={...c,input:{...c.input,initial_message:'Write.',operator_events:actions.map(action=>({kind:'editor_action',action}))}};const r=await runCase(x,{mode:'mock',model:async()=>'',runId:'r',trial:1,recipe:{actions:actions.map((a,index)=>({...a,source:{kind:'operator',index}})) as never}});expect(r.execution?.actions[1].status).toBe('skipped');expect(caseMetrics(x,r,{assertions:[{checkId:'required',path:'cancelled',op:'equals',value:true}]}).status).not.toBe('PASS');
});
it('interruption preserves every planned case/trial row and denominator',async()=>{
 const dir=await mkdtemp('.git/trial-ledger-');const first={...c,input:{...c.input,initial_message:'Write.'}};await writeFile(dir+'/cases.jsonl',[first,{...first,id:'OBS2'}].map(x=>JSON.stringify(x)).join('\n'));const abort=new AbortController();const fetchSpy=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>{abort.abort();return new Response('',{status:502})});const log=vi.spyOn(console,'log').mockImplementation(()=>{});
 try{const result=await main(['--real','--cases',dir+'/cases.jsonl','--trials','2','--out',dir+'/out'],{FOEFLOW_API_KEY:'fake-only'}, {signal:abort.signal});expect('total'in result&&result.total).toBe(4);const skipped=JSON.parse(await readFile(dir+'/out/OBS2-2.json','utf8'));expect(skipped.execution.trialStatus).toBe('not_run');expect(skipped.metrics.status).not.toBe('PASS')}finally{fetchSpy.mockRestore();log.mockRestore()}
});

it('observed explicit null is distinct from a missing property',()=>{expect(evaluateAssertion({outputs:[{output:null}]},{checkId:'c',path:'outputs.0.output',op:'equals',value:null})).toEqual({pass:true,actual:null,exists:true});expect(evaluateAssertion({outputs:[{}]},{checkId:'c',path:'outputs.0.output',op:'equals',value:null}).pass).toBe(false)});
