import { describe, expect, it } from 'vitest';
import { parseJsonObject, parseArticleAnalysis, parseLayoutAnalysis } from '@/lib/agentValidation';

const spec = { articleType: '通知', tone: '正式', structure: '总分总', presentation: '要点', keywords: ['活动'], reasoning: '' };
const directions = [1, 2, 3].map(id => ({ id: String(id), name: `方向${id}`, angle: '直接说明', structure: '总分总', tone: '正式' }));

describe('agent validation', () => {
  it('parses fenced JSON and quoted braces without truncating values', () => {
    expect(parseJsonObject('```json\n{"brief":"保留 } 和 { 以及 \\" 引号","nested":{"ok":true}}\n```').nested).toEqual({ ok: true });
  });
  it('normalizes optional direction metadata', () => {
    expect(parseArticleAnalysis(JSON.stringify({ spec, directions })).directions[0].features).toEqual([]);
  });
  it('rejects malformed array types before the UI receives them', () => {
    expect(() => parseArticleAnalysis(JSON.stringify({ spec: { ...spec, keywords: '不是数组' }, directions }))).toThrow('文本数组');
  });
  it('rejects duplicate direction ids and missing directions', () => {
    expect(() => parseArticleAnalysis(JSON.stringify({ spec, directions: [directions[0], directions[0], directions[2]] }))).toThrow('不得重复');
    expect(() => parseArticleAnalysis(JSON.stringify({ spec, directions: [] }))).toThrow('3 个方向');
  });
  it('rejects invalid colors before creating style controls or HTML', () => {
    expect(() => parseLayoutAnalysis(JSON.stringify({ spec: { articleType: '通知', emotionTone: '正式', primaryColor: 'red;broken', secondaryColor: '#ffffff', density: 'normal', keywords: [], forbidden: [] }, directions }))).toThrow('六位');
  });
});
