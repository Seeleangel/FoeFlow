/**
 * 范文风格分析器
 * 从范文库中提取风格特征，用于指导 AI 生成符合公众号定位的文章
 */

import { getAllUserArticles } from './libraryStorage';

export interface StyleFeatures {
  /** 标题模式 */
  titlePatterns: {
    /** 主副标题分隔符（如「丨」） */
    separator: string;
    /** 常见标题关键词 */
    commonKeywords: string[];
    /** 标题长度范围 */
    lengthRange: { min: number; max: number };
  };
  /** 语言风格特征 */
  writingStyle: {
    /** 短句分行模式 */
    shortLineBreaks: boolean;
    /** 排比句使用频率 */
    parallelismFrequency: 'low' | 'medium' | 'high';
    /** 设问/反问使用 */
    rhetoricalQuestions: boolean;
    /** 情感色彩 */
    tone: 'formal' | 'warm' | 'energetic' | 'poetic';
  };
  /** 高频词汇 */
  frequentWords: {
    /** 称谓词（如 ECNUers、E 小苗、E 小叶） */
    addressTerms: string[];
    /** 主题词（如青春、成长、教育） */
    themeWords: string[];
    /** 连接词（如让我们、愿、相信） */
    connectors: string[];
  };
  /** 结构特点 */
  structure: {
    /** 常见开头模式 */
    openingPatterns: string[];
    /** 常见结尾模式 */
    closingPatterns: string[];
    /** 段落平均长度 */
    avgParagraphLength: number;
    /** 是否有固定结尾格式 */
    hasStandardFooter: boolean;
  };
  /** 文章类型分布 */
  articleTypes: Array<{
    type: string;
    count: number;
    characteristics: string;
  }>;
}

/**
 * 分析范文库中的文章，提取风格特征
 */
export async function analyzeArticleStyles(): Promise<StyleFeatures> {
  const articles = await getAllUserArticles();

  if (articles.length === 0) {
    return getDefaultStyleFeatures();
  }

  const allTitles = articles.map((a) => a.title);
  const allContent = articles.map((a) => a.content).join('\n\n');

  // 分析标题模式
  const titlePatterns = analyzeTitlePatterns(allTitles);

  // 分析语言风格
  const writingStyle = analyzeWritingStyle(allContent);

  // 分析高频词汇
  const frequentWords = analyzeFrequentWords(allContent);

  // 分析结构特点
  const structure = analyzeStructure(articles);

  // 分析文章类型
  const articleTypes = analyzeArticleTypes(articles);

  return {
    titlePatterns,
    writingStyle,
    frequentWords,
    structure,
    articleTypes,
  };
}

/**
 * 分析标题模式
 */
function analyzeTitlePatterns(titles: string[]) {
  // 检测分隔符
  const separators = ['丨', '|', '·', ' - ', '：'];
  let mostCommonSeparator = '丨';
  let maxCount = 0;

  separators.forEach((sep) => {
    const count = titles.filter((t) => t.includes(sep)).length;
    if (count > maxCount) {
      maxCount = count;
      mostCommonSeparator = sep;
    }
  });

  // 提取常见关键词
  const keywordCandidates: Record<string, number> = {};
  titles.forEach((title) => {
    // 分隔符后的部分通常包含文章类型
    const parts = title.split(/[丨|·:]/);
    if (parts.length > 1) {
      const secondPart = parts[1].trim();
      // 提取可能的关键词（去除标点）
      const words = secondPart.replace(/[!！\?？]/g, '').split(/\s+/);
      words.forEach((word) => {
        if (word.length >= 2) {
          keywordCandidates[word] = (keywordCandidates[word] || 0) + 1;
        }
      });
    }
  });

  const commonKeywords = Object.entries(keywordCandidates)
    .filter(([_, count]) => count >= 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);

  // 标题长度统计
  const lengths = titles.map((t) => t.length);
  const minLength = Math.min(...lengths);
  const maxLength = Math.max(...lengths);

  return {
    separator: mostCommonSeparator,
    commonKeywords,
    lengthRange: { min: minLength, max: maxLength },
  };
}

