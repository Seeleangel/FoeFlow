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


  it('keeps obligations whose refs carry an empty quote instead of discarding the task', () => {
    const s = session();
    const text = s.evidence[0].text;
    const empty = { evidenceId: 'user', revision: 1, start: 0, end: 0, quote: '' };
    const withOffsets = { evidenceId: 'user', revision: 1, start: 0, end: 5, quote: '' };
    const raw = normalizeModelExtraction(s, {
      factPatch: { scopes: [{ id: 'subject', kind: 'event', label: 'Reading', anchors: [empty] }], claims: [{ id: 'when', selector: { scopeId: 'subject', predicate: 'day' }, value: 'Tuesday', refs: [empty], epistemic: 'asserted', visibility: 'public' }], permissions: [], alignments: [] },
      taskPatch: { objective: 'Public article', intents: ['inform'], requirements: [{ id: 'when', selector: { scopeId: 'subject', predicate: 'day' }, label: 'Tuesday reading', reason: 'Editor stated the day.', refs: [empty], necessity: 'blocking', resolution: 'supply_fact' }], criteria: [{ id: 'body', refs: [withOffsets], rule: { kind: 'semantic', instruction: 'Short article.' } }] },
    });
    const facts = applyFactPatch(s, raw.factPatch as never);
    const planned = applyTaskPatch(facts, raw.taskPatch as never);
    expect(planned.task.requirements).toHaveLength(1);
    expect(planned.task.requirements[0].refs[0]).toMatchObject({ start: 0, end: text.length, quote: text });
    expect(facts.claims).toHaveLength(1);
    expect(facts.claims[0].refs[0]).toMatchObject({ start: 0, end: text.length, quote: text });
    expect(planned.task.criteria[0].refs[0]).toMatchObject({ start: 0, end: 5, quote: text.slice(0, 5) });
    expect(taskContractValid(planned)).toBe(true);
  });

  it('accepts abbreviated refs with a refId alias and no revision when the quote anchors uniquely', () => {
    const s = session(); const text = s.evidence[0].text;
    const short = { refId: 'user', quote: 'Tuesday' };
    const raw = normalizeModelExtraction(s, {
      factPatch: { scopes: [{ id: 'subject', kind: 'event', label: 'Reading', anchors: [short] }], claims: [{ id: 'when', selector: { scopeId: 'subject', predicate: 'day' }, value: 'Tuesday', refs: [short], epistemic: 'asserted', visibility: 'public' }], permissions: [], alignments: [] },
      taskPatch: { objective: 'Public article', intents: ['inform'], criteria: [{ id: 'body', refs: [short], rule: { kind: 'semantic', instruction: 'Short article.' } }] },
    });
    const facts = applyFactPatch(s, raw.factPatch as never);
    const planned = applyTaskPatch(facts, raw.taskPatch as never);
    expect(facts.scopes[0].anchors[0]).toMatchObject({ evidenceId: 'user', revision: 1, start: text.indexOf('Tuesday'), end: text.indexOf('Tuesday') + 'Tuesday'.length, quote: 'Tuesday' });
    expect(facts.claims[0].refs[0]).toMatchObject({ evidenceId: 'user', start: text.indexOf('Tuesday') });
    expect(planned.task.criteria[0].refs[0]).toMatchObject({ evidenceId: 'user', quote: 'Tuesday' });
    expect(taskContractValid(planned)).toBe(true);
  });

  it('accepts anchor wrappers, numeric values and source-spelled dates from live extraction', () => {
    const s = session();
    const text = '帮学院写报名推文。讲座 2026 年 12 月 8 日 19:00 在知行楼 205 室，名额 30 人。';
    s.evidence = [{ ...s.evidence[0], text, contentHash: hashText(text) }];
    const quote = (value: string) => { const start = text.indexOf(value); return { evidenceId: 'user', revision: 1, start, end: start + value.length, quote: value }; };
    const raw = normalizeModelExtraction(s, {
      factPatch: {
        scopes: [{ id: 'lecture', kind: 'event', label: '讲座', anchors: [{ text: '帮学院', refs: [{ evidenceId: 'user', revision: 1, start: 0, end: 3, quote: '帮学院' }] }], qualifiers: [], identity: 'provisional' }],
        claims: [
          { id: 'time', selector: { scopeId: 'lecture', predicate: 'start_time' }, value: '2026-12-08T19:00', refs: [quote('2026 年 12 月 8 日 19:00')], epistemic: 'supported', visibility: 'public', statusBasis: [quote('2026 年 12 月 8 日 19:00')] },
          { id: 'capacity', selector: { scopeId: 'lecture', predicate: 'capacity' }, value: 30, refs: [quote('名额 30 人')], epistemic: 'supported', visibility: 'public', statusBasis: [quote('名额 30 人')] },
        ],
        permissions: [], alignments: [],
      },
    });
    const facts = applyFactPatch(s, raw.factPatch as never);
    expect(facts.scopes).toHaveLength(1);
    expect(facts.claims).toHaveLength(2);
    expect(facts.claims.find(claim => claim.id === 'time')?.value).toBe('2026 年 12 月 8 日 19:00');
    expect(facts.claims.find(claim => claim.id === 'capacity')?.value).toBe('30');
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
