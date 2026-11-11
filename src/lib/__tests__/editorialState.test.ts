import { describe, it, expect } from 'vitest';
import { parseContentBlocks } from '../editorialDocument';
import { createEditorialSession, hashText, type DraftArtifact } from '../editorialTypes';
import { applyToolEvents, startEditorialRun, applyControlEvent, currentInputKey, persistConfirmation } from '../editorialState';
const artifact: DraftArtifact = { schemaVersion: 2, id: 'd', revision: 1, title: 'Title', bodyMarkdown: 'Body', contentHash: hashText('Title\nBody'), blocks: parseContentBlocks('Body'), editorialNotes: [], assets: [], claimLinks: [], origin: 'model' };
const ready = () => {
  const s = startEditorialRun(createEditorialSession('s'), 'r'); s.candidate = artifact; s.task = { ...s.task, objective: 'Inform', intents: ['inform'], revision: 1 };
  const inputKey = currentInputKey(s);
  s.review = { inputKey, issues: [], blocking: [], notes: [] };
  s.gate = { inputKey, checks: [{ criterionId: 'c', status: 'pass', verifier: 'test', detail: '' }], blockers: [] };
  s.layout = { contentHash: artifact.contentHash, themeId: 't', themeVersion: '1', html: `<article><h1>Title</h1><p data-editorial-block="${artifact.blocks[0].id}">Body</p></article>`, htmlHash: hashText(`<article><h1>Title</h1><p data-editorial-block="${artifact.blocks[0].id}">Body</p></article>`) };
  s.phase = 'pending_confirmation'; return s;
};
describe('session ownership and stamps', () => {
  it('rejects stale, cancelled and cross-session events without mutation', () => {
    const s = startEditorialRun(createEditorialSession('s'), 'r');
    const event = { type: 'candidate_updated' as const, artifact, sessionId: 'other', runId: 'r', expectedRevision: s.revision };
    expect(() => applyToolEvents(s, [event])).toThrow(/ownership/);
    expect(() => applyToolEvents(s, [{ ...event, sessionId: 's', expectedRevision: 0 }])).toThrow();
    const cancelled = applyControlEvent(s, { type: 'run_cancelled', sessionId: 's', runId: 'r', expectedRevision: s.revision });
    expect(() => applyToolEvents(cancelled, [{ ...event, sessionId: 's', expectedRevision: cancelled.revision }])).toThrow();
    expect(s.candidate).toBeUndefined();
  });
  it('accepts a batch atomically using one expected revision', () => {
    const s = startEditorialRun(createEditorialSession('s'), 'r');
    const e = { sessionId: 's', runId: 'r', expectedRevision: s.revision };
    const next = applyToolEvents(s, [{ ...e, type: 'candidate_updated', artifact }, { ...e, type: 'gaps_updated', gaps: [] }]);
    expect(next.revision).toBe(s.revision + 1); expect(next.candidate).toEqual(artifact);
  });
  it.each(['task', 'facts', 'evidence'] as const)('%s changes invalidate stamps but retain committed snapshot', kind => {
    const s = ready(); s.committed = { artifact, layout: s.layout! };
    const e = { sessionId: 's', runId: 'r', expectedRevision: s.revision };
    const event = kind === 'task' ? { ...e, type: 'task_revised' as const, task: { ...s.task, objective: 'Changed objective', revision: s.task.revision + 1 } } : kind === 'facts' ? { ...e, type: 'facts_resolved' as const, scopes: [{ id: 'new', kind: 'other' as const, label: 'New identity', anchors: [], qualifiers: [], identity: 'provisional' as const }], claims: [], permissions: [] } : { ...e, type: 'evidence_loaded' as const, records: [{ id: 'e', revision: 1, contentHash: hashText('New evidence'), text: 'New evidence', kind: 'import' as const, provenance: {}, context: { scenario: 'unknown' as const } }], receipts: [] };
    const next = applyToolEvents(s, [event]); expect(next.review).toBeUndefined(); expect(next.layout).toBeUndefined(); expect(next.gate).toBeUndefined(); expect(next.committed).toEqual(s.committed);
  });
  it('duplicate fact/evidence events do not invent evidence revisions or invalidate safe stamps', () => {
    const s = ready(); const e = { sessionId: 's', runId: 'r', expectedRevision: s.revision };
    const next = applyToolEvents(s, [{ ...e, type: 'facts_resolved', scopes: s.scopes, claims: s.claims, permissions: s.permissions }, { ...e, type: 'evidence_loaded', records: [], receipts: [] }]);
    expect(currentInputKey(next)).toEqual(currentInputKey(s)); expect(next.review).toEqual(s.review); expect(next.layout).toEqual(s.layout);
  });
  it('requires exact current inputKey and layout hash and successful persistence', async () => {
    const s = ready(); const confirmation = { inputKey: currentInputKey(s), htmlHash: s.layout!.htmlHash, actor: 'editor' as const, confirmedAt: '2026-11-11T23:00:00+08:00' };
    const e = { sessionId: 's', runId: 'r', expectedRevision: s.revision, type: 'editor_confirmed' as const, confirmation };
    expect(() => applyControlEvent(s, { ...e, confirmation: { ...confirmation, htmlHash: 'wrong' } })).toThrow();
    await expect(persistConfirmation(s, e, async () => { throw new Error('disk'); })).rejects.toThrow('disk'); expect(s.committed).toBeUndefined();
    const next = await persistConfirmation(s, e, async () => {}); expect(next.phase).toBe('confirmed'); expect(next.committed?.confirmation).toEqual(confirmation);
    expect(() => applyToolEvents(s, [{ ...e, type: 'editor_confirmed' } as never])).toThrow();
  });
});
