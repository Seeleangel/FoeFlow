import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

// Fixed upstream: no caller-supplied host or path is accepted.
const schoolModelProxy = Object.fromEntries(
  ['/chat/completions', '/images/generations'].map((endpoint) => [
    '^/foeflow/_model' + endpoint + '$',
    {
      target: 'https://chat.ecnu.edu.cn',
      changeOrigin: true,
      secure: true,
      rewrite: () => '/open/api/v1' + endpoint,
      headers: { cookie: '', origin: '', referer: '' },
      timeout: 120_000,
      proxyTimeout: 120_000,
    },
  ]),
)

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const mailTarget = process.env.FOEFLOW_MAIL_DEV_TARGET
  const webProxy = { ...schoolModelProxy, ...(mailTarget ? { '/foeflow/mail/': { target: mailTarget, timeout: 25_000, proxyTimeout: 25_000 } } : {}) }
  return {
    plugins: [react()],
    base: mode === 'web' ? '/foeflow/' : '/',
    ...(mode === 'web' ? { server: { proxy: webProxy }, preview: { proxy: webProxy } } : {}),
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
      exclude: ['tests/e2e/**/*.spec.ts', 'node_modules/**', '.worktrees/**', '.claude/**', 'license-server/**', 'mail-server/**'],
    },
  }
})
