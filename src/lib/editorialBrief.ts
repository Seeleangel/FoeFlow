import type { AIMessage } from './ai';
import { hashText } from './editorialTypes';

const FIELD_LABELS = {
  topic: '主题',
  time: '活动时间',
  location: '活动地点或线上平台',
  registration: '报名方式和已确定的截止时间',
  audience: '参与对象',
  organizer: '主办方',
  capacity: '名额',
  preparation: '参与前的准备事项',
  detail: '任务所需的其他信息',
};
const MODES = ['registration', 'preview', 'example', 'general'] as const;
type Mode = typeof MODES[number];
type Field = keyof typeof FIELD_LABELS;
type Fact = { field: Field; value: string; source: string; quote: string; status: 'known' | 'pending' | 'unverified' | 'private' };
export type EditorialEvidence = { id: string; text: string; priority: number };
export type EditorialBrief = { mode: Mode; facts: Fact[]; needed: Field[] };

const REGISTRATION_FIELDS: Field[] = ['time', 'location', 'registration'];
const normalized = (s: string) => s.normalize('NFKC').replace(/\s+/g, '');
const pending = /另行通知|后续.{0,6}(?:通知|公布)|待定|待公布|待确认|未确定|未公布/;
const unverified = /没核实|未.{0,2}核实|待核实|未经证实|未获证实/;
const isField = (value: unknown): value is Field =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(FIELD_LABELS, value);

export const BRIEF_INSTRUCTIONS = `当 briefRequired 为真，请在同一个工具 JSON 中加入 brief，例如
{"mode":"registration","needed":[],"facts":[{"field":"time","value":"12 月 9 日 18:30","source":"u1","quote":"12 月 9 日 18:30 于知行楼","status":"known"}]}。
mode 按用户要的稿件判断。正式活动报名通知用 registration，允许留待后续公布的预告用 preview，明确要虚构示例或占位稿用 example，其余用 general。
field 只用 ${Object.keys(FIELD_LABELS).join('、')}。value 用原文的连续片段，quote 是包含该片段的原文，source 是 evidence 里的 ID。
status 只用 known、pending、unverified、private。提取确有依据的当前活动事实和用户明确标为待核或内部的信息。历史活动、过时安排和对照稿里的错误值不可作为本轮事实。两份同级资料确实给出不同值时，两条都保留。把主办方和参与对象分开。
needed 只列完成当前任务不可缺少的字段。额外细节、可省略的主办方、未要求的活动信息不要放入 needed。示例用占位符。允许留白的预告可以直接写。
required 是程序计算出的缺口。如果缺口可能从工作台取得，先查找。需要用户补充时，ask 返回 {"tool":"ask","fields":["time","location"]}，只选确实未解决的字段。`;

export function conversationEvidence(conversation: AIMessage[], previousDraft: string): EditorialEvidence[] {
  const editor = conversation.flatMap((message, index) => message.role === 'user'
    ? [{ id: `u${index + 1}`, text: message.content, priority: index + 2 }]
    : []);
  return previousDraft ? [...editor, { id: 'previousDraft', text: previousDraft, priority: 1 }] : editor;
}

export function readEditorialBrief(value: unknown, evidence: EditorialEvidence[]): EditorialBrief | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const mode = MODES.find(item => item === raw.mode);
  if (!mode || !Array.isArray(raw.facts) || !Array.isArray(raw.needed)) return undefined;
  const facts: Fact[] = [];
  for (const item of raw.facts.slice(0, 24)) {
    if (!item || typeof item !== 'object' || !isField(item.field) || typeof item.value !== 'string' ||
      (item.status !== undefined && !['known', 'pending', 'unverified', 'private'].includes(item.status)) || typeof item.quote !== 'string' || !item.value.trim() || item.value.length > 300 || item.quote.length > 600) continue;
    const source = evidence.find(entry => entry.id === item.source);
    const quote = normalized(item.quote);
    const text = normalized(item.value);
    if (!source || !quote.includes(text) || !normalized(source.text).includes(quote)) continue;
    const status = item.status === 'private' ? 'private'
      : item.status === 'unverified' || unverified.test(item.quote) ? 'unverified'
      : item.status === 'pending' || pending.test(item.value) ? 'pending' : 'known';
    facts.push({ field: item.field, value: item.value.trim(), source: source.id, quote: item.quote, status });
  }
  return { mode, facts, needed: [...new Set(raw.needed.filter(isField))] };
}

