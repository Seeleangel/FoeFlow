import type { ArticleStyleSpec, WritingDirection } from '@/types/article';
import type { StyleSpec, LayoutDirection } from '@/types/layout';

export function parseJsonObject(raw: string): Record<string, unknown> {
  const start = raw.indexOf('{');
  if (start < 0) throw new Error('缺少 JSON 对象');
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < raw.length; i++) {
    const char = raw[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return object(JSON.parse(raw.slice(start, i + 1)));
  }
  throw new Error('JSON 对象未闭合');
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('字段必须为对象');
  return value as Record<string, unknown>;
}
function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} 必须为非空文本`);
  return value.trim();
}
function optional(value: unknown, field: string): string {
  if (value === undefined || value === '') return '';
  return string(value, field);
}
function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every(v => typeof v === 'string')) throw new Error(`${field} 必须为文本数组`);
  return value.map(v => v.trim()).filter(Boolean);
}
function directions(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length !== 3) throw new Error('必须提供 3 个方向');
  const items = value.map(object);
  if (new Set(items.map(d => string(d.id, '方向 id'))).size !== 3) throw new Error('方向 id 不得重复');
  return items;
}
function color(value: unknown, field: string): string {
  const result = string(value, field);
  if (!/^#[0-9a-f]{6}$/i.test(result)) throw new Error(`${field} 必须为六位十六进制颜色`);
  return result;
}

export function parseArticleAnalysis(raw: string): { spec: ArticleStyleSpec; directions: WritingDirection[] } {
  const parsed = parseJsonObject(raw), spec = object(parsed.spec);
  return {
    spec: {
      articleType: string(spec.articleType, '文章类型'), tone: string(spec.tone, '语气'),
      structure: string(spec.structure, '结构'), presentation: string(spec.presentation, '呈现方式'),
      keywords: strings(spec.keywords, '关键词'), reasoning: optional(spec.reasoning, '分析依据'),
    },
    directions: directions(parsed.directions).map(d => ({
      id: string(d.id, '方向 id'), name: string(d.name, '方向名称'),
      angle: string(d.angle, '角度'), structure: string(d.structure, '方向结构'), tone: string(d.tone, '方向语气'),
      features: d.features === undefined ? [] : strings(d.features, '特征'), whyFit: optional(d.whyFit, '理由'),
    })),
  };
}

export function parseLayoutDirection(value: unknown): LayoutDirection {
  const d = object(value);
  return {
    id: string(d.id, '方向 id'), name: string(d.name, '方向名称'),
    description: string(d.description, '方向描述'), features: strings(d.features, '特征'),
    whyFit: optional(d.whyFit, '理由'), philosophy: optional(d.philosophy, '设计哲学'),
  };
}
export function parseLayoutAnalysis(raw: string): { spec: StyleSpec; directions: LayoutDirection[] } {
  const parsed = parseJsonObject(raw), spec = object(parsed.spec);
  if (!['sparse', 'normal', 'rich'].includes(String(spec.density))) throw new Error('装饰密度必须为 sparse/normal/rich');
  return {
    spec: {
      articleType: string(spec.articleType, '文章类型'), emotionTone: string(spec.emotionTone, '情感基调'),
      primaryColor: color(spec.primaryColor, '主色'), secondaryColor: color(spec.secondaryColor, '辅色'),
      ...(spec.accentColor ? { accentColor: color(spec.accentColor, '强调色') } : {}),
      density: spec.density as StyleSpec['density'], forbidden: strings(spec.forbidden, '禁止元素'),
      keywords: strings(spec.keywords, '关键词'), reasoning: optional(spec.reasoning, '分析依据'),
    },
    directions: directions(parsed.directions).map(parseLayoutDirection),
  };
}
