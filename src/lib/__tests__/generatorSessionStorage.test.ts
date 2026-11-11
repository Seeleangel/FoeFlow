import { expect,it,vi,beforeEach } from 'vitest';
import { uiReady } from './editorialUiFixture';
import { compareAndSaveEditorialSession, loadGeneratorSession, saveGeneratorSession, type GeneratorSessionState } from '../generatorSessionStorage';
import { applyControlEvent } from '../editorialState';
import { currentInputKey } from '../editorialTypes';
const db=vi.hoisted(()=>({select:vi.fn(),execute:vi.fn()})); vi.mock('@/hooks/useDb',()=>({getDb:async()=>db}));
const state=():GeneratorSessionState=>({messages:[],chatInput:'',generatedText:'',generatedHtml:'',generatedTitle:'',layoutHtml:'',layoutStrategyJson:'',styleSpecJson:'',selectedDirectionJson:'',selectedTemplateId:'',editorialSession:uiReady()});
beforeEach(()=>{vi.clearAllMocks()});
it('uses one conditional SQL write with expected persisted bytes/revision; CAS conflict rejects',async()=>{
 const s=state(), old=JSON.stringify(s); db.select.mockResolvedValue([{id:'s',params_json:old}]);db.execute.mockResolvedValue({rowsAffected:0}); const e=s.editorialSession!; const next=applyControlEvent(e,{type:'editor_confirmed',sessionId:'s',runId:'r',expectedRevision:e.revision,confirmation:{actor:'editor',confirmedAt:'now',inputKey:currentInputKey(e),htmlHash:e.layout!.htmlHash}});
 await expect(compareAndSaveEditorialSession('s',s,next,3)).rejects.toThrow('stale'); expect(db.execute.mock.calls[0][0]).toContain('AND params_json = ?'); expect(db.execute.mock.calls[0][1]).toContain(old);
 db.select.mockResolvedValue([{id:'s',params_json:JSON.stringify({...s,editorialSession:{...e,revision:4}})}]); await expect(compareAndSaveEditorialSession('s',s,next,3)).rejects.toThrow('stale');
});
it('checkpoint autosave cannot overwrite a newer confirmed revision',async()=>{const s=state();db.select.mockResolvedValue([{params_json:JSON.stringify({...s,editorialSession:{...uiReady(),revision:4}})}]); await expect(saveGeneratorSession('s',s)).rejects.toThrow('stale');expect(db.execute).not.toHaveBeenCalled()});
it('loads v2 even without HTML, and migrates historical layout/confirmation idempotently',async()=>{
 const s=state(); db.select.mockResolvedValue([{id:'s',template_id:'',created_at:1,params_json:JSON.stringify(s),content_text:'',content_html:''}]); expect((await loadGeneratorSession('s'))?.state.editorialSession?.phase).toBe('pending_confirmation');
 const legacy={...s,editorialSession:undefined,generatedTitle:'Original',generatedText:'# Original\nBody',generatedHtml:'<p>template</p>',layoutHtml:'<p>original layout</p>',editorial:{status:'confirmed',notes:[],sources:[]}}; db.select.mockResolvedValue([{id:'s',template_id:'',created_at:1,params_json:JSON.stringify(legacy),content_text:legacy.generatedText,content_html:legacy.generatedHtml}]);const loaded=(await loadGeneratorSession('s'))!;expect(loaded.state.editorialSession?.legacy?.html).toBe(legacy.layoutHtml);expect(loaded.state.editorialSession?.selectedOutput).toBe('legacy');
});
