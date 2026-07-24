import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const nodeEnv = (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process?.env
const backendTarget = nodeEnv?.BACKEND_URL ?? 'http://localhost:10053'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 10052,
    host: true,
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 10052,
    host: true,
  },
  build: {
    chunkSizeWarningLimit: 700,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test-setup.ts'],
    exclude: ['**/node_modules/**', 'e2e/**'],
  },
})
