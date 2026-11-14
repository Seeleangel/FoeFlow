import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callAI } from '../ai';
import { searchEditorialLibraryDocuments } from '../articleSearch';
import { readEditorialLibraryDocument } from '../libraryStorage';
import { runEditorialAgent } from '../editorialAgent';
import { EDITORIAL_STAGE_PROMPTS } from '../editorialPrompts';
import { narrowsEditorialAudience, readEditorialBrief, resolveEditorialBrief } from '../editorialBrief';
import { hashText, type EditorialSession, type EvidenceRef } from '../editorialTypes';
vi.mock('../ai', () => ({ callAI: vi.fn() }));
vi.mock('../articleSearch', () => ({ searchEditorialLibraryDocuments: vi.fn() }));
vi.mock('../libraryStorage', () => ({ readEditorialLibraryDocument: vi.fn() }));
const model = vi.mocked(callAI), search = vi.mocked(searchEditorialLibraryDocuments), read = vi.mocked(readEditorialLibraryDocument);
const general = { mode: 'general', facts: [], needed: [] };
const options = (message = '根据我的素材写一篇读书会通知。') => ({ messages: [{ role: 'user' as const, content: message }], previousDraft: '', template: { name: '活动通知', structureJson: {} }, signal: new AbortController().signal, onStep: vi.fn() });
let responses: Record<string, object[]> = {};
let customize: (data: Pick<EditorialSession,'evidence'|'task'>, refs: EvidenceRef[]) => object;
const answer = (content: object) => { const stage = 'tool' in content ? 'decide' : 'title' in content ? 'write' : 'review'; (responses[stage] ??= []).push(content); };
const write = (instructions: string) => ({ tool: 'write', instructions, theme: 'professional-clean' });
const review = { tool: 'review' }, approve = { blocking: [], notes: [] };
beforeEach(() => {
  vi.resetAllMocks(); responses = {}; search.mockResolvedValue([]); read.mockResolvedValue(undefined);
  customize = (data, refs) => ({ factPatch: {}, taskPatch: { baseRevision: data.task.revision, refs, objective: 'Publish an article', intents: ['inform'], criteria: [{ id: 'body', origin: 'user', refs, severity: 'blocking', verification: 'deterministic', rule: { kind: 'length', min: 1, unit: 'visible_characters' } }] } });
  model.mockImplementation(async request => {
    const prompt = request.messages[0].content;
    const data = JSON.parse(request.messages[1].content) as Pick<EditorialSession,'evidence'|'task'>;
    if (prompt === EDITORIAL_STAGE_PROMPTS.preflight) { const e = data.evidence[0]; return { content: JSON.stringify(customize(data, [{ evidenceId: e.id, revision: e.revision, start: 0, end: e.text.length, quote: e.text }])) }; }
    if (prompt === EDITORIAL_STAGE_PROMPTS.extract) {
      const e = data.evidence.find(e => e.kind === 'library')!; const refs = [{ evidenceId: e.id, revision: e.revision, start: 0, end: e.text.length, quote: e.text }];
      return { content: JSON.stringify({ factPatch: { scopes: [{ id: 'source', kind: 'other', label: 'Reference', identity: 'aligned', anchors: refs, qualifiers: [] }], claims: [{ id: 'reference-fact', selector: { scopeId: 'source', predicate: 'program' }, value: e.text, refs, epistemic: 'supported', visibility: 'public', statusBasis: [] }] } }) };
    }
    const stage = Object.entries(EDITORIAL_STAGE_PROMPTS).find(([,value]) => value === prompt)?.[0] ?? ''; const next = responses[stage]?.shift(); if (!next) throw new Error('fixture_error:unconfigured_stage'); return { content: JSON.stringify(next) };
  });
});
describe('editorial tool loop (default v2 runtime; legacy options adapter)', () => {
  it('blocks writing with missing registration details and asks for the actual gaps', async () => {
    customize = (data, refs) => ({ factPatch: {}, taskPatch: { baseRevision: data.task.revision, refs, objective: '报名推文', intents: ['call_to_action'], requirements: ['活动时间','活动地点','报名方式','已确定的截止时间'].map((label,i) => ({ id: 'r'+i, selector: { scopeId: 'event', predicate: 'field'+i }, label, reason: '读者报名需要', whyNeeded: '读者报名需要', refs, necessity: 'blocking', resolution: 'supply_fact' })) } });
    answer(write('写报名通知')); answer({ tool: 'ask', fields: ['detail'] }); const result = await runEditorialAgent(options('帮我写一篇读书会报名推文。'));
    expect(result.type).toBe('question'); if (result.type === 'question') for (const label of ['活动时间','活动地点','报名方式','截止时间']) expect(result.text).toContain(label);
    expect(model).toHaveBeenCalledTimes(3); expect(search).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  });
  it('uses real local material and hands off immediately after an unblocked same-version review', async () => {
    search.mockResolvedValue([{ documentId: 'article:a', title: '读书会流程', snippet: '小组讨论', contentHash: hashText('小组讨论环节') }]); read.mockResolvedValue({ documentId: 'article:a', title: '读书会流程', text: '小组讨论环节', complete: true, kind: 'library' });
    answer({ tool: 'search', query: '读书会' }); answer(write('整理通知')); answer({ title: '读书会通知', bodyMarkdown: '欢迎报名参加小组讨论环节。' }); answer(review); answer({ blocking: [], notes: ['请确认报名人数上限。'] });
    const result = await runEditorialAgent(options()); expect(result).toMatchObject({ type: 'draft', title: '读书会通知', handoff: { status: 'pending', notes: ['请确认报名人数上限。'], sources: ['读书会流程'] } });
    if (result.type !== 'draft') throw new Error('Expected draft'); expect(result.html).toContain('小组讨论环节');
    const writing = model.mock.calls.find(([request]) => request.messages[0].content === EDITORIAL_STAGE_PROMPTS.write); expect(writing?.[0].messages[1].content).toContain('小组讨论环节');
    expect(result.outcome?.session.readReceipts).toHaveLength(1);
  });
  it('blocks unsafe drafts and invalidates review and layout after rewriting', async () => {
    answer(write('写通知')); answer({ title: '标题', bodyMarkdown: '<script>danger()</script>' }); answer(write('输出纯文字')); answer({ title: '读书会通知', bodyMarkdown: '周六下午见。' }); answer({ tool: 'layout', theme: 'professional-clean' }); answer(review); answer({ blocking: ['日期和用户提供的信息冲突'], notes: [] }); answer(write('按编辑日期修正')); answer({ title: '读书会通知', bodyMarkdown: '周五下午见。' }); answer({ tool: 'submit' }); answer(review); answer(approve);
    const result = await runEditorialAgent(options()); expect(result).toMatchObject({ type: 'draft', text: '# 读书会通知\n周五下午见。' });
    const decisions = model.mock.calls.filter(([r]) => r.messages[0].content === EDITORIAL_STAGE_PROMPTS.decide).map(([r]) => JSON.parse(r.messages[1].content));
    expect(decisions.some(d => d.draft?.bodyMarkdown === '周五下午见。' && !d.layoutReady && !d.review)).toBe(true);
  });
  it('keeps an unverified quotation in editor notes and blocks it in the public draft', async () => {
    customize = (data, refs) => { const e = data.evidence[0], quote = '学院规模最大', start = e.text.indexOf(quote), qref = { evidenceId: e.id, revision: e.revision, start, end: start+quote.length, quote }; return { factPatch: { scopes: [{ id: 'event', kind: 'event', label: '展览', anchors: refs, identity: 'aligned', qualifiers: [] }], claims: [{ id: 'unverified', selector: { scopeId: 'event', predicate: 'quotation' }, value: quote, refs: [qref], statusBasis: [qref], visibility: 'editor_only', epistemic: 'pending' }] }, editorialNotes: [{ id: 'verify', kind: 'fact_check', text: '请核实引语或说法「学院规模最大」后再决定是否采用。', relatedIds: ['unverified'] }], taskPatch: { baseRevision: data.task.revision, refs, objective: '写展览通知', intents: ['inform'], criteria: [{ id: 'body', origin: 'user', refs, severity: 'blocking', verification: 'deterministic', rule: { kind: 'length', min: 1, unit: 'visible_characters' } }] } }; };
    answer(write('写通知')); answer({ title: '展览通知', bodyMarkdown: '欢迎观展。\n待核查提示：学院规模最大。' }); answer(write('只用已核实事实')); answer({ title: '展览通知', bodyMarkdown: '欢迎到白榆展厅观展。' }); answer(review); answer(approve);
    expect(await runEditorialAgent(options('在白榆展厅开展。有人说「学院规模最大」，我没核实。'))).toMatchObject({ type: 'draft', text: '# 展览通知\n欢迎到白榆展厅观展。', handoff: { notes: ['请核实引语或说法「学院规模最大」后再决定是否采用。'] } });
  });
  it('rejects unknown artifact fields rather than silently ignoring them, then repairs missing confirmed audience', async () => {
    customize = (data, refs) => ({ factPatch: { scopes: [{ id: 'event', kind: 'event', label: '通知', anchors: refs, identity: 'aligned', qualifiers: [] }], claims: [{ id: 'audience', selector: { scopeId: 'event', predicate: 'audience' }, value: '本科生', refs, statusBasis: [], epistemic: 'supported', visibility: 'public' }] }, taskPatch: { baseRevision: data.task.revision, refs, objective: '报名通知', intents: ['call_to_action'], criteria: [{ id: 'audience', origin: 'user', refs, severity: 'blocking', verification: 'deterministic', rule: { kind: 'include_facts', factIds: ['audience'], location: 'body' } }] } });
    answer(write('写通知')); answer({ title: '通知', bodyMarkdown: '周五在知行楼，公众号报名。', highlights: '不进入正文' }); answer(write('有效结构')); answer({ title: '通知', bodyMarkdown: '周五在知行楼，公众号报名。' }); answer(review); answer(approve); answer(write('补全受众')); answer({ title: '通知', bodyMarkdown: '面向本科生。周五在知行楼，公众号报名。' }); answer(review); answer(approve);
    expect(await runEditorialAgent(options('请写报名推文。周五在知行楼，面向本科生，公众号报名。'))).toMatchObject({ type: 'draft', text: '# 通知\n面向本科生。周五在知行楼，公众号报名。' });
  });
  it('halts repeated submits without artifacts (approved criterion: never exceeds limit, structured stop)', async () => {
    for (let i=0;i<12;i++) answer({ tool: 'submit' }); const result = await runEditorialAgent(options()); expect(result.type).toBe('question'); expect(result.outcome?.type).toBe('incomplete'); expect(model.mock.calls.length).toBeGreaterThan(0); expect(model.mock.calls.length).toBeLessThanOrEqual(12);
  });
  it('rejects a cancelled model response before any tool can run', async () => {
    const controller = new AbortController(); let finish!: (response: { content: string }) => void; model.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); const task = runEditorialAgent({ ...options(), signal: controller.signal }); controller.abort(); finish({ content: '{"tool":"search","query":"读书会"}' }); await expect(task).rejects.toMatchObject({ name: 'AbortError' }); expect(search).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  });
});

