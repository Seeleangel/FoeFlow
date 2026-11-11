import {rawNoteSpans} from './artifactSafety';
import {applyEditorVerification} from '../../src/lib/editorialControls';
import {validateAssertion,validateAssertions,type Assertion,type ExecutionLedger} from './observations';
import {executionPlan,isAction,type ActionSource,type ApprovedCaseProtocol} from './authority';
import JSZip from 'jszip';
import { runEditorialAgent } from '../../src/lib/editorialAgent';
import { type EditorialModelPort, type EditorialStage } from '../../src/lib/editorialController';
import { createEditorialSession, hashText, stableJson, EditorialSessionSchema, currentInputKey, type EditorialSession, type EditorialOutcome, type RunBudget } from '../../src/lib/editorialTypes';
import { invalidateEditorialStamps, applyControlEvent } from '../../src/lib/editorialState';
import { requireConfirmedOutput, exportPublicDocumentToDocx, publicDraftFields } from '../../src/lib/editorialOutput';
import { applyEditorTaskPatch } from '../../src/lib/editorialTask';
import type { SourcePort } from '../../src/lib/editorialSources';
export interface EvalCase {
 id:string; scenario_family?:string; split?:string;
 input:{setup?:string;initial_message:string|null;fixtures:{id:string;title:string;text:string;location?:string}[];followups:{after:string;message:string}[];operator_events:unknown[]};
 oracle:{end_state:string;checks:{id:string;criterion:string;required:boolean;evidence:string}[]};
}
export type ReplayReply=string|{error:string};
export class StageReplay {
 private queues:Record<string,ReplayReply[]>; readonly consumed:Record<string,number>={};
 constructor(responses:Record<string,ReplayReply[]>) {this.queues=structuredClone(responses);}
 call:EditorialModelPort=async({stage},signal)=>{
  if(signal.aborted)throw new DOMException('cancelled','AbortError');
  const reply=this.queues[stage]?.shift();if(reply===undefined)throw Error('fixture_error:'+stage);
  this.consumed[stage]=(this.consumed[stage]??0)+1;
  if(typeof reply!=='string')throw Error(reply.error);return reply;
 };
 remaining(){return Object.fromEntries(Object.entries(this.queues).map(([k,v])=>[k,v.length]));}
}
export function parseCaseFile(bytes:string):EvalCase[] {
 const seen=new Set<string>();return bytes.split(/\r?\n/).filter(s=>s.trim()).map(line=>{
  let c:EvalCase;try{c=JSON.parse(line)}catch{throw Error('case_json')}
  if(!c||typeof c.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(c.id)||!c.input||!Array.isArray(c.input.fixtures)||!c.input.fixtures.every(f=>typeof f.id==='string'&&typeof f.title==='string'&&typeof f.text==='string')||!(c.input.initial_message===null||typeof c.input.initial_message==='string')||!Array.isArray(c.input.followups)||!c.input.followups.every(f=>typeof f.after==='string'&&typeof f.message==='string')||!Array.isArray(c.input.operator_events)||!c.oracle||typeof c.oracle.end_state!=='string'||!Array.isArray(c.oracle.checks)||!c.oracle.checks.every(a=>typeof a.id==='string'&&typeof a.criterion==='string'&&typeof a.required==='boolean'&&typeof a.evidence==='string'))throw Error('case_schema');
  if(new Set(c.oracle.checks.map(a=>a.id)).size!==c.oracle.checks.length)throw Error('duplicate_check_id');
  if(seen.has(c.id))throw Error('duplicate_case');seen.add(c.id);return c;
 });
}
/** Only the editor's message is input. setup/oracle/operator scripts are harness-only data. */
export function modelInput(c:EvalCase){return {message:c.input.initial_message};}
export function sourcePortForCase(c:EvalCase):SourcePort {
 const docs=c.input.fixtures.map((f,i)=>({documentId:'doc-'+hashText(f.title+':'+i).slice(0,24),title:f.title,text:f.text,complete:true}));
 return {search:async(query,signal)=>{if(signal.aborted)throw new DOMException('cancelled','AbortError');const terms=query.toLocaleLowerCase().split(/\s+/).filter(Boolean);return docs.filter(d=>terms.some(t=>(d.title+' '+d.text).toLocaleLowerCase().includes(t))).map(d=>({documentId:d.documentId,title:d.title,snippet:d.text.slice(0,240),contentHash:hashText(d.text)}));},read:async(id,signal)=>{if(signal.aborted)throw new DOMException('cancelled','AbortError');return docs.find(d=>d.documentId===id)}};
}
export {redact} from './artifactSafety';
export type EvalAction=({type:'message';text:string}|{type:'confirm'}|{type:'verify';criterionId:string}|{type:'waive';sourceRequirementId:string;reason:string}|{type:'select';output:'committed'|'candidate'|'legacy'}|{type:'cancel';afterCalls:number}|{type:'copy'|'save'|'word'})&{source?:ActionSource};
export interface Recipe {initialSession?:EditorialSession;initialMessage?:string;actions?:EvalAction[];responses?:Record<string,ReplayReply[]>;assertions?:Assertion[]}
export interface CaseResult {execution?:ExecutionLedger;restoration?:{phase:string;sessionHash:string;selectedOutput?:string};id:string;runId:string;trial:number;outcome?:EditorialOutcome;cancelled:boolean;error?:string;modelCalls:number;legacyModelCalls:number|null;trace:unknown[];outputs:unknown[];checkpoints:{hash:string;revision:number}[];privateSpans:string[];operatorPlanRequired:boolean;unappliedFollowups:number}
export interface RunCaseOptions {mode:'mock'|'real';model:EditorialModelPort;runId:string;trial:number;signal?:AbortSignal;budget?:Partial<RunBudget>;recipe?:Recipe;approvedProtocol?:ApprovedCaseProtocol}
export function unexecutedCase(c:EvalCase,o:Pick<RunCaseOptions,'runId'|'trial'|'recipe'|'approvedProtocol'>):CaseResult{const plan=executionPlan(c,o.recipe,o.approvedProtocol);return {id:c.id,runId:o.runId,trial:o.trial,cancelled:true,error:'run_interrupted',modelCalls:0,legacyModelCalls:null,trace:[],outputs:[],checkpoints:[],privateSpans:[],operatorPlanRequired:plan.requiredSteps.some(s=>s.startsWith('operator:')),unappliedFollowups:c.input.followups.length,execution:{kind:plan.kind,trialStatus:'not_run',initial:plan.initialMessage===null?'not_applicable':'planned',terminalObserved:false,restorationObserved:false,requiredSteps:plan.requiredSteps,completedSteps:[],actions:plan.actions.map((a,index)=>({index,type:a.type,status:'skipped'}))}};}
export async function runCase(c:EvalCase,o:RunCaseOptions):Promise<CaseResult>{
 const plan=executionPlan(c,o.recipe,o.approvedProtocol);validateAssertions(c,o.recipe);
 const execution:ExecutionLedger={kind:plan.kind,trialStatus:'running',initial:plan.initialMessage===null?'not_applicable':'planned',terminalObserved:false,restorationObserved:false,requiredSteps:plan.requiredSteps,completedSteps:[],actions:plan.actions.map((a,index)=>({index,type:a.type,status:'planned'}))};
 const r:CaseResult={id:c.id,runId:o.runId,trial:o.trial,cancelled:false,modelCalls:0,legacyModelCalls:null,trace:[],outputs:[],checkpoints:[],privateSpans:[],operatorPlanRequired:plan.unresolvedOperators>0,unappliedFollowups:c.input.followups.length,execution};
 let session=plan.initialSession?EditorialSessionSchema.parse(plan.initialSession):createEditorialSession('eval-'+hashText(o.runId+':'+o.trial).slice(0,24));
 if(plan.kind==='restoration'&&plan.initialSession){execution.restorationObserved=true;r.restoration={phase:session.phase,sessionHash:hashText(stableJson(session)),selectedOutput:session.selectedOutput};}
 const sources=sourcePortForCase(c),abort=new AbortController(),cancel=()=>abort.abort();o.signal?.addEventListener('abort',cancel,{once:true});if(o.signal?.aborted)abort.abort();
 const protect=(s:EditorialSession)=>{r.privateSpans.push(...s.claims.filter(x=>x.visibility!=='public').flatMap(x=>[x.value,...x.statusBasis.map(ref=>ref.quote)]),...(s.editorialNotes??[]).map(n=>n.text),...(s.candidate?.editorialNotes??[]).map(n=>n.text));};protect(session);
 const checkpoint=(s:EditorialSession)=>{session=s;r.checkpoints.push({hash:hashText(stableJson(s)),revision:s.revision});protect(s);};
 const complete=(index:number)=>{execution.actions[index].status='completed';const step=plan.stepFor(plan.actions[index]);if(step&&!execution.completedSteps.includes(step))execution.completedSteps.push(step);};
 const cancelIndex=plan.actions.findIndex(a=>a.type==='cancel');const cancelAction=plan.actions[cancelIndex];
 const model:EditorialModelPort=async(req,signal)=>{
  r.modelCalls++;r.trace.push({type:'model_request',stage:req.stage,input:req.data});
  if(cancelAction?.type==='cancel'&&r.modelCalls>=cancelAction.afterCalls){complete(cancelIndex);abort.abort();throw new DOMException('cancelled','AbortError');}
  const raw=await o.model(req,signal);r.privateSpans.push(...rawNoteSpans(raw,req.stage));r.trace.push({type:'model_response',stage:req.stage,raw,hash:hashText(raw)});return raw;
 };
 const message=async(text:string)=>{
  if(abort.signal.aborted)throw new DOMException('cancelled','AbortError');session=invalidateEditorialStamps(session);const id='editor-'+session.evidence.length;
  session.evidence.push({id,revision:1,text,contentHash:hashText(text),kind:'editor_message',provenance:{messageId:id},context:{scenario:'unknown'}});session.evidenceRevision++;session.revision++;
  r.outcome=await runEditorialAgent({session,model,signal:abort.signal,sources,budget:o.budget,runId:'turn-'+hashText(o.runId+':'+session.revision).slice(0,24),onCheckpoint:checkpoint,onToolResult:result=>r.trace.push({type:'tool',result})});session=r.outcome.session;execution.terminalObserved=true;
 };
 try{
  r.trace.push({type:'editor_plan',kind:plan.kind,provenance:plan.provenance});
  if(plan.initialMessage!==null){await message(plan.initialMessage);execution.initial='completed';}else if(!plan.initialSession)throw Error('fixture_error:initial_state_required');
  for(const [index,action] of plan.actions.entries()){
   if(execution.actions[index].status==='completed')continue;if(abort.signal.aborted)break;
   r.trace.push({type:'operator_action',action});
   try{
    if(action.type==='message')await message(action.text);
    else if(action.type==='select'){session={...session,selectedOutput:action.output,revision:session.revision+1};checkpoint(session);}
    else if(action.type==='confirm'){session=applyControlEvent(session,{type:'editor_confirmed',sessionId:session.sessionId,runId:session.activeRunId!,expectedRevision:session.revision,confirmation:{inputKey:currentInputKey(session),htmlHash:session.layout?.htmlHash??'',actor:'editor',confirmedAt:new Date().toISOString()}});checkpoint(session);}
    else if(action.type==='verify'){session=applyEditorVerification(session,{type:'human_verified',sessionId:session.sessionId,runId:session.activeRunId!,expectedRevision:session.revision,verification:{criterionId:action.criterionId,inputKey:currentInputKey(session),actor:'editor',status:'pass',verifiedAt:new Date().toISOString()}});checkpoint(session);}
    else if(action.type==='waive'){
     const id='waiver-'+session.evidence.length,text=action.reason;session.evidence.push({id,revision:1,text,contentHash:hashText(text),kind:'editor_message',provenance:{messageId:id},context:{scenario:'unknown'}});
     const refs=[{evidenceId:id,revision:1,start:0,end:text.length,quote:text}];session=applyEditorTaskPatch(session,{baseRevision:session.task.revision,refs,sourceWaivers:[{sourceRequirementId:action.sourceRequirementId,refs,actor:'editor',reason:text}]});checkpoint(session);
    }else if(action.type==='copy'||action.type==='save'||action.type==='word'){
     try{const b=requireConfirmedOutput(session);r.outputs.push({type:action.type,allowed:true,output:action.type==='copy'?b.layout.html:action.type==='save'?publicDraftFields(b):await wordEvidence(b.document)});}catch{r.outputs.push({type:action.type,allowed:false});}
    }
    if(action.type!=='cancel')complete(index);
   }catch(e){execution.actions[index].status='failed';throw e;}
  }
  if(r.outcome)r.outcome={...r.outcome,session};execution.trialStatus=abort.signal.aborted?'cancelled':'completed';
 }catch(e){if(execution.initial==='planned')execution.initial='failed';execution.trialStatus=abort.signal.aborted?'cancelled':'failed';if(e&&typeof e==='object'&&'name'in e&&e.name==='AbortError')r.cancelled=true;else r.error=e instanceof Error&&e.message.startsWith('fixture_error:')?e.message:'runner_action_failed';}
 finally{o.signal?.removeEventListener('abort',cancel);r.cancelled=r.cancelled||abort.signal.aborted;for(const a of execution.actions)if(a.status==='planned')a.status='skipped';}
 r.operatorPlanRequired=execution.requiredSteps.some(s=>s.startsWith('operator:')&&!execution.completedSteps.includes(s));r.unappliedFollowups=execution.requiredSteps.filter(s=>s.startsWith('followup:')&&!execution.completedSteps.includes(s)).length;
 protect(session);r.privateSpans=[...new Set(r.privateSpans)];return r;
}
export function originalStageResponses(c:EvalCase):Record<string,ReplayReply[]> {
 const responses:Record<string,ReplayReply[]>={};
 for(const event of c.input.operator_events){
  if(typeof event==='object'&&event&&'stage'in event&&'response'in event){const e=event as {stage:EditorialStage;response:string};(responses[e.stage]??=[]).push(e.response);}
  else if(typeof event==='string'&&event.startsWith('模拟响应：')){const e=JSON.parse(event.slice(5)) as {stage:string;response:string};if(typeof e.stage!=='string'||typeof e.response!=='string')throw Error('fixture_error:response_schema');(responses[e.stage]??=[]).push(e.response);}
 }
 return responses;
}

