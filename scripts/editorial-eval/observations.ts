import {stableJson} from '../../src/lib/editorialTypes';
import type {EvalCase,Recipe,CaseResult} from './replay';
export interface Assertion {checkId:string;path:string;op:'equals'|'includes'|'not_includes'|'nonempty';value?:unknown}
export interface ExecutionLedger {kind:'agent'|'historical'|'restoration';trialStatus:'running'|'completed'|'failed'|'cancelled'|'not_run';initial:'planned'|'completed'|'not_applicable'|'failed';terminalObserved:boolean;restorationObserved:boolean;requiredSteps:string[];completedSteps:string[];actions:{index:number;type:string;status:'planned'|'completed'|'failed'|'skipped'}[]}
const roots=new Set(['outcome','outputs','cancelled','modelCalls','legacyModelCalls','error','checkpoints','trace','execution','restoration','unappliedFollowups','operatorPlanRequired']);
export function validateAssertion(a:Assertion){
 if(!a||typeof a.checkId!=='string'||!a.checkId||typeof a.path!=='string'||!['equals','includes','not_includes','nonempty'].includes(a.op))throw Error('assertion_schema');
 const parts=a.path.split('.');if(!roots.has(parts[0])||parts.some(p=>!/^[A-Za-z0-9_]+$/.test(p)||['__proto__','prototype','constructor'].includes(p)))throw Error('assertion_path');
 if(a.op==='nonempty'){if(Object.hasOwn(a,'value'))throw Error('assertion_operand');}
 else if(!Object.hasOwn(a,'value')||a.value===undefined||a.op!=='equals'&&typeof a.value!=='string')throw Error('assertion_operand');
}
export function validateAssertions(c:EvalCase,recipe?:Recipe){const ids=new Set<string>();for(const a of recipe?.assertions??[]){validateAssertion(a);if(ids.has(a.checkId))throw Error('duplicate_assertion');ids.add(a.checkId);if(!c.oracle.checks.some(check=>check.id===a.checkId))throw Error('unknown_check_id');}}
export function observe(root:unknown,path:string){let value=root;for(const p of path.split('.')){if(value===null||typeof value!=='object'||!Object.hasOwn(value,p))return {exists:false,value:undefined};value=(value as Record<string,unknown>)[p];}return {exists:value!==undefined,value};}
export function evaluateAssertion(root:unknown,a:Assertion){try{validateAssertion(a)}catch{return {pass:false,actual:undefined,exists:false}}const observation=observe(root,a.path);if(!observation.exists)return {pass:false,actual:undefined,exists:false};const v=observation.value;
 const pass=a.op==='equals'?stableJson(v)===stableJson(a.value):a.op==='includes'?typeof v==='string'&&v.includes(String(a.value)):a.op==='not_includes'?typeof v==='string'&&!v.includes(String(a.value)):typeof v==='string'||Array.isArray(v)?v.length>0:!!v&&typeof v==='object'&&Object.keys(v).length>0;
 return {pass,actual:v,exists:true};}
export function observedExecution(r:CaseResult){const e=r.execution;if(!e||e.trialStatus==='not_run'||e.actions.some(a=>a.status!=='completed')||e.requiredSteps.some(s=>!e.completedSteps.includes(s)))return false;return e.terminalObserved||e.kind==='restoration'&&e.restorationObserved||r.cancelled&&e.actions.some(a=>a.type==='cancel'&&a.status==='completed');}
