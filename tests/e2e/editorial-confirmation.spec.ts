import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
const base=process.env.FOEFLOW_UI_URL ?? 'http://127.0.0.1:5178/foeflow/';
test('mocked v2 run: locked candidate, persisted confirmation, public clipboard/workspace/Word, refresh',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);
 let calls=0;
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if (url.pathname.endsWith('/mail/session')) return route.fulfill({json:{username:'mock-editor',workspaceId:'a'.repeat(32)}});
  if (url.pathname.endsWith('/_model/chat/completions')) {
   calls++;const req=route.request().postDataJSON();const prompt=req.messages[0].content as string;const data=JSON.parse(req.messages.at(-1).content);let reply:unknown;
   if(prompt.includes('任务预检')) {const e=data.evidence.at(-1),refs=[{evidenceId:e.id,revision:e.revision,start:0,end:e.text.length,quote:e.text}];reply={factPatch:{scopes:[],claims:[],permissions:[]},taskPatch:{baseRevision:data.task.revision,refs,objective:'Publish a public article',intents:['inform'],criteria:[{id:'minimum',origin:'user',refs,severity:'blocking',verification:'deterministic',rule:{kind:'length',min:1,unit:'visible_characters'}}]}};}
   else if(prompt.includes('编辑协调器'))reply={tool:'write',instructions:'Compose the public body',repairCriterionIds:[]};
   else if(prompt.includes('写作工具'))reply={title:'Mock public title',bodyMarkdown:'Mock public body.',editorialNotes:[{id:'n',kind:'process',text:'MOCK-INTERNAL-NOTE',relatedIds:[]}]};
   else if(prompt.includes('审稿器'))reply={blocking:[],notes:[],issues:[],criterionChecks:[],humanChecks:[]};
   else throw Error('unexpected stage');
   return route.fulfill({json:{id:'mock-request-'+calls,choices:[{message:{content:JSON.stringify(reply)}}]}});
  }
  if(url.hostname!=='127.0.0.1')return route.abort();return route.continue();
 });
 await page.goto(base);
 await expect(page.getByRole('button',{name:'生成器',exact:true})).toBeVisible();
 await page.evaluate(async()=>{const {loadSettings,saveSettings}=await import('/foeflow/src/lib/settingsStorage.ts');const s=await loadSettings();await saveSettings({...s,apiUrl:'https://chat.ecnu.edu.cn/open/api/v1/chat/completions',apiKey:'MOCK-NOT-A-REAL-CREDENTIAL',modelName:'mock-only'});});
 await page.getByRole('button',{name:'生成器',exact:true}).click();
 await page.locator('textarea').first().fill('请写一篇简短公开稿件。');await page.getByRole('button',{name:'发送给 AI'}).click();
 await expect(page.getByRole('button',{name:'确认成稿',exact:true})).toBeEnabled();expect(calls).toBe(5);
 await expect(page.getByRole('button',{name:'复制 HTML'})).toBeDisabled();await expect(page.getByText('MOCK-INTERNAL-NOTE',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'确认成稿',exact:true}).click();await expect(page.getByRole('button',{name:'复制 HTML'})).toBeEnabled();
 await page.getByRole('button',{name:'复制 HTML'}).click();const html=await page.evaluate(()=>navigator.clipboard.readText());expect(html).toContain('Mock public body.');expect(html).not.toContain('MOCK-INTERNAL-NOTE');
 await page.getByRole('button',{name:'保存草稿',exact:true}).click();
 const publicRows=await page.evaluate(async()=>{const {getAllDrafts}=await import('/foeflow/src/lib/draftStorage.ts');return await getAllDrafts()});expect(JSON.stringify(publicRows)).toContain('Mock public body.');expect(JSON.stringify(publicRows)).not.toContain('MOCK-INTERNAL-NOTE');
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'导出 Word'}).click();const download=await downloadPromise;const path=await download.path();const {readFile}=await import('node:fs/promises');const zip=await JSZip.loadAsync(await readFile(path!));const xml=await zip.file('word/document.xml')!.async('string');expect(xml).toContain('Mock public body.');expect(xml).not.toContain('MOCK-INTERNAL-NOTE');
 await page.reload();await page.getByRole('button',{name:'生成器',exact:true}).click();await expect(page.getByRole('button',{name:'复制 HTML'})).toBeEnabled();expect(calls).toBe(5);
});
