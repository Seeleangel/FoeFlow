import { describe, expect, it, vi } from 'vitest';
import { createEditorialSession, hashText } from '../editorialTypes';
import { normalizeModelExtraction } from '../editorialNormalize';
import { applyFactPatch } from '../editorialFacts';
import { applyTaskPatch } from '../editorialTask';
import { taskContractValid } from '../editorialContract';
import { runEditorialController, type EditorialModelPort } from '../editorialController';

function session() {
  const s = createEditorialSession('session');
  const text = 'Write a short public article about the reading on Tuesday.';
  s.evidence = [{ id: 'user', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: { messageId: 'm' }, context: { scenario: 'real' } }];
  return s;
}

describe('model extraction normalization', () => {
  it('realigns quotes and accepts the shapes the live model actually returns', () => {
    const s = session();
    const text = s.evidence[0].text;
    const bad = { evidenceId: 'user', revision: 1, start: 2, end: 6, quote: text };
    const raw = normalizeModelExtraction(s, {
      factPatch: { scopes: [{ id: 'subject', kind: 'event', label: 'Reading', anchors: [bad], qualifiers: { day: 'Tuesday' }, identity: { name: 'Reading' } }], claims: [{ id: 'when', selector: { scopeId: 'subject', predicate: 'day' }, value: 'Tuesday', refs: [{ evidenceId: 'user', revision: 1, start: 0, end: 3, quote: 'Tuesday' }], epistemic: 'asserted', visibility: 'public', statusBasis: '编辑消息直接陈述' }], permissions: [], alignments: [] },
      taskPatch: { objective: 'Public article', intents: [{ id: 'intent', label: '参加提醒' }], criteria: [{ id: 'body', origin: 'user', refs: [bad], severity: 'blocking', verification: 'human', rule: { type: 'length', min: 1, unit: 'visible_characters' } }], sourceWaivers: [{ sourceRequirementId: 'x' }] },
      editorialNotes: ['待核对开场'],
    });
    const facts = applyFactPatch(s, raw.factPatch);
    const planned = applyTaskPatch(facts, raw.taskPatch);
    expect(facts.scopes[0].identity).toBe('provisional');
    expect(facts.scopes[0].qualifiers[0]).toMatchObject({ key: 'day', value: 'Tuesday' });
    expect(facts.claims[0].epistemic).toBe('supported');
    expect(facts.claims[0].refs[0]).toMatchObject({ start: text.indexOf('Tuesday'), quote: 'Tuesday' });
    expect(planned.task.intents).toEqual(['call_to_action']);
    expect(planned.task.criteria[0].rule).toEqual({ kind: 'length', min: 1, unit: 'visible_characters' });
    expect(planned.task.sourceWaivers).toEqual([]);
    expect(taskContractValid(planned)).toBe(true);
    expect(raw.editorialNotes).toEqual([expect.objectContaining({ kind: 'process', text: '待核对开场' })]);
  });

  it('does not abort the run when preflight notes are strings and rules use type', async () => {
    const s = session();
    const text = s.evidence[0].text;
    const bad = { evidenceId: 'user', revision: 1, start: 1, end: 4, quote: text };
    const preflight = { factPatch: { scopes: [], claims: [], permissions: [] }, taskPatch: { objective: 'Public article', intents: [{ label: '通知' }], criteria: [{ id: 'body', refs: [bad], rule: { type: 'length', min: 1, unit: 'visible_characters' } }] }, editorialNotes: ['note'] };
    const queues: Record<string, string[]> = { preflight: [JSON.stringify(preflight)], decide: [JSON.stringify({ tool: 'write', instructions: 'Write' }), JSON.stringify({ tool: 'review' })], write: ['{"title":"Title","bodyMarkdown":"Body"}'], review: ['{"blocking":[],"notes":[]}'] };
    const calls: string[] = [];
    const model: EditorialModelPort = async ({ stage }) => { calls.push(stage); const reply = queues[stage]?.shift(); if (reply === undefined) throw new Error('fixture_error:' + stage); return reply; };
    const outcome = await runEditorialController({ session: s, signal: new AbortController().signal, model, sources: { search: vi.fn(async () => []), read: vi.fn(async () => undefined) } });
    expect(outcome.session.lastStop?.code).not.toBe('model_or_tool_failed');
    expect(outcome.type).toBe('draft');
    expect(calls).toContain('decide');
  });
});
