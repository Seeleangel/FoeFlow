import { describe, expect, it } from 'vitest';
import { formatConstraint, formatGapReason, gapStateLabel, hasCjk } from '../editorialDisplay';
import { formatQuestionBubble } from '../editorialGaps';
import type { Gap } from '../editorialTypes';
import type { QuestionBatch } from '../editorialTypesV3';

const gap = (overrides: Partial<Gap> = {}): Gap => ({
  id: 'g', requirementId: 'r', kind: 'constraint', selector: { scopeId: 'criterion:length', predicate: 'length' },
  label: '篇幅要求', reason: '等待当前候选的验收结果', state: 'unmet', blocking: false, alternatives: [], resolutionClaimIds: [], ...overrides,
});
const batch = (overrides: Partial<QuestionBatch> = {}): QuestionBatch => ({
  id: 'q', createdAtMessageId: 'm', gapIds: ['g1', 'g2'],
  items: [
    { gapId: 'g1', gapClass: 'fact', subject: '出席人数', requested: '具体出席人数', why: '需要可核验的人数', expected: 'free_text', answerSlot: 's1' },
    { gapId: 'g2', gapClass: 'fact', subject: '活动日期', requested: '具体日期', why: '读者需要日期', expected: 'free_text', answerSlot: 's2' },
  ],
  status: 'active', ...overrides,
});

describe('editorial display labels (#6)', () => {
  it('detects CJK and translates states', () => {
    expect(hasCjk('unsafe fact snapshot')).toBe(false);
    expect(hasCjk('内部校验失败')).toBe(true);
    expect(gapStateLabel('blocked_by_constraint')).toBe('改写预算已用尽');
    expect(gapStateLabel('asked')).toBe('已询问');
  });

  it('normalises legacy permission tokens', () => {
    const permission = gap({ kind: 'permission', reason: '用途：publication；渠道：public；身份：not_applicable' });
    expect(formatGapReason(permission)).toBe('用途：公开发布；渠道：公开；身份：不适用');
  });

  it('renders each measurement once and labels the constraint by kind', () => {
    const measured = gap({ measurement: { criterionId: 'length', measured: '5', required: '10–∞ 可见字符', detail: '要求 10–∞ 可见字符，实测 5 字符' } });
    const display = formatConstraint(measured);
    expect(display.label).toBe('篇幅要求');
    expect(display.detail).toBe('要求 10–∞ 可见字符，实测 5 字符');
    expect(display.detail.match(/实测/g)).toHaveLength(1);
    expect(display.detail.match(/要求/g)).toHaveLength(1);
  });

  it('hides raw English gate detail in technical disclosure', () => {
    const display = formatConstraint(gap({ reason: 'Visible body characters: 5' }));
    expect(display.label).toBe('篇幅要求');
    expect(display.detail).toBe('未满足篇幅要求');
    expect(display.technical).toBe('Visible body characters: 5');
  });
});

describe('question bubble dedupe (#9)', () => {
  it('uses one short status line and never repeats card content', () => {
    const text = formatQuestionBubble(batch());
    expect(text).toBe('还有 2 项信息需要你补充。请在下方卡片中回答。');
    for (const value of ['出席人数', '具体出席人数', '需要可核验的人数', 'g1']) expect(text).not.toContain(value);
    expect(text.length).toBeLessThanOrEqual(120);
  });

  it('uses the intake wording and only mentions remaining count', () => {
    const text = formatQuestionBubble(batch({ intake: true, reasonCode: 'task_plan_incomplete', remainingGapIds: ['g3', 'g4'] }));
    expect(text).toContain('已整理出 2 项需要你确认的信息');
    expect(text).toContain('另有 2 项会在下一批继续询问');
    expect(text).not.toContain('出席人数');
  });

  it('uses the clarification wording for partial or unmapped replies', () => {
    expect(formatQuestionBubble(batch({ reasonCode: 'reply_partial' }))).toBe('还有 2 项未能对应到你的上一条回复。请在下方卡片中补充。');
    expect(formatQuestionBubble(batch({ reasonCode: 'reply_unmapped' }))).toContain('未能对应到你的上一条回复');
  });
});
