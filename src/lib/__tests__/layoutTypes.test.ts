import { describe, it, expect } from 'vitest';
import type {
  StyleSpec,
  LayoutDirection,
  LayoutReview,
  ReviewIssue,
  ReviewVerdict,
  LayoutAnalysisResult,
  FixInstruction,
} from '@/types/layout';

describe('layout types', () => {
  it('StyleSpec should accept valid spec', () => {
    const spec: StyleSpec = {
      articleType: '活动通知',
      emotionTone: '喜庆',
      primaryColor: '#e22007',
      secondaryColor: '#ffc026',
      accentColor: '#ff6b35',
      density: 'rich',
      forbidden: ['紫色渐变', 'emoji'],
      keywords: ['热烈', '传统', '欢聚'],
      reasoning: '文章提到春节和红包，故选喜庆红金配色',
    };
    expect(spec.primaryColor).toBe('#e22007');
    expect(spec.density).toBe('rich');
  });

  it('LayoutDirection should accept valid direction', () => {
    const dir: LayoutDirection = {
      id: 'dir-1',
      name: 'Pentagram 信息建筑',
      description: '克制网格、清晰层级',
      features: ['模块化卡片', '理性配色', '数据可视化'],
      whyFit: '活动通知需要信息清晰',
      philosophy: '信息建筑派',
    };
    expect(dir.philosophy).toBe('信息建筑派');
  });

  it('LayoutReview should accept valid 3-dim qualitative review', () => {
    const issue: ReviewIssue = {
      dimension: 'readingExperience',
      severity: 'important',
      message: '正文行高不足',
      fixHint: '将正文行高调整为 1.5-1.8',
    };
    const review: LayoutReview = {
      dimensions: {
        readingExperience: 'pass' as ReviewVerdict,
        visualStructure: 'warn' as ReviewVerdict,
        memorability: 'pass' as ReviewVerdict,
      },
      issues: [issue],
      passed: false,
      overallFeedback: '阅读体验良好，但视觉层次需加强',
    };
    expect(review.passed).toBe(false);
    expect(review.dimensions.readingExperience).toBe('pass');
    expect(review.dimensions.visualStructure).toBe('warn');
    expect(review.issues[0].dimension).toBe('readingExperience');
    expect(review.overallFeedback).toBe('阅读体验良好，但视觉层次需加强');
  });

  it('LayoutReview should accept all-pass dimensions', () => {
    const review: LayoutReview = {
      dimensions: {
        readingExperience: 'pass' as ReviewVerdict,
        visualStructure: 'pass' as ReviewVerdict,
        memorability: 'pass' as ReviewVerdict,
      },
      issues: [],
      passed: true,
      overallFeedback: '排版质量优秀，无需修改',
    };
    expect(review.passed).toBe(true);
    expect(review.issues).toHaveLength(0);
  });

  describe('ReviewVerdict', () => {
    it('should accept "pass"', () => {
      const v: ReviewVerdict = 'pass';
      expect(v).toBe('pass');
    });

    it('should accept "warn"', () => {
      const v: ReviewVerdict = 'warn';
      expect(v).toBe('warn');
    });

    it('should accept "fail"', () => {
      const v: ReviewVerdict = 'fail';
      expect(v).toBe('fail');
    });
  });

  describe('LayoutAnalysisResult', () => {
    it('should contain spec, strategy, and directions', () => {
      const result: LayoutAnalysisResult = {
        spec: {
          articleType: '活动通知',
          emotionTone: '喜庆',
          primaryColor: '#e22007',
          secondaryColor: '#ffc026',
          density: 'rich',
          forbidden: [],
          keywords: ['热烈'],
          reasoning: 'test',
        },
        strategy: {
          articleType: '活动通知',
          style: '节日喜庆',
          density: 'rich',
          colorScheme: { primary: '#e22007', secondary: '#ffc026' },
          layoutPattern: 'default',
          decorations: [],
        },
        directions: [
          {
            id: 'dir-1',
            name: '方向A',
            description: '描述A',
            features: ['特征1'],
            whyFit: '适合',
            philosophy: '哲学派',
          },
        ],
      };
      expect(result.spec.articleType).toBe('活动通知');
      expect(result.strategy.layoutPattern).toBe('default');
      expect(result.directions).toHaveLength(1);
    });
  });

  describe('FixInstruction', () => {
    it('should accept replaceSection instruction', () => {
      const inst: FixInstruction = {
        action: 'replaceSection',
        selector: 'section:nth-of-type(1)',
        newHtml: '<section>new content</section>',
        reason: '修复配色',
      };
      expect(inst.action).toBe('replaceSection');
      expect(inst.selector).toBe('section:nth-of-type(1)');
    });

    it('should accept insertBefore instruction', () => {
      const inst: FixInstruction = {
        action: 'insertBefore',
        selector: 'h1:nth-of-type(1)',
        newHtml: '<svg viewBox="0 0 100 20"><rect width="100" height="20"/></svg>',
        reason: '添加标题装饰',
      };
      expect(inst.action).toBe('insertBefore');
    });

    it('should accept insertAfter instruction', () => {
      const inst: FixInstruction = {
        action: 'insertAfter',
        selector: 'h2:nth-of-type(1)',
        newHtml: '<section>divider</section>',
        reason: '添加章节分隔',
      };
      expect(inst.action).toBe('insertAfter');
    });

    it('should accept remove instruction without newHtml', () => {
      const inst: FixInstruction = {
        action: 'remove',
        selector: 'section:nth-of-type(3)',
        reason: '移除多余装饰',
      };
      expect(inst.action).toBe('remove');
      expect(inst.newHtml).toBeUndefined();
    });
  });
});
