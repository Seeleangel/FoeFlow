import { describe, it, expect, vi } from 'vitest';
import { createEditorialSession, hashText, type EditorialSession, type EvidenceRef } from '../editorialTypes';
import { runEditorialController, type EditorialModelPort } from '../editorialController';
import { deriveGaps, formatQuestion } from '../editorialGaps';
import { validateAnswerMappings } from '../editorialTurnProcessor';
import type { QuestionBatch } from '../editorialTypesV3';

const noSources = { search: vi.fn(async () => []), read: vi.fn(async () => undefined) };
interface RequirementSpec { id: string; predicate: string; label: string; reason: string }

function opening(id: string): { session: EditorialSession; refs: EvidenceRef[] } {
  const session = createEditorialSession(id);
  const text = '请写一篇面向读者的活动报道。';
  session.evidence = [{ id: 'basis', revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: { messageId: 'm1' }, context: { scenario: 'real' } }];
  return { session, refs: [{ evidenceId: 'basis', revision: 1, start: 0, end: text.length, quote: text }] };
}
function planFor(refs: EvidenceRef[], requirements: RequirementSpec[]): Record<string, unknown> {
  return {
    factPatch: {},
    taskPatch: {
      baseRevision: 0, refs, objective: '活动报道', intents: ['inform'],
      criteria: [{ id: 'body', origin: 'user', refs, severity: 'blocking', verification: 'deterministic', rule: { kind: 'length', min: 1, unit: 'visible_characters' } }],
      requirements: requirements.map(requirement => ({ id: requirement.id, selector: { scopeId: 'event', predicate: requirement.predicate }, label: requirement.label, reason: requirement.reason, whyNeeded: requirement.reason, refs, necessity: 'blocking', resolution: 'supply_fact' })),
    },
  };
}
function reply(session: EditorialSession, text: string, messageId: string): EditorialSession {
  const next = structuredClone(session);
  next.evidence.push({ id: messageId, revision: 1, text, contentHash: hashText(text), kind: 'editor_message', provenance: { messageId }, context: { scenario: 'real' } });
  next.evidenceRevision++;
  return next;
}
async function openQuestion(id: string, requirements: RequirementSpec[]) {
  const { session, refs } = opening(id);
  const model: EditorialModelPort = async ({ stage }) => {
    if (stage === 'preflight') return JSON.stringify(planFor(refs, requirements));
    if (stage === 'decide') return '{"tool":"ask"}';
    throw new Error('fixture_error:' + stage);
  };
  const outcome = await runEditorialController({ session, model, sources: noSources, signal: new AbortController().signal });
  expect(outcome.type).toBe('question');
  if (outcome.type !== 'question') throw new Error('expected_question');
  return outcome;
}
function mappingPayload(data: Record<string, unknown>, spec: [string, string][]) {
  const message = String(data.text ?? '');
  const items = (data.batch as { items: { gapId: string; requested: string }[] }).items;
  return {
    mappings: spec.flatMap(([label, quote]) => {
      const item = items.find(candidate => candidate.requested.includes(label));
      const start = message.indexOf(quote);
      return item ? [{ gapId: item.gapId, start, end: start + quote.length, quote, confidence: 0.9 }] : [];
    }),
  };
}
function finishingModel(stages: string[]): EditorialModelPort {
  let decisions = 0;
  return async ({ stage }) => {
    stages.push(stage);
    if (stage === 'decide') return JSON.stringify(++decisions === 1 ? { tool: 'write', instructions: 'Write' } : { tool: 'review' });
    if (stage === 'write') return JSON.stringify({ title: 'Activity', bodyMarkdown: 'Body' });
    if (stage === 'review') return '{"blocking":[],"notes":[]}';
    throw new Error('fixture_error:' + stage);
  };
}
const twoRequirements: RequirementSpec[] = [
  { id: 'attendance', predicate: 'attendance', label: '出席人数', reason: '报道需要人数' },
  { id: 'date', predicate: 'date', label: '活动日期', reason: '报道需要日期' },
];
const naturalReply = '到场 30 人，日期是 10 月 20 日';

