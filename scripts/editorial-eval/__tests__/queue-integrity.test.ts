import {it,expect,vi} from 'vitest';
import {main} from '../run';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
const c={id:'SYNTHETIC',input:{initial_message:'Publish a public note.',fixtures:[],followups:[],operator_events:[{stage:'write',response:'ORIGINAL-CONTAMINATED'}]},oracle:{end_state:'pending',checks:[]}};
it('CLI rejects a supplemental clean write replacing an original fault before any request',async()=>{
 const d=await mkdtemp('.git/queue-integrity-');await writeFile(d+'/case.jsonl',JSON.stringify(c)+'\n');await writeFile(d+'/recipe.json',JSON.stringify({SYNTHETIC:{responses:{write:['CLEAN']}}}));const spy=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('no network'));
 try{await expect(main(['--mock','--cases',d+'/case.jsonl','--recipe',d+'/recipe.json','--out',d+'/out'],{})).rejects.toThrow('fixture_stage_collision');expect(spy).not.toHaveBeenCalled()}finally{spy.mockRestore()}
});
it('absent new-stage supplements preserve original queue hashes, consumption and leftovers',async()=>{
 const d=await mkdtemp('.git/queue-integrity-');await writeFile(d+'/case.jsonl',JSON.stringify(c)+'\n');await writeFile(d+'/recipe.json',JSON.stringify({SYNTHETIC:{responses:{preflight:[{error:'HTTP_502'}]}}}));const log=vi.spyOn(console,'log').mockImplementation(()=>{});
 try{await main(['--mock','--cases',d+'/case.jsonl','--recipe',d+'/recipe.json','--out',d+'/out'],{});const result=JSON.parse(await readFile(d+'/out/SYNTHETIC-1.json','utf8'));expect(result.queueEvidence.originalHashes.write).toBeTruthy();expect(result.queueEvidence.effectiveHashes.write).toBe(result.queueEvidence.originalHashes.write);expect(result.queueEvidence.consumed.preflight).toBe(1);expect(result.remaining.write).toBe(1)}finally{log.mockRestore()}
});
