import { describe, it, expect, beforeEach } from 'vitest';
import { loadSettings, saveSettings } from '../../src/lib/settingsStorage';
import { initDb } from '../../src/hooks/useDb';

describe('settingsStorage', () => {
  beforeEach(async () => {
    await initDb();
  });

  it('should return default settings when empty', async () => {
    const settings = await loadSettings();
    expect(settings.apiUrl).toBe('https://chat.ecnu.edu.cn/open/api/v1/chat/completions');
    expect(settings.enabledAuditRules.length).toBeGreaterThan(0);
  });

  it('should persist and reload settings', async () => {
    const settings = {
      apiUrl: 'https://api.school.edu/v1',
      apiKey: 'secret-key',
      modelName: 'qwen-max',
      brandColor: '#FF0000',
      enabledAuditRules: ['typo'],
    };
    await saveSettings(settings);
    const loaded = await loadSettings();
    expect(loaded.apiUrl).toBe('https://api.school.edu/v1');
    expect(loaded.enabledAuditRules).toEqual(['typo']);
  });
});
