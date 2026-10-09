/**
 * Article Generation Pipeline Types
 *
 * Types for the 5-phase article generation quality loop:
 * 1. analyzeArticleStyleSpec → ArticleStyleSpec
 * 2. suggestWritingDirections → WritingDirection[]
 * 3. generateArticle → string (article content)
 * 4. reviewArticle → ArticleReview
 * 5. fixArticle → string (fixed article)
 */

export interface ArticleStyleSpec {
  articleType: string;
  tone: string;
  structure: string;
  presentation: string;
  keywords: string[];
  reasoning: string;
}

export interface WritingDirection {
  id: string;
  name: string;
  angle: string;
  structure: string;
  tone: string;
  features: string[];
  whyFit: string;
}

export interface ArticleReviewDimension {
  score: number;
  maxScore: number;
  feedback: string;
}

export interface ArticleReviewIssue {
  dimension: string;
  severity: 'fatal' | 'important' | 'minor';
  message: string;
  fixHint: string;
}

export interface ArticleReview {
  dimensions: {
    structureClarity: ArticleReviewDimension;
    infoAccuracy: ArticleReviewDimension;
    toneConsistency: ArticleReviewDimension;
    mobileReadability: ArticleReviewDimension;
    audienceImpact: ArticleReviewDimension;
  };
  totalScore: number; // 0-50
  issues: ArticleReviewIssue[];
  passed: boolean;
  overallFeedback: string;
}

export type ArticlePipelineStage =
  | 'analyzing'
  | 'styleConfirm'
  | 'directionSelect'
  | 'generating'
  | 'reviewing'
  | 'reviewResult'
  | 'fixing'
  | 'complete';
