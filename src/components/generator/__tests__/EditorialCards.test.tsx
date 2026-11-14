import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorialFailureCard } from '../EditorialFailureCard';
import { QuestionBatchCard } from '../QuestionBatchCard';
import { EditorialStatusPanel } from '../EditorialStatusPanel';
import ChatPanel from '../ChatPanel';
import { currentInputKey } from '@/lib/editorialTypes';
import type { QuestionBatch, StopAction, StopRecord } from '@/lib/editorialTypesV3';
import type { EditorialSession } from '@/lib/editorialTypes';
import { uiReady } from '@/lib/__tests__/editorialUiFixture';
afterEach(cleanup);

function stopRecord(cls: 'external' | 'internal' | 'input', code: string, headline: string, actions: StopAction[], overrides: Partial<StopRecord> = {}): StopRecord {
  return {
    code, class: cls, stage: cls === 'internal' ? 'write:validation' : undefined, retryable: true, headline,
    detail: code === 'model_unavailable' ? '模型服务返回 HTTP 502，未自动重试。' : '内部校验失败（unsafe_fact_snapshot）。',
    actions, traceId: 'trace-unit-1', preserved: { candidateRevision: 1, inputKey: { contentHash: '', evidenceRevision: 0, taskRevision: 0, policyRevision: 0 } },
    ...overrides,
  } as StopRecord;
}
function withStop(cls: 'external' | 'internal' | 'input', code: string, headline: string, actions: StopAction[], overrides: Partial<StopRecord> = {}) {
  const session = uiReady();
  const stop = stopRecord(cls, code, headline, actions, { preserved: { candidateRevision: session.candidate?.revision, inputKey: currentInputKey(session) }, ...overrides });
  session.lastRun = { runId: 'r', startedAt: '', endedAt: '', outcome: 'stopped', stop, modelCalls: [], agentDiagnostics: [] };
  return { session, stop };
}
const factGap = (overrides: Partial<EditorialSession['gaps'][number]> = {}): EditorialSession['gaps'][number] => ({ id: 'fact-1', requirementId: 'r-fact', kind: 'missing', selector: { scopeId: 'event', predicate: 'attendance' }, label: '出席人数', reason: '报道需要人数', state: 'open', blocking: true, alternatives: [], resolutionClaimIds: [], gapClass: 'fact', askable: true, ...overrides });

