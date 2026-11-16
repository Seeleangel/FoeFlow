import { abortable, throwIfAborted } from './agentRuntime';
import { searchEditorialLibraryDocuments } from './articleSearch';
import { readEditorialLibraryDocument } from './libraryStorage';
import { hashText, stableJson, type EditorialSession, type ToolResult, type LoadedSource, type ReadReceipt, type EvidenceRecord } from './editorialTypes';
export interface SourceDescriptor { documentId: string; title: string; snippet?: string; contentHash?: string }
export interface SourceDocument { documentId: string; title: string; text: string; complete: boolean; kind?: EvidenceRecord['kind']; range?: [number, number] }
export interface SourcePort { search(query: string, signal: AbortSignal): Promise<SourceDescriptor[]>; read(documentId: string, signal: AbortSignal): Promise<SourceDocument | undefined> }
export const localSourcePort: SourcePort = { search: async (q, signal) => { throwIfAborted(signal); return abortable(searchEditorialLibraryDocuments(q), signal); }, read: async (id, signal) => { throwIfAborted(signal); return abortable(readEditorialLibraryDocument(id), signal); } };
export const normalizeSourceQuery = (query: string): string => query.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
const TITLE_UI_PREFIX = /^(?:工作台|文章库|素材库|资料库|知识库|文档库)+/;
const titleCore = (title: string): string => {
  const normalized = normalizeSourceQuery(title).replace(/\s+/g, '');
  const core = normalized.replace(TITLE_UI_PREFIX, '').replace(/^[的了的]+/, '');
  return core || normalized;
};
function longestCommonSubstring(a: string, b: string): number {
  let best = 0; const row = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) { let diagonal = 0; for (let j = 1; j <= b.length; j++) { const above = row[j]; row[j] = a[i - 1] === b[j - 1] ? diagonal + 1 : 0; if (row[j] > best) best = row[j]; diagonal = above; } }
  return best;
}
/** Score how well a natural-language source reference matches a library document title. 1 = same title, 0 = unrelated. */
export function sourceTitleScore(requested: string, actual: string): number {
  const a = titleCore(requested), b = titleCore(actual);
  if (!a || !b) return a === b ? 1 : 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.9;
  const length = longestCommonSubstring(a, b), ratio = length / Math.min(a.length, b.length);
  return length >= 4 && ratio >= 0.6 ? ratio * 0.8 : 0;
}
export function sourceTitlesMatch(requested: string, actual: string): boolean { return sourceTitleScore(requested, actual) >= 0.6; }
const PERIOD_PRESENT = /本期|今期|本次|当次|新一期/;
const PERIOD_PAST = /往期|上期|前期|去年|历年|历史|旧版|以往/;
/** A current-edition reference must never be served by a stale edition just because search returned one hit. */
export function sourcePeriodConflict(requested: string, actual: string): boolean {
  return (PERIOD_PRESENT.test(requested) && PERIOD_PAST.test(actual)) || (PERIOD_PAST.test(requested) && PERIOD_PRESENT.test(actual));
}
const MULTI_DOCUMENT_TITLE = /两期|多期|各期|多篇|两份|两篇|多个|全部|合集|系列|历年|历次/;
export class SourceSearchCache {
  private cache = new Map<string, SourceDescriptor[]>(); private found = new Map<string, SourceDescriptor>();
  constructor(private port: SourcePort) {}
  discovered(): SourceDescriptor[] { return structuredClone([...this.found.values()]); }
  get size(): number { return this.cache.size; }
  has(query: string): boolean { return this.cache.has(normalizeSourceQuery(query)); }
  async search(query: string, signal: AbortSignal): Promise<{ status: 'progress' | 'no_progress'; sources: SourceDescriptor[]; cached: boolean }> {
    throwIfAborted(signal); const key = normalizeSourceQuery(query); if (!key || key.length > 1000) throw new Error('invalid_query');
    const old = this.cache.get(key); if (old) return { status: 'no_progress', sources: structuredClone(old), cached: true };
    const sources = await abortable(this.port.search(key, signal), signal); throwIfAborted(signal);
    const changed = sources.some(source => { const prior = this.found.get(source.documentId); return !prior || prior.contentHash !== source.contentHash; });
    this.cache.set(key, structuredClone(sources)); for (const source of sources) this.found.set(source.documentId, structuredClone(source));
    return { status: changed ? 'progress' : 'no_progress', sources, cached: false };
  }
}
const result = (code: string, status: ToolResult['status'] = 'failed'): ToolResult => ({ tool: 'read', status, code, changedIds: [], events: [], allowedNext: ['ask'], diagnostics: status === 'failed' || status === 'rejected' ? [{ code, message: '指定来源尚未完成真实读取：' + code, refs: [] }] : [] });
/** A read is staged as evidence only. Receipt creation is a separate post-consumer boundary. */
export async function readSourceDocument(s: EditorialSession, documentId: string, signal: AbortSignal, port: SourcePort = localSourcePort, sourceRequirementId?: string, allowTitleMismatch = false): Promise<ToolResult> {
  throwIfAborted(signal);
  try {
    const source = sourceRequirementId ? s.task.requiredSources.find(source => source.id === sourceRequirementId) : undefined;
    if (sourceRequirementId && !source) return result('unknown_source_requirement', 'rejected');
    const document = await abortable(port.read(documentId, signal), signal); throwIfAborted(signal);
    if (!document || document.documentId !== documentId || !document.text.trim()) return result('source_unavailable');
    if (source?.selector.title && !sourceTitlesMatch(source.selector.title, document.title) && !allowTitleMismatch) return result('source_identity_mismatch');
    if (source?.depth === 'full_document' && !document.complete) return result('source_depth_insufficient');
    const id = 'source-' + hashText(documentId).slice(0,24), previous = s.evidence.find(e => e.id === id), contentHash = hashText(document.text);
    if (s.evidence.filter(e => e.id !== id).reduce((n,e) => n + e.text.length, 0) + document.text.length > 120000) return result('context_capacity');
    const range: [number,number] = source?.depth === 'full_document' ? [0, document.text.length] : document.range ?? [0, document.text.length];
    if (!Number.isSafeInteger(range[0]) || !Number.isSafeInteger(range[1]) || range[0] < 0 || range[1] <= range[0] || range[1] > document.text.length) return result('invalid_source_range', 'rejected');
    const loadedSources: LoadedSource[] = [{ sourceRequirementId, documentId, evidenceId: id, range }];
    if (previous?.contentHash === contentHash && previous.provenance.complete === document.complete && previous.provenance.documentTitle === document.title) return { ...result('source_reused', 'no_progress'), loadedSources };
    const record: EvidenceRecord = { id, revision: (previous?.revision ?? 0) + 1, contentHash, text: document.text, kind: document.kind ?? 'library', provenance: { documentId, documentTitle: document.title, complete: document.complete }, context: { scenario: 'unknown' } };
    return { ...result('source_loaded', 'progress'), loadedSources, changedIds: [id], events: [{ sessionId: s.sessionId, runId: s.activeRunId ?? '', expectedRevision: s.revision, type: 'evidence_loaded', records: [record], receipts: [] }] };
  } catch (error) { throwIfAborted(signal); if (error instanceof Error && error.name === 'AbortError') throw error; return result('source_read_failed'); }
}
/** A plural source title is satisfied only by consuming every member document in one call. */
async function readSourceBundle(s: EditorialSession, sourceId: string, documentIds: string[], signal: AbortSignal, port: SourcePort): Promise<ToolResult> {
  const results: ToolResult[] = [];
  for (const documentId of documentIds) { throwIfAborted(signal); results.push(await readSourceDocument(s, documentId, signal, port, sourceId, true)); }
  const usable = results.filter(item => item.status === 'progress' || item.status === 'no_progress');
  if (!usable.length) return results.find(item => item.status === 'failed' || item.status === 'rejected') ?? result('source_unavailable');
  const progressed = results.some(item => item.status === 'progress');
  return { tool: 'read', status: progressed ? 'progress' : 'no_progress', code: progressed ? 'source_loaded' : 'source_reused', changedIds: results.flatMap(item => item.changedIds), events: results.flatMap(item => item.events), loadedSources: results.flatMap(item => item.loadedSources ?? []), allowedNext: ['ask'], diagnostics: [] };
}
export async function loadRequiredSource(s: EditorialSession, sourceId: string, signal: AbortSignal, port: SourcePort = localSourcePort): Promise<ToolResult> {
  throwIfAborted(signal); const source = s.task.requiredSources.find(source => source.id === sourceId); if (!source) return result('unknown_source_requirement', 'rejected');
  let id = source.selector.documentId, allowTitleMismatch = false;
  if (!id) {
    try {
      const matches = await abortable(port.search(source.selector.title ?? '', signal), signal); throwIfAborted(signal);
      // A source named in prose ("读工作台的毕业典礼活动卡") rarely equals the stored document title.
      // Rank the search results by title similarity and only accept an unambiguous winner.
      const distinct = [...new Map(matches.map(match => [match.documentId, match])).values()];
      const ranked = distinct
        .map(match => ({ match, score: sourceTitleScore(source.selector.title ?? '', match.title) }))
        .filter(item => item.score >= 0.6)
        .sort((a, b) => b.score - a.score);
      // Title similarity alone can score "本期准备单" against "…往期准备单" at 0.8 because the
      // shared tail "期准备单" dominates; a stale edition is never the requested source.
      const present = ranked.filter(item => !sourcePeriodConflict(source.selector.title ?? '', item.match.title));
      if (ranked.length && !present.length) return result('source_unavailable');
      const best = present[0], second = present[1];
      const tied = !!second && best.score === second.score && best.match.documentId !== second.match.documentId;
      if (best && !tied && !(second && best.score < 1 && best.score - second.score < 0.15)) id = best.match.documentId;
      // A directive can hand us a whole sentence as the source name ("书目、名额和行前准备以工作台的本期准备单为准。").
      // If full-text search returned exactly one document, that hit is the named source; title similarity is unusable there.
      else if (!best && distinct.length === 1) {
        // A stale edition is not the requested source: "本期准备单" must not be satisfied by "往期准备单".
        if (sourcePeriodConflict(source.selector.title ?? '', distinct[0].title)) return result('source_unavailable');
        id = distinct[0].documentId; allowTitleMismatch = true;
      }
      else if (!best && distinct.length > 1) {
        // Several versions may match full-text terms ("江岚读书会本期准备单" vs "…往期准备单").
        // Prefer the unique longest title overlap; a tie stays ambiguous instead of guessing.
        const overlaps = distinct
          .map(match => ({ match, overlap: longestCommonSubstring(titleCore(source.selector.title ?? ''), titleCore(match.title)) }))
          .filter(item => item.overlap >= 4)
          .sort((a, b) => b.overlap - a.overlap);
        // A plural reference ("影子校长两期记录") names a bundle of documents; reading one of them
        // leaves the requirement unsatisfied forever, so read every strongly overlapping member.
        if (MULTI_DOCUMENT_TITLE.test(source.selector.title ?? '') && overlaps.length >= 2) return readSourceBundle(s, sourceId, overlaps.slice(0, 3).map(item => item.match.documentId), signal, port);
        const top = overlaps[0], next = overlaps[1];
        if (top && (!next || top.overlap > next.overlap)) { id = top.match.documentId; allowTitleMismatch = true; }
        else return result('source_ambiguous');
      }
      else return result(distinct.length ? 'source_ambiguous' : 'source_unavailable');
    } catch (error) { throwIfAborted(signal); if (error instanceof Error && error.name === 'AbortError') throw error; return result('source_read_failed'); }
  }
  return readSourceDocument(s, id, signal, port, sourceId, allowTitleMismatch);
}
function stringsIn(value: unknown): string[] { return typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap(stringsIn) : value && typeof value === 'object' ? Object.values(value).flatMap(stringsIn) : []; }
/** Call only AFTER the exact supplied context has been successfully consumed by the stated stage. */
export function recordSourceConsumption(s: EditorialSession, loaded: LoadedSource[], stage: ReadReceipt['consumedByStage'], context: string): ToolResult {
  let strings: string[]; try { strings = stringsIn(JSON.parse(context)); } catch { strings = [context]; }
  const receipts: ReadReceipt[] = [];
  for (const load of loaded) {
    const e = s.evidence.find(e => e.id === load.evidenceId), source = s.task.requiredSources.find(source => source.id === load.sourceRequirementId);
    if (!e || e.provenance.documentId !== load.documentId || e.contentHash !== hashText(e.text) || load.range[0] < 0 || load.range[1] > e.text.length || load.range[1] <= load.range[0] || !strings.some(text => text.includes(e.text.slice(...load.range))) || source && ((source.selector.documentId && source.selector.documentId !== load.documentId) || source.selector.title && source.selector.documentId && !sourceTitlesMatch(source.selector.title, e.provenance.documentTitle ?? '') || source.depth === 'full_document' && (e.provenance.complete === false || load.range[0] !== 0 || load.range[1] !== e.text.length))) return result('source_context_not_consumed', 'rejected');
    const receipt = { documentId: load.documentId, sourceRequirementId: load.sourceRequirementId, contentHash: e.contentHash, range: load.range, evidenceIds: [e.id], consumedByStage: stage, contextHash: hashText(context) };
    receipts.push({ ...receipt, id: 'receipt-' + hashText(stableJson(receipt)).slice(0,24) });
  }
  const fresh = receipts.filter(receipt => !s.readReceipts.some(old => old.id === receipt.id));
  return { ...result(fresh.length ? 'source_consumed' : 'source_reused', fresh.length ? 'progress' : 'no_progress'), changedIds: fresh.map(r => r.id), events: fresh.length ? [{ sessionId: s.sessionId, runId: s.activeRunId ?? '', expectedRevision: s.revision, type: 'evidence_loaded', records: [], receipts: fresh }] : [] };
}
