import { expect } from 'vitest';
import originals from './fixtures/editorial-v04-operators.json';
import supplementData from './fixtures/editorial-phaseB-supplement-v1.json';
import { legacyEditorialSession } from '../editorialAgent';
import { runEditorialController, type EditorialModelPort, type EditorialStage } from '../editorialController';
import { hashText, type EditorialSession, type EvidenceRecord, type EvidenceRef, type Scope, type FactClaim, type MetricSpec, type AcceptanceCriterion, type EditorialNote, type PermissionUse } from '../editorialTypes';
import type { SourcePort } from '../editorialSources';
export interface ReplayCase { id: string; input: { setup: string; fixtures: { id: string; location: string; title: string; text: string }[]; initial_message: string | null; followups: { after: string; message: string }[]; operator_events: string[] } }
interface Supplement {
  requiredSources: number[]; scopes: { id: string; kind: Scope['kind']; label: string; source: number | 'editor'; anchor: string; ordinal?: string }[];
  facts: { id: string; scopeId: string; predicate: string; value: string; source: number | 'editor'; visibility?: FactClaim['visibility']; epistemic?: FactClaim['epistemic'] }[];
  include?: string[]; location?: 'body' | 'first_body_paragraph';
  requirements?: { id: string; scopeId: string; predicate: string; label: string; metric?: MetricSpec }[];
  permissions?: { subjectId: string; state: 'allowed' | 'denied'; purpose: string; source: number | 'editor'; anchor: string }[];
  permissionCriteria?: { subjectId: string; purpose: string; identity: PermissionUse['identity'] }[]; notes?: EditorialNote[];
}
export const replayCases: ReplayCase[] = originals;
const supplements = supplementData as Record<string, Supplement>;
function grounded(c: ReplayCase, spec: Supplement, data: Record<string, unknown>, preflight: boolean) {
  const evidence = data.evidence as EvidenceRecord[], task = data.task as EditorialSession['task'];
  const source = (id: number | 'editor') => id === 'editor' ? evidence.find(e => e.kind === 'editor_message') : evidence.find(e => e.provenance.documentTitle === c.input.fixtures[id]?.title);
  const ref = (e: EvidenceRecord, quote: string): EvidenceRef => { const start = e.text.indexOf(quote); if (start < 0) throw new Error('fixture_error:grounding'); return { evidenceId: e.id, revision: e.revision, start, end: start + quote.length, quote }; };
  const user = source('editor')!; const refs = [ref(user, user.text)];
  const scopes = spec.scopes.flatMap(item => { const e = source(item.source); if (!e) return []; const anchors = [ref(e,item.anchor)]; return [{ id: item.id, kind: item.kind, label: item.label, identity: item.ordinal ? 'provisional' : 'aligned', anchors, qualifiers: item.ordinal ? [{ key: 'ordinal', value: item.ordinal, refs: anchors }] : [] }]; });
  const claims = spec.facts.flatMap(item => { const e = source(item.source); if (!e) return []; const refs = [ref(e, item.value)], visibility = item.visibility ?? 'public'; return [{ id: item.id, selector: { scopeId: item.scopeId, predicate: item.predicate }, value: item.value, refs, epistemic: item.epistemic ?? 'supported', visibility, statusBasis: visibility === 'public' ? [] : refs }]; });
  const permissions = (spec.permissions ?? []).flatMap(item => { const e = source(item.source); if (!e) return []; return [{ id: 'permission:' + item.subjectId + ':' + item.purpose, subjectId: item.subjectId, state: item.state, refs: [ref(e,item.anchor)], uses: [{ channel: 'public', purpose: item.purpose, identity: 'not_applicable' }] }]; });
  const result: Record<string, unknown> = { factPatch: { scopes, claims, permissions }, editorialNotes: spec.notes ?? [] };
  if (preflight) {
    const criteria: AcceptanceCriterion[] = [{ id: 'body', origin: 'user', refs, severity: 'blocking', verification: 'deterministic', rule: { kind: 'length', min: 1, unit: 'visible_characters' } }];
    if (spec.include?.length) criteria.push({ id: 'required-facts', origin: 'user', refs, severity: 'blocking', verification: 'deterministic', rule: { kind: 'include_facts', factIds: spec.include, location: spec.location ?? 'body' } });
    for (const item of spec.permissionCriteria ?? []) criteria.push({ id: 'use:' + item.subjectId, origin: 'user', refs, severity: 'blocking', verification: 'deterministic', rule: { kind: 'permission', subjectIds: [item.subjectId], use: item.purpose, channel: 'public', identity: item.identity } });
    result.taskPatch = { baseRevision: task.revision, refs, objective: task.objective || '根据编辑要求撰写公开稿件', intents: spec.requirements?.some(r => r.predicate === 'quotation') ? ['interview'] : ['inform'], targetScopes: spec.scopes.map(scope => scope.id),
      criteria, requiredSources: spec.requiredSources.map(index => ({ id: 'required:' + index, selector: { title: c.input.fixtures[index].title }, purpose: '编辑指定的材料必须真实读取并用于后续核对', refs, depth: 'full_document', state: 'pending' })),
      requirements: (spec.requirements ?? []).map(item => ({ id: item.id, selector: { scopeId: item.scopeId, predicate: item.predicate, ...(item.metric ? { metric: item.metric } : {}) }, label: item.label, reason: '当前任务明确需要本项；其他对象或阶段信息不能替代', refs, necessity: 'blocking', resolution: 'supply_fact' })) };
  }
  return result;
}
export async function replay(c: ReplayCase) {
  const spec = supplements[c.id]; if (!spec) throw new Error('fixture_error:no_supplement');
  const queues: Record<string,string[]> = {}; const initial: Record<string,number> = {};
  for (const event of c.input.operator_events) if (event.startsWith('模拟响应：')) { const parsed = JSON.parse(event.slice('模拟响应：'.length)) as { stage: string; response: string }; (queues[parsed.stage] ??= []).push(parsed.response); }
  for (const [stage, values] of Object.entries(queues)) initial[stage] = values.length;
  const stages: EditorialStage[] = [], checkpoints: EditorialSession[] = [], searches: string[] = [], reads: string[] = [];
  const model: EditorialModelPort = async ({ stage,data }) => {
    stages.push(stage); const serialized = JSON.stringify(data); expect(serialized).not.toContain('模拟响应：'); expect(serialized).not.toContain('operator_events'); expect(serialized).not.toContain('"oracle"'); expect(serialized).not.toContain('"' + c.id + '"');
    if (stage === 'preflight' || stage === 'extract') return JSON.stringify(grounded(c,spec,data,stage === 'preflight'));
    const response = queues[stage]?.shift(); if (response === undefined) throw new Error('fixture_error:' + stage); return response;
  };
  const documents = c.input.fixtures.map((fixture,index) => ({ documentId: 'document:' + hashText(fixture.title + index).slice(0,24), title: fixture.title, text: fixture.text, complete: true }));
  const sources: SourcePort = { search: async query => {
    searches.push(query); if (c.id === 'R09' && query === '全阶段结项核验表 参与学生总数') return [];
    const named = documents.filter(d => d.title === query); const result = named.length ? named : c.id === 'R07' || c.id === 'R12' ? [...documents].reverse() : documents;
    return result.map(d => ({ documentId: d.documentId, title: d.title, snippet: d.text.slice(0,80), contentHash: hashText(d.text) }));
  }, read: async id => { reads.push(id); return documents.find(d => d.documentId === id); } };
  if (c.input.initial_message === null) throw new Error('fixture_error:no_initial_message');
  const session = legacyEditorialSession({ messages: [{ role: 'user', content: c.input.initial_message }], previousDraft: '' });
  const outcome = await runEditorialController({ session, model, sources, signal: new AbortController().signal, onCheckpoint: snapshot => checkpoints.push(snapshot) });
  if ((outcome.type === 'failed' || outcome.type === 'incomplete') && outcome.reason.startsWith('fixture_error:')) throw new Error(outcome.reason);
  return { outcome, stages, checkpoints, searches, reads, initial, remaining: Object.fromEntries(Object.entries(queues).map(([stage,values]) => [stage,values.length])) };
}
