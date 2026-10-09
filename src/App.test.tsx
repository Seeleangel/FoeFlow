import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import App from './App'
import { getDb } from './hooks/useDb'

vi.mock('./hooks/useDb', async () => {
  const actual = await vi.importActual('./hooks/useDb')
  return {
    ...actual,
    initDb: vi.fn(() => Promise.resolve()),
  }
})

vi.mock('./lib/seedSampleArticles', () => ({
  seedSampleArticles: vi.fn(() => Promise.resolve()),
}))

vi.mock('./lib/seedTemplates', () => ({
  seedBuiltinTemplates: vi.fn(() => Promise.resolve()),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === 'check_activation') return Promise.resolve({ active: true })
    return Promise.resolve()
  }),
}))

describe('App onboarding', () => {
  beforeEach(async () => {
    const db = await getDb()
    await db.execute("DELETE FROM settings")
  })

  it('shows WelcomeModal on first use', async () => {
    render(<App />)
    await waitFor(() => {
      expect(screen.getByText('感谢你使用本工具，让我们带你快速了解')).toBeInTheDocument()
    })
  })

  it('does not show WelcomeModal when hasSeenWelcome is true', async () => {
    const db = await getDb()
    await db.execute(
      "INSERT INTO settings (key, value) VALUES (?, ?)",
      ['hasSeenWelcome', 'true']
    )
    render(<App />)
    await waitFor(() => {
      expect(screen.queryByText('感谢你使用本工具，让我们带你快速了解')).not.toBeInTheDocument()
    })
    expect(screen.queryByText(/初始化中/i)).not.toBeInTheDocument()
  })
})
