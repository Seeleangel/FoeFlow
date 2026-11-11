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
  if(seen.has(c.id))throw Error('duplicate_case');seen.add(c.id);return c;
 });
}
/** Only the editor's message is input. setup/oracle/operator scripts are harness-only data. */
export function modelInput(c:EvalCase){return {message:c.input.initial_message};}
export function sourcePortForCase(c:EvalCase):SourcePort {
 const docs=c.input.fixtures.map((f,i)=>({documentId:'doc-'+hashText(f.title+':'+i).slice(0,24),title:f.title,text:f.text,complete:true}));
 return {search:async(query,signal)=>{if(signal.aborted)throw new DOMException('cancelled','AbortError');const terms=query.toLocaleLowerCase().split(/\s+/).filter(Boolean);return docs.filter(d=>terms.some(t=>(d.title+' '+d.text).toLocaleLowerCase().includes(t))).map(d=>({documentId:d.documentId,title:d.title,snippet:d.text.slice(0,240),contentHash:hashText(d.text)}));},read:async(id,signal)=>{if(signal.aborted)throw new DOMException('cancelled','AbortError');return docs.find(d=>d.documentId===id)}};
}
export function redact<T>(value:T,secrets:string[]=[]):T {
 const clean=(v:unknown):unknown=>{
  if(typeof v==='string'){let s=v;for(const secret of secrets.filter(Boolean).sort((a,b)=>b.length-a.length))for(const encoded of new Set([secret,JSON.stringify(secret).slice(1,-1)]))s=s.split(encoded).join('[REDACTED]');return s.replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi,'Bearer [REDACTED]');}
  if(Array.isArray(v))return v.map(clean);
  if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,/^(authorization|proxy-authorization|api[_-]?key|key|password|cookie|set-cookie|access[_-]?token)$/i.test(k)?'[REDACTED]':clean(x)]));return v;
 };return clean(value) as T;
}
export type EvalAction={type:'message';text:string}|{type:'confirm'}|{type:'verify';criterionId:string}|{type:'waive';sourceRequirementId:string;reason:string}|{type:'select';output:'committed'|'candidate'|'legacy'}|{type:'cancel';afterCalls:number}|{type:'copy'|'save'|'word'};
export interface Recipe {initialSession?:EditorialSession;initialMessage?:string;actions?:EvalAction[];responses?:Record<string,ReplayReply[]>;assertions?:{checkId:string;path:string;op:'equals'|'includes'|'not_includes'|'nonempty';value?:unknown}[]}
export interface CaseResult {id:string;runId:string;trial:number;outcome?:EditorialOutcome;cancelled:boolean;error?:string;modelCalls:number;legacyModelCalls:number|null;trace:unknown[];outputs:unknown[];checkpoints:{hash:string;revision:number}[];privateSpans:string[];operatorPlanRequired:boolean;unappliedFollowups:number}
export async function runCase(c:EvalCase,o:{mode:'mock'|'real';model:EditorialModelPort;runId:string;trial:number;signal?:AbortSignal;budget?:Partial<RunBudget>;recipe?:Recipe}):Promise<CaseResult>{
 const r:CaseResult={id:c.id,runId:o.runId,trial:o.trial,cancelled:false,modelCalls:0,legacyModelCalls:null,trace:[],outputs:[],checkpoints:[],privateSpans:[],operatorPlanRequired:c.input.operator_events.length>0&&!o.recipe?.actions,unappliedFollowups:c.input.followups.length};
 let session=o.recipe?.initialSession?EditorialSessionSchema.parse(o.recipe.initialSession):createEditorialSession('eval-'+hashText(o.runId+':'+o.trial).slice(0,24));
 const sources=sourcePortForCase(c);const abort=new AbortController();const cancel=()=>abort.abort();o.signal?.addEventListener('abort',cancel,{once:true});if(o.signal?.aborted)abort.abort();
 const protect=(s:EditorialSession)=>{r.privateSpans.push(...s.claims.filter(x=>x.visibility!=='public').flatMap(x=>[x.value,...x.statusBasis.map(ref=>ref.quote)]),...(s.editorialNotes??[]).map(n=>n.text),...(s.candidate?.editorialNotes??[]).map(n=>n.text));};
 protect(session);
 const checkpoint=(s:EditorialSession)=>{session=s;r.checkpoints.push({hash:hashText(stableJson(s)),revision:s.revision});protect(s);};
 const cancelAfter=o.recipe?.actions?.find((a):a is Extract<EvalAction,{type:'cancel'}>=>a.type==='cancel')?.afterCalls;
 const model:EditorialModelPort=async(req,signal)=>{
  r.modelCalls++;r.trace.push({type:'model_request',stage:req.stage,input:req.data});
  if(cancelAfter!==undefined&&r.modelCalls>=cancelAfter){abort.abort();throw new DOMException('cancelled','AbortError');}
  const raw=await o.model(req,signal);r.trace.push({type:'model_response',stage:req.stage,raw,hash:hashText(raw)});return raw;
 };
 const message=async(text:string)=>{
  if(abort.signal.aborted)throw new DOMException('cancelled','AbortError');
  session=invalidateEditorialStamps(session);const id='editor-'+session.evidence.length;
  session.evidence.push({id,revision:1,text,contentHash:hashText(text),kind:'editor_message',provenance:{messageId:id},context:{scenario:'unknown'}});session.evidenceRevision++;session.revision++;
  r.outcome=await runEditorialAgent({session,model,signal:abort.signal,sources,budget:o.budget,runId:'turn-'+hashText(o.runId+':'+session.revision).slice(0,24),onCheckpoint:checkpoint,onToolResult:result=>r.trace.push({type:'tool',result})});session=r.outcome.session;
 };
 try{
  const initial=o.recipe?.initialMessage??c.input.initial_message;
  if(initial!==null)await message(initial);else if(!o.recipe?.initialSession)throw Error('fixture_error:initial_state_required');
  // Conditions in natural-language followups are not guessed. A frozen recipe provides the exact editor actions.
  for(const action of o.recipe?.actions??[]){
   r.trace.push({type:'operator_action',action});
   if(action.type==='message'){await message(action.text);r.unappliedFollowups=Math.max(0,r.unappliedFollowups-1);}
   else if(action.type==='select'){session={...session,selectedOutput:action.output,revision:session.revision+1};checkpoint(session);}
   else if(action.type==='confirm'){
    session=applyControlEvent(session,{type:'editor_confirmed',sessionId:session.sessionId,runId:session.activeRunId!,expectedRevision:session.revision,confirmation:{inputKey:currentInputKey(session),htmlHash:session.layout?.htmlHash??'',actor:'editor',confirmedAt:new Date().toISOString()}});checkpoint(session);
   }else if(action.type==='verify'){session=applyControlEvent(session,{type:'human_verified',sessionId:session.sessionId,runId:session.activeRunId!,expectedRevision:session.revision,verification:{criterionId:action.criterionId,inputKey:currentInputKey(session),actor:'editor',status:'pass',verifiedAt:new Date().toISOString()}});checkpoint(session);}
   else if(action.type==='waive'){
    const id='waiver-'+session.evidence.length,text=action.reason;session.evidence.push({id,revision:1,text,contentHash:hashText(text),kind:'editor_message',provenance:{messageId:id},context:{scenario:'unknown'}});
    const refs=[{evidenceId:id,revision:1,start:0,end:text.length,quote:text}];session=applyEditorTaskPatch(session,{baseRevision:session.task.revision,refs,sourceWaivers:[{sourceRequirementId:action.sourceRequirementId,refs,actor:'editor',reason:text}]});checkpoint(session);
   }else if(action.type==='copy'||action.type==='save'||action.type==='word'){
    try{const b=requireConfirmedOutput(session);const output=action.type==='copy'?b.layout.html:action.type==='save'?publicDraftFields(b):await wordEvidence(b.document);r.outputs.push({type:action.type,allowed:true,output});}catch{r.outputs.push({type:action.type,allowed:false});}
   }
  }
  if(r.outcome)r.outcome={...r.outcome,session};
 }catch(e){if(e && typeof e==='object' && 'name' in e && e.name==='AbortError')r.cancelled=true;else r.error=e instanceof Error&&e.message.startsWith('fixture_error:')?e.message:'runner_action_failed';}
 finally{o.signal?.removeEventListener('abort',cancel);}
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
  if(r.actions!==undefined&&(!Array.isArray(r.actions)||!r.actions.every(a=>a&&typeof a==='object'&&(
   a.type==='message'?typeof a.text==='string':a.type==='waive'?typeof a.sourceRequirementId==='string'&&typeof a.reason==='string':a.type==='verify'?typeof a.criterionId==='string':a.type==='select'?['candidate','committed','legacy'].includes(a.output):a.type==='cancel'?Number.isInteger(a.afterCalls)&&a.afterCalls>0:['confirm','copy','save','word'].includes(a.type)
  ))))throw Error('recipe_schema');
  if(r.responses!==undefined&&(!r.responses||typeof r.responses!=='object'||Array.isArray(r.responses)||!Object.entries(r.responses).every(([stage,values])=>stages.has(stage)&&Array.isArray(values)&&values.every(v=>typeof v==='string'||v&&typeof v==='object'&&typeof v.error==='string'))))throw Error('recipe_schema');
  if(r.assertions!==undefined&&(!Array.isArray(r.assertions)||!r.assertions.every(a=>a&&typeof a.checkId==='string'&&typeof a.path==='string'&&['equals','includes','not_includes','nonempty'].includes(a.op))))throw Error('recipe_schema');
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
