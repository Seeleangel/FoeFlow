/**
 * Style Extractor for FOE Publicity
 *
 * Extracts style patterns from existing article HTML to create reusable style profiles.
 */

import type { LearnedStyle, DecorationInstruction } from '@/types/decoration';

/**
 * Color palette extracted from articles.
 */
interface ColorPalette {
  primary: string;
  secondary: string;
  accent?: string;
  background?: string;
  text?: string;
}

/**
 * Decoration pattern found in articles.
 */
interface DecorationPattern {
  type: string;
  frequency: number;
  props?: Record<string, unknown>;
  example?: string;
}

/**
 * Style rule for AI prompt (built-in from 6 sample articles)
 */
export interface StyleRule {
  name: string;
  description: string;
  colors: {
    primary: string;
    secondary: string;
    accent?: string;
    background?: string;
  };
  layouts: string[];
  decorations: string[];
  applicableScenarios: string[];
  keywords: string[];
}

/**
 * Extract color scheme from HTML content.
 */
function extractColors(html: string): ColorPalette {
  const colorMap = new Map<string, number>();

  // Match inline style colors
  const colorRegex = /(?:color|background-color|background|border-color):\s*(#[0-9a-fA-F]{3,8}|rgb\([^)]+\)|rgba\([^)]+\))/gi;
  let match;

  while ((match = colorRegex.exec(html)) !== null) {
    const color = match[1];
    colorMap.set(color, (colorMap.get(color) || 0) + 1);
  }

  // Sort by frequency
  const sortedColors = Array.from(colorMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([color]) => color);

  // Identify primary color (most frequent non-neutral color)
  const isNeutral = (c: string) => {
    const lower = c.toLowerCase();
    return lower.includes('#fff') || lower.includes('#000') ||
           lower.includes('#f') || lower.includes('#333') ||
           lower.includes('#666') || lower.includes('#999') ||
           lower.includes('rgb(255') || lower.includes('rgba(255');
  };

  const nonNeutralColors = sortedColors.filter(c => !isNeutral(c));

  return {
    primary: nonNeutralColors[0] || '#2563eb',
    secondary: nonNeutralColors[1] || nonNeutralColors[0] || '#3b82f6',
    accent: nonNeutralColors[2],
    background: sortedColors.find(c => c.toLowerCase().includes('#f') || c.toLowerCase().includes('#e')) || '#ffffff',
    text: '#333333',
  };
}

/**
 * Extract decoration patterns from HTML content.
 */
function extractDecorationPatterns(html: string): DecorationPattern[] {
  const patterns: DecorationPattern[] = [];

  // Check for SVG decorations
  const svgCount = (html.match(/<svg/g) || []).length;
  if (svgCount > 0) {
    patterns.push({
      type: 'svg-decoration',
      frequency: svgCount,
      example: 'SVG geometric shapes',
    });
  }

  // Check for border decorations
  const borderMatches = html.match(/border[^;]*:\s*[^;]+/gi) || [];
  const dashedBorders = borderMatches.filter(b => b.includes('dashed'));
  const solidBorders = borderMatches.filter(b => b.includes('solid'));

  if (dashedBorders.length > 0) {
    patterns.push({
      type: 'dashed-border',
      frequency: dashedBorders.length,
      props: { style: 'dashed' },
    });
  }

  if (solidBorders.length > 3) {
    patterns.push({
      type: 'solid-border',
      frequency: solidBorders.length,
      props: { style: 'solid' },
    });
  }

  // Check for rounded corners
  const borderRadiusCount = (html.match(/border-radius/gi) || []).length;
  if (borderRadiusCount > 2) {
    patterns.push({
      type: 'rounded-corners',
      frequency: borderRadiusCount,
      props: { radius: '8px-25px' },
    });
  }

  // Check for gradient backgrounds
  const gradientCount = (html.match(/linear-gradient/gi) || []).length;
  if (gradientCount > 0) {
    patterns.push({
      type: 'gradient-bg',
      frequency: gradientCount,
      props: { type: 'linear' },
    });
  }

  // Check for section dividers
  const dividerPatterns = [
    /<hr/gi,
    /border-bottom.*dashed/gi,
    /～.*～.*～/g,
    /✦.*✦.*✦/g,
  ];
  let dividerCount = 0;
  for (const pattern of dividerPatterns) {
    dividerCount += (html.match(pattern) || []).length;
  }
  if (dividerCount > 0) {
    patterns.push({
      type: 'section-divider',
      frequency: dividerCount,
    });
  }

  // Check for image decorations (GIFs, decorative images)
  const gifCount = (html.match(/\.gif/gi) || []).length;
  if (gifCount > 0) {
    patterns.push({
      type: 'animated-decoration',
      frequency: gifCount,
    });
  }

  return patterns.filter(p => p.frequency > 0);
}

/**
 * Analyze article structure.
 */
function analyzeStructure(html: string): {
  hasTitleSection: boolean;
  hasContentCards: boolean;
  hasFooter: boolean;
  sectionCount: number;
} {
  const sections = html.match(/<section[^>]*data-role=["']title["'][^>]*>/gi) || [];
  const cards = html.match(/<section[^>]*style=["'][^"']*background-color/gi) || [];
  const footer = html.match(/教育学部|宣传媒体部|指导老师/gi) || [];

  return {
    hasTitleSection: sections.length > 0,
    hasContentCards: cards.length > 3,
    hasFooter: footer.length > 0,
    sectionCount: Math.max(sections.length, Math.floor(cards.length / 2)),
  };
}

/**
 * Convert extracted patterns to a learned style profile.
 */
function createStyleProfile(
  name: string,
  description: string,
  colors: ColorPalette,
  patterns: DecorationPattern[],
  structure: ReturnType<typeof analyzeStructure>
): LearnedStyle {
  // Determine article type based on patterns
  let articleType: '活动通知' | '人物专访' | '成果展示' | '节日节气' | '学术报告' | '其他' = '其他';

  if (patterns.some(p => p.type === 'animated-decoration') || patterns.some(p => p.type === 'svg-decoration')) {
    if (name.includes('新年') || name.includes('腊八') || name.includes('拥抱')) {
      articleType = '节日节气';
    } else if (name.includes('穿搭')) {
      articleType = '成果展示';
    }
  }

  if (patterns.some(p => p.type === 'gradient-bg') && colors.primary.includes('#e22007') || colors.primary.includes('#f22a0e')) {
    articleType = '节日节气';
  }

  if (name.includes('315') || name.includes('维权')) {
    articleType = '其他';
  }

  // Determine style
  let style: '正式' | '活泼' | '温暖' | '学术' | '简洁' = '简洁';

  if (colors.primary.includes('#d83c18') || colors.primary.includes('#e22007')) {
    style = name.includes('315') ? '正式' : '活泼';
  }

  if (colors.primary.includes('#f5d6a8') || colors.primary.includes('#837261')) {
    style = '温暖';
  }

  if (patterns.some(p => p.type === 'gradient-bg') || patterns.some(p => p.type === 'animated-decoration')) {
    style = '活泼';
  }

  // Determine decoration density
  const totalPatterns = patterns.reduce((sum, p) => sum + p.frequency, 0);
  let decorationDensity: 'sparse' | 'normal' | 'rich' = 'normal';

  if (totalPatterns < 5) {
    decorationDensity = 'sparse';
  } else if (totalPatterns > 15) {
    decorationDensity = 'rich';
  }

  // Generate decoration instructions based on patterns
  const decorations: Array<{
    type: string;
    target: string;
    position: 'wrap' | 'before' | 'after';
    props?: Record<string, unknown>;
    reason: string;
  }> = [];

  // Add section dividers if found
  if (patterns.some(p => p.type === 'section-divider') || structure.sectionCount > 2) {
    decorations.push({
      type: 'section-divider',
      target: 'h2',
      position: 'after',
      props: { style: 'line' },
      reason: '文章分节明显，使用分隔线增强节奏感',
    });
  }

  // Add gradient background for festive articles
  if (patterns.some(p => p.type === 'gradient-bg') || articleType === '节日节气') {
    decorations.push({
      type: 'gradient-bg',
      target: 'paragraph:0',
      position: 'wrap',
      props: { colors: [colors.primary, colors.secondary] },
      reason: '节日主题文章使用渐变背景增强氛围',
    });
  }

  // Add border accent for content cards
  if (patterns.some(p => p.type === 'solid-border') || patterns.some(p => p.type === 'rounded-corners')) {
    decorations.push({
      type: 'border-accent',
      target: 'paragraph:1',
      position: 'wrap',
      props: { style: 'rounded' },
      reason: '内容卡片使用装饰边框提升视觉层次',
    });
  }

  // Add title badge for articles with clear title sections
  if (structure.hasTitleSection) {
    decorations.push({
      type: 'title-badge',
      target: 'h1',
      position: 'before',
      props: {
        label: articleType === '节日节气' ? '节日专题' : '专题报道',
        icon: articleType === '节日节气' ? '🎉' : '📌',
        color: colors.primary,
      },
      reason: '文章有明确标题区域，添加徽章增强识别',
    });
  }

  return {
    name,
    description,
    articleType,
    style,
    decorationDensity,
    colors: {
      primary: colors.primary,
      secondary: colors.secondary,
      accent: colors.accent,
    },
    patterns: patterns.map(p => p.type),
    decorations,
    sourceArticle: name,
  };
}

/**
 * Built-in style rules extracted from 6 sample articles
 * Used in AI prompt for layout analysis and generation
 */
export const STYLE_RULES: StyleRule[] = [
  // Academic / Neutral rules first — these are the most common for school content
  {
    name: '学术沉静',
    description: '学术报告风格，深蓝 + 灰蓝系，沉稳专业',
    colors: {
      primary: '#1e3a5f',
      secondary: '#5a7a9c',
      accent: '#e8eef4',
      background: '#f4f6f8',
    },
    layouts: [
      '简洁边框：border: 1px solid #d0d8e0',
      '清晰层次：标题加粗 + 段落缩进',
      '数据图表框',
      '引用块：左侧竖线',
    ],
    decorations: [
      '简约线条分隔',
      '几何点缀（圆点、方块）',
      '学术图标（书本、笔）',
    ],
    applicableScenarios: ['学术报告', '科研成果', '论文摘要'],
    keywords: ['学术', '报告', '科研', '论文', '研究', '讲座'],
  },
  {
    name: '简约现代',
    description: '通用简约风格，深灰 + 浅灰，克制高级',
    colors: {
      primary: '#374151',
      secondary: '#9ca3af',
      accent: '#f3f4f6',
      background: '#fafafa',
    },
    layouts: [
      '无装饰边框',
      '清晰网格',
      '留白优先',
      '层级分明',
    ],
    decorations: [
      '细线分隔',
      '极简几何',
      '单色图标',
    ],
    applicableScenarios: ['通知', '说明', '通用'],
    keywords: ['通知', '公告', '说明', '通用', '简介'],
  },
  {
    name: '自然清新',
    description: '环保/自然主题风格，绿色系 + 米白，清新舒适',
    colors: {
      primary: '#2d6a4f',
      secondary: '#74c69d',
      accent: '#e8f5e9',
      background: '#f1f8f4',
    },
    layouts: [
      '柔和边框：border: 1px solid #a8d5ba',
      '自然留白',
      '图文并排',
      '列表卡片',
    ],
    decorations: [
      '叶片/植物 SVG',
      '波浪线分隔',
      '圆角标签',
    ],
    applicableScenarios: ['环保', '自然', '健康', '校园活动'],
    keywords: ['绿色', '环保', '自然', '生态', '植物', '健康'],
  },
  // Specific / warm-toned rules below — lower priority for general school content
  {
    name: '专业严谨',
    description: '315 维权指南风格，红金配色，专业严肃',
    colors: {
      primary: '#d83c18',
      secondary: '#eeb069',
      accent: '#fcf3e5',
      background: '#fcf3e5',
    },
    layouts: [
      '边框容器：border: 1px solid #eeb069',
      '圆角：border-radius: 8px',
      'SVG 几何装饰（三角形、菱形）',
      '分隔线：border-top: 2px solid #e5e7eb',
    ],
    decorations: [
      'PART 标号系统',
      '信息卡片（浅蓝背景 + 图标）',
      '模拟场景框（圆角 + 阴影）',
      'SVG 交互：点击展开步骤详情',
      'SVG 交互：进度条展示数据',
    ],
    applicableScenarios: ['维权指南', '专业说明', '通知'],
    keywords: ['维权', '指南', '专业', '说明'],
  },
  {
    name: '温暖治愈',
    description: '拥抱日风格，暖黄 + 棕色系，温和柔软',
    colors: {
      primary: '#f5d6a8',
      secondary: '#837261',
      accent: '#fef8f0',
    },
    layouts: [
      '柔化边框：border: 1px dashed',
      '虚线分隔',
      '大圆角：border-radius: 20px',
      '宽间距：margin: 20px',
    ],
    decorations: [
      '花卉装饰 GIF',
      '居中金句',
      '温暖文案',
    ],
    applicableScenarios: ['情感类', '温暖主题', '关怀'],
    keywords: ['拥抱', '温暖', '关怀', '情感', '治愈'],
  },
  {
    name: '节日喜庆',
    description: '新年红包风格，中国红 + 金黄，喜庆热烈',
    colors: {
      primary: '#e22007',
      secondary: '#ffc026',
      accent: '#fff8e7',
    },
    layouts: [
      '圆角卡片：border-radius: 10px',
      '横向布局（flex 容器）',
      '红包组件嵌入（<mp-common-redpacket>）',
      '圆形图片框',
    ],
    decorations: [
      '灯笼/红包图标',
      '渐变背景（红金）',
      '祝福语居中',
      'SVG 交互：点击拆开红包/信封',
      'SVG 交互：循环闪烁引导箭头',
    ],
    applicableScenarios: ['新年', '春节', '节日庆典'],
    keywords: ['新年', '春节', '红包', '祝福', '元旦', '元宵'],
  },
  {
    name: '传统节日',
    description: '腊八节风格，深红 + 深蓝，传统庄重',
    colors: {
      primary: '#700202',
      secondary: '#023270',
      accent: '#ffe8d1',
    },
    layouts: [
      '圆形图片框：border-radius: 50%',
      '动态 GIF 装饰',
      '传统纹样',
      '对称布局',
    ],
    decorations: [
      '腊八粥图标',
      '传统图案',
      '菱形分隔',
      'SVG 交互：顺序点击揭晓习俗',
      'SVG 交互：点击展开节日详情',
    ],
    applicableScenarios: ['传统节日', '文化活动'],
    keywords: ['腊八', '端午', '中秋', '清明', '重阳', '寒食'],
  },
  {
    name: '活力庆典',
    description: '师生同乐会风格，橙色系 + 多色点缀，活力四射',
    colors: {
      primary: '#f96900',
      secondary: '#ffb347',
      accent: '#fff5e6',
    },
    layouts: [
      '复杂网格布局',
      '多层叠加',
      '宽幅 header',
      '动态效果',
    ],
    decorations: [
      '庆祝图标（🎉）',
      '渐变文字',
      '活动亮点卡片',
      'SVG 交互：点击揭晓奖项/节目单',
      'SVG 交互：多图顺序切换展示',
    ],
    applicableScenarios: ['活动通知', '庆典', '晚会'],
    keywords: ['晚会', '庆典', '报名', '同乐会', '联欢'],
  },
  {
    name: '时尚潮流',
    description: '穿搭风格，渐变红 + 现代设计，时尚前卫',
    colors: {
      primary: '#f22a0e',
      secondary: '#be0000',
      accent: '#f4a37a',
    },
    layouts: [
      '渐变背景：linear-gradient()',
      '文字特效：-webkit-background-clip: text',
      '几何边框',
      '层叠效果',
    ],
    decorations: [
      '时尚标签',
      '渐变标题',
      '现代感分隔',
    ],
    applicableScenarios: ['时尚', '穿搭', '现代主题'],
    keywords: ['穿搭', '时尚', '潮流', '美妆', '现代'],
  },
];

/**
 * Get style rule by name
 */
export function getStyleRuleByName(name: string): StyleRule | undefined {
  return STYLE_RULES.find(rule => rule.name === name);
}

/**
 * Match style based on article content keywords.
 * Uses a scoring system: the rule with the most keyword matches wins.
 * On ties, academic/modern rules are preferred over festive/emotional ones.
 */
export function matchStyleByKeywords(content: string): StyleRule {
  const lowerContent = content.toLowerCase();

  let bestRule: StyleRule | null = null;
  let bestScore = 0;

  for (const rule of STYLE_RULES) {
    const score = rule.keywords.filter(kw => lowerContent.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestRule = rule;
    }
  }

  if (bestRule && bestScore > 0) {
    return bestRule;
  }

  // Default: return a neutral style instead of hardcoded warm tones
  return {
    name: '自主设计',
    description: '根据文章内容自主设计配色和风格',
    colors: {
      primary: '#1e3a5f',
      secondary: '#5a7a9c',
      accent: '#f0f4f8',
      background: '#f8f9fa',
    },
    layouts: ['根据内容自主决定布局'],
    decorations: ['根据内容自主决定装饰'],
    applicableScenarios: ['通用'],
    keywords: [],
  };
}

/**
 * Pre-defined style profiles extracted from existing articles.
 */
export const PRE_DEFINED_STYLES: LearnedStyle[] = [
  {
    name: '专业严谨',
    description: '315 维权指南风格，使用红金配色，专业严肃',
    articleType: '其他',
    style: '正式',
    decorationDensity: 'normal',
    colors: {
      primary: '#d83c18',
      secondary: '#eeb069',
      accent: '#fcf3e5',
    },
    patterns: ['svg-decoration', 'solid-border', 'rounded-corners', 'section-divider'],
    decorations: [
      {
        type: 'title-badge',
        target: 'h1',
        position: 'before',
        props: { label: '专题指南', icon: '📋', color: '#d83c18' },
        reason: '专业指南类文章添加标题徽章增强识别',
      },
      {
        type: 'info-box',
        target: 'paragraph:1',
        position: 'wrap',
        props: {
          title: '重要提示',
          icon: 'ℹ️',
          items: [{ label: '准备', value: '证据材料' }, { label: '核实', value: '主体信息' }, { label: '明确', value: '核心诉求' }],
        },
        reason: '关键信息使用信息卡片突出展示',
      },
      {
        type: 'section-divider',
        target: 'h2',
        position: 'after',
        props: { style: 'line' },
        reason: '分节内容使用分隔线清晰划分',
      },
    ],
    sourceArticle: '315.txt',
  },
  {
    name: '节日喜庆',
    description: '新年红包风格，使用中国红 + 金黄，喜庆热烈',
    articleType: '节日节气',
    style: '活泼',
    decorationDensity: 'rich',
    colors: {
      primary: '#e22007',
      secondary: '#ffc026',
      accent: '#fff8e7',
    },
    patterns: ['gradient-bg', 'svg-decoration', 'animated-decoration', 'rounded-corners'],
    decorations: [
      {
        type: 'gradient-bg',
        target: 'paragraph:0',
        position: 'wrap',
        props: { colors: ['#e22007', '#ffc026'] },
        reason: '节日主题使用红金渐变背景增强喜庆氛围',
      },
      {
        type: 'emoji-prefix',
        target: 'h1',
        position: 'wrap',
        props: { emoji: '🧧' },
        reason: '红包主题添加 Emoji 前缀',
      },
      {
        type: 'centered-quote',
        target: 'paragraph:2',
        position: 'wrap',
        props: { size: 'large' },
        reason: '祝福语使用居中金句样式突出展示',
      },
    ],
    sourceArticle: '新年红包.txt',
  },
  {
    name: '温暖治愈',
    description: '拥抱日风格，使用暖黄 + 棕色系，温和柔软',
    articleType: '其他',
    style: '温暖',
    decorationDensity: 'normal',
    colors: {
      primary: '#f5d6a8',
      secondary: '#837261',
      accent: '#fef8f0',
    },
    patterns: ['dashed-border', 'rounded-corners', 'section-divider'],
    decorations: [
      {
        type: 'border-accent',
        target: 'paragraph:1',
        position: 'wrap',
        props: { style: 'rounded' },
        reason: '温暖风格使用圆角边框营造柔和感',
      },
      {
        type: 'section-divider',
        target: 'h2',
        position: 'after',
        props: { style: 'dots' },
        reason: '使用点状分隔线增强温柔氛围',
      },
      {
        type: 'centered-quote',
        target: 'paragraph:3',
        position: 'wrap',
        props: { size: 'normal' },
        reason: '金句使用居中样式增强情感表达',
      },
    ],
    sourceArticle: '拥抱日.txt',
  },
  {
    name: '传统节日',
    description: '腊八节风格，使用深红 + 深蓝，传统庄重',
    articleType: '节日节气',
    style: '正式',
    decorationDensity: 'normal',
    colors: {
      primary: '#700202',
      secondary: '#023270',
      accent: '#ffe8d1',
    },
    patterns: ['animated-decoration', 'solid-border', 'section-divider'],
    decorations: [
      {
        type: 'title-badge',
        target: 'h1',
        position: 'before',
        props: { label: '传统节日', icon: '🥣', color: '#700202' },
        reason: '传统节日主题添加标题徽章',
      },
      {
        type: 'border-accent',
        target: 'paragraph:1',
        position: 'wrap',
        props: { style: 'corners' },
        reason: '传统节日使用装饰边框增强仪式感',
      },
      {
        type: 'section-divider',
        target: 'h2',
        position: 'after',
        props: { style: 'diamond' },
        reason: '使用传统纹样分隔线增强节日氛围',
      },
    ],
    sourceArticle: '腊八节.txt',
  },
  {
    name: '活力庆典',
    description: '师生同乐会风格，使用橙色系 + 多色点缀，活力四射',
    articleType: '活动通知',
    style: '活泼',
    decorationDensity: 'rich',
    colors: {
      primary: '#f96900',
      secondary: '#ffb347',
      accent: '#fff5e6',
    },
    patterns: ['gradient-bg', 'animated-decoration', 'svg-decoration', 'rounded-corners'],
    decorations: [
      {
        type: 'gradient-bg',
        target: 'paragraph:0',
        position: 'wrap',
        props: { colors: ['#f96900', '#ffb347'] },
        reason: '活动通知使用渐变背景增强活力感',
      },
      {
        type: 'emoji-prefix',
        target: 'h1',
        position: 'wrap',
        props: { emoji: '🎉' },
        reason: '活动主题添加庆祝 Emoji',
      },
      {
        type: 'info-box',
        target: 'paragraph:1',
        position: 'wrap',
        props: { title: '活动亮点', icon: '✨', items: [] },
        reason: '活动信息使用信息卡片清晰展示',
      },
    ],
    sourceArticle: '新年师生同乐会.txt',
  },
  {
    name: '时尚潮流',
    description: '穿搭风格，使用渐变红 + 现代设计，时尚前卫',
    articleType: '成果展示',
    style: '活泼',
    decorationDensity: 'rich',
    colors: {
      primary: '#f22a0e',
      secondary: '#be0000',
      accent: '#f4a37a',
    },
    patterns: ['gradient-bg', 'svg-decoration', 'rounded-corners'],
    decorations: [
      {
        type: 'gradient-bg',
        target: 'paragraph:0',
        position: 'wrap',
        props: { colors: ['#f22a0e', '#be0000'] },
        reason: '时尚主题使用渐变背景增强视觉冲击',
      },
      {
        type: 'title-badge',
        target: 'h1',
        position: 'before',
        props: { label: '时尚专题', icon: '👗', color: '#f22a0e' },
        reason: '穿搭主题添加标题徽章',
      },
      {
        type: 'centered-quote',
        target: 'paragraph:2',
        position: 'wrap',
        props: { size: 'large' },
        reason: '时尚金句使用居中样式突出展示',
      },
    ],
    sourceArticle: '穿搭.txt',
  },
];

/**
 * Analyze article HTML and return a learned style profile.
 *
 * @param html - The article HTML content
 * @param name - The article name (for style profile naming)
 * @returns Learned style profile
 */
export function analyzeAndLearnStyle(html: string, name: string): LearnedStyle {
  const colors = extractColors(html);
  const patterns = extractDecorationPatterns(html);
  const structure = analyzeStructure(html);

  return createStyleProfile(
    name,
    `从《${name}》提取的风格`,
    colors,
    patterns,
    structure
  );
}

/**
 * Get all available learned styles.
 */
export function getLearnedStyles(): LearnedStyle[] {
  return PRE_DEFINED_STYLES;
}

/**
 * Get a specific learned style by name.
 */
export function getLearnedStyleByName(name: string): LearnedStyle | undefined {
  return PRE_DEFINED_STYLES.find(style => style.name === name);
}

/**
 * Apply a learned style to decoration instructions.
 * Modifies the decoration instructions to match the learned style's color scheme and patterns.
 */
export function applyLearnedStyle(
  decorations: DecorationInstruction[],
  style: LearnedStyle
): DecorationInstruction[] {
  return decorations.map(dec => {
    const updatedProps = { ...dec.props } as Record<string, unknown>;

    // Apply primary color to relevant decorations
    if (dec.type === 'title-badge' && 'color' in updatedProps) {
      updatedProps.color = style.colors.primary;
    }

    if (dec.type === 'gradient-bg' && 'colors' in updatedProps) {
      updatedProps.colors = [style.colors.primary, style.colors.secondary];
    }

    if (dec.type === 'border-accent') {
      // Keep style props but can adjust colors if needed
    }

    return {
      ...dec,
      props: updatedProps as any,
    };
  });
}
