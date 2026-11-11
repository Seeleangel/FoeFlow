import { describe, it, expect, vi, afterAll } from 'vitest';
import { writeFileSync } from 'node:fs';
import JSZip from 'jszip';
import { runEditorialAgent } from '../editorialAgent';
import { replayCases } from './editorialReplayFixtures';
import { seedTestTask } from './editorialTestFixtures';
import { parseDraftArtifact } from '../editorialDocument';
import { makePublicDocument, renderPublicDocument, requireConfirmedOutput, exportPublicDocumentToDocx } from '../editorialOutput';
import { createEditorialSession, currentInputKey, hashText, type EditorialSession } from '../editorialTypes';
import { startEditorialRun, applyControlEvent, applyToolEvents } from '../editorialState';
import { normalizeLegacySession } from '../editorialCompatibility';
import { validateAcceptance } from '../editorialAcceptance';
import { runEditorialController, canHandoff, type EditorialModelPort } from '../editorialController';
import { getDefaultTheme } from '../themeLoader';
const results: { id: string; status: string; scope: string }[] = [];
afterAll(() => writeFileSync('.git/phaseB-legacy-replays.json', JSON.stringify(results,null,2)));
function ready() {
  const original = replayCases.find(c => c.id === 'R01')!.input.fixtures[0];
  const s = startEditorialRun(createEditorialSession('session'),'run'); seedTestTask(s);
  s.candidate = parseDraftArtifact(original.text,{ id: 'candidate', revision: 1 }).artifact!;
  s.review = { inputKey: currentInputKey(s), issues: [], blocking: [], notes: [] }; s.layout = renderPublicDocument(makePublicDocument(s).document!,getDefaultTheme()); s.gate = validateAcceptance(s,s.layout); s.phase = 'pending_confirmation'; return s;
}
function confirm(s: EditorialSession) { return applyControlEvent(s,{ sessionId: s.sessionId, runId: s.activeRunId!, expectedRevision: s.revision, type: 'editor_confirmed', confirmation: { actor: 'editor', inputKey: currentInputKey(s), htmlHash: s.layout!.htmlHash, confirmedAt: '2026-11-11T23:40:00+08:00' } }); }
function addMessage(s: EditorialSession, text: string) { return applyToolEvents(s,[{ sessionId: s.sessionId, runId: s.activeRunId!, expectedRevision: s.revision, type: 'evidence_loaded', records: [{ id: 'new-message', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: { messageId: 'new-message' }, context: { scenario: 'real' } }], receipts: [] }]); }
const noSources = { search: vi.fn(async () => []), read: vi.fn(async () => undefined) };
const mark = (id: string) => results.push({ id,status: 'PASS',scope: 'contract/controller/output replay; not browser/native UI' });
describe('R01-R06 existing operator safety behaviors at real module boundaries', () => {
  it('R01 chat cannot confirm; explicit editor control unlocks same-version DOCX', async () => {
    const pending = ready(), chat = replayCases.find(c => c.id === 'R01')!.input.initial_message!; expect(() => requireConfirmedOutput(pending)).toThrow();
    const chatResult = await runEditorialAgent({ messages: [{ role: 'user', content: chat }], previousDraft: '# '+pending.candidate!.title+'\n'+pending.candidate!.bodyMarkdown, template: { name: 'Article', structureJson: {} }, signal: new AbortController().signal, onStep: () => {}, sources: noSources, model: async () => '{"factPatch":{}}' });
    expect(chatResult.type).toBe('question'); expect(chatResult.outcome?.session.committed).toBeUndefined(); expect(() => requireConfirmedOutput(pending)).toThrow();
    const confirmed = confirm(pending), bundle = requireConfirmedOutput(confirmed); expect(bundle.document.title).toBe('青岑论坛提醒');
    const blob = await exportPublicDocumentToDocx(bundle.document); const buffer = await new Promise<ArrayBuffer>((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob); }); const zip = await JSZip.loadAsync(buffer); const xml = await zip.file('word/document.xml')!.async('string');
    for (const fact of ['青岑论坛提醒','知行楼 302','60 人']) expect(xml).toContain(fact); mark('R01');
  });
  it('R02 pending/confirmed storage round trips do not broaden authority or change HTML', () => {
    const pending = ready(); expect(() => requireConfirmedOutput(normalizeLegacySession(JSON.parse(JSON.stringify(pending))))).toThrow(); const confirmed = confirm(pending); const restored = normalizeLegacySession(JSON.parse(JSON.stringify(confirmed))); expect(requireConfirmedOutput(restored)).toEqual(requireConfirmedOutput(confirmed)); mark('R02');
  });
  it('R03 a rewrite invalidates A review/layout; B cannot submit until reviewed and laid out', () => {
    const a = ready(), artifact = parseDraftArtifact('{"title":"B","bodyMarkdown":"New public draft B."}',{ id: 'candidate', revision: 2 }).artifact!;
    let b = applyToolEvents(a,[{ sessionId: a.sessionId, runId: a.activeRunId!, expectedRevision: a.revision, type: 'candidate_updated', artifact }]); expect(canHandoff(b).blockers).toContain('review_current'); expect(b.layout).toBeUndefined(); expect(() => requireConfirmedOutput(b)).toThrow();
    expect(() => applyToolEvents(b,[{ sessionId: b.sessionId, runId: b.activeRunId!, expectedRevision: b.revision, type: 'review_recorded', review: a.review! }])).toThrow('stale_review');
    b = applyToolEvents(b,[{ sessionId: b.sessionId, runId: b.activeRunId!, expectedRevision: b.revision, type: 'review_recorded', review: { inputKey: currentInputKey(b), issues: [], blocking: [], notes: [] } },{ sessionId: b.sessionId, runId: b.activeRunId!, expectedRevision: b.revision, type: 'layout_recorded', layout: renderPublicDocument(makePublicDocument(b).document!,getDefaultTheme()) }]); expect(canHandoff(b).blockers).toEqual([]); expect(() => requireConfirmedOutput(b)).toThrow(); mark('R03');
  });
  it('R04 502 is one request, preserves old confirmed output; manual retry makes a new pending candidate', async () => {
    const original = confirm(ready()), old = requireConfirmedOutput(original), s = addMessage(original,'Please revise the article.'); const failing = vi.fn(async () => { throw new Error('HTTP 502'); });
    const failed = await runEditorialController({ session: s, signal: new AbortController().signal, model: failing, sources: noSources }); expect(failing).toHaveBeenCalledTimes(1); expect(failed.type).toBe('failed'); failed.session.selectedOutput = 'committed'; expect(requireConfirmedOutput(failed.session)).toEqual(old);
    const queues: Record<string,string[]> = { preflight: ['{"factPatch":{}}'], decide: ['{"tool":"write","instructions":"Revise"}','{"tool":"review"}'], write: ['{"title":"B","bodyMarkdown":"Revised public text."}'], review: ['{"blocking":[],"notes":[]}'] };
    const model: EditorialModelPort = async ({ stage }) => { const raw = queues[stage]?.shift(); if (!raw) throw new Error('fixture_error:'+stage); return raw; };
    const retried = await runEditorialController({ session: failed.session, signal: new AbortController().signal, model, sources: noSources }); expect(retried.type).toBe('draft'); expect(retried.session.committed).toEqual(original.committed); expect(retried.session.candidate?.title).toBe('B'); expect(() => requireConfirmedOutput(retried.session)).toThrow(); mark('R04');
  });
  it('R05 cancellation/session switch rejects deferred results without late writeback or losing old confirmation', async () => {
    const s = confirm(ready()), old = structuredClone(s.committed), abort = new AbortController(), checkpoint = vi.fn(); let resolve!: (value:string)=>void;
    const model: EditorialModelPort = () => new Promise(done => { resolve = done; }); const running = runEditorialController({ session: s, model, signal: abort.signal, sources: noSources, onCheckpoint: checkpoint }); abort.abort(); resolve('{"factPatch":{}}'); await expect(running).rejects.toMatchObject({ name: 'AbortError' }); expect(s.committed).toEqual(old); expect(checkpoint).not.toHaveBeenCalled(); mark('R05');
  });
  it('R06 unknown mark_confirmed then endless submit stops within approved at-most limit', async () => {
    const s = ready(); delete s.candidate; delete s.review; delete s.layout; delete s.gate; delete s.committed; let decisions = 0;
    const model: EditorialModelPort = async ({ stage }) => { if (stage === 'preflight') return '{"factPatch":{}}'; if (stage === 'decide') { decisions++; return decisions === 1 ? '{"tool":"mark_confirmed"}' : '{"tool":"submit"}'; } throw new Error('fixture_error:'+stage); };
    const outcome = await runEditorialController({ session: s, model, signal: new AbortController().signal, sources: noSources }); expect(outcome.type).toBe('incomplete'); expect(decisions).toBeGreaterThan(0); expect(decisions).toBeLessThanOrEqual(12); expect(outcome.session.committed).toBeUndefined(); expect(outcome.session.candidate).toBeUndefined(); mark('R06');
  });
});