/**
 * 分析语言风格
 */
function analyzeWritingStyle(content: string) {
  // 检测短句分行（通过换行符密度判断）
  const lines = content.split('\n').filter((l) => l.trim().length > 0);
  const avgLineLength =
    lines.reduce((sum, line) => sum + line.length, 0) / lines.length;
  const shortLineBreaks = avgLineLength < 50; // 平均每行少于 50 字认为是短句分行

  // 检测排比句（重复的句式结构）
  const parallelPatterns = [
    /是.*是.*是/g,
    /从.*到.*从.*到/g,
    /每一次.*每一次/g,
    /有.*有.*也有/g,
  ];
  let parallelismCount = 0;
  parallelPatterns.forEach((pattern) => {
    const matches = content.match(pattern);
    if (matches) parallelismCount += matches.length;
  });
  const parallelismFrequency: 'low' | 'medium' | 'high' =
    parallelismCount > 10 ? 'high' : parallelismCount > 3 ? 'medium' : 'low';

  // 检测设问/反问
  const rhetoricalPatterns = [
    /你是否/g,
    /是不是/g,
    /为什么/g,
    /如何/g,
    /难道/g,
    /什么是/g,
  ];
  let rhetoricalCount = 0;
  rhetoricalPatterns.forEach((pattern) => {
    const matches = content.match(pattern);
    if (matches) rhetoricalCount += matches.length;
  });
  const rhetoricalQuestions = rhetoricalCount > 5;

  // 判断整体语调
  const warmWords = ['温暖', '温馨', '温情', '暖心', '感动', '感谢', '祝福'];
  const energeticWords = [
    '燃',
    '超燃',
    '热血',
    '奋进',
    '冲刺',
    '加油',
    '拼搏',
  ];
  const poeticWords = ['诗意', '画卷', '笔墨', '篇章', '芳华', '韶华'];

  let warmScore = warmWords.reduce(
    (sum, word) => sum + (content.includes(word) ? 1 : 0),
    0
  );
  let energeticScore = energeticWords.reduce(
    (sum, word) => sum + (content.includes(word) ? 1 : 0),
    0
  );
  let poeticScore = poeticWords.reduce(
    (sum, word) => sum + (content.includes(word) ? 1 : 0),
    0
  );

  const maxScore = Math.max(warmScore, energeticScore, poeticScore);
  let tone: StyleFeatures['writingStyle']['tone'] = 'formal';
  if (maxScore === warmScore) tone = 'warm';
  else if (maxScore === energeticScore) tone = 'energetic';
  else if (maxScore === poeticScore) tone = 'poetic';

  return {
    shortLineBreaks,
    parallelismFrequency,
    rhetoricalQuestions,
    tone,
  };
}

/**
 * 分析高频词汇
 */
function analyzeFrequentWords(content: string): StyleFeatures['frequentWords'] {
  // 称谓词
  const addressTerms = [
    'ECNUers',
    'E 小苗',
    'E 小叶',
    '师大人',
    '教育学子',
    '同学们',
    '老师们',
    '我们',
    '你们',
  ].filter((term) => content.includes(term));

  // 主题词（从内容中提取高频名词）
  const themeWordCandidates = [
    '青春',
    '成长',
    '教育',
    '梦想',
    '未来',
    '卓越',
    '引领',
    '担当',
    '使命',
    '初心',
    '奋斗',
    '拼搏',
    '温暖',
    '感动',
    '回忆',
    '时光',
  ];
  const themeWords = themeWordCandidates
    .map((word) => ({
      word,
      count: (content.match(new RegExp(word, 'g')) || []).length,
    }))
    .filter((item) => item.count >= 3)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map((item) => item.word);

  // 连接词
  const connectors = [
    '让我们',
    '愿',
    '相信',
    '期待',
    '一起',
    '共同',
    '携手',
    '从今往后',
    '从此',
  ].filter((connector) => content.includes(connector));

  return {
    addressTerms,
    themeWords,
    connectors,
  };
}

