/**
 * Decoration System Types for FOE Publicity
 *
 * Type definitions for AI-powered article decoration system.
 */

// -- Article Analysis Result --

export type ArticleType =
  | '活动通知'
  | '人物专访'
  | '成果展示'
  | '节日节气'
  | '学术报告'
  | '其他';

export type ArticleStyle =
  | '正式'
  | '活泼'
  | '温暖'
  | '学术'
  | '简洁';

export type DecorationDensity = 'sparse' | 'normal' | 'rich';

// -- Decoration Types --

/**
 * Functional decorations (content-related)
 */
export type FunctionalDecorationType =
  | 'title-badge'      // 标题徽章/图标
  | 'info-box'         // 信息卡片
  | 'highlight-box'    // 重点高亮框
  | 'callout';         // 提示/警告框

/**
 * Pure decorative elements (visual-only)
 */
export type DecorativeElementType =
  | 'section-divider'     // 装饰性分隔线
  | 'emoji-prefix'        // emoji 前缀
  | 'gradient-bg'         // 渐变背景块
  | 'border-accent'       // 装饰性边框
  | 'centered-quote'      // 居中金句
  | 'sidebar-note'        // 侧边注释
  | 'first-letter-drop'   // 首字下沉
  | 'progress-indicator'; // 进度指示

export type DecorationType = FunctionalDecorationType | DecorativeElementType;

// -- Decoration Position --

export type DecorationPosition =
  | 'prefix'    // 添加到元素前面
  | 'suffix'    // 添加到元素后面
  | 'wrap'      // 包裹元素
  | 'after'     // 在元素之后
  | 'before';   // 在元素之前

// -- Decoration Props --

export interface TitleBadgeProps {
  icon: string;
  label: string;
  color?: string;
}

export interface InfoBoxProps {
  title: string;
  icon?: string;
  items: Array<{ label: string; value: string }>;
}

export interface HighlightBoxProps {
  variant: 'warning' | 'success' | 'info';
}

export interface CalloutProps {
  variant: 'tip' | 'warning' | 'danger' | 'info';
}

export interface SectionDividerProps {
  style: 'line' | 'diamond' | 'dots' | 'wave';
}

export interface EmojiPrefixProps {
  emoji: string;
}

export interface GradientBgProps {
  colors: string[];
}

export interface BorderAccentProps {
  style: 'rounded' | 'corners' | 'full';
}

export interface CenteredQuoteProps {
  size: 'normal' | 'large';
}

export interface SidebarNoteProps {
  title: string;
}

export interface FirstLetterDropProps {
  lines: number;
}

export interface ProgressIndicatorProps {
  current: number;
  total: number;
}

// Union type for all props
export type DecorationProps =
  | TitleBadgeProps
  | InfoBoxProps
  | HighlightBoxProps
  | CalloutProps
  | SectionDividerProps
  | EmojiPrefixProps
  | GradientBgProps
  | BorderAccentProps
  | CenteredQuoteProps
  | SidebarNoteProps
  | FirstLetterDropProps
  | ProgressIndicatorProps
  | Record<string, never>;

// -- Decoration Instruction --

export interface DecorationInstruction {
  type: DecorationType;
  target: string; // e.g., "paragraph:3", "h2:活动背景", "h1"
  position: DecorationPosition;
  props: DecorationProps;
  reason: string; // Why this decoration is added
}

// -- Analysis Result --

export interface DecorationAnalysisResult {
  articleType: ArticleType;
  style: ArticleStyle;
  decorationDensity: DecorationDensity;
  decorations: DecorationInstruction[];
}

// -- Rendered Decoration --

export interface RenderedDecoration {
  instruction: DecorationInstruction;
  html: string;
  applied: boolean;
  error?: string;
}

// -- Learned Style --

export interface LearnedStyle {
  name: string;
  description: string;
  articleType: ArticleType;
  style: ArticleStyle;
  decorationDensity: DecorationDensity;
  colors: {
    primary: string;
    secondary: string;
    accent?: string;
  };
  patterns: string[];
  decorations: Array<{
    type: string;
    target: string;
    position: 'wrap' | 'before' | 'after';
    props?: Record<string, unknown>;
    reason: string;
  }>;
  sourceArticle: string;
}
