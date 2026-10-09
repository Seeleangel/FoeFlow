import { callAI } from './ai';

interface DateEvent {
  month: number;
  day: number;
  name: string;
  suggestion: string;
}

const EVENTS: DateEvent[] = [
  { month: 1, day: 1, name: '元旦', suggestion: '请帮我生成一篇元旦新年祝福的推文' },
  { month: 3, day: 8, name: '妇女节', suggestion: '我想写一篇关于三八妇女节致敬女性教师的推文' },
  { month: 3, day: 12, name: '植树节', suggestion: '请帮我生成一篇植树节环保主题的活动推文' },
  { month: 4, day: 23, name: '世界读书日', suggestion: '我想写一篇世界读书日阅读分享活动的推文' },
  { month: 5, day: 1, name: '劳动节', suggestion: '请帮我生成一篇五一劳动节致敬劳动者的推文' },
  { month: 5, day: 4, name: '五四青年节', suggestion: '请帮我生成一篇五四青年节弘扬青春风采的推文' },
  { month: 6, day: 1, name: '儿童节', suggestion: '我想写一篇六一儿童节与教育学相关的推文' },
  { month: 9, day: 10, name: '教师节', suggestion: '请帮我生成一篇教师节感恩老师的推文' },
  { month: 10, day: 1, name: '国庆节', suggestion: '我想写一篇国庆节爱国主义教育的推文' },
];

function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function isUpcomingEvent(date: Date, event: DateEvent, windowDays: number): boolean {
  const eventDate = new Date(date.getFullYear(), event.month - 1, event.day);
  const diff = dayOfYear(eventDate) - dayOfYear(date);
  return diff >= 0 && diff <= windowDays;
}

function getUpcomingEvents(date: Date, windowDays = 14): DateEvent[] {
  return EVENTS.filter((e) => isUpcomingEvent(date, e, windowDays));
}

function getSeasonalSuggestions(month: number): string[] {
  const seasonal: Record<number, string[]> = {
    1: ['寒假社会实践分享', '新年读书计划启动'],
    2: ['春季开学第一课', '新学期学习计划'],
    3: ['春季校园赏花活动', '春日读书会招募'],
    4: ['清明传统文化活动', '春季学术沙龙'],
    5: ['春季运动会报道', '校园心理健康月活动'],
    6: ['毕业季致谢师恩', '毕业典礼预热推文'],
    7: ['暑期社会实践', '夏令营活动招募'],
    8: ['暑期研学活动', '开学季迎新准备'],
    9: ['秋季开学典礼', '新学期社团招新'],
    10: ['秋季运动会', '重阳节敬老活动'],
    11: ['期中学习分享', '秋季读书心得'],
    12: ['年终总结回顾', '考研加油祝福'],
  };
  return seasonal[month] || ['学术论坛讲座预告', '读书分享会活动'];
}

export function getDateBasedSuggestions(date?: Date): string[] {
  const now = date ?? new Date();
  const month = now.getMonth() + 1;

  const upcomingEvents = getUpcomingEvents(now);
  const seasonal = getSeasonalSuggestions(month);

  const suggestions: string[] = [];

  for (const event of upcomingEvents.slice(0, 2)) {
    suggestions.push(event.suggestion);
  }

  if (month === 2 || month === 3) {
    suggestions.push('我们学院春季学期开学，需要一篇迎新推文');
  } else if (month === 6) {
    suggestions.push('毕业季到了，想写一篇毕业生寄语推文');
  } else if (month === 9) {
    suggestions.push('新学期开始了，请帮我写一篇开学季推文');
  } else if (month === 12 || month === 1) {
    suggestions.push('年末将至，想写一篇年度回顾总结推文');
  }

  for (const s of seasonal) {
    if (suggestions.length >= 3) break;
    const full = s.includes('推文') || s.includes('文章')
      ? `我想写一篇关于${s}`
      : `我想写一篇关于${s}的推文`;
    if (!suggestions.includes(full)) {
      suggestions.push(full);
    }
  }

  if (suggestions.length < 3) {
    suggestions.push('我们学院要举办学术论坛，需要一篇预热推文');
  }

  return suggestions.slice(0, 3);
}

// ── AI-powered suggestions (module-level singleton cache) ──

let _cachedSuggestions: string[] | null = null;
let _fetchPromise: Promise<string[]> | null = null;

const DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

async function fetchAISuggestions(): Promise<string[]> {
  const now = new Date();
  const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${DAY_NAMES[now.getDay()]}`;

  const prompt = [
    `今天是${dateStr}。`,
    '你是"未来教育引领者"公众号（华东师范大学教育学部）的内容策划。',
    '请推荐3个今天适合写的推文选题，以满足公众号读者的阅读需求。',
    '要求：',
    '1. 结合当前日期特点（临近节日、教育热点、学期节奏、社会事件等）',
    '2. 适合教育学部公众号定位（学术活动、师生风采、教育政策、校园生活等）',
    '3. 表述为具体的写作请求，如"我想写一篇关于...的推文"',
    '4. 只输出纯 JSON 字符串数组，不要 markdown 代码块，不要解释：',
    '["我想写一篇关于...的推文", "...", "..."]',
  ].join('\n');

  try {
    const res = await callAI({
      messages: [
        { role: 'system', content: '你是公众号内容策划。只输出纯 JSON 字符串数组。' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.8,
      purpose: 'general',
    });

    const text = res.content.trim()
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '');

    const first = text.indexOf('[');
    const last = text.lastIndexOf(']');
    if (first === -1 || last <= first) throw new Error('No JSON array found');

    const arr = JSON.parse(text.substring(first, last + 1));
    if (Array.isArray(arr) && arr.length > 0 && arr.every((s: unknown) => typeof s === 'string' && (s as string).length > 0)) {
      return arr.slice(0, 3);
    }
    throw new Error('Invalid suggestions format');
  } catch (err) {
    console.warn('[fetchAISuggestions] AI call failed, falling back to hardcoded:', err);
    return getDateBasedSuggestions();
  }
}

export function getCachedSuggestions(): string[] | null {
  return _cachedSuggestions;
}

export function prefetchSuggestions(): Promise<string[]> {
  if (_fetchPromise) return _fetchPromise;
  _fetchPromise = fetchAISuggestions().then((result) => {
    _cachedSuggestions = result;
    return result;
  });
  return _fetchPromise;
}
