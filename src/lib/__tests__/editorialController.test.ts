import { describe, it, expect, vi } from 'vitest';
import { createEditorialSession, hashText, type EditorialSession } from '../editorialTypes';
import { runEditorialController, canHandoff, qualityFingerprint, type EditorialModelPort } from '../editorialController';
import { parseDraftArtifact } from '../editorialDocument';
import { applyControlEvent } from '../editorialState';
import { currentInputKey } from '../editorialTypes';
import { requireConfirmedOutput } from '../editorialOutput';
export function planned(s: EditorialSession) {
  const e = s.evidence.find(e => e.kind === 'editor_message')!; const refs = [{ evidenceId: e.id, revision: e.revision, start: 0, end: e.text.length, quote: e.text }];
  return { factPatch: {}, taskPatch: { baseRevision: s.task.revision, refs, objective: s.task.objective || 'Public article', intents: ['inform'], criteria: [{ id: 'public-body', origin: 'user', refs, severity: 'blocking', verification: 'deterministic', rule: { kind: 'length', min: 1, unit: 'visible_characters' } }] } };
}
function input() { const s = createEditorialSession('session'), text = 'Write a short public article.'; s.evidence = [{ id: 'user', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: { messageId: 'm' }, context: { scenario: 'real' } }]; return s; }
const noSources = { search: vi.fn(async () => []), read: vi.fn(async () => undefined) };
function queue(session: EditorialSession, decisions: object[], writes: string[], reviews: object[] = [{ blocking: [], notes: [] }]) {
  const queues: Record<string,string[]> = { preflight: [JSON.stringify(planned(session))], decide: decisions.map(item => JSON.stringify(item)), write: writes, review: reviews.map(item => JSON.stringify(item)) };
  const calls: string[] = []; const model: EditorialModelPort = async ({ stage }) => { calls.push(stage); const reply = queues[stage]?.shift(); if (reply === undefined) throw new Error('fixture_error:' + stage); return reply; }; return { model, calls };
}
describe('bounded runtime controller', () => {
  it('wraps a grounded plan, reviews/layouts the same version and never confirms automatically', async () => {
    const s = input(), { model, calls } = queue(s, [{ tool: 'write', instructions: 'Write' }, { tool: 'review' }], ['# Title\nBody']);
    const outcome = await runEditorialController({ session: s, signal: new AbortController().signal, model, sources: noSources });
    expect(outcome.type).toBe('draft'); expect(canHandoff(outcome.session).blockers).toEqual([]); expect(outcome.session.phase).toBe('pending_confirmation'); expect(() => requireConfirmedOutput(outcome.session)).toThrow(); expect(calls).toEqual(['preflight','decide','write','decide','review']);
  });
  it('deduplicates repeated/paraphrased writes, advances to legal review and counts every model call', async () => {
    const s = input(), { model, calls } = queue(s, Array.from({ length: 12 }, (_,i) => ({ tool: 'write', instructions: 'Different wording ' + i })), ['{"title":"Title","bodyMarkdown":"Body"}']);
    const outcome = await runEditorialController({ session: s, signal: new AbortController().signal, model, sources: noSources }); expect(outcome.type).toBe('draft'); expect(calls.filter(s => s === 'write')).toHaveLength(1); expect(calls.filter(s => s === 'decide').length).toBeLessThan(12);
  });
  it('stops unknown tools and premature submit at the no-progress bound rather than twelve calls', async () => {
    const s = input(), { model, calls } = queue(s, [{ tool: 'mark_confirmed' }, { tool: 'submit' }, { tool: 'submit' }], []);
    const outcome = await runEditorialController({ session: s, signal: new AbortController().signal, model, sources: noSources }); expect(outcome.type).toBe('incomplete'); expect(outcome.session.lastStop?.code).toBe('no_progress'); expect(calls.length).toBeLessThanOrEqual(4); expect(outcome.session.committed).toBeUndefined();
  });
  it('502 stops immediately with a checkpoint and no automatic POST retry', async () => {
    const s = input(), model = vi.fn(async () => { throw new Error('HTTP 502'); });
    const outcome = await runEditorialController({ session: s, signal: new AbortController().signal, model, sources: noSources }); expect(outcome.type).toBe('failed'); expect(model).toHaveBeenCalledTimes(1); expect(outcome.session.evidence).toEqual(s.evidence);
  });
  it('cancellation rejects a deferred response without any late event', async () => {
    const s = input(), abort = new AbortController(); let resolve!: (value: string) => void; const onEvent = vi.fn();
    const model: EditorialModelPort = () => new Promise(done => { resolve = done; }); const promise = runEditorialController({ session: s, signal: abort.signal, model, sources: noSources, onEvent }); abort.abort(); resolve(JSON.stringify(planned(s))); await expect(promise).rejects.toMatchObject({ name: 'AbortError' }); expect(onEvent).not.toHaveBeenCalled();
  });
});

