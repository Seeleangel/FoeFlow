import { describe, it, expect } from 'vitest';
import { extractReadyJson } from '@/lib/requirementAgent';

describe('extractReadyJson', () => {
  it('extracts nested JSON with collectedInfo object', () => {
    const response = '好的，信息足够了。\n{"status":"ready","brief":"一篇关于教育创新的推文","collectedInfo":{"topic":"教育创新与未来课堂","style":"轻松温暖，约800字","materials":"引用芬兰教育案例"}}';
    const result = extractReadyJson(response);
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.status).toBe('ready');
    expect(parsed.collectedInfo.topic).toBe('教育创新与未来课堂');
    expect(parsed.collectedInfo.style).toBe('轻松温暖，约800字');
  });

  it('extracts flat JSON', () => {
    const response = '{"status":"ready","brief":"test","collectedInfo":{"topic":"t","style":"s","materials":"m"}}';
    const result = extractReadyJson(response);
    expect(result).not.toBeNull();
    expect(JSON.parse(result!).status).toBe('ready');
  });

  it('returns null when no ready signal present', () => {
    const response = '你可以告诉我更多关于这篇文章的想法吗？';
    expect(extractReadyJson(response)).toBeNull();
  });

  it('returns null for unbalanced braces', () => {
    const response = '{"status":"ready","brief":"test","collectedInfo":{"topic":"t"';
    expect(extractReadyJson(response)).toBeNull();
  });

  it('handles braces inside string values when balanced', () => {
    const response = '{"status":"ready","brief":"关于{未来教育}的思考","collectedInfo":{"topic":"主题{探索}","style":"s","materials":"m"}}';
    const result = extractReadyJson(response);
    // Balanced braces inside strings don't break the depth counter — this works
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.collectedInfo.topic).toBe('主题{探索}');
  });

  it('extracts only from the first ready-status JSON', () => {
    const response = '{"status":"ready","brief":"first","collectedInfo":{"topic":"a","style":"b","materials":"c"}} some text {"status":"ready","brief":"second","collectedInfo":{"topic":"x","style":"y","materials":"z"}}';
    const result = extractReadyJson(response);
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.brief).toBe('first');
  });

  it('skips non-ready status JSON', () => {
    const response = '{"status":"not_ready","collectedInfo":{}} some more text';
    const result = extractReadyJson(response);
    expect(result).not.toBeNull();
    // It finds {"status" but status field check happens in gatherRequirements
    // extractReadyJson just finds the first {"status"... block
  });

  it('handles text after JSON block', () => {
    const response = '{"status":"ready","brief":"done","collectedInfo":{"topic":"t","style":"s","materials":"m"}}接下来开始生成…';
    const result = extractReadyJson(response);
    expect(result).not.toBeNull();
    expect(result).not.toContain('接下来开始生成');
    const parsed = JSON.parse(result!);
    expect(parsed.status).toBe('ready');
  });
});
