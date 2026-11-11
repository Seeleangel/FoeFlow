import {expect,it,vi} from 'vitest';
import {saveConfirmedEditorialDraft} from '../draftStorage';
import {uiReady} from './editorialUiFixture';
import {applyControlEvent} from '../editorialState';
import {currentInputKey} from '../editorialTypes';
const execute=vi.hoisted(()=>vi.fn());vi.mock('@/hooks/useDb',()=>({getDb:async()=>({execute})}));
it('real workspace save is guarded and stores only public fields (not session metadata)',async()=>{const s=uiReady();await expect(saveConfirmedEditorialDraft(s,'t')).rejects.toThrow();expect(execute).not.toHaveBeenCalled();const next=applyControlEvent(s,{type:'editor_confirmed',sessionId:'s',runId:'r',expectedRevision:s.revision,confirmation:{actor:'editor',inputKey:currentInputKey(s),htmlHash:s.layout!.htmlHash,confirmedAt:'now'}});await saveConfirmedEditorialDraft(next,'t');const values=execute.mock.calls[0][1];expect(JSON.stringify(values)).toContain('Public body.');expect(JSON.stringify(values)).not.toContain('INTERNAL-NOTE');expect(JSON.stringify(values)).not.toContain('editorialNotes')});