describe('controller budget, repair and async edge invariants', () => {
  it('counts preflight/repair calls in the same total-call budget and preserves an empty checkpoint', async () => {
    const s = input(), { model,calls } = queue(s,[],[]); const outcome = await runEditorialController({ session: s, model, signal: new AbortController().signal, sources: noSources, budget: { modelCalls: 1 } });
    expect(outcome.type).toBe('incomplete'); expect(outcome.session.lastStop?.code).toBe('model_budget_exhausted'); expect(calls).toEqual(['preflight']); expect(outcome.session.evidence).toEqual(s.evidence);
  });
  it('zero remaining writes with an existing draft advances to review instead of spinning', async () => {
    const s = input(); s.candidate = parseDraftArtifact('{"title":"Title","bodyMarkdown":"Body"}',{ id: 'candidate', revision: 1 }).artifact!;
    const { model,calls } = queue(s,[{ tool: 'write', instructions: 'Again' }],[]); const outcome = await runEditorialController({ session: s, model, signal: new AbortController().signal, sources: noSources, budget: { writes: 0 } }); expect(outcome.type).toBe('draft'); expect(calls).not.toContain('write'); expect(calls.filter(stage => stage === 'review')).toHaveLength(1);
  });
  it('allows exactly one JSON structure repair and never a network-error retry', async () => {
    const s = input(); const replies: Record<string,string[]> = { preflight: [JSON.stringify(planned(s))], decide: ['{bad','{bad'], repair: ['{"tool":"submit"}'] }; const calls: string[] = [];
    const model: EditorialModelPort = async ({ stage }) => { calls.push(stage); const raw = replies[stage]?.shift(); if (!raw) throw new Error('fixture_error:'+stage); return raw; };
    const outcome = await runEditorialController({ session: s, model, signal: new AbortController().signal, sources: noSources }); expect(outcome.type).toBe('incomplete'); expect(outcome.session.lastStop?.code).toBe('invalid_json'); expect(calls.filter(s => s === 'repair')).toHaveLength(1); expect(calls).toHaveLength(4);
  });
  it('executes a second distinct empty query, never clears existing evidence, then stops at no-progress bound', async () => {
    const s = input(), sources = { search: vi.fn(async () => []), read: vi.fn(async () => undefined) }; const { model,calls } = queue(s,[{ tool: 'search', query: 'first' },{ tool: 'search', query: 'second' },{ tool: 'search', query: 'second' }],[]);
    const outcome = await runEditorialController({ session: s, model, signal: new AbortController().signal, sources }); expect(outcome.type).toBe('incomplete'); expect(sources.search).toHaveBeenCalledTimes(2); expect(calls.filter(s => s === 'decide')).toHaveLength(2); expect(outcome.session.evidence).toEqual(s.evidence);
  });
  it('A-B-A body oscillation cannot transfer a stamp or count as progress', async () => {
    const s = input(), base = planned(s), refs = base.taskPatch.refs; const calls: string[] = [], codes: string[] = [];
    const preflight = { factPatch: { scopes: [{ id: 'subject', kind: 'other', label: 'Article', anchors: refs, qualifiers: [], identity: 'aligned' }], claims: ['public','article'].map(value => ({ id: value, selector: { scopeId: 'subject', predicate: value }, value, refs, statusBasis: [], epistemic: 'supported', visibility: 'public' })) }, taskPatch: { ...base.taskPatch, criteria: ['public','article'].map(id => ({ id, origin: 'user', refs, severity: 'blocking', verification: 'deterministic', rule: { kind: 'include_facts', factIds: [id], location: 'body' } })) } };
    const replies: Record<string,string[]> = { preflight: [JSON.stringify(preflight)], decide: Array.from({ length: 12 },() => '{"tool":"write","instructions":"Different wording"}'), write: ['public','article','public'].map(body => JSON.stringify({ title: 'Title', bodyMarkdown: body })), review: ['{"blocking":[],"notes":[]}'] };
    const model: EditorialModelPort = async ({ stage }) => { calls.push(stage); const raw = replies[stage]?.shift(); if (!raw) throw new Error('fixture_error:'+stage); return raw; };
    const outcome = await runEditorialController({ session: s, model, signal: new AbortController().signal, sources: noSources, onToolResult: result => codes.push(result.code) }); expect(outcome.type).toBe('incomplete'); expect(codes).toContain('content_cycle'); expect(outcome.session.candidate?.bodyMarkdown).toBe('article'); expect(calls.filter(s => s === 'write')).toHaveLength(3); expect(canHandoff(outcome.session).blockers).toContain('public');
  });
  it('human-pending survives model passes and can only be cleared by an exact-key editor action', async () => {
    const s = input(), { model } = queue(s,[{ tool: 'write', instructions: 'Write' },{ tool: 'review' },{ tool: 'submit' },{ tool: 'submit' },{ tool: 'submit' }],['{"title":"Title","bodyMarkdown":"Body"}'],[{ blocking: [], notes: [], humanChecks: [{ id: 'publication', instruction: 'Editor must verify publication readiness' }] }]);
    const outcome = await runEditorialController({ session: s, model, signal: new AbortController().signal, sources: noSources }); expect(outcome.type).toBe('incomplete'); const current = outcome.session; expect(canHandoff(current).blockers).toContain('human:publication');
    current.review!.criterionChecks = [{ criterionId: 'human:publication', status: 'pass', verifier: 'model', detail: 'The model says done' }]; expect(canHandoff(current).blockers).toContain('human:publication');
    const verified = applyControlEvent(current,{ sessionId: current.sessionId, runId: current.activeRunId!, expectedRevision: current.revision, type: 'human_verified', verification: { criterionId: 'human:publication', inputKey: currentInputKey(current), status: 'pass', actor: 'editor', verifiedAt: '2026-11-11T23:40:00+08:00' } }); expect(canHandoff(verified).blockers).toEqual([]);
  });
  it('global deadline cancels deferred I/O and late completion produces no tool event', async () => {
    vi.useFakeTimers(); try { const s = input(), onEvent = vi.fn(); let resolve!: (value:string)=>void; const model: EditorialModelPort = () => new Promise(done => { resolve = done; }); const running = runEditorialController({ session: s, model, signal: new AbortController().signal, sources: noSources, budget: { maxElapsedMs: 10 }, onEvent }); await vi.advanceTimersByTimeAsync(11); const outcome = await running; expect(outcome.type).toBe('incomplete'); expect(outcome.session.lastStop?.code).toBe('deadline_exceeded'); resolve(JSON.stringify(planned(s))); await Promise.resolve(); expect(onEvent).not.toHaveBeenCalled(); } finally { vi.useRealTimers(); }
  });
  it('late ownership loss is an AbortError, not a write to another session', async () => {
    const s = input(), onEvent = vi.fn(); let current = true, resolve!: (value:string)=>void; const model: EditorialModelPort = () => new Promise(done => { resolve = done; }); const running = runEditorialController({ session: s, model, signal: new AbortController().signal, sources: noSources, isCurrent: () => current, onEvent }); current = false; resolve(JSON.stringify(planned(s))); await expect(running).rejects.toMatchObject({ name: 'AbortError' }); expect(onEvent).not.toHaveBeenCalled();
  });
  it('context capacity is explicit and never silently truncates or calls the model', async () => {
    const s = input(), text = 'x'.repeat(120001); s.evidence[0] = { ...s.evidence[0], text, contentHash: hashText(text) }; const model = vi.fn(async () => ''); const outcome = await runEditorialController({ session: s, model, signal: new AbortController().signal, sources: noSources }); expect(model).not.toHaveBeenCalled(); expect(outcome.session.evidence[0].text).toHaveLength(120001); expect(outcome.session.gaps.some(g => g.requirementId === 'context_capacity')).toBe(true);
  });
});

