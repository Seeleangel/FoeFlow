import {expect,it} from 'vitest';
import {seedTestTask} from './editorialTestFixtures';
import {createEditorialSession} from '../editorialTypes';
import {runEditorialController,type EditorialModelPort} from '../editorialController';
it('PB-M2: a request-sensitive writer receives the actionable same-defect review before repair',async()=>{
 const s=seedTestTask(createEditorialSession('s'));let decisions=0,writes=0,reviews=0;const writeInputs:Record<string,unknown>[]=[];
 const model:EditorialModelPort=async({stage,data})=>{
  if(stage==='preflight')return '{"factPatch":{}}';
  if(stage==='decide')return JSON.stringify({tool:++decisions%2?'write':'review',instructions:'Preserve the public subject',repairCriterionIds:[]});
  if(stage==='write'){writeInputs.push(data);writes++;const hasRepair=String(JSON.stringify(data.repairTargets)).includes('Use one declarative sentence');return JSON.stringify({title:'Public title',bodyMarkdown:hasRepair?'A concise public sentence.':'A sprawling opening. Another opening.'});}
  if(stage==='review')return JSON.stringify({blocking:++reviews===1?['Use one declarative sentence']:[],notes:[],issues:[]});throw Error('unexpected stage');
 };
 const result=await runEditorialController({session:s,model,signal:new AbortController().signal,sources:{search:async()=>[],read:async()=>undefined}});
 expect(result.type).toBe('draft');expect(writes).toBe(2);expect(result.session.candidate?.bodyMarkdown).toBe('A concise public sentence.');expect(writeInputs[1].repairCriterionIds).toContain('review:blocking');expect(writeInputs[1].instructions).toBe('Preserve the public subject');
});
