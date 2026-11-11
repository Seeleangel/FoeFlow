/** No upstream object is trusted as telemetry or a safe log key. */
export function safeUsage(raw:unknown):Record<string,number>|undefined {
 if(!raw||typeof raw!=='object')return undefined;const out:Record<string,number>={};
 for(const k of ['prompt_tokens','completion_tokens','total_tokens']){const v=(raw as Record<string,unknown>)[k];if(typeof v==='number'&&Number.isSafeInteger(v)&&v>=0)out[k]=v;}
 return Object.keys(out).length?out:undefined;
}
export function redact<T>(value:T,secrets:string[]=[]):T {
 const protectedValues=secrets.filter(Boolean).sort((a,b)=>b.length-a.length);
 const clean=(v:unknown):unknown=>{
  if(typeof v==='string'){
   // Canonicalize parseable JSON-in-string channels so Unicode/quote escapes cannot hide known values/keys.
   if(v.trimStart().startsWith('{')||v.trimStart().startsWith('[')){try{const parsed=JSON.parse(v);if(parsed&&typeof parsed==='object')return JSON.stringify(clean(parsed));}catch{/* Markdown/non-JSON remains text. */}}
   let s=v;for(const secret of protectedValues)for(const variant of new Set([secret,JSON.stringify(secret).slice(1,-1)]))s=s.split(variant).join('[REDACTED]');return s.replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi,'Bearer [REDACTED]');
  }
  if(Array.isArray(v))return v.map(clean);
  if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[clean(k) as string,/^(authorization|proxy-authorization|api[_-]?key|key|password|cookie|set-cookie|access[_-]?token)$/i.test(k)?'[REDACTED]':clean(x)]));return v;
 };return clean(value) as T;
}
/** Final credential check is over bytes destined to disk/stdout, including JSON property names and numeric metadata. */
export function secureSerialize(value:unknown,privateSpans:string[]=[],credentials:string[]=[]):string {
 const serialized=JSON.stringify(redact(value,[...privateSpans,...credentials]),null,2);
 for(const key of credentials.filter(Boolean))for(const variant of new Set([key,JSON.stringify(key).slice(1,-1),JSON.stringify(JSON.stringify(key).slice(1,-1)).slice(1,-1)]))if(serialized.includes(variant))throw Error('artifact_secret_check_failed');
 return serialized+'\n';
}
/** Privacy discovery is not artifact acceptance: rejected parseable note channels still stay private. */
export function rawNoteSpans(raw:string,stage:string):string[]{
 try{const value=JSON.parse(raw.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));const notes=Array.isArray(value?.editorialNotes)?value.editorialNotes.flatMap((n:unknown)=>n&&typeof n==='object'&&'text'in n&&typeof n.text==='string'?[n.text]:[]):[];if(stage==='review'&&Array.isArray(value?.notes))notes.push(...value.notes.filter((n:unknown)=>typeof n==='string'));return notes;}catch{return [];}
}