it('quality progress ignores cosmetic revisions, random IDs, diagnostic wording and reordered entities', () => {
  const s = input(); s.task = { ...s.task, revision: 1, objective: 'Article', intents: ['inform'], criteria: [{ id: 'random-a', origin: 'user', refs: [], verification: 'deterministic', severity: 'blocking', rule: { kind: 'length', min: 1, unit: 'visible_characters' } }] }; const before = qualityFingerprint(s);
  s.revision += 99; s.task.revision += 7; s.task.criteria[0].id = 'random-b'; s.sessionId = 'other-uuid'; s.activeRunId = 'another-run'; s.evidence.reverse(); expect(qualityFingerprint(s)).toBe(before);
});

it('a progress callback cancelling before dispatch cannot start even the first POST', async () => {
  const s = input(), abort = new AbortController(), model = vi.fn(async () => ''); await expect(runEditorialController({ session: s, model, signal: abort.signal, sources: noSources, onStep: () => abort.abort() })).rejects.toMatchObject({ name: 'AbortError' }); expect(model).not.toHaveBeenCalled();
});
it('source event cancellation prevents a subsequent persistence callback or extraction call', async () => {
  const s = input(), abort = new AbortController(), checkpoint = vi.fn(); const plannedReply = planned(s); Object.assign(plannedReply.taskPatch, { requiredSources: [{ id: 'required', selector: { documentId: 'doc' }, purpose: 'Read', refs: plannedReply.taskPatch.refs, depth: 'full_document', state: 'pending' }] });
  const model = vi.fn(async () => JSON.stringify(plannedReply)); let writesBeforeCancel = -1;
  const sources = { search: vi.fn(async () => []), read: vi.fn(async () => ({ documentId: 'doc', title: 'Document', text: 'Reference', complete: true })) };
  await expect(runEditorialController({ session: s, model, signal: abort.signal, sources, onCheckpoint: checkpoint, onEvent: event => { if (event.type === 'evidence_loaded') { writesBeforeCancel = checkpoint.mock.calls.length; abort.abort(); } } })).rejects.toMatchObject({ name: 'AbortError' }); expect(checkpoint.mock.calls.length).toBe(writesBeforeCancel); expect(model).toHaveBeenCalledTimes(1);
});

