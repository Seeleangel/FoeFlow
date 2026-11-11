import { abortable, throwIfAborted } from './agentRuntime';
import { searchEditorialLibraryDocuments } from './articleSearch';
import { readEditorialLibraryDocument } from './libraryStorage';
import { hashText, stableJson, type EditorialSession, type ToolResult, type LoadedSource, type ReadReceipt, type EvidenceRecord } from './editorialTypes';
export interface SourceDescriptor { documentId: string; title: string; snippet?: string; contentHash?: string }
export interface SourceDocument { documentId: string; title: string; text: string; complete: boolean; kind?: EvidenceRecord['kind']; range?: [number, number] }
export interface SourcePort { search(query: string, signal: AbortSignal): Promise<SourceDescriptor[]>; read(documentId: string, signal: AbortSignal): Promise<SourceDocument | undefined> }
export const localSourcePort: SourcePort = { search: async (q, signal) => { throwIfAborted(signal); return abortable(searchEditorialLibraryDocuments(q), signal); }, read: async (id, signal) => { throwIfAborted(signal); return abortable(readEditorialLibraryDocument(id), signal); } };
export const normalizeSourceQuery = (query: string): string => query.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
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
export async function readSourceDocument(s: EditorialSession, documentId: string, signal: AbortSignal, port: SourcePort = localSourcePort, sourceRequirementId?: string): Promise<ToolResult> {
  throwIfAborted(signal);
  try {
    const source = sourceRequirementId ? s.task.requiredSources.find(source => source.id === sourceRequirementId) : undefined;
    if (sourceRequirementId && !source) return result('unknown_source_requirement', 'rejected');
    const document = await abortable(port.read(documentId, signal), signal); throwIfAborted(signal);
    if (!document || document.documentId !== documentId || !document.text.trim()) return result('source_unavailable');
    if (source?.selector.title && normalizeSourceQuery(source.selector.title) !== normalizeSourceQuery(document.title)) return result('source_identity_mismatch');
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
export async function loadRequiredSource(s: EditorialSession, sourceId: string, signal: AbortSignal, port: SourcePort = localSourcePort): Promise<ToolResult> {
  throwIfAborted(signal); const source = s.task.requiredSources.find(source => source.id === sourceId); if (!source) return result('unknown_source_requirement', 'rejected');
  let id = source.selector.documentId;
  if (!id) {
    try {
      const matches = await abortable(port.search(source.selector.title ?? '', signal), signal); throwIfAborted(signal);
      const unique = [...new Map(matches.filter(match => normalizeSourceQuery(match.title) === normalizeSourceQuery(source.selector.title ?? '')).map(match => [match.documentId, match])).values()];
      if (unique.length !== 1) return result(unique.length ? 'source_ambiguous' : 'source_unavailable'); id = unique[0].documentId;
    } catch (error) { throwIfAborted(signal); if (error instanceof Error && error.name === 'AbortError') throw error; return result('source_read_failed'); }
  }
  return readSourceDocument(s, id, signal, port, sourceId);
}
function stringsIn(value: unknown): string[] { return typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap(stringsIn) : value && typeof value === 'object' ? Object.values(value).flatMap(stringsIn) : []; }
/** Call only AFTER the exact supplied context has been successfully consumed by the stated stage. */
export function recordSourceConsumption(s: EditorialSession, loaded: LoadedSource[], stage: ReadReceipt['consumedByStage'], context: string): ToolResult {
  let strings: string[]; try { strings = stringsIn(JSON.parse(context)); } catch { strings = [context]; }
  const receipts: ReadReceipt[] = [];
  for (const load of loaded) {
    const e = s.evidence.find(e => e.id === load.evidenceId), source = s.task.requiredSources.find(source => source.id === load.sourceRequirementId);
    if (!e || e.provenance.documentId !== load.documentId || e.contentHash !== hashText(e.text) || load.range[0] < 0 || load.range[1] > e.text.length || load.range[1] <= load.range[0] || !strings.some(text => text.includes(e.text.slice(...load.range))) || source && ((source.selector.documentId && source.selector.documentId !== load.documentId) || source.selector.title && normalizeSourceQuery(source.selector.title) !== normalizeSourceQuery(e.provenance.documentTitle ?? '') || source.depth === 'full_document' && (e.provenance.complete === false || load.range[0] !== 0 || load.range[1] !== e.text.length))) return result('source_context_not_consumed', 'rejected');
    const receipt = { documentId: load.documentId, sourceRequirementId: load.sourceRequirementId, contentHash: e.contentHash, range: load.range, evidenceIds: [e.id], consumedByStage: stage, contextHash: hashText(context) };
    receipts.push({ ...receipt, id: 'receipt-' + hashText(stableJson(receipt)).slice(0,24) });
  }
  const fresh = receipts.filter(receipt => !s.readReceipts.some(old => old.id === receipt.id));
  return { ...result(fresh.length ? 'source_consumed' : 'source_reused', fresh.length ? 'progress' : 'no_progress'), changedIds: fresh.map(r => r.id), events: fresh.length ? [{ sessionId: s.sessionId, runId: s.activeRunId ?? '', expectedRevision: s.revision, type: 'evidence_loaded', records: [], receipts: fresh }] : [] };
}
