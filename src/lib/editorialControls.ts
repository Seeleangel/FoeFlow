import {applyControlEvent} from './editorialState';
import {canHandoff} from './editorialController';
import type {EditorialSession,EditorialControlEvent} from './editorialTypes';
/** Trusted editor-only transition shared by UI and evaluation. Never a model/tool action. */
export function applyEditorVerification(session:EditorialSession,event:Extract<EditorialControlEvent,{type:'human_verified'}>):EditorialSession {
 const next=applyControlEvent(session,event);
 next.gate=canHandoff(next);
 if(!next.gate.blockers.length)next.phase='pending_confirmation';
 return next;
}
