/**
 * Layout System Types for AI-Powered Article Layout
 */

// -- Layout Strategies (Phase 1 Output) --

export type LayoutArticleType =
  | '活动通知'
  | '人物专访'
  | '成果展示'
  | '节日节气'
  | '学术报告'
  | '其他';

export type LayoutStyle = string;

export type LayoutDensity = 'sparse' | 'normal' | 'rich';

export interface LayoutStrategy {
  articleType: LayoutArticleType;
  style: LayoutStyle;
  density: LayoutDensity;
  colorScheme: {
    primary: string;
    secondary: string;
    accent?: string;
  };
  layoutPattern: string;
  decorations: Array<{
    type: string;
    position: string;
    props?: Record<string, unknown>;
  }>;
}

// -- Fallback Strategy --

export const FALLBACK_STRATEGY: LayoutStrategy = {
  articleType: '其他',
  style: '自主设计',
  density: 'normal',
  colorScheme: {
    primary: '#1e3a5f',
    secondary: '#5a7a9c',
  },
  layoutPattern: 'default',
  decorations: [],
};

// -- StyleSpec (Phase 1 Output) --

export interface StyleSpec {
  articleType: string;
  emotionTone: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor?: string;
  density: 'sparse' | 'normal' | 'rich';
  forbidden: string[];
  keywords: string[];
  reasoning: string;
}

// -- LayoutDirection (Phase 2 Output) --

export interface LayoutDirection {
  id: string;
  name: string;
  description: string;
  features: string[];
  whyFit: string;
  philosophy: string;
}

// -- Merged Analysis Output (Phase 1) --

export interface LayoutAnalysisResult {
  spec: StyleSpec;
  strategy: Pick<LayoutStrategy, 'style' | 'layoutPattern' | 'decorations'> & {
    articleType: LayoutStrategy['articleType'];
    density: LayoutStrategy['density'];
    colorScheme: LayoutStrategy['colorScheme'];
  };
  directions: LayoutDirection[];
}

// -- Incremental Fix Instruction (Phase 5) --

export interface FixInstruction {
  action: 'replaceSection' | 'insertBefore' | 'insertAfter' | 'remove';
  selector: string;
  newHtml?: string;
  reason: string;
}

// -- LayoutReview (Phase 4 Output) --

export interface ReviewIssue {
  dimension: string;
  severity: 'fatal' | 'important' | 'minor';
  message: string;
  fixHint: string;
}

export type ReviewVerdict = 'pass' | 'warn' | 'fail';

export interface LayoutReview {
  dimensions: {
    readingExperience: ReviewVerdict; // 阅读体验 (40%)
    visualStructure: ReviewVerdict;   // 视觉结构 (30%)
    memorability: ReviewVerdict;      // 记忆点 (30%)
  };
  issues: ReviewIssue[];
  passed: boolean;
  overallFeedback: string;
}