describe('editorial brief', () => {
  const evidence = [
    { id: 'u1', priority: 2, text: '活动时间为 12 月 9 日 18:30。' },
    { id: 's1', priority: 0, text: '活动时间另行通知。' },
    { id: 's2', priority: 0, text: '旧活动时间为 14:00。' },
  ];
  const fact = (value: string, source: string, quote = value) => ({ field: 'time', value, source, quote, status: 'known' });

  it('uses grounded editor facts ahead of placeholders and lower-priority values', () => {
    const brief = readEditorialBrief({
      ...general,
      needed: ['time'],
      facts: [fact('另行通知', 's1'), fact('14:00', 's2'), fact('12 月 9 日 18:30', 'u1'), fact('20:00', 'u1')],
    }, evidence);
    expect(brief?.facts).toHaveLength(3);
    if (!brief) throw new Error('Expected a brief');
    expect(resolveEditorialBrief(brief, evidence)).toMatchObject({
      accepted: [{ value: '12 月 9 日 18:30', source: 'u1' }], required: [],
    });
  });

  it('keeps anchored facts when the model omits the status', () => {
    const brief = readEditorialBrief({
      ...general,
      facts: [{ field: 'time', source: 'u1', value: '18:30', quote: '12 月 9 日 18:30' }],
    }, evidence);
    expect(brief?.facts).toEqual([{ field: 'time', source: 'u1', value: '18:30', quote: '12 月 9 日 18:30', status: 'known' }]);
  });

  it('blocks an extra college restriction even without a known organizer', () => {
    expect(narrowsEditorialAudience('讲座面向青岑学院本科生开放报名。', '本科生')).toBe(true);
    expect(narrowsEditorialAudience('青岑学院主办，讲座面向本科生。', '本科生')).toBe(false);
    expect(narrowsEditorialAudience('讲座面向青岑学院本科生。', '青岑学院本科生')).toBe(false);
  });

  it('asks for an actual same-priority conflict', () => {
    const conflicting = [{ id: 'u1', priority: 2, text: '一份是 14:00，另一份是 16:00。' }];
    const brief = readEditorialBrief({ ...general, facts: [fact('14:00', 'u1'), fact('16:00', 'u1')] }, conflicting);
    if (!brief) throw new Error('Expected a brief');
    const resolved = resolveEditorialBrief(brief, conflicting);
    expect(resolved.required).toEqual(['time']);
    expect(resolved.conflicts.get('time')).toEqual(['14:00', '16:00']);
  });
});