it('required full reads still execute before writing when the optional search budget is zero', async () => {
  const s = input(), base = planned(s); Object.assign(base.taskPatch,{ requiredSources: [{ id: 'required',selector: { documentId: 'document' },purpose: 'Must read',refs: base.taskPatch.refs,depth: 'full_document',state: 'pending' }] });
  const replies: Record<string,string[]> = { preflight: [JSON.stringify(base)],extract: ['{"factPatch":{}}'],decide: ['{"tool":"write","instructions":"Write"}','{"tool":"review"}'],write: ['{"title":"Title","bodyMarkdown":"Body"}'],review: ['{"blocking":[],"notes":[]}'] };
  const stages: string[] = []; const model: EditorialModelPort = async ({ stage }) => { stages.push(stage); const raw = replies[stage]?.shift(); if (!raw) throw new Error('fixture_error:'+stage); return raw; };
  const sources = { search: vi.fn(async () => []),read: vi.fn(async () => ({ documentId: 'document',title: 'Source',text: 'Full required source',complete: true })) };
  const outcome = await runEditorialController({ session: s,model,sources,signal: new AbortController().signal,budget: { searches: 0 } }); expect(outcome.type).toBe('draft'); expect(sources.read).toHaveBeenCalledTimes(1); expect(sources.search).not.toHaveBeenCalled(); expect(stages.indexOf('extract')).toBeLessThan(stages.indexOf('write')); expect(outcome.session.readReceipts).toHaveLength(1);
});
it('an asked unresolved gap without a new editor reply returns the same question without model calls', async () => {
  const s = input(), base = planned(s); Object.assign(base.taskPatch,{ requirements: [{ id: 'missing',selector: { scopeId: 'subject',predicate: 'quotation' },label: 'Required public quote',reason: 'Explicit task requirement',refs: base.taskPatch.refs,necessity: 'blocking',resolution: 'supply_fact' }] });
  const model: EditorialModelPort = async ({ stage }) => stage === 'preflight' ? JSON.stringify(base) : '{"tool":"ask","fields":["detail"]}';
  const first = await runEditorialController({ session: s,model,sources: noSources,signal: new AbortController().signal }); expect(first.type).toBe('question');
  const secondModel = vi.fn(async () => { throw new Error('fixture_error:must_not_call'); }); const second = await runEditorialController({ session: first.session,model: secondModel,sources: noSources,signal: new AbortController().signal }); expect(second.type).toBe('question'); expect(second.session.lastQuestion).toEqual(first.session.lastQuestion); expect(secondModel).not.toHaveBeenCalled();
});
