import { describe, it, expect } from 'vitest';
import { normalizeLegacySession } from '../editorialCompatibility';
describe('legacy migration', () => {
  it.each(['pending', 'confirmed', 'manual'])('migrates %s idempotently without inventing review', status => {
    const raw = { id: 'old', generatedTitle: 'Title', generatedText: '# Title\nOriginal', generatedHtml: '<p>Original</p>', ...(status === 'manual' ? {} : { editorial: { status, notes: [], sources: [] } }) };
    const s = normalizeLegacySession(raw); expect(normalizeLegacySession(s)).toEqual(s); expect(s.review).toBeUndefined();
    expect(s.legacy?.text).toBe(raw.generatedText);
    expect(s.legacy?.mode).toBe(status === 'manual' ? 'legacy-manual' : status);
    expect(s.phase).not.toBe('confirmed');
    expect(s.legacy?.confirmed).toBe(status === 'confirmed');
  });
  it('retains damaged raw text but does not grant confirmation', () => {
    const s = normalizeLegacySession('{broken original'); expect(s.legacy?.raw).toBe('{broken original'); expect(s.legacy?.confirmed).toBe(false);
    const forged = normalizeLegacySession({ schemaVersion: 2, phase: 'confirmed', generatedText: 'preserve' });
    expect(forged.legacy?.confirmed).toBe(false); expect(forged.legacy?.text).toBe('preserve');
  });
});
