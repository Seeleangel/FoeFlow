import { useCallback, useEffect, useRef, useState } from 'react';
import { applyControlEvent, assertConfirmable } from '@/lib/editorialState';
import { createEditorialSession, currentInputKey, hashText, type EditorialSession } from '@/lib/editorialTypes';
import type { AnswerChoice } from '@/lib/editorialTypesV3';
/** Single UI owner. Checkpoints are retained, but never grant an output capability. */
export function useEditorialSession(sessionId: string) {
 const [session, setSession] = useState<EditorialSession>();
 const latest = useRef(session); const owner = useRef(0); const alive = useRef(true);
 const put = useCallback((next: EditorialSession | undefined) => { latest.current = next; setSession(next); }, []);
 useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
 const restore = useCallback((next?: EditorialSession) => { owner.current++; put(next); }, [put]);
 const begin = useCallback(() => {
  const token = ++owner.current, base = latest.current ?? createEditorialSession(sessionId);
  const runId = 'ui-' + crypto.randomUUID();
  const isCurrent = () => alive.current && owner.current === token && (!latest.current || latest.current.sessionId === base.sessionId);
  const checkpoint = (next: EditorialSession) => {
   if (!isCurrent() || next.sessionId !== base.sessionId || next.activeRunId !== runId || next.revision <= (latest.current?.revision ?? base.revision)) return false;
   put(next); return true;
  };
  return { runId, session: base, isCurrent, checkpoint };
 }, [sessionId, put]);
 const appendMessage = useCallback((text: string, messageId: string, metadata?: { replyToBatchId?: string; slots?: { gapId: string; optionId?: string; value?: string; choice?: AnswerChoice }[] }) => {
  const s = structuredClone(latest.current ?? createEditorialSession(sessionId));
  if (!s.evidence.some(e => e.provenance.messageId === messageId)) {
   s.evidence.push({ id: messageId, revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: {messageId, ...(metadata?.replyToBatchId ? { replyToBatchId: metadata.replyToBatchId } : {}), ...(metadata?.slots ? { slots: metadata.slots } : {})}, context: {scenario:'unknown'} });
   s.evidenceRevision++; s.revision++; delete s.review; delete s.gate; s.humanVerifications=[]; s.selectedOutput='candidate';
  }
  put(s); return s;
 }, [sessionId, put]);
 const confirm = useCallback(async (persist: (next: EditorialSession, expectedRevision: number) => Promise<void>) => {
  const s = latest.current; if (!s) throw Error('confirmation_blocked'); assertConfirmable(s);
  const token = owner.current, next = applyControlEvent(s, { type:'editor_confirmed', sessionId:s.sessionId,runId:s.activeRunId!,expectedRevision:s.revision,confirmation:{inputKey:currentInputKey(s),htmlHash:s.layout!.htmlHash,actor:'editor',confirmedAt:new Date().toISOString()} });
  await persist(next,s.revision);
  if (!alive.current || owner.current !== token || latest.current !== s) return false;
  put(next); return true;
 }, [put]);
 return {session, restore, begin, appendMessage, confirm, getCurrent: () => latest.current};
}
