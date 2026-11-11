import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callAI } from '../ai';
import { searchArticleLibrary } from '../articleSearch';
import { getAllUserArticles } from '../libraryStorage';
import { runEditorialAgent } from '../editorialAgent';
import { narrowsEditorialAudience, readEditorialBrief, resolveEditorialBrief } from '../editorialBrief';

vi.mock('../ai', () => ({ callAI: vi.fn() }));
vi.mock('../articleSearch', () => ({ searchArticleLibrary: vi.fn() }));
vi.mock('../libraryStorage', () => ({ getAllUserArticles: vi.fn() }));

const model = vi.mocked(callAI);
const search = vi.mocked(searchArticleLibrary);
const articles = vi.mocked(getAllUserArticles);
const general = { mode: 'general', facts: [], needed: [] };
const options = (message = '根据我的素材写一篇读书会通知。') => ({
  messages: [{ role: 'user' as const, content: message }],
  previousDraft: '',
  template: { name: '活动通知', structureJson: {} },
  signal: new AbortController().signal,
  onStep: vi.fn(),
});
const answer = (content: object) => model.mockResolvedValueOnce({ content: JSON.stringify(content) });
const write = (instructions: string) => ({ tool: 'write', instructions, theme: 'professional-clean' });
const review = { tool: 'review' };
const approve = { blocking: [], notes: [] };

beforeEach(() => {
  vi.resetAllMocks();
  articles.mockResolvedValue([]);
  search.mockResolvedValue([]);
});

describe('editorial tool loop', () => {
  it('blocks writing with missing registration details and asks for the actual gaps', async () => {
    answer({ ...write('写报名通知'), brief: { ...general, mode: 'registration' } });
    answer({ tool: 'ask', fields: ['time'] });
    const result = await runEditorialAgent(options('帮我写一篇读书会报名推文。'));
    expect(result).toEqual({ type: 'question', text: '请确认稿件需要的活动时间、活动地点或线上平台、报名方式和已确定的截止时间。' });
    expect(model).toHaveBeenCalledTimes(2);
    expect(search).not.toHaveBeenCalled();
    expect(articles).not.toHaveBeenCalled();
  });

  it('uses local material and hands off immediately after an unblocked review', async () => {
    search.mockResolvedValue([{ title: '读书会流程', snippet: '小组讨论环节' }]);
    answer({ tool: 'search', query: '读书会', brief: general });
    answer({ ...write('整理通知'), brief: general });
    answer({ title: '读书会通知', bodyMarkdown: '欢迎报名参加。' });
    answer(review);
    answer({ blocking: [], notes: ['请确认报名人数上限。'] });

    const result = await runEditorialAgent(options());

    expect(result).toMatchObject({
      type: 'draft', title: '读书会通知',
      handoff: { status: 'pending', notes: ['请确认报名人数上限。'], sources: ['读书会流程'] },
    });
    if (result.type !== 'draft') throw new Error('Expected a draft');
    expect(result.html).toContain('欢迎报名参加。');
    expect(model.mock.calls[2][0].messages[1].content).toContain('小组讨论环节');
    expect(model).toHaveBeenCalledTimes(5);
  });

  it('blocks unsafe drafts and invalidates review and layout after rewriting', async () => {
    answer({ ...write('写通知'), brief: general });
    answer({ title: '标题', bodyMarkdown: '<script>danger()</script>' });
    answer(write('输出纯文字'));
    answer({ title: '读书会通知', bodyMarkdown: '周六下午见。' });
    answer({ tool: 'layout', theme: 'professional-clean' });
    answer(review);
    answer({ blocking: ['日期和用户提供的信息冲突'], notes: [] });
    answer(write('按用户提供的日期修正'));
    answer({ title: '读书会通知', bodyMarkdown: '周五下午见。' });
    answer({ tool: 'submit' });
    answer(review);
    answer(approve);

    const result = await runEditorialAgent(options());

    expect(result).toMatchObject({ type: 'draft', text: '# 读书会通知\n周五下午见。' });
    const afterRewrite = JSON.parse(model.mock.calls[9][0].messages[1].content);
    expect(afterRewrite.layoutReady).toBe(false);
    expect(afterRewrite.review).toBeUndefined();
    expect(model.mock.calls[10][0].messages[1].content).toContain('交稿需要');
  });

  it('keeps an unverified quotation in editor notes and rejects it in the draft', async () => {
    answer({ ...write('写展览通知'), brief: general });
    answer({ title: '展览通知', bodyMarkdown: '欢迎观展。\n待核查提示：学院规模最大。' });
    answer(write('只用已核实事实'));
    answer({ title: '展览通知', bodyMarkdown: '欢迎到白榆展厅观展。' });
    answer(review);
    answer(approve);

    const result = await runEditorialAgent(options('在白榆展厅开展。有人说「学院规模最大」，我没核实。'));
    expect(result).toMatchObject({
      type: 'draft', text: '# 展览通知\n欢迎到白榆展厅观展。',
      handoff: { notes: ['请核实引语或说法「学院规模最大」后再决定是否采用。'] },
    });
    expect(model.mock.calls[2][0].messages[1].content).toContain('正文含待核');
  });

  it('ignores extra output fields and fixes a missing confirmed audience before handoff', async () => {
    const known = (field: string, value: string) => ({ field, value, source: 'u1', quote: value });
    const brief = {
      mode: 'registration', needed: [],
      facts: [known('time', '周五'), known('location', '知行楼'), known('registration', '公众号报名'), known('audience', '本科生')],
    };
    answer({ ...write('写通知'), brief });
    answer({ title: '通知', bodyMarkdown: '周五在知行楼，公众号报名。', highlights: '不进入正文' });
    answer(review);
    answer(approve);
    answer(write('补全受众'));
    answer({ title: '通知', bodyMarkdown: '面向本科生。周五在知行楼，公众号报名。' });
    answer(review);
    answer(approve);

    const result = await runEditorialAgent(options('请写报名推文。周五在知行楼，面向本科生，公众号报名。'));
    expect(result).toMatchObject({ type: 'draft', text: '# 通知\n面向本科生。周五在知行楼，公众号报名。' });
    expect(model.mock.calls[4][0].messages[1].content).toContain('报名稿缺少已确认的参与对象');
  });

  it('halts repeated attempts to submit without the required artifacts', async () => {
    model.mockResolvedValue({ content: '{"tool":"submit"}' });
    await expect(runEditorialAgent(options())).rejects.toThrow('达到操作上限');
    // Product-approved v0.4 criterion: safe early stop is allowed; never exceed the limit.
    expect(model.mock.calls.length).toBeGreaterThan(0);
    expect(model.mock.calls.length).toBeLessThanOrEqual(12);
  });

  it('rejects a cancelled model response before any tool can run', async () => {
    const controller = new AbortController();
    let finish!: (response: { content: string }) => void;
    model.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const task = runEditorialAgent({ ...options(), signal: controller.signal });
    controller.abort();
    finish({ content: '{"tool":"search","query":"读书会"}' });
    await expect(task).rejects.toMatchObject({ name: 'AbortError' });
    expect(search).not.toHaveBeenCalled();
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
