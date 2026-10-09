import { describe, it, expect } from 'vitest';
import type { ArticleStyleSpec, WritingDirection, ArticleReview, ArticlePipelineStage } from '@/types/article';

describe('article types', () => {
  it('ArticleStyleSpec can be constructed', () => {
    const spec: ArticleStyleSpec = {
      articleType: '活动通知',
      tone: '正式庄重',
      structure: '总分总',
      presentation: '段落式文段',
      keywords: ['活动', '通知'],
      reasoning: 'test',
    };
    expect(spec.articleType).toBe('活动通知');
    expect(spec.tone).toBe('正式庄重');
  });

  it('WritingDirection can be constructed', () => {
    const dir: WritingDirection = {
      id: 'dir-1',
      name: '稳妥型',
      angle: '正面直叙',
      structure: '总分总',
      tone: '正式庄重',
      features: ['结构清晰'],
      whyFit: '通用选择',
    };
    expect(dir.id).toBe('dir-1');
    expect(dir.features).toHaveLength(1);
  });

  it('ArticleReview passed field works', () => {
    const review: ArticleReview = {
      dimensions: {
        structureClarity: { score: 8, maxScore: 10, feedback: 'ok' },
        infoAccuracy: { score: 8, maxScore: 10, feedback: 'ok' },
        toneConsistency: { score: 7, maxScore: 10, feedback: 'ok' },
        mobileReadability: { score: 7, maxScore: 10, feedback: 'ok' },
        audienceImpact: { score: 7, maxScore: 10, feedback: 'ok' },
      },
      totalScore: 37,
      issues: [],
      passed: false,
      overallFeedback: '基本可用',
    };
    expect(review.passed).toBe(false);
    expect(review.totalScore).toBe(37);
    expect(review.dimensions.structureClarity.score).toBe(8);
  });

  it('ArticlePipelineStage accepts all valid stages', () => {
    const stages: ArticlePipelineStage[] = [
      'analyzing', 'styleConfirm', 'directionSelect', 'generating',
      'reviewing', 'reviewResult', 'fixing', 'complete',
    ];
    expect(stages).toHaveLength(8);
  });

  it('rejects invalid pipeline stages at type level', () => {
    // @ts-expect-error 'invalidStage' is not a valid ArticlePipelineStage
    const badStage: ArticlePipelineStage = 'invalidStage';
    expect(badStage).toBe('invalidStage'); // runtime still works, but TS should flag it
  });
});