describe('model mapping suggestions (design §3.7)', () => {
  it('binds a natural-language reply to multiple gaps after program validation', async () => {
    const first = await openQuestion('map-ok', twoRequirements);
    const answered = reply(first.session, naturalReply, 'answer-map');
    const stages: string[] = [];
    const base = finishingModel(stages);
    const model: EditorialModelPort = async ({ stage, data }) => {
      if (stage === 'mapping') { stages.push(stage); return JSON.stringify(mappingPayload(data, [['出席人数', '30 人'], ['活动日期', '10 月 20 日']])); }
      return base({ stage, data }, new AbortController().signal);
    };
    const second = await runEditorialController({ session: answered, model, sources: noSources, signal: new AbortController().signal });
    expect(second.type).toBe('draft');
    expect(stages.filter(stage => stage === 'mapping')).toHaveLength(1);
    expect(stages).not.toContain('preflight');
    expect(second.session.answers?.map(answer => [answer.method, answer.value])).toEqual([['model_mapped', '30 人'], ['model_mapped', '10 月 20 日']]);
    expect(deriveGaps(second.session).filter(gap => gap.selector.predicate === 'attendance' || gap.selector.predicate === 'date').every(gap => gap.state === 'resolved')).toBe(true);
    expect(second.session.lastRun?.modelCalls.find(call => call.stage === 'mapping')).toMatchObject({ result: 'ok', acceptedCount: 2, quarantinedCount: 0 });
  });

  it('rejects a quote that is not a continuous substring of the editor message', async () => {
    const first = await openQuestion('map-bad-quote', twoRequirements);
    const answered = reply(first.session, naturalReply, 'answer-bad-quote');
    const model: EditorialModelPort = async ({ stage, data }) => {
      if (stage === 'mapping') {
        const payload = mappingPayload(data, [['出席人数', '30 人']]);
        const items = (data.batch as { items: { gapId: string; requested: string }[] }).items;
        const date = items.find(item => item.requested.includes('活动日期'))!;
        payload.mappings.push({ gapId: date.gapId, start: 0, end: 7, quote: '11 月 1 日', confidence: 0.9 });
        return JSON.stringify(payload);
      }
      throw new Error('fixture_error:' + stage);
    };
    const second = await runEditorialController({ session: answered, model, sources: noSources, signal: new AbortController().signal });
    expect(second.type).toBe('question');
    if (second.type !== 'question') throw new Error('expected_question');
    expect(second.question.id).not.toBe(first.question.id);
    expect(formatQuestion(second.question)).not.toBe(formatQuestion(first.question));
    expect(second.session.answers?.map(answer => answer.gapId)).toHaveLength(1);
    expect(second.session.lastRun?.modelCalls.find(call => call.stage === 'mapping')).toMatchObject({ acceptedCount: 1, quarantinedCount: 1 });
  });

  it('rejects a gap outside the active batch and turns the remainder into a clarification', async () => {
    const first = await openQuestion('map-bad-gap', twoRequirements);
    const answered = reply(first.session, naturalReply, 'answer-bad-gap');
    const model: EditorialModelPort = async ({ stage, data }) => {
      if (stage === 'mapping') {
        const payload = mappingPayload(data, [['出席人数', '30 人']]);
        payload.mappings.push({ gapId: 'not-in-this-batch', start: 0, end: 5, quote: '到场 30', confidence: 0.9 });
        return JSON.stringify(payload);
      }
      throw new Error('fixture_error:' + stage);
    };
    const second = await runEditorialController({ session: answered, model, sources: noSources, signal: new AbortController().signal });
    expect(second.type).toBe('question');
    if (second.type !== 'question') throw new Error('expected_question');
    expect(second.question.id).not.toBe(first.question.id);
    expect(second.session.answers?.map(answer => answer.gapId)).toHaveLength(1);
    expect(second.session.questionBatches?.find(batch => batch.id === second.session.activeBatchId)?.gapIds).toHaveLength(1);
  });

  it('rejects a duplicate-span suggestion for a second gap and clarifies only the remainder', async () => {
    const first = await openQuestion('map-overlap', twoRequirements);
    const answered = reply(first.session, naturalReply, 'answer-overlap');
    const model: EditorialModelPort = async ({ stage, data }) => {
      if (stage === 'mapping') {
        const items = (data.batch as { items: { gapId: string; requested: string }[] }).items;
        const start = naturalReply.indexOf('30 人');
        return JSON.stringify({ mappings: items.map(item => ({ gapId: item.gapId, start, end: start + '30 人'.length, quote: '30 人', confidence: 0.9 })) });
      }
      throw new Error('fixture_error:' + stage);
    };
    const second = await runEditorialController({ session: answered, model, sources: noSources, signal: new AbortController().signal });
    expect(second.type).toBe('question');
    if (second.type !== 'question') throw new Error('expected_question');
    expect(second.question.id).not.toBe(first.question.id);
    const clarification = second.session.questionBatches?.find(batch => batch.id === second.session.activeBatchId);
    expect(clarification?.gapIds).toHaveLength(1);
    expect(clarification?.understood).toEqual(['30 人']);
    expect(clarification?.items[0].why).not.toContain('已了解');
    expect(formatQuestion(second.question)).not.toContain('已了解');
    expect(second.session.lastRun?.modelCalls.find(call => call.stage === 'mapping')).toMatchObject({ acceptedCount: 1, quarantinedCount: 1 });
  });

  it('turns an all-rejected mapping response into a rephrased clarification, not the original question', async () => {
    const first = await openQuestion('map-all-rejected', twoRequirements);
    const answered = reply(first.session, naturalReply, 'answer-all-rejected');
    const model: EditorialModelPort = async ({ stage, data }) => {
      if (stage === 'mapping') {
        const items = (data.batch as { items: { gapId: string }[] }).items;
        return JSON.stringify({ mappings: [{ gapId: items[0].gapId, start: 0, end: 3, quote: '99 人', confidence: 0.9 }] });
      }
      throw new Error('fixture_error:' + stage);
    };
    const second = await runEditorialController({ session: answered, model, sources: noSources, signal: new AbortController().signal });
    expect(second.type).toBe('question');
    if (second.type !== 'question') throw new Error('expected_question');
    expect(second.question.id).not.toBe(first.question.id);
    expect(second.question.reasonCode).toBe('reply_unmapped');
    expect(second.session.questionBatches?.find(batch => batch.id === second.session.activeBatchId)?.understood).toBeUndefined();
    expect(second.session.answers ?? []).toHaveLength(0);
    expect(second.session.questionBatches?.find(batch => batch.id === second.session.activeBatchId)?.gapIds).toHaveLength(2);
    expect(second.session.lastRun?.modelCalls.find(call => call.stage === 'mapping')).toMatchObject({ acceptedCount: 0, quarantinedCount: 1 });
  });

  it('stops on a mapping transport failure and only falls back for unparseable output', async () => {
    const first = await openQuestion('map-fail', twoRequirements);
    const answered = reply(first.session, naturalReply, 'answer-map-fail');
    const transport: EditorialModelPort = async ({ stage }) => {
      if (stage === 'mapping') throw new Error('HTTP 502');
      throw new Error('fixture_error:' + stage);
    };
    const stopped = await runEditorialController({ session: answered, model: transport, sources: noSources, signal: new AbortController().signal });
    expect(stopped.type).toBe('failed');
    expect(stopped.session.lastRun?.stop).toMatchObject({ code: 'model_unavailable', class: 'external', fields: { status: 502 } });
    expect(stopped.session.lastRun?.modelCalls.find(call => call.stage === 'mapping')?.result).toBe('transport_error');
    expect(stopped.session.answers ?? []).toHaveLength(0);
    const syntax: EditorialModelPort = async ({ stage }) => {
      if (stage === 'mapping') return '{bad';
      throw new Error('fixture_error:' + stage);
    };
    const second = await runEditorialController({ session: answered, model: syntax, sources: noSources, signal: new AbortController().signal });
    expect(second.type).toBe('question');
    if (second.type !== 'question') throw new Error('expected_question');
    expect(second.question.id).toBe(first.question.id);
    expect(second.session.lastStop).toBeUndefined();
    expect(second.session.answers ?? []).toHaveLength(0);
    expect(second.session.lastRun?.modelCalls.find(call => call.stage === 'mapping')?.result).toBe('syntax_error');
  });

  it('respects the model-call budget and falls back without calling the model', async () => {
    const first = await openQuestion('map-budget', twoRequirements);
    const answered = reply(first.session, naturalReply, 'answer-map-budget');
    const model = vi.fn(async () => { throw new Error('fixture_error:must_not_call'); });
    const second = await runEditorialController({ session: answered, model, sources: noSources, signal: new AbortController().signal, budget: { modelCalls: 0 } });
    expect(model).not.toHaveBeenCalled();
    expect(second.type).toBe('question');
    if (second.type !== 'question') throw new Error('expected_question');
    expect(second.question.id).toBe(first.question.id);
    expect(second.session.lastRun?.modelCalls.find(call => call.stage === 'mapping')).toBeUndefined();
  });
});

