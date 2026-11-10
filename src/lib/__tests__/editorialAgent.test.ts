import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callAI } from '../ai';
import { searchArticleLibrary } from '../articleSearch';
import { getAllUserArticles } from '../libraryStorage';
import { runEditorialAgent } from '../editorialAgent';

vi.mock('../ai', () => ({ callAI: vi.fn() }));
vi.mock('../articleSearch', () => ({ searchArticleLibrary: vi.fn() }));
vi.mock('../libraryStorage', () => ({ getAllUserArticles: vi.fn() }));

const model = vi.mocked(callAI);
const search = vi.mocked(searchArticleLibrary);
const articles = vi.mocked(getAllUserArticles);
const options = () => ({
  messages: [{ role: 'user' as const, content: '根据我的素材写一篇读书会通知。' }],
  previousDraft: '',
  template: { name: '活动通知', structureJson: {} },
  signal: new AbortController().signal,
  onStep: vi.fn(),
});
const answer = (content: string | object) => model.mockResolvedValueOnce({
  content: typeof content === 'string' ? content : JSON.stringify(content),
});

beforeEach(() => {
  vi.resetAllMocks();
  articles.mockResolvedValue([]);
  search.mockResolvedValue([]);
});

describe('editorial tool loop', () => {
  it('can ask for information before reading any workspace material', async () => {
    answer({ tool: 'ask', question: '读书会在哪里举行？' });
    await expect(runEditorialAgent(options())).resolves.toEqual({ type: 'question', text: '读书会在哪里举行？' });
    expect(search).not.toHaveBeenCalled();
    expect(articles).not.toHaveBeenCalled();
  });

  it('uses tool results to continue and hands off the rendered article with review notes', async () => {
    search.mockResolvedValue([{ title: '读书会流程', snippet: '小组讨论环节' }]);
    answer({ tool: 'search', query: '读书会' });
    answer({ tool: 'write', instructions: '整理通知' });
    answer('# 读书会通知\n欢迎报名参加。');
    answer({ tool: 'layout', theme: 'warm-editorial' });
    answer({ tool: 'review' });
    answer({ blocking: [], notes: ['请确认报名人数上限。'] });
    answer({ tool: 'submit' });

    const result = await runEditorialAgent(options());

    expect(result).toMatchObject({
      type: 'draft', title: '读书会通知',
      handoff: { status: 'pending', notes: ['请确认报名人数上限。'], sources: ['读书会流程'] },
    });
    if (result.type !== 'draft') throw new Error('Expected a draft');
    expect(result.html).toContain('欢迎报名参加。');
    expect(model.mock.calls[2][0].messages[1].content).toContain('小组讨论环节');
  });

  it('blocks unsafe drafts and invalidates review and layout after rewriting', async () => {
    answer({ tool: 'write', instructions: '写通知' });
    answer('# 标题\n<script>danger()</script>');
    answer({ tool: 'write', instructions: '输出纯文字' });
    answer('# 读书会通知\n周六下午见。');
    answer({ tool: 'review' });
    answer({ blocking: ['日期和用户提供的信息冲突'], notes: [] });
    answer({ tool: 'layout', theme: 'professional-clean' });
    answer({ tool: 'submit' });
    answer({ tool: 'write', instructions: '按用户提供的日期修正' });
    answer('# 读书会通知\n周五下午见。');
    answer({ tool: 'submit' });
    answer({ tool: 'review' });
    answer({ blocking: [], notes: [] });
    answer({ tool: 'layout', theme: 'professional-clean' });
    answer({ tool: 'submit' });

    const result = await runEditorialAgent(options());

    expect(result).toMatchObject({ type: 'draft', text: '# 读书会通知\n周五下午见。' });
    expect(model).toHaveBeenCalledTimes(15);
    expect(model.mock.calls[2][0].messages[1].content).toContain('不含 HTML');
    expect(model.mock.calls[8][0].messages[1].content).toContain('无阻断问题');
    const afterRewrite = JSON.parse(model.mock.calls[10][0].messages[1].content);
    expect(afterRewrite.layoutReady).toBe(false);
    expect(afterRewrite.review).toBeUndefined();
  });

  it('halts repeated attempts to submit without the required artifacts', async () => {
    model.mockResolvedValue({ content: '{"tool":"submit"}' });
    await expect(runEditorialAgent(options())).rejects.toThrow('达到操作上限');
    expect(model).toHaveBeenCalledTimes(12);
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