/**
 * 分析结构特点
 */
function analyzeStructure(articles: Array<{ content: string }>) {
  // 分析开头模式
  const openingPatterns: string[] = [];
  const openingKeywords = [
    '当',
    '在这个',
    '近日',
    '刚刚',
    '今天',
    '秋风',
    '春日',
    '盛夏',
    '寒冬',
  ];

  articles.forEach((article) => {
    const firstParagraph = article.content.split('\n').find((p) => p.trim().length > 0) || '';
    openingKeywords.forEach((keyword) => {
      if (firstParagraph.startsWith(keyword) && !openingPatterns.includes(keyword)) {
        openingPatterns.push(keyword);
      }
    });
  });

  // 分析结尾模式
  const closingPatterns: string[] = [];
  const closingKeywords = [
    '愿',
    '期待',
    '让我们',
    '相信',
    '祝福',
    '加油',
    '我们',
  ];

  articles.forEach((article) => {
    const paragraphs = article.content.split('\n').filter((p) => p.trim().length > 0);
    const lastParagraph = paragraphs[paragraphs.length - 1] || '';
    closingKeywords.forEach((keyword) => {
      if (lastParagraph.includes(keyword) && !closingPatterns.includes(keyword)) {
        closingPatterns.push(keyword);
      }
    });
  });

  // 计算平均段落长度
  const allParagraphs = articles.flatMap((a) =>
    a.content.split('\n').filter((p) => p.trim().length > 0)
  );
  const avgParagraphLength =
    allParagraphs.reduce((sum, p) => sum + p.length, 0) / allParagraphs.length;

  // 检测是否有固定结尾格式（如固定署名）
  const hasStandardFooter = articles.some(
    (a) =>
      a.content.includes('教育学部') ||
      a.content.includes('宣传媒体部') ||
      a.content.includes('未来教育引领者')
  );

  return {
    openingPatterns,
    closingPatterns,
    avgParagraphLength: Math.round(avgParagraphLength),
    hasStandardFooter,
  };
}

/**
 * 分析文章类型
 */
