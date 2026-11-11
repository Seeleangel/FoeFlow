import {it,expect,vi,afterEach} from 'vitest';
import {readFile} from 'node:fs/promises';
import {setImmediate as nextLoop} from 'node:timers/promises';
import {runCase,StageReplay,type EvalCase,type Recipe} from '../replay';
import {realModel} from '../run';
import {caseMetrics} from '../metrics';
import type {EditorialModelPort,EditorialStage} from '../../../src/lib/editorialController';
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const makeCase=():EvalCase=>({id:'SETTLEMENT',input:{initial_message:'Write a public note.',fixtures:[],followups:[{after:'first attempt ends',message:'Keep the original task and try again.'}],operator_events:[]},oracle:{end_state:'pending',checks:[{id:'draft',criterion:'Final draft observed',required:true,evidence:'outcome'}]}});
const plan=(c:EvalCase):Recipe=>({actions:c.input.followups.map((f,index)=>({type:'message',text:f.message,source:{kind:'followup',index}})),assertions:[{checkId:'draft',path:'outcome.type',op:'equals',value:'draft'}]});
async function wire(){return JSON.parse(await readFile('scripts/editorial-eval/fixtures/smoke-v2.recipe.json','utf8')).SAMPLE01.responses;}
async function probe(mode:'direct'|'headers'|'body'){
 const responses=await wire(),c=makeCase(),recipe=plan(c),held=deferred<unknown>(),started=deferred<void>(),q=new StageReplay(responses),records:unknown[]=[];let first=true,aborted=false,stage:EditorialStage='preflight',firstInput:Record<string,unknown>|undefined;
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date']});const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('network_forbidden'));
 const observe=(signal:AbortSignal)=>signal.addEventListener('abort',()=>{aborted=true;},{once:true});
 const payload=(raw:string)=>({id:'synthetic-response',choices:[{message:{content:raw}}]});
 const adapter=realModel({apiUrl:'https://example.test/v1',model:'synthetic',temperature:.2,maxTokens:6000},meta=>records.push(meta),async(_url,init)=>{
  const signal=init?.signal;if(!signal)throw Error('missing_test_signal');const requestStage=stage;
  if(first){first=false;observe(signal);if(mode==='headers'){started.resolve();return await held.promise as Response;}const response=new Response('{}',{headers:{'x-request-id':'synthetic-headers'}});Object.defineProperty(response,'json',{value:()=>{started.resolve();return held.promise;}});return response;}
  return new Response(JSON.stringify(payload(await q.call({stage:requestStage,data:{}},signal))));
 });
 const model:EditorialModelPort=mode==='direct'?async(req,signal)=>{if(first){first=false;firstInput=req.data;observe(signal);started.resolve();return await held.promise as string;}return q.call(req,signal);}:async(req,signal)=>{stage=req.stage;return adapter(req,signal);};
 const pending=runCase(c,{mode:mode==='direct'?'mock':'real',runId:'deferred',trial:1,model,recipe,budget:{maxElapsedMs:40}});await started.promise;await vi.advanceTimersByTimeAsync(41);const result=await pending;
 const release=(ending:'resolve'|'reject')=>ending==='reject'?held.reject(new DOMException('late cleanup','AbortError')):held.resolve(mode==='direct'?responses.preflight[0]:mode==='headers'?new Response(JSON.stringify(payload(responses.preflight[0]))):payload(responses.preflight[0]));
 return {c,recipe,result,records,release,aborted,network,mutateInput:()=>{if(firstInput)(firstInput.task as Record<string,unknown>).objective='late port input mutation';}};
}
for(const mode of ['direct','headers','body'] as const)it.each(['never','resolve','reject'] as const)(mode+' deadline finalization is stable with late %s',async ending=>{
 const p=await probe(mode),before=JSON.stringify(p.result),metadata=JSON.stringify(p.records),status=caseMetrics(p.c,p.result,p.recipe).status;
 if(ending!=='never'){p.release(ending);await nextLoop();await nextLoop();}
 expect(JSON.stringify(p.result)).toBe(before);expect(JSON.stringify(p.records)).toBe(metadata);expect(p.aborted).toBe(true);expect(p.result.outcome?.type).toBe('draft');expect(status).toBe('FAIL');expect(caseMetrics(p.c,p.result,p.recipe).status).toBe(status);expect(p.result.execution?.trialStatus).toBe('failed');expect(p.result.modelFailures).toEqual([expect.objectContaining({stage:'preflight',turn:1,attempt:1,kind:'service',code:'model_port_aborted'})]);expect(p.network).not.toHaveBeenCalled();
 if(mode!=='direct')expect(p.records).toContainEqual(expect.objectContaining({stage:'preflight',status:'aborted'}));
});
it('late rejection retains the originating identity, not the recovered turn and attempt',async()=>{
 const p=await probe('direct');p.release('reject');await nextLoop();await nextLoop();expect(p.result.modelFailures?.[0]).toMatchObject({turn:1,attempt:1});expect(p.result.modelCalls).toBe(6);
});
it('finalized case snapshots are deeply immutable and detached from port inputs',async()=>{
 const p=await probe('direct');expect(Object.isFrozen(p.result)).toBe(true);expect(Object.isFrozen(p.result.modelFailures)).toBe(true);expect(Object.isFrozen(p.result.outcome?.session)).toBe(true);expect(()=>{p.result.trace.push({type:'forged-after-finalization'});}).toThrow();const before=JSON.stringify(p.result);p.mutateInput();expect(JSON.stringify(p.result)).toBe(before);
});
it('a late success during the next turn is ignored, not appended to that turn evidence',async()=>{
 const responses=await wire(),c=makeCase(),recipe=plan(c),old=deferred<string>(),second=deferred<void>(),resumed=deferred<void>(),started=deferred<void>(),q=new StageReplay(responses);let calls=0;
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date']});const pending=runCase(c,{mode:'mock',runId:'between-turns',trial:1,recipe,budget:{maxElapsedMs:40},model:async(req,signal)=>{calls++;if(calls===1){started.resolve();return old.promise;}if(calls===2){second.resolve();await resumed.promise;}return q.call(req,signal);}});
 await started.promise;await vi.advanceTimersByTimeAsync(41);await second.promise;old.resolve('ABANDONED-RESPONSE-MUST-NOT-ENTER-EVIDENCE');await nextLoop();resumed.resolve();const result=await pending;
 expect(JSON.stringify(result)).not.toContain('ABANDONED-RESPONSE-MUST-NOT-ENTER-EVIDENCE');expect(result.modelFailures).toEqual([expect.objectContaining({turn:1,attempt:1})]);expect(result.outcome?.type).toBe('draft');expect(caseMetrics(c,result,recipe).status).toBe('FAIL');
});
it('a controller-only deadline with no dispatched port is still a sticky failure',async()=>{
 const c=makeCase();c.input.followups=[];const recipe:Recipe={assertions:[{checkId:'draft',path:'outcome.type',op:'equals',value:'incomplete'}]},model=vi.fn(async()=>'{"factPatch":{}}');const result=await runCase(c,{mode:'mock',runId:'zero-budget',trial:1,recipe,model,budget:{maxElapsedMs:0}});
 expect(model).not.toHaveBeenCalled();expect(caseMetrics(c,result,recipe).status).toBe('FAIL');expect(result.execution?.trialStatus).toBe('failed');expect(result.modelFailures).toContainEqual({stage:'controller',turn:1,attempt:0,kind:'service',code:'deadline_exceeded'});
});
it('explicit outer cancellation finalizes a pending port without becoming a service deadline failure',async()=>{
 const c=makeCase();c.input.followups=[];c.oracle.checks=[{id:'cancel',criterion:'Explicit cancellation observed',required:true,evidence:'cancelled'}];const recipe:Recipe={assertions:[{checkId:'cancel',path:'cancelled',op:'equals',value:true}]},started=deferred<void>(),held=deferred<string>(),outer=new AbortController();
 const pending=runCase(c,{mode:'mock',runId:'outer-cancel',trial:1,recipe,signal:outer.signal,model:async()=>{started.resolve();return held.promise;}});await started.promise;outer.abort();const result=await pending,before=JSON.stringify(result);held.reject(new DOMException('late outer cleanup','AbortError'));await nextLoop();
 expect(JSON.stringify(result)).toBe(before);expect(result.cancelled).toBe(true);expect(result.error).toBeUndefined();expect(result.modelFailures?.some(f=>f.kind==='service')).toBe(false);expect(caseMetrics(c,result,recipe).status).toBe('CANCELLED');
});
it('ordinary product no-progress followed by a successful authorized turn may still PASS',async()=>{
 const responses=await wire(),c=makeCase(),recipe=plan(c),q=new StageReplay({preflight:[responses.preflight[0],'{"factPatch":{}}'],decide:['{"tool":"ask","gapIds":["absent-gap"]}',...responses.decide],write:responses.write,review:responses.review});const result=await runCase(c,{mode:'mock',runId:'product-recovery',trial:1,recipe,model:q.call,budget:{maxNoProgress:1}});
 expect(result.outcome?.type).toBe('draft');expect(result.error).toBeUndefined();expect(result.modelFailures).toEqual([]);expect(caseMetrics(c,result,recipe).status).toBe('PASS');
});

