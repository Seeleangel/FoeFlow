import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      ...(mode === 'test' ? {
        '@tauri-apps/plugin-fs': path.resolve(__dirname, './tests/mocks/tauri-fs.ts'),
        '@tauri-apps/api/path': path.resolve(__dirname, './tests/mocks/tauri-path.ts'),
        '@tauri-apps/api/core': path.resolve(__dirname, './tests/mocks/tauri-core.ts'),
        '@tauri-apps/plugin-sql': path.resolve(__dirname, './tests/mocks/tauri-sql.ts'),
      } : {}),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    exclude: ['tests/e2e/**/*.spec.ts', 'node_modules/**', '.worktrees/**', '.claude/**', 'license-server/**'],
  },
}))