describe('editorial failure card', () => {
  it('renders the structured external stop and routes retry without dead buttons', () => {
    const onAction = vi.fn();
    const { stop } = withStop('external', 'model_unavailable', '模型服务暂时不可用（HTTP 502）', ['retry']);
    render(<EditorialFailureCard stop={stop} candidateRevision={1} onAction={onAction} />);
    expect(screen.getByRole('alert')).toHaveTextContent('模型服务暂时不可用（HTTP 502）');
    expect(screen.getByText(/HTTP 502，未自动重试/)).toBeInTheDocument();
    expect(screen.queryByText(/诊断编号/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith('retry');
  });

  it('renders supply and waive and calls the router once each', () => {
    const onAction = vi.fn();
    const { stop } = withStop('external', 'source_unavailable', '无法读取素材', ['supply', 'waive']);
    render(<EditorialFailureCard stop={stop} onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: '补充素材' }));
    fireEvent.click(screen.getByRole('button', { name: '明确豁免' }));
    expect(onAction.mock.calls).toEqual([['supply'], ['waive']]);
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('shows traceId and copy once for internal stops and notes the preserved candidate version', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { stop } = withStop('internal', 'internal_invariant', '处理过程中出现内部一致性问题（write）', ['retry', 'report'], { preserved: { candidateRevision: 3, inputKey: currentInputKey(uiReady()) } });
    render(<EditorialFailureCard stop={stop} candidateRevision={3} onAction={vi.fn()} />);
    const cardText = screen.getByRole('region', { name: '本轮失败' }).textContent ?? '';
    expect(cardText).toContain('trace-unit-1');
    expect(cardText).toContain('诊断码：internal_invariant');
    expect(cardText).toContain('阶段：write:validation');
    expect(screen.getAllByRole('button', { name: '复制诊断编号' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '报告问题' })).not.toBeInTheDocument();
    expect(cardText).toContain('第 3 版，未被本次失败修改');
    fireEvent.click(screen.getByRole('button', { name: '复制诊断编号' }));
    await waitFor(() => expect(screen.getByText('已复制诊断编号')).toBeInTheDocument());
    expect(writeText).toHaveBeenCalledWith('trace-unit-1');
  });

  it('disables retry with an aria-describedby reason and omits retry when terminal', () => {
    const { stop } = withStop('external', 'model_unavailable', '模型服务暂时不可用', ['retry']);
    render(<EditorialFailureCard stop={stop} onAction={vi.fn()} retryBlockedReason="正在处理本轮任务，完成后可操作。" />);
    const retry = screen.getByRole('button', { name: '重试' });
    expect(retry).toBeDisabled();
    expect(retry).toHaveAttribute('aria-describedby', 'retry-blocked-reason');
    expect(screen.getByText('正在处理本轮任务，完成后可操作。')).toBeInTheDocument();
    cleanup();
    const terminal = withStop('input', 'permission_denied', '缺少必要授权', ['waive', 'edit_task'], { retryable: false });
    render(<EditorialFailureCard stop={terminal.stop} onAction={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '明确豁免' })).toBeInTheDocument();
  });

  it('uses a generic internal headline when the diagnostic message has no CJK', () => {
    const { stop } = withStop('internal', 'unsafe_fact_snapshot', '处理过程中出现内部一致性问题', ['retry', 'report'], { detail: 'unsafe fact snapshot' });
    render(<EditorialFailureCard stop={stop} onAction={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Agent 报告了一个内部问题');
    expect(screen.getByText('unsafe fact snapshot')).toBeInTheDocument();
  });
});

describe('question batch card', () => {
  const item = (gapId: string, subject: string, requested: string, expected: 'free_text' | 'choice' | 'authorization' = 'free_text', options?: QuestionBatch['items'][number]['options']) => ({
    gapId, gapClass: expected === 'authorization' ? 'authorization' as const : 'fact' as const, subject, requested, why: '读者需要', expected, answerSlot: 'slot-' + gapId, ...(options ? { options } : {}),
  });
  const batch = (items: QuestionBatch['items'], intake = false, understood?: string[]): QuestionBatch => ({ id: 'q-1', createdAtMessageId: 'm1', gapIds: items.map(entry => entry.gapId), items, status: 'active', ...(intake ? { intake: true, reasonCode: 'task_plan_incomplete' } : {}), ...(understood ? { understood } : {}) });
  const options = [{ id: 'o1', label: '允许使用', choice: 'grant' as const, isDefaultAffirmative: true }, { id: 'o2', label: '不允许使用', choice: 'deny' as const }];

  it('submits explicit text slots with the batch id and keeps omitted items unbound', () => {
    const onSubmit = vi.fn();
    render(<QuestionBatchCard batch={batch([item('g1', '秋季读书会', '出席人数'), item('g2', '秋季读书会', '活动日期')])} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('出席人数'), { target: { value: '30 人' } });
    fireEvent.click(screen.getByRole('button', { name: '提交回答' }));
    expect(onSubmit).toHaveBeenCalledWith({ batchId: 'q-1', slots: [{ gapId: 'g1', value: '30 人' }] });
  });

  it('submits optionId and choice, never the display label', () => {
    const onSubmit = vi.fn();
    render(<QuestionBatchCard batch={batch([item('g1', '讲师照片', '是否可以使用讲师照片', 'authorization', options)])} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: '允许使用' }));
    fireEvent.click(screen.getByRole('button', { name: '提交回答' }));
    expect(onSubmit).toHaveBeenCalledWith({ batchId: 'q-1', slots: [{ gapId: 'g1', optionId: 'o1', choice: 'grant' }] });
    expect(JSON.stringify(onSubmit.mock.calls[0][0])).not.toContain('允许使用');
  });

  it('keeps one aria-pressed option and toggles it off on a second click', () => {
    render(<QuestionBatchCard batch={batch([item('g1', '讲师照片', '是否可以使用讲师照片', 'authorization', options)])} onSubmit={vi.fn()} />);
    const allow = screen.getByRole('button', { name: '允许使用' });
    const deny = screen.getByRole('button', { name: '不允许使用' });
    fireEvent.click(allow);
    expect(allow).toHaveAttribute('aria-pressed', 'true');
    expect(allow.querySelector('svg')).not.toBeNull();
    expect(deny).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(deny);
    expect(allow).toHaveAttribute('aria-pressed', 'false');
    expect(deny).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(deny);
    expect(deny).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '提交回答' })).toBeDisabled();
  });

  it('records an explicit defer for 无法提供 and keeps it mutually exclusive with options', () => {
    const onSubmit = vi.fn();
    render(<QuestionBatchCard batch={batch([item('g1', '秋季读书会', '出席人数'), item('g2', '秋季读书会', '活动形式', 'choice', options)])} onSubmit={onSubmit} />);
    fireEvent.click(screen.getAllByRole('button', { name: '无法提供' })[0]);
    fireEvent.click(screen.getByRole('button', { name: '允许使用' }));
    fireEvent.click(screen.getAllByRole('button', { name: '无法提供' })[0]);
    expect(screen.getByRole('button', { name: '允许使用' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: '提交回答' }));
    expect(onSubmit).toHaveBeenCalledWith({ batchId: 'q-1', slots: [{ gapId: 'g1', choice: 'defer' }, { gapId: 'g2', choice: 'defer' }] });
  });

  it('uses a full-width 44px submit, disabled styles and an explained disabled state', () => {
    render(<QuestionBatchCard batch={batch([item('g1', '秋季读书会', '出席人数')])} onSubmit={vi.fn()} />);
    const submit = screen.getByRole('button', { name: '提交回答' });
    expect(submit).toBeDisabled();
    expect(submit.className).toContain('h-11');
    expect(submit.className).toContain('w-full');
    expect(submit.className).toContain('disabled:bg-stone-200');
    expect(submit).toHaveAttribute('aria-describedby', 'batch-submit-hint');
    expect(screen.getByText('至少回答一项，或选择「无法提供」后才能提交')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '无法提供' }).className).toContain('min-h-11');
  });

  it('renders understood only as a batch-level line', () => {
    render(<QuestionBatchCard batch={batch([item('g1', '秋季读书会', '出席人数'), item('g2', '秋季读书会', '活动日期')], false, ['出席人数'])} onSubmit={vi.fn()} />);
    expect(screen.getByText('已了解：出席人数')).toBeInTheDocument();
    expect(screen.queryByText(/（已了解/)).not.toBeInTheDocument();
    expect(screen.getAllByText('读者需要')).toHaveLength(2);
  });

  it('renders the intake template with the four program items and a scrollable list', () => {
    const items = [item('intake:goal', '目标', '这篇内容主要想达成什么目标？'), item('intake:audience', '读者', '主要写给谁看？'), item('intake:facts', '必须包含的事实', '必须写进内容的事实是什么？'), item('intake:sources', '来源', '需要参考哪些文件？')];
    render(<QuestionBatchCard batch={batch(items, true)} onSubmit={vi.fn()} />);
    expect(screen.getByText('请先明确任务')).toBeInTheDocument();
    const card = screen.getByRole('region', { name: '待回答的问题批次' });
    for (const subject of ['目标', '读者', '必须包含的事实', '来源']) expect(card.textContent).toContain(subject);
    expect(screen.getByRole('group', { name: '问题列表（可滚动）' })).toHaveAttribute('tabindex', '0');
  });
});