it('an earlier fixture failure keeps precedence over a later uncooperative deadline',async()=>{
 const responses=await wire(),c=makeCase(),recipe=plan(c),q=new StageReplay({preflight:[responses.preflight[0]],decide:[responses.decide[0]],write:['{']}),held=deferred<string>(),started=deferred<void>();let calls=0;vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date']});
 const pending=runCase(c,{mode:'mock',runId:'fixture-before-deadline',trial:1,recipe,budget:{maxElapsedMs:40},model:async(req,signal)=>{calls++;if(calls===5){started.resolve();return held.promise;}return q.call(req,signal);}});await started.promise;await vi.advanceTimersByTimeAsync(41);const result=await pending,before=JSON.stringify(result);held.reject(new DOMException('late cleanup','AbortError'));await nextLoop();
 expect(JSON.stringify(result)).toBe(before);expect(caseMetrics(c,result,recipe).status).toBe('fixture_error');expect(result.error).toBe('fixture_error:repair');expect(result.modelFailures).toEqual([expect.objectContaining({kind:'fixture',stage:'repair',turn:1,attempt:4}),expect.objectContaining({kind:'service',stage:'preflight',turn:2,attempt:5})]);
});
it('elapsed guard expiry after a successful port response stays failed after recovery',async()=>{
 const responses=await wire(),c=makeCase(),recipe=plan(c),q=new StageReplay(responses);let first=true;vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date']});
 const result=await runCase(c,{mode:'mock',runId:'elapsed-guard',trial:1,recipe,budget:{maxElapsedMs:40},model:async(req,signal)=>{if(first){first=false;vi.setSystemTime(Date.now()+41);return responses.preflight[0];}return q.call(req,signal);}});
 expect(result.outcome?.type).toBe('draft');expect(caseMetrics(c,result,recipe).status).toBe('FAIL');expect(result.modelFailures).toContainEqual({stage:'controller',turn:1,attempt:0,kind:'service',code:'deadline_exceeded'});
});
