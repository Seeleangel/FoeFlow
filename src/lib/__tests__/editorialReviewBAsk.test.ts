import {expect,it} from 'vitest';
import {seedTestTask} from './editorialTestFixtures';
import {createEditorialSession} from '../editorialTypes';
import {deriveGaps} from '../editorialGaps';
import {runEditorialController,type EditorialModelPort} from '../editorialController';
it.each(['mixed','already-asked'])('PB-m1: %s gap selection is a bounded rejected action, not generic model failure',async variant=>{
 const s=seedTestTask(createEditorialSession('s')),e=s.evidence[0],refs=[{evidenceId:e.id,revision:1,start:0,end:e.text.length,quote:e.text}];s.scopes=[{id:'subject',kind:'other',label:'Subject',anchors:refs,qualifiers:[],identity:'aligned'}];s.task.requirements=['first','second'].map(id=>({id,selector:{scopeId:'subject',predicate:id},label:id+' detail',reason:'Required for article',refs,necessity:'blocking',resolution:'supply_fact'}));s.gaps=deriveGaps(s);if(variant==='already-asked')s.gaps[0]={...s.gaps[0],state:'asked'};const first=s.gaps[0].id,second=s.gaps[1].id;let d=0;const codes:string[]=[];
 const model:EditorialModelPort=async({stage})=>stage==='preflight'?'{"factPatch":{}}':JSON.stringify({tool:'ask',gapIds:++d===1?variant==='mixed'?[second,'nonexistent']:[first]:[second]});
 const result=await runEditorialController({session:s,model,signal:new AbortController().signal,sources:{search:async()=>[],read:async()=>undefined},onToolResult:r=>codes.push(r.code)});expect(result.type).toBe('question');expect(d).toBe(2);expect(codes.some(c=>c.startsWith('ask_selection_rejected:'))).toBe(true);if(result.type==='question')expect(result.question.gapIds).toEqual([second]);
});
