import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Mock Tauri plugins for unit tests
vi.mock('@tauri-apps/plugin-fs', () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  exists: vi.fn(),
  readDir: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn(() => Promise.resolve('/mock/app/data/')),
}))

vi.mock('@tauri-apps/api/core', async () => {
  return {
    convertFileSrc: vi.fn((path: string) => `mock-file://${path}`),
    invoke: vi.fn(),
  }
})

vi.mock('@tauri-apps/plugin-sql', async () => {
  const MockDatabase = (await import('./mocks/tauri-sql')).default
  const mockDb = {
    load: vi.fn((connectionString: string) => MockDatabase.load(connectionString)),
  }
  return {
    default: mockDb,
    Database: mockDb,
  }
})
