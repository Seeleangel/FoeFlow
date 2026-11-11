import {readFile,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {DEFAULT_RUN_BUDGET,hashText,stableJson} from '../../src/lib/editorialTypes';
import {EDITORIAL_STAGE_PROMPTS} from '../../src/lib/editorialPrompts';
export interface ModelConfig {apiUrl:string;model:string;temperature:number;maxTokens:number;key?:string}
export function verifyHash(bytes:string|Uint8Array,expected?:string){const hash=createHash('sha256').update(bytes).digest('hex');if(expected&&hash!==expected.toLowerCase())throw Error('case_hash_mismatch');return hash;}
export function configSummary(c:ModelConfig){const url=new URL(c.apiUrl);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('unsafe_endpoint');if(!c.model.trim()||!Number.isFinite(c.temperature)||c.temperature<0||c.temperature>2||!Number.isInteger(c.maxTokens)||c.maxTokens<1)throw Error('invalid_model_config');return {apiUrl:url.href,model:c.model,temperature:c.temperature,maxTokens:c.maxTokens,credentialPresent:!!c.key,transport:'openai-compatible-single-post-no-retry'};}
async function tree(path:string):Promise<string[]>{const entries=await readdir(path,{withFileTypes:true});return (await Promise.all(entries.map(e=>e.isDirectory()?tree(join(path,e.name)):e.isFile()?[join(path,e.name)]:[]))).flat();}
export async function makeManifest(root:string,casesHash:string,config:ModelConfig,extra:Record<string,unknown>={}){
 const files=(await Promise.all(['src','scripts/editorial-eval'].map(p=>tree(join(root,p))))).flat().sort();
 const hashes=await Promise.all(files.map(async f=>[f.slice(root.length+1),verifyHash(await readFile(f))]));
 const lock=await readFile(join(root,'package-lock.json'));const schema=await readFile(join(root,'src/lib/editorialTypes.ts'));const git=(...args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
 return {version:1,createdAt:new Date().toISOString(),timezone:'Asia/Shanghai',code:{head:git('rev-parse','HEAD'),dirty:!!git('status','--porcelain'),treeHash:hashText(stableJson(hashes)),files:hashes},lockfileHash:verifyHash(lock),casesHash,promptHash:hashText(stableJson(EDITORIAL_STAGE_PROMPTS)),schemaHash:verifyHash(schema),budget:DEFAULT_RUN_BUDGET,budgetHash:hashText(stableJson(DEFAULT_RUN_BUDGET)),platform:{os:process.platform,arch:process.arch,node:process.version},platformHash:hashText(stableJson({os:process.platform,arch:process.arch,node:process.version})),model:configSummary(config),...extra};
}
