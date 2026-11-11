import {expect,it} from 'vitest';
import {runEditorialAgent,type EditorialResult} from '../editorialAgent';
import type {EditorialModelPort} from '../editorialController';
it('PB-M3: the actual legacy overload preserves an unchecked editable body without self-attesting its facts',async()=>{
 const body='First untouched paragraph.\n\nSecond **untouched** paragraph.';let step=0,surface:unknown;
 const model:EditorialModelPort=async({stage,data})=>{
  if(stage==='preflight'){const e=(data.evidence as {id:string;revision:number;text:string;kind:string}[]).find(e=>e.kind==='editor_message')!;const refs=[{evidenceId:e.id,revision:e.revision,start:0,end:e.text.length,quote:e.text}];return JSON.stringify({factPatch:{},taskPatch:{baseRevision:0,refs,objective:'Change the title only',intents:['edit'],criteria:[{id:'nonempty',origin:'user',refs,severity:'blocking',verification:'deterministic',rule:{kind:'length',min:1,unit:'visible_characters'}}]}});}
  if(stage==='decide')return JSON.stringify({tool:++step===1?'write':'review',instructions:'Change only the title',repairCriterionIds:[]});
  if(stage==='write'){surface=data.currentDraft;return JSON.stringify({title:'New title',bodyMarkdown:(data.currentDraft as {bodyMarkdown?:string}|undefined)?.bodyMarkdown??'MISSING EDITING SURFACE'});}
  if(stage==='review')return '{"blocking":[],"notes":[]}';throw Error('unexpected stage');
 };
 const result:EditorialResult=await runEditorialAgent({messages:[{role:'user',content:'Change only the title; preserve the body exactly.'}],previousDraft:'# Old title\n'+body,template:{name:'Article',structureJson:{}},signal:new AbortController().signal,onStep:()=>{},model,sources:{search:async()=>[],read:async()=>undefined}});
 expect(surface).toEqual({title:'Old title',bodyMarkdown:body});expect(result.type).toBe('draft');if(result.type==='draft')expect(result.text).toBe('# New title\n'+body);expect(result.outcome?.session.claims).toEqual([]);expect(result.outcome?.session.committed).toBeUndefined();
});
