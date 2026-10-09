import { describe, it, expect } from 'vitest';
import { parseAuditResult } from '../../src/lib/auditParser';

describe('parseAuditResult', () => {
  it('should parse a JSON array string', () => {
    const raw = JSON.stringify([
      { dimension: 'text', severity: 'high', message: '错别字', suggestion: '修改' },
    ]);
    const result = parseAuditResult(raw);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('high');
  });

  it('should handle markdown-wrapped JSON', () => {
    const raw = '```json\n[{"dimension":"content","severity":"medium","message":"缺时间","suggestion":"补充"}]\n```';
    const result = parseAuditResult(raw);
    expect(result).toHaveLength(1);
    expect(result[0].message).toBe('缺时间');
  });

  it('should return fallback on invalid JSON', () => {
    const result = parseAuditResult('not json');
    expect(result).toHaveLength(1);
    expect(result[0].message).toContain('格式异常');
  });

  it('should repair unescaped double quotes inside string values', () => {
    const raw = '[{"dimension":"date_consistency","severity":"high","message":"年份不一致","suggestion":"改为"4 月 23 日将迎来...""}]';
    const result = parseAuditResult(raw);
    expect(result).toHaveLength(1);
    expect(result[0].suggestion).toBe('改为」4 月 23 日将迎来...」');
  });
});
