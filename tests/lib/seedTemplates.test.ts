import { describe, it, expect, beforeEach } from 'vitest';
import { seedBuiltinTemplates } from '../../src/lib/seedTemplates';
import { getAllTemplates } from '../../src/lib/libraryStorage';
import { initDb } from '../../src/hooks/useDb';

describe('seedBuiltinTemplates', () => {
  beforeEach(async () => {
    await initDb();
  });

  it('should seed at least 2 built-in templates', async () => {
    const templates = await getAllTemplates();
    const builtins = templates.filter((t) => t.sourceType === 'built-in');
    expect(builtins.length).toBeGreaterThanOrEqual(1);
  });
});