describe('mapping suggestion validation rules', () => {
  const batch: QuestionBatch = {
    id: 'q-1', createdAtMessageId: 'm1', gapIds: ['gap-a', 'gap-b'], status: 'active',
    items: [
      { gapId: 'gap-a', gapClass: 'fact', subject: 'A', requested: 'A 的值', why: '需要', expected: 'free_text', answerSlot: 'slot-a' },
      { gapId: 'gap-b', gapClass: 'fact', subject: 'B', requested: 'B 的值', why: '需要', expected: 'free_text', answerSlot: 'slot-b' },
    ],
  };
  const text = 'A 是 30 人，B 是 10 月 20 日';
  const valid = (gapId: string, quote: string) => { const start = text.indexOf(quote); return { gapId, start, end: start + quote.length, quote, confidence: 0.9 }; };

  it('accepts only suggestions that belong to the batch, match the source span and do not overlap', () => {
    expect(validateAnswerMappings(batch, text, { mappings: [valid('gap-a', '30 人'), valid('gap-b', '10 月 20 日')] })).toMatchObject({ shapeValid: true, rejected: 0, mappings: [{ gapId: 'gap-a' }, { gapId: 'gap-b' }] });
    expect(validateAnswerMappings(batch, text, { mappings: [valid('gap-a', '30 人'), { ...valid('gap-b', '10 月 20 日'), quote: '11 月 1 日' }] })).toMatchObject({ rejected: 1, mappings: [{ gapId: 'gap-a' }] });
    expect(validateAnswerMappings(batch, text, { mappings: [valid('gap-a', '30 人'), valid('not-in-batch', '10 月 20 日')] })).toMatchObject({ rejected: 1, mappings: [{ gapId: 'gap-a' }] });
    expect(validateAnswerMappings(batch, text, { mappings: [valid('gap-a', '30 人'), { ...valid('gap-b', '30 人'), gapId: 'gap-b' }] })).toMatchObject({ rejected: 1, mappings: [{ gapId: 'gap-a' }] });
    expect(validateAnswerMappings(batch, text, { mappings: [{ ...valid('gap-a', '30 人'), confidence: 0.2 }] })).toMatchObject({ rejected: 1, mappings: [] });
    expect(validateAnswerMappings(batch, text, { mappings: [{ gapId: ['gap-a', 'gap-b'], start: 0, end: 5, quote: 'A 是 3', confidence: 0.9 }] })).toMatchObject({ rejected: 1, mappings: [] });
    expect(validateAnswerMappings(batch, text, {})).toMatchObject({ shapeValid: false });
  });
});
