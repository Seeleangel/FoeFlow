import {EditorialSessionSchema,hashText,stableJson,type EditorialSession} from '../../src/lib/editorialTypes';
import type {EvalCase,EvalAction,Recipe} from './replay';
export type ActionSource={kind:'followup'|'operator';index:number}|{kind:'protocol';step:string};
export interface ApprovedCaseProtocol {caseSha256:string;kind:'agent'|'historical'|'restoration';approvedBy:string;approvalRef:string;initialSession?:EditorialSession;initialMessage?:string;steps:Record<string,EvalAction>;bindings?:Record<string,{kind:'operator'|'followup';index:number}>}
export const caseHash=(c:EvalCase)=>hashText(stableJson(c));
export function isAction(a:unknown):a is EvalAction {
 if(!a||typeof a!=='object')return false;const x=a as EvalAction;
 return x.type==='message'?typeof x.text==='string':x.type==='waive'?typeof x.sourceRequirementId==='string'&&typeof x.reason==='string':x.type==='verify'?typeof x.criterionId==='string':x.type==='select'?['candidate','committed','legacy'].includes(x.output):x.type==='cancel'?Number.isInteger(x.afterCalls)&&x.afterCalls>0:['confirm','copy','save','word'].includes(x.type);
}
function actionBody(a:EvalAction){const {source,...body}=a;void source;return body;}
export function operatorAction(event:unknown):EvalAction|undefined {if(event&&typeof event==='object'&&'kind'in event&&event.kind==='editor_action'&&'action'in event&&isAction(event.action))return event.action;}
export function needsOperator(event:unknown){return !(event&&typeof event==='object'&&'stage'in event&&'response'in event)&&!(typeof event==='string'&&event.startsWith('模拟响应：'));}
/** An external protocol is trusted only after the caller pins its reviewed bytes via CLI SHA. Recipes cannot self-approve it. */
export function parseApprovedProtocols(raw:unknown,caseFileSha256:string):Record<string,ApprovedCaseProtocol>{
 if(!raw||typeof raw!=='object')throw Error('protocol_schema');const p=raw as Record<string,unknown>;
 if(p.schemaVersion!==1||p.caseFileSha256!==caseFileSha256||typeof p.approvedBy!=='string'||!p.approvedBy.trim()||typeof p.approvalRef!=='string'||!p.approvalRef.trim()||!p.cases||typeof p.cases!=='object'||Array.isArray(p.cases))throw Error('protocol_schema_or_case_file_hash');
 const result:Record<string,ApprovedCaseProtocol>={};
 for(const [id,value] of Object.entries(p.cases)){const c=value as ApprovedCaseProtocol;if(!c||!['agent','historical','restoration'].includes(c.kind)||!/^([a-f0-9]{64})$/.test(c.caseSha256)||!c.steps||typeof c.steps!=='object'||Array.isArray(c.steps)||!Object.values(c.steps).every(isAction))throw Error('protocol_schema');if(c.initialSession)EditorialSessionSchema.parse(c.initialSession);if(c.initialMessage!==undefined&&typeof c.initialMessage!=='string')throw Error('protocol_schema');result[id]={...c,approvedBy:p.approvedBy,approvalRef:p.approvalRef};}
 return result;
}
export function executionPlan(c:EvalCase,recipe?:Recipe,approved?:ApprovedCaseProtocol){
 if(recipe?.initialMessage!==undefined||recipe?.initialSession!==undefined)throw Error('recipe_initial_state_forbidden');
 if(approved){if(approved.caseSha256!==caseHash(c))throw Error('protocol_case_hash_mismatch');if(!approved.approvedBy?.trim()||!approved.approvalRef?.trim())throw Error('protocol_approval_required');if(approved.initialMessage!==undefined&&c.input.initial_message!==null)throw Error('frozen_initial_message');if(approved.initialSession&&approved.kind==='agent')throw Error('historical_setup_required');if(approved.kind==='restoration'&&(c.input.initial_message!==null||!approved.initialSession))throw Error('restoration_setup_required');}
 if(approved?.bindings)for(const [id,b] of Object.entries(approved.bindings)){if(!approved.steps[id]||!['operator','followup'].includes(b.kind)||!Number.isInteger(b.index)||b.index<0||(b.kind==='operator'?!needsOperator(c.input.operator_events[b.index])||b.index>=c.input.operator_events.length:b.index>=c.input.followups.length))throw Error('protocol_binding');if(b.kind==='followup'&&stableJson(actionBody(approved.steps[id]))!==stableJson({type:'message',text:c.input.followups[b.index].message}))throw Error('unapproved_editor_action');}
 const used=new Set<string>();const actions=(recipe?.actions??[]).map(action=>{
  const source=action.source;if(!source)throw Error('unbound_editor_action');const key=stableJson(source);if(used.has(key))throw Error('duplicate_editor_step');used.add(key);let expected:EvalAction|undefined;
  if(source.kind==='followup'){const f=c.input.followups[source.index];if(f)expected={type:'message',text:f.message};}
  else if(source.kind==='operator')expected=operatorAction(c.input.operator_events[source.index]);
  else if(source.kind==='protocol')expected=approved?.steps[source.step];
  if(!expected||stableJson(actionBody(action))!==stableJson(actionBody(expected)))throw Error('unapproved_editor_action');return action;
 });
 const operators=c.input.operator_events.flatMap((e,index)=>needsOperator(e)?[index]:[]);
 const unresolvedOperators=operators.filter(index=>!actions.some(a=>a.source?.kind==='operator'&&a.source.index===index)&&!actions.some(a=>a.source?.kind==='protocol'&&approved?.bindings?.[a.source.step]?.kind==='operator'&&approved.bindings[a.source.step].index===index)).length;
 const requiredSteps=[...operators.map(i=>'operator:'+i),...c.input.followups.map((_,i)=>'followup:'+i)];
 const stepFor=(action:EvalAction)=>{const source=action.source?.kind==='protocol'?approved?.bindings?.[action.source.step]:action.source;return source&&'index'in source?source.kind+':'+source.index:undefined;};
 return {requiredSteps,stepFor,initialMessage:c.input.initial_message??approved?.initialMessage??null,initialSession:approved?.initialSession,actions,kind:approved?.kind??'agent',unresolvedOperators,provenance:approved?{caseSha256:approved.caseSha256,approvedBy:approved.approvedBy,approvalRef:approved.approvalRef}:null};
}