describe('delivery status sections', () => {
  it('keeps pending askable facts, excludes internal/constraint, and shows delivery measurement, deferrals and agent diagnostics', () => {
    const session = uiReady();
    session.gaps = [
      factGap(),
      factGap({ id: 'internal-1', gapClass: 'internal', askable: false, label: '内部诊断条目', state: 'open', blocking: false }),
      factGap({ id: 'constraint-1', gapClass: 'constraint', askable: false, kind: 'constraint', label: '篇幅要求', state: 'blocked_by_constraint', blocking: false, selector: { scopeId: 'criterion:length', predicate: 'length' }, measurement: { criterionId: 'length', measured: '5', required: '10–∞ 可见字符', detail: '要求 10–∞ 可见字符，实测 5 字符' } }),
      factGap({ id: 'deferred-1', label: '已放弃的出勤', state: 'waived' }),
    ];
    session.gapDecisions = [{ id: 'gd-1', gapId: 'deferred-1', by: 'editor', kind: 'defer', refs: [], createdAt: '' }];
    session.agentDiagnostics = [{ owner: 'facts:claims:x', code: 'missing_status_basis', message: '缺少依据', refs: [] }];
    render(<EditorialStatusPanel session={session} onStopAction={vi.fn()} />);
    expect(screen.getByText(/出席人数/)).toBeInTheDocument();
    expect(screen.queryByText(/内部诊断条目/)).not.toBeInTheDocument();
    expect(screen.getByText('篇幅要求')).toBeInTheDocument();
    expect(screen.getAllByText(/10–∞ 可见字符/)).toHaveLength(1);
    expect(screen.getByText('改写预算已用尽')).toBeInTheDocument();
    expect(screen.getAllByText(/编辑已知悉并选择继续/).length).toBeGreaterThan(0);
    expect(screen.getByText('Agent 诊断')).toBeInTheDocument();
    expect(screen.getByText(/缺少依据/)).toBeInTheDocument();
    expect(screen.getByText('待补事项').className).toContain('text-sm');
    expect(screen.getByText('待补事项').className).toContain('font-semibold');
    expect(screen.getByText('待补事项').className).toContain('text-stone-900');
  });

  it('renders readable names for editor decisions and never leaks stale gap ids', () => {
    const session = uiReady();
    session.gaps = [factGap({ id: 'gap-photo', label: '讲师照片', state: 'resolved' })];
    session.task = { ...session.task, requiredSources: [{ id: 'src-brief', selector: { title: '活动通稿' }, purpose: '核对事实', refs: [], depth: 'relevant_excerpt', state: 'pending' }] };
    session.gapDecisions = [
      { id: 'gd-deny', gapId: 'gap-photo', by: 'editor', kind: 'deny', refs: [], createdAt: '' },
      { id: 'gd-omit', gapId: 'src-brief', by: 'editor', kind: 'omit', refs: [], createdAt: '' },
      { id: 'gd-stale', gapId: 'gap-photo-old', by: 'editor', kind: 'deny', refs: [], createdAt: '' },
    ];
    render(<EditorialStatusPanel session={session} onStopAction={vi.fn()} />);
    expect(screen.getByText('讲师照片：编辑不允许使用该素材')).toBeInTheDocument();
    expect(screen.getByText('活动通稿：编辑选择省略该项')).toBeInTheDocument();
    expect(screen.getByText('编辑不允许使用该素材')).toBeInTheDocument();
    expect(screen.queryByText(/gap-photo-old/)).not.toBeInTheDocument();
  });

  it('normalises legacy English permission tokens in the requirement row', () => {
    const session = uiReady();
    session.gaps = [factGap({ id: 'perm', kind: 'permission', gapClass: 'authorization', label: '讲师照片的使用授权', reason: '用途：publication；渠道：public；身份：not_applicable', state: 'open' })];
    render(<EditorialStatusPanel session={session} onStopAction={vi.fn()} />);
    expect(screen.getByText(/用途：公开发布；渠道：公开；身份：不适用/)).toBeInTheDocument();
    expect(screen.queryByText(/not_applicable/)).not.toBeInTheDocument();
    expect(screen.getByText('待补充')).toBeInTheDocument();
  });

  it('renders one internal card for a block diagnostic without lastRun.stop and keeps other blocks in Agent 诊断', () => {
    const session = uiReady();
    session.diagnostics = [
      { owner: 'write:validation', code: 'invalid_artifact', message: '生成的正文未通过校验', refs: [], gateEffect: 'block' },
      { owner: 'facts:claims:x', code: 'unsafe_fact_snapshot', message: '事实快照不安全', refs: [], gateEffect: 'block' },
    ];
    render(<EditorialStatusPanel session={session} onStopAction={vi.fn()} />);
    expect(screen.getAllByRole('region', { name: '本轮失败' })).toHaveLength(1);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    const failureText = screen.getByRole('region', { name: '本轮失败' }).textContent ?? '';
    expect(failureText).toContain('诊断码：unsafe_fact_snapshot');
    expect(failureText).toContain('阶段：facts:claims:x');
    expect(screen.getAllByText('会阻止成稿')).toHaveLength(1);
    expect(screen.getByText(/诊断码：invalid_artifact/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制诊断编号' })).toBeInTheDocument();
    expect(screen.getByText('会阻止成稿')).toBeInTheDocument();
  });

  it('prefers lastRun.stop over a synthesized block card and never renders two cards', () => {
    const { session, stop } = withStop('internal', 'invalid_artifact', '生成的正文未通过校验', ['retry', 'report']);
    session.diagnostics = [{ owner: 'write:validation', code: 'invalid_artifact', message: '生成的正文未通过校验', refs: [], gateEffect: 'block' }];
    render(<EditorialStatusPanel session={session} onStopAction={vi.fn()} />);
    expect(stop.code).toBe('invalid_artifact');
    expect(screen.getAllByRole('region', { name: '本轮失败' })).toHaveLength(1);
    expect(screen.getByRole('region', { name: '本轮失败' }).textContent).toContain('诊断编号：trace-unit-1');
  });

  it('omits the 素材状态 section when there are no assets and shows it when present', () => {
    const empty = uiReady(); empty.candidate!.assets = [];
    render(<EditorialStatusPanel session={empty} onStopAction={vi.fn()} />);
    expect(screen.queryByText('素材状态')).not.toBeInTheDocument();
    cleanup();
    const withAsset = uiReady();
    withAsset.candidate!.assets = [{ assetId: 'asset-1', slotId: 'slot-1', use: 'illustration', state: 'included' }];
    withAsset.scopes = [{ id: 'asset-1', kind: 'asset', label: '讲师照片', anchors: [], qualifiers: [], identity: 'aligned' }];
    withAsset.permissions = [{ id: 'p1', subjectId: 'asset-1', uses: [{ channel: 'public', purpose: 'publication', identity: 'named' }], state: 'allowed', refs: [] }];
    render(<EditorialStatusPanel session={withAsset} onStopAction={vi.fn()} />);
    expect(screen.getByText('素材状态')).toBeInTheDocument();
    expect(screen.getByText(/讲师照片：已使用；已授权/)).toBeInTheDocument();
  });
});

describe('chat panel question notice and card submission record', () => {
  const batch: QuestionBatch = { id: 'q-chat', createdAtMessageId: 'm1', gapIds: ['g1'], items: [{ gapId: 'g1', gapClass: 'fact', subject: '活动', requested: '出席人数', why: '读者需要', expected: 'free_text', answerSlot: 'slot-g1' }], status: 'active' };
  const props = { messages: [{ role: 'assistant' as const, content: '请补充信息', timestamp: new Date() }], inputValue: '', loading: false, pipelineLoading: false, showHistory: false, sessions: [], currentSessionId: 's', chatScrollRef: { current: null }, chatError: null, onInputChange: vi.fn(), onSend: vi.fn(), onNewSession: vi.fn(), onLoadSession: vi.fn(), onDeleteSession: vi.fn(), onToggleHistory: vi.fn(), onGeneratePreview: vi.fn(), allowMessagePreview: false, onRetry: vi.fn() };
  it('renders the slot rejection notice', () => {
    render(<ChatPanel {...props} notice="该回答属于已过期的问题批次，请按当前问题重新回答。" />);
    expect(screen.getByRole('status')).toHaveTextContent('已过期');
  });
  it('labels card submissions as 卡片提交记录 and keeps full text plus a short bubble', () => {
    const onSubmit = vi.fn();
    render(<ChatPanel {...props} activeBatch={batch} onQuestionSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('出席人数'), { target: { value: '30 人' } });
    fireEvent.click(screen.getByRole('button', { name: '提交回答' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ batchId: 'q-chat', slots: [{ gapId: 'g1', value: '30 人' }], text: expect.stringContaining('[卡片提交记录]'), bubbleText: '已提交 1 项回答：活动' }));
  });
  it('keeps the batch outside the message scroll area with a capped, scrollable list', () => {
    render(<ChatPanel {...props} activeBatch={batch} onQuestionSubmit={vi.fn()} />);
    const card = screen.getByRole('region', { name: '待回答的问题批次' });
    expect(card.parentElement?.className).toContain('max-h-[60%]');
    expect(card.parentElement?.className).toContain('shrink-0');
    expect(card.className).toContain('min-h-0');
    expect(screen.getByRole('group', { name: '问题列表（可滚动）' }).className).toContain('overflow-y-auto');
  });
});
