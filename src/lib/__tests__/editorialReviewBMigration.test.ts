import {expect,it} from 'vitest';
import {normalizeLegacySession} from '../editorialCompatibility';
import {seedTestTask} from './editorialTestFixtures';
import {runEditorialController,type EditorialModelPort} from '../editorialController';
import {requireConfirmedOutput} from '../editorialOutput';
it.each(['pending-json','pending-markdown','manual-json','manual-markdown'])('PB-M4: migrated %s can write and freshly review without manual event injection',async variant=>{
 const raw={id:'s',generatedTitle:'Old title',generatedText:'# Old title\nOld body.',generatedHtml:'<p>Old body.</p>',...(variant.startsWith('pending')?{editorial:{status:'pending',notes:[],sources:[]}}:{})};const s=seedTestTask(normalizeLegacySession(raw));let decisions=0;const stages:string[]=[];
 const model:EditorialModelPort=async({stage})=>{stages.push(stage);if(stage==='preflight')return '{"factPatch":{}}';if(stage==='decide')return JSON.stringify({tool:++decisions===1?'write':'review',instructions:'Revalidate the old article',repairCriterionIds:[]});if(stage==='write')return variant.endsWith('markdown')?'# Fresh title\nFresh public body.':'{"title":"Fresh title","bodyMarkdown":"Fresh public body."}';if(stage==='review')return '{"blocking":[],"notes":[]}';throw Error('unexpected stage')};
 const result=await runEditorialController({session:s,model,signal:new AbortController().signal,sources:{search:async()=>[],read:async()=>undefined}});expect(result.type).toBe('draft');expect(stages).toContain('write');expect(stages).toContain('review');expect(result.session.diagnostics).toEqual([]);expect(result.session.legacy?.raw).toEqual(raw);expect(()=>requireConfirmedOutput(result.session)).toThrow();expect(result.session.candidate?.origin).toBe('model');
});

it('migrated typed UI sessions retain the old article as an unchecked editing surface',async()=>{
 const s=seedTestTask(normalizeLegacySession({id:'s',generatedTitle:'Old',generatedText:'# Old\nKeep this paragraph exactly.',generatedHtml:'<p>Keep this paragraph exactly.</p>',editorial:{status:'pending'}}));let decision=0;
 const model:EditorialModelPort=async({stage,data})=>{if(stage==='preflight')return '{"factPatch":{}}';if(stage==='decide')return JSON.stringify({tool:++decision===1?'write':'review',instructions:'Change title only',repairCriterionIds:[]});if(stage==='write')return JSON.stringify({title:'New',bodyMarkdown:(data.currentDraft as {bodyMarkdown?:string}|undefined)?.bodyMarkdown??'MISSING'});if(stage==='review')return '{"blocking":[],"notes":[]}';throw Error('unexpected')};
 const result=await runEditorialController({session:s,model,signal:new AbortController().signal,sources:{search:async()=>[],read:async()=>undefined}});expect(result.type).toBe('draft');expect(result.session.candidate?.bodyMarkdown).toBe('Keep this paragraph exactly.');
});
