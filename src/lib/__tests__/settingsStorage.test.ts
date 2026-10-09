import { describe, it, expect, beforeEach } from 'vitest'
import { loadSettings, saveSettings } from '../settingsStorage'
import { getDb } from '@/hooks/useDb'

describe('settingsStorage', () => {
  beforeEach(async () => {
    const db = await getDb()
    await db.execute("DELETE FROM settings")
  })

  it('should return hasSeenWelcome as false when not set', async () => {
    const settings = await loadSettings()
    expect(settings.hasSeenWelcome).toBe(false)
  })

  it('should save and load hasSeenWelcome=true', async () => {
    await saveSettings({
      apiUrl: 'https://test.com',
      apiKey: 'sk-test',
      modelName: 'test-model',
      brandColor: '#8B1A1A',
      enabledAuditRules: [],
      hasSeenWelcome: true,
    })
    const settings = await loadSettings()
    expect(settings.hasSeenWelcome).toBe(true)
  })

  it('should save and load hasSeenWelcome=false', async () => {
    await saveSettings({
      apiUrl: 'https://test.com',
      apiKey: 'sk-test',
      modelName: 'test-model',
      brandColor: '#8B1A1A',
      enabledAuditRules: [],
      hasSeenWelcome: false,
    })
    const settings = await loadSettings()
    expect(settings.hasSeenWelcome).toBe(false)
  })
})
