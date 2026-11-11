import {saveGeneratorSession,compareAndSaveEditorialSession,type GeneratorSessionState,type PersistedSessionBase} from './generatorSessionStorage';
import type {EditorialSession} from './editorialTypes';
/** One causal persisted base per UI owner. Own writes serialize and advance; foreign conflicts never refresh it. */
export function createSessionPersistence(sessionId:string,initial:PersistedSessionBase={sessionId,paramsJson:null},onConflict:()=>void=()=>{}) {
 let base=initial,queue:Promise<unknown>=Promise.resolve(),conflicted=false;
 const write=(operation:(expected:PersistedSessionBase)=>Promise<PersistedSessionBase>)=>{
  const result=queue.then(async()=>{if(conflicted)throw Error('stale_persistence');try{const next=await operation(base);base=next;return next;}catch(error){if(error instanceof Error&&error.message==='stale_persistence'){conflicted=true;onConflict();}throw error;}});
  queue=result.catch(()=>{});return result;
 };
 return {sessionId,getBase:()=>base,hasConflict:()=>conflicted,save:(state:GeneratorSessionState)=>write(expected=>saveGeneratorSession(sessionId,state,expected)),confirm:(state:GeneratorSessionState,next:EditorialSession,revision:number)=>write(expected=>compareAndSaveEditorialSession(sessionId,state,next,revision,expected))};
}