function analyzeArticleTypes(
  articles: Array<{ title: string; tags: string[]; content: string }>
) {
  const typeMap: Record<string, number> = {};

  articles.forEach((article) => {
    // 从标签推断类型
    const typeTags = article.tags.filter(
      (tag) =>
        tag.includes('活动') ||
        tag.includes('节日') ||
        tag.includes('迎新') ||
        tag.includes('军训') ||
        tag.includes('爱国') ||
        tag.includes('获奖')
    );

    typeTags.forEach((tag) => {
      typeMap[tag] = (typeMap[tag] || 0) + 1;
    });
  });

  return Object.entries(typeMap)
    .map(([type, count]) => ({
      type,
      count,
      characteristics: getTypeCharacteristics(type),
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * 获取类型特征描述
 */
function getTypeCharacteristics(type: string): string {
  const characteristicsMap: Record<string, string> = {
    '学生活动': '注重氛围营造，强调参与感和集体荣誉感',
    '节日': '富有节日氛围，融入传统文化元素和祝福语',
    '迎新': '温馨欢迎语调，详细介绍安排，体现关怀',
    '军训': '激昂向上，强调意志品质和团队精神',
    '爱国': '庄重严肃，引用历史事件，激发爱国情怀',
    '获奖': '庆祝表彰，突出成就和努力过程',
  };
  return characteristicsMap[type] || '通用公众号风格';
}

/**
 * 获取默认风格特征（当范文库为空时）
 */
function getDefaultStyleFeatures(): StyleFeatures {
  return {
    titlePatterns: {
      separator: '丨',
      commonKeywords: ['活动', '通知', '祝福', '回顾'],
      lengthRange: { min: 10, max: 30 },
    },
    writingStyle: {
      shortLineBreaks: true,
      parallelismFrequency: 'medium',
      rhetoricalQuestions: true,
      tone: 'warm',
    },
    frequentWords: {
      addressTerms: ['ECNUers', 'E 小苗', 'E 小叶', '教育学子'],
      themeWords: ['青春', '成长', '教育', '梦想', '未来'],
      connectors: ['让我们', '愿', '相信', '一起'],
    },
    structure: {
      openingPatterns: ['当', '在这个', '近日'],
      closingPatterns: ['愿', '期待', '让我们'],
      avgParagraphLength: 35,
      hasStandardFooter: true,
    },
    articleTypes: [
      {
        type: '活动通知',
        count: 0,
        characteristics: '注重氛围营造，强调参与感',
      },
    ],
  };
}

/**
 * 生成风格指导 prompt，用于 AI 生成时参考
 */
export function buildStyleGuidancePrompt(features: StyleFeatures): string {
  return `【"未来教育引领者"公众号风格指南】

请严格遵循以下风格特征生成文章：

## 标题规范
- 使用「${features.titlePatterns.separator}」作为主副标题分隔符
- 标题长度控制在${features.titlePatterns.lengthRange.min}-${features.titlePatterns.lengthRange.max}字
- 参考常见关键词：${features.titlePatterns.commonKeywords.join('、')}

## 语言风格
- ${features.writingStyle.shortLineBreaks ? '采用短句分行的诗歌般节奏，每行不宜过长' : '段落长度适中，层次分明'}
- ${features.writingStyle.parallelismFrequency !== 'low' ? '多使用排比句式增强气势和节奏感' : '适当使用排比句'}
- ${features.writingStyle.rhetoricalQuestions ? '巧用设问、反问等修辞手法，增强互动感' : '适当使用问句增加互动'}
- 整体语调：${
  features.writingStyle.tone === 'warm'
    ? '温暖亲切，富有感染力'
    : features.writingStyle.tone === 'energetic'
    ? '激昂向上，充满活力'
    : features.writingStyle.tone === 'poetic'
    ? '诗意优美，富有文采'
    : '正式专业，严谨规范'
}

## 常用词汇
- 称谓词：${features.frequentWords.addressTerms.join('、')}（根据语境选择使用）
- 主题词：${features.frequentWords.themeWords.join('、')}（融入文章表达）
- 连接词：${features.frequentWords.connectors.join('、')}（用于段落过渡和结尾）

## 结构特点
- 常见开头方式：以「${features.structure.openingPatterns.join('」「')}」等引入
- 常见结尾方式：以「${features.structure.closingPatterns.join('」「')}」等收束
- 段落平均长度：约${features.structure.avgParagraphLength}字
- ${features.structure.hasStandardFooter ? '结尾需加上固定署名格式（如：华东师范大学教育学部）' : '结尾灵活处理'}

## 文章类型参考
${features.articleTypes
  .map(
    (t) =>
      `- **${t.type}**：${t.characteristics}（范文库中有${t.count}篇）`
  )
  .join('\n')}

请以上风格特征作为生成文章的指导，确保产出内容符合"未来教育引领者"公众号的整体定位和调性。`;
}

export function buildCompactStyleGuidance(features: StyleFeatures): string {
  if (!features || features.articleTypes.length === 0) {
    return '暂无文章库风格数据。';
  }
  return [
    `标题：${features.titlePatterns.separator}分隔，${features.titlePatterns.lengthRange.min}-${features.titlePatterns.lengthRange.max}字`,
    `语言：${features.writingStyle.tone}，${features.writingStyle.shortLineBreaks ? '短句分行' : '段落式'}，排比${features.writingStyle.parallelismFrequency}`,
    `高频词：${features.frequentWords.addressTerms.slice(0, 3).join('、')} / ${features.frequentWords.themeWords.slice(0, 5).join('、')}`,
    `结构：以${features.structure.openingPatterns.slice(0, 2).join('、')}开头，以${features.structure.closingPatterns.slice(0, 2).join('、')}收尾${features.structure.hasStandardFooter ? '，需加署名' : ''}`,
  ].join('；');
}