export function parseRecipes(raw:unknown):Record<string,Recipe>{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('recipe_schema');
 const stages=new Set(['preflight','extract','decide','write','review','repair']);
 for(const [id,value] of Object.entries(raw)){
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(id)||!value||typeof value!=='object'||Array.isArray(value))throw Error('recipe_schema');
  const r=value as Recipe;
  if(r.initialSession)EditorialSessionSchema.parse(r.initialSession);
  if(r.initialMessage!==undefined&&typeof r.initialMessage!=='string')throw Error('recipe_schema');
  if(Object.keys(r).some(k=>!['actions','responses','assertions'].includes(k)))throw Error('recipe_initial_state_forbidden');
  if(r.actions!==undefined&&(!Array.isArray(r.actions)||!r.actions.every(isAction)))throw Error('recipe_schema');
  if(r.responses!==undefined&&(!r.responses||typeof r.responses!=='object'||Array.isArray(r.responses)||!Object.entries(r.responses).every(([stage,values])=>stages.has(stage)&&Array.isArray(values)&&values.every(v=>typeof v==='string'||v&&typeof v==='object'&&typeof v.error==='string'))))throw Error('recipe_schema');
  if(r.assertions!==undefined){if(!Array.isArray(r.assertions))throw Error('recipe_schema');const ids=new Set<string>();for(const a of r.assertions){validateAssertion(a);if(ids.has(a.checkId))throw Error('duplicate_assertion');ids.add(a.checkId);}}
 }
 return raw as Record<string,Recipe>;
}

async function wordEvidence(document:import('../../src/lib/editorialTypes').PublicDocument){
 const blob=await exportPublicDocumentToDocx(document);
 const bytes=typeof blob.arrayBuffer==='function'?await blob.arrayBuffer():await new Promise<ArrayBuffer>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result as ArrayBuffer);reader.onerror=reject;reader.readAsArrayBuffer(blob)});
 const zip=await JSZip.loadAsync(bytes);const xml=await zip.file('word/document.xml')!.async('string');return {docxBytes:blob.size,contentHash:document.contentHash,documentXml:xml};
}

/** Supplements add absent stages only; original fault queues are immutable. */
export function replayQueues(c:EvalCase,supplement:Record<string,ReplayReply[]>={}) {
 const original=originalStageResponses(c);
 if(Object.keys(supplement).some(stage=>Object.hasOwn(original,stage)))throw Error('fixture_stage_collision');
 const effective={...original,...supplement};const hashes=(q:Record<string,ReplayReply[]>)=>Object.fromEntries(Object.entries(q).map(([stage,replies])=>[stage,hashText(stableJson(replies))]));
 return {effective,originalHashes:hashes(original),effectiveHashes:hashes(effective)};
}
