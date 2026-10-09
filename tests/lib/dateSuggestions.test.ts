import { describe, it, expect, vi } from 'vitest';
import { getDateBasedSuggestions, getCachedSuggestions, prefetchSuggestions } from '../../src/lib/dateSuggestions';

vi.mock('@/lib/ai', () => ({
  callAI: vi.fn().mockRejectedValue(new Error('AI unavailable')),
}));

describe('getDateBasedSuggestions', () => {
  it('returns 3 suggestions for any date', () => {
    const suggestions = getDateBasedSuggestions(new Date('2026-05-04'));
    expect(suggestions.length).toBe(3);
  });

  it('includes Youth Day suggestion on May 4th', () => {
    const suggestions = getDateBasedSuggestions(new Date('2026-05-04'));
    expect(suggestions.some((s) => s.includes('五四'))).toBe(true);
  });

  it('includes Labor Day suggestion around May 1st', () => {
    const suggestions = getDateBasedSuggestions(new Date('2026-05-01'));
    expect(suggestions.some((s) => s.includes('劳动'))).toBe(true);
  });

  it('includes spring-related suggestions in March', () => {
    const suggestions = getDateBasedSuggestions(new Date('2026-03-15'));
    expect(suggestions.some((s) => s.includes('春'))).toBe(true);
  });

  it('includes Teacher Day suggestion on September 10th', () => {
    const suggestions = getDateBasedSuggestions(new Date('2026-09-10'));
    expect(suggestions.some((s) => s.includes('教师'))).toBe(true);
  });

  it('includes start-of-semester suggestion in September', () => {
    const suggestions = getDateBasedSuggestions(new Date('2026-09-05'));
    expect(suggestions.some((s) => s.includes('开学'))).toBe(true);
  });

  it('includes graduation suggestion in June', () => {
    const suggestions = getDateBasedSuggestions(new Date('2026-06-15'));
    expect(suggestions.some((s) => s.includes('毕业'))).toBe(true);
  });

  it('returns different suggestions for different seasons', () => {
    const spring = getDateBasedSuggestions(new Date('2026-04-01'));
    const summer = getDateBasedSuggestions(new Date('2026-07-01'));
    const autumn = getDateBasedSuggestions(new Date('2026-10-01'));
    const winter = getDateBasedSuggestions(new Date('2026-01-01'));

    expect(spring).not.toEqual(summer);
    expect(summer).not.toEqual(autumn);
    expect(autumn).not.toEqual(winter);
  });

  it('defaults to today when no date is provided', () => {
    const suggestions = getDateBasedSuggestions();
    expect(suggestions.length).toBe(3);
    expect(suggestions.every((s) => typeof s === 'string' && s.length > 0)).toBe(true);
  });
});

describe('prefetchSuggestions and getCachedSuggestions', () => {
  it('getCachedSuggestions returns null or string[]', () => {
    const cached = getCachedSuggestions();
    // May be null (before prefetch) or string[] (after prefetch from another test)
    expect(cached === null || Array.isArray(cached)).toBe(true);
  });

  it('prefetchSuggestions falls back to hardcoded when AI fails', async () => {
    const result = await prefetchSuggestions();
    expect(result.length).toBe(3);
    expect(result.every((s) => typeof s === 'string' && s.length > 0)).toBe(true);
  });

  it('prefetchSuggestions is idempotent (returns same promise)', async () => {
    const p1 = prefetchSuggestions();
    const p2 = prefetchSuggestions();
    expect(p1).toBe(p2);
    await p1;
  });

  it('getCachedSuggestions returns results after prefetch completes', async () => {
    await prefetchSuggestions();
    const cached = getCachedSuggestions();
    expect(cached).not.toBeNull();
    expect(cached!.length).toBe(3);
  });
});
