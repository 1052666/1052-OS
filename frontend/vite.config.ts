import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 10052,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:10053',
        changeOrigin: true,
      },
      // Industrial Gateway dashboard iframe — 只 proxy /api 子路径
      // static 文件（public/industrial-gateway/index.html）由 vite serve
      '/industrial-gateway/api': {
        target: 'http://localhost:8766',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/industrial-gateway\/api/, '/api'),
      },
      // Embedded Node-RED editor — gateway reverse-proxies /nodered/* to
      // its child process on :1880. Vite just hands the path through.
      '/industrial-gateway/nodered': {
        target: 'http://localhost:8766',
        changeOrigin: true,
        ws: true,
        rewrite: (p) => p.replace(/^\/industrial-gateway\/nodered/, '/nodered'),
      },
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./test-setup.ts'],
    globals: false,
    exclude: ['**/node_modules/**', 'e2e/**'],
  },
})
