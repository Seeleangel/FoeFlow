import {validateAssertions} from './observations';
import {executionPlan,parseApprovedProtocols,type ApprovedCaseProtocol} from './authority';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import {EDITORIAL_STAGE_PROMPTS} from '../../src/lib/editorialPrompts';
import {prepareAgentContext} from '../../src/lib/agentRuntime';
import type {EditorialModelPort} from '../../src/lib/editorialController';
import {DEFAULT_RUN_BUDGET} from '../../src/lib/editorialTypes';
import {StageReplay,parseCaseFile,parseRecipes,replayQueues,runCase,unexecutedCase,redact,type Recipe} from './replay';
import {caseMetrics,groupedMetrics} from './metrics';
import {verifyHash,makeManifest,configSummary,type ModelConfig} from './manifest';
export function realModel(config:ModelConfig,record:(meta:unknown)=>void,transport:typeof fetch=fetch):EditorialModelPort {
 return async({stage,data},signal)=>{
  const parameters={model:config.model,temperature:config.temperature,max_tokens:stage==='write'?8192:stage==='decide'?1500:config.maxTokens};
  const sentAt=new Date().toISOString();const localRequestId=randomUUID();let response:Response;
  try {response=await transport(config.apiUrl,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.key},body:JSON.stringify({...parameters,messages:prepareAgentContext([{role:'system',content:EDITORIAL_STAGE_PROMPTS[stage]},{role:'user',content:JSON.stringify(data)}])}),signal});}
  catch {record({localRequestId,stage,parameters,sentAt,status:signal.aborted?'cancelled':'network_error'});throw Error(signal.aborted?'cancelled':'network_error');}
  const requestId=response.headers.get('x-request-id')??response.headers.get('request-id');
  let body:{id?:string;choices?:{message?:{content?:string}}[];usage?:unknown};
  if(!response.ok){record({localRequestId,requestId,stage,parameters,sentAt,status:response.status});throw Error('HTTP_'+response.status);}
  try{body=await response.json()}catch{record({localRequestId,requestId,stage,parameters,sentAt,status:'invalid_response'});throw Error('invalid_model_response')}
  record({localRequestId,requestId:requestId??body.id??null,responseId:body.id??null,stage,parameters,sentAt,status:response.status,usage:body.usage});
  const content=body.choices?.[0]?.message?.content;if(typeof content!=='string')throw Error('invalid_model_response');return content;
 };
}
export function parseArgs(args:string[]){
 const flags=new Set(['dry-run','mock','real','allow-acceptance']);const values=new Set(['cases','sha256','select','out','trials','recipe','protocol','protocol-sha256','api-url','model','temperature','max-tokens']);const out:Record<string,string|boolean>={};
 for(let i=0;i<args.length;i++){const a=args[i];if(!a.startsWith('--'))throw Error('invalid_arguments');const key=a.slice(2);if(flags.has(key)){out[key]=true;continue;}if(!values.has(key)||!args[i+1]||args[i+1].startsWith('--'))throw Error('invalid_arguments');out[key]=args[++i];}
 if(!out.cases)throw Error('cases_required');const modes=['dry-run','mock','real'].filter(k=>out[k]);if(modes.length!==1)throw Error('choose_one_mode');return out;
}
export async function main(args:string[],env:Record<string,string|undefined>=process.env,control:{signal?:AbortSignal}={}){
 const a=parseArgs(args);const casePath=resolve(String(a.cases));
 if(!a['allow-acceptance']&&/[/\\](blind[^/\\]*|sealed)[/\\]/i.test(casePath))throw Error('acceptance_assets_require_explicit_mode');
 const bytes=await readFile(casePath);const casesHash=verifyHash(bytes,typeof a.sha256==='string'?a.sha256:undefined);const all=parseCaseFile(bytes.toString('utf8'));if(!all.length)throw Error('empty_cases');
 const patterns=typeof a.select==='string'?a.select.split(','):undefined;
 const selected=all.filter(c=>patterns?patterns.some(p=>p.endsWith('*')?c.id.startsWith(p.slice(0,-1)):c.id===p):a['allow-acceptance']||!c.id.startsWith('H'));
 if(!selected.length)throw Error('empty_selection');if(patterns?.some(p=>!all.some(c=>p.endsWith('*')?c.id.startsWith(p.slice(0,-1)):c.id===p)))throw Error('unknown_selection');if(!a['allow-acceptance']&&selected.some(c=>c.id.startsWith('H')||c.split==='holdout'||c.split==='blind'))throw Error('acceptance_cases_require_explicit_mode');
 const trials=Number(a.trials??1);if(!Number.isInteger(trials)||trials<1||trials>20)throw Error('invalid_trials');
 const config:ModelConfig={apiUrl:String(a['api-url']??env.FOEFLOW_API_URL??'https://chat.ecnu.edu.cn/open/api/v1/chat/completions'),model:String(a.model??env.FOEFLOW_MODEL??'default'),temperature:Number(a.temperature??.2),maxTokens:Number(a['max-tokens']??6000),key:a.real?env.FOEFLOW_API_KEY??env.OPENAI_API_KEY:undefined};configSummary(config);
 if(a.real&&!config.key)throw Error('credential_required_in_environment');
 // Recipes are separate, hash-frozen assets; original case bytes are never modified.
 let recipes:Record<string,Recipe>={};let recipeHash:string|undefined;
 if(a.recipe){const recipePath=resolve(String(a.recipe));if(!a['allow-acceptance']&&/[/\\](blind[^/\\]*|sealed)[/\\]/i.test(recipePath))throw Error('acceptance_assets_require_explicit_mode');const raw=await readFile(recipePath);recipeHash=verifyHash(raw);recipes=parseRecipes(JSON.parse(raw.toString('utf8')));}
 let protocols:Record<string,ApprovedCaseProtocol>={};let protocolHash:string|undefined;
 if(a.protocol){if(!a['allow-acceptance']||typeof a['protocol-sha256']!=='string')throw Error('approved_protocol_requires_explicit_mode_and_hash');const raw=await readFile(resolve(String(a.protocol)));protocolHash=verifyHash(raw,a['protocol-sha256']);protocols=parseApprovedProtocols(JSON.parse(raw.toString('utf8')),casesHash);}
 for(const c of selected){executionPlan(c,recipes[c.id],protocols[c.id]);validateAssertions(c,recipes[c.id]);}
 if(a.real&&selected.some(c=>(c.input.initial_message===null||c.input.followups.length||c.input.operator_events.length)&&!recipes[c.id]?.actions))throw Error('operator_recipe_required');
 for(const c of selected)replayQueues(c,recipes[c.id]?.responses);
 const runId='editorial-'+randomUUID();const root=process.cwd();const out=resolve(String(a.out??join('.git','editorial-eval',runId)));
 await mkdir(dirname(out),{recursive:true,mode:0o700});await mkdir(out,{mode:0o700});
 const save=async(name:string,data:unknown,secrets:string[]=[])=>writeFile(join(out,name),JSON.stringify(redact(data,secrets),null,2)+'\n',{mode:0o600,flag:'wx'});
 const manifest=await makeManifest(root,casesHash,config,{runId,mode:a['dry-run']?'dry-run':a.mock?'mock':'real',caseFile:basename(casePath),selection:selected.map(c=>c.id),trials,recipeHash,protocolHash,stageParameters:{write:{temperature:config.temperature,maxTokens:8192},decide:{temperature:config.temperature,maxTokens:1500},other:{temperature:config.temperature,maxTokens:config.maxTokens}}});
 await save('manifest.json',manifest,[config.key??'']);
 const modelCallUpperBound=selected.reduce((sum,c)=>sum+trials*DEFAULT_RUN_BUDGET.modelCalls*(1+(recipes[c.id]?.actions?.filter(a=>a.type==='message').length??0)),0);
 if(a['dry-run']){const result={runId,mode:'dry-run',validated:all.length,selected:selected.length,trials,casesHash,networkCalls:0,modelCallUpperBound,needsOperatorRecipe:selected.filter(c=>c.input.initial_message===null||c.input.operator_events.length||c.input.followups.length).map(c=>c.id),config:configSummary(config)};await save('dry-run.json',result);console.log(JSON.stringify(result));return result;}
 const metrics=[];const allPrivateSpans:string[]=[];const abort=new AbortController();const stop=()=>abort.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);control.signal?.addEventListener('abort',stop,{once:true});if(control.signal?.aborted)abort.abort();
 try{
  for(const c of selected)for(let trial=1;trial<=trials;trial++){
   const recipe=recipes[c.id];const queues=replayQueues(c,recipe?.responses);const q=new StageReplay(queues.effective);const requests:unknown[]=[];
   const model=a.mock?q.call:realModel(config,meta=>requests.push(meta));
   const r=abort.signal.aborted?unexecutedCase(c,{runId,trial,recipe,approvedProtocol:protocols[c.id]}):await runCase(c,{mode:a.mock?'mock':'real',model,runId,trial,recipe,approvedProtocol:protocols[c.id],signal:abort.signal});
   const m=caseMetrics(c,r,recipe);metrics.push(m);const secrets=[config.key??'',...r.privateSpans];allPrivateSpans.push(...r.privateSpans);
   await save(c.id+'-'+trial+'.json',{...r,privateSpans:undefined,requests,queueEvidence:{originalHashes:queues.originalHashes,effectiveHashes:queues.effectiveHashes,consumed:a.mock?q.consumed:null},remaining:a.mock?q.remaining():undefined,metrics:m},secrets);
  }
 }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);control.signal?.removeEventListener('abort',stop);}
 const summary={runId,casesHash,...groupedMetrics(metrics),modelCallUpperBound};await save('summary.json',summary);
 await save('assertions.json',metrics,[config.key??'',...allPrivateSpans]);console.log(JSON.stringify(summary));return summary;
}
