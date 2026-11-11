import {expect,it} from 'vitest';
import {createEditorialSession,hashText} from '../editorialTypes';
import {buildWriterContext} from '../editorialDocument';
it('PB-M1: public set cardinality preserves semantics without nested private proof quotes',()=>{
 const s=createEditorialSession('s'),text='Public member; PRIVATE-SENTINEL; INTERNAL-MEMO';const ref={evidenceId:'e',revision:1,start:0,end:text.length,quote:text};s.evidence=[{id:'e',revision:1,text,contentHash:hashText(text),kind:'editor_message',provenance:{},context:{scenario:'unknown'}}];s.scopes=[{id:'scope',kind:'other',label:'Group',identity:'aligned',anchors:[ref],qualifiers:[]}];
 s.claims=[{id:'public',selector:{scopeId:'scope',predicate:'members',cardinality:'set',cardinalityRefs:[ref]},value:'Public member',refs:[ref],epistemic:'supported',visibility:'public',statusBasis:[]},{id:'private',selector:{scopeId:'scope',predicate:'story'},value:'PRIVATE-SENTINEL',refs:[ref],epistemic:'supported',visibility:'private',statusBasis:[ref]}];s.editorialNotes=[{id:'n',kind:'process',text:'INTERNAL-MEMO',relatedIds:[]}];
 const context=buildWriterContext(s),raw=JSON.stringify(context);expect(raw).toContain('Public member');expect(context.claims[0].selector.cardinality).toBe('set');expect(raw).not.toContain('PRIVATE-SENTINEL');expect(raw).not.toContain('INTERNAL-MEMO');expect(raw).not.toContain('cardinalityRefs');
});
