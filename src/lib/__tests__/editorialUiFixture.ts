import { seedTestTask } from './editorialTestFixtures';
import { createEditorialSession, currentInputKey } from '../editorialTypes';
import { parseDraftArtifact } from '../editorialDocument';
import { renderPublicDocument, makePublicDocument } from '../editorialOutput';
import { getDefaultTheme } from '../themeLoader';
import { canHandoff } from '../editorialController';
export function uiReady(id = 's') {
 const s = seedTestTask(createEditorialSession(id)); s.activeRunId = 'r'; s.revision = 3;
 s.candidate = parseDraftArtifact(JSON.stringify({title:'Public title',bodyMarkdown:'Public body.',editorialNotes:[{id:'n',kind:'process',text:'INTERNAL-NOTE',relatedIds:[]}]}),{id:'d',revision:1}).artifact!;
 s.review={inputKey:currentInputKey(s),issues:[],blocking:[],notes:[]}; s.layout=renderPublicDocument(makePublicDocument(s).document!,getDefaultTheme()); s.gate=canHandoff(s); s.phase='pending_confirmation'; return s;
}