export function resolveEditorialBrief(brief: EditorialBrief, evidence: EditorialEvidence[]) {
  const accepted: Fact[] = [];
  const conflicts = new Map<Field, string[]>();
  for (const field of Object.keys(FIELD_LABELS).filter(isField)) {
    const candidates = brief.facts.filter(fact => fact.field === field && fact.status === 'known');
    if (!candidates.length) continue;
    const priority = (fact: Fact) => evidence.find(entry => entry.id === fact.source)?.priority ?? 0;
    const best = Math.max(...candidates.map(priority));
    const current = candidates.filter(fact => priority(fact) === best);
    const unique = [...new Map(current.map(fact => [normalized(fact.value), fact])).values()];
    const distinct = unique.filter(fact => !unique.some(other => other.source === fact.source && other !== fact &&
      normalized(other.value).includes(normalized(fact.value))));
    if (field === 'detail') accepted.push(...distinct);
    else if (distinct.length === 1) accepted.push(distinct[0]);
    else conflicts.set(field, distinct.map(fact => fact.value));
  }
  const required = brief.mode === 'example' || brief.mode === 'preview' ? []
    : [...new Set([...brief.needed, ...(brief.mode === 'registration' ? REGISTRATION_FIELDS : []), ...conflicts.keys()])]
      .filter(field => !accepted.some(fact => fact.field === field));
  return { accepted, conflicts, required };
}

export function editorialQuestion(required: Field[], conflicts: Map<Field, string[]>): string {
  const fields = required.map(field => {
    const values = conflicts.get(field);
    return values ? `${FIELD_LABELS[field]}以哪项为准（${values.join('或')}）` : FIELD_LABELS[field];
  });
  return `请确认稿件需要的${fields.join('、')}。`;
}

export function protectedEditorialText(brief: EditorialBrief, evidence: EditorialEvidence[]) {
  const protectedFacts = brief.facts.filter(fact => fact.status === 'unverified' || fact.status === 'private');
  const privateText = new Set(protectedFacts.filter(fact => fact.status === 'private').map(fact => fact.value));
  const pendingQuotes = new Set(protectedFacts.filter(fact => fact.status === 'unverified').map(fact => fact.value));
  for (const { text } of evidence) {
    for (const sentence of text.split(/[。！？\n]/)) {
      if (!unverified.test(sentence)) continue;
      for (const match of sentence.matchAll(/[「“"]([^」”"]{3,180})[」”"]/g)) pendingQuotes.add(match[1]);
    }
  }
  return { privateText: [...privateText], pendingQuotes: [...pendingQuotes].filter(text => !privateText.has(text)) };
}

export function containsEditorialText(haystack: string, needle: string) {
  const text = normalized(needle).replace(/[「」“”"。！？]+$/g, '').replace(/^[「“"]+/g, '');
  return !!text && normalized(haystack).includes(text);
}

export function narrowsEditorialAudience(draft: string, audience: string, organizer?: string) {
  const target = normalized(audience);
  const content = normalized(draft);
  const scoped = /(?:面向|(?:参与|报名|招募)?对象[:：为是]*)([^。！？、，,：:]{0,16}(?:学院|大学|学部|本院|本校))(?:的)?/g;
  if ([...content.matchAll(scoped)].some(match =>
    !target.includes(match[1]) && content.slice((match.index ?? 0) + match[0].length).startsWith(target),
  )) return true;
  return !!organizer && !target.includes(normalized(organizer)) && ['面向', '参与对象：', '报名对象：'].some(
    label => containsEditorialText(draft, label + organizer + audience),
  );
}


/** V2 compatibility is deliberately separate from the v1 loop until WP06 integration. */
export function legacyBriefCandidates(brief: EditorialBrief, session: import('./editorialTypes').EditorialSession): { scopes: import('./editorialTypes').Scope[]; claims: import('./editorialTypes').FactClaim[]; diagnostics: import('./editorialTypes').Diagnostics[] } {
  const scopes: import('./editorialTypes').Scope[] = [], claims: import('./editorialTypes').FactClaim[] = [], diagnostics: import('./editorialTypes').Diagnostics[] = [];
  for (const fact of brief.facts) {
    const source = session.evidence.find(e => e.id === fact.source), start = source?.text.indexOf(fact.quote) ?? -1;
    if (!source || start < 0 || !fact.quote.includes(fact.value)) { diagnostics.push({ code: 'invalid_reference', message: 'Legacy candidate needs exact source offsets.', refs: [] }); continue; }
    const refs = [{ evidenceId: source.id, revision: source.revision, start, end: start + fact.quote.length, quote: fact.quote }];
    const id = 'legacy-' + hashText(`${source.id}:${start}:${fact.field}:${fact.value}`).slice(0, 24);
    scopes.push({ id, kind: 'other', label: FIELD_LABELS[fact.field], qualifiers: [], anchors: refs, identity: 'provisional' });
    claims.push({ id: id + '-claim', selector: { scopeId: id, predicate: fact.field }, value: fact.value, refs, epistemic: 'unknown', visibility: fact.status === 'private' ? 'private' : 'public', statusBasis: fact.status === 'private' ? refs : [] });
  }
  if (brief.facts.length || brief.needed.length) diagnostics.push({ code: 'legacy_scope_unresolved', message: 'Legacy fields are unaligned candidates, not authority for satisfying requirements or permissions.', refs: [] });
  return { scopes, claims, diagnostics };
}
