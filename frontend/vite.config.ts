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
    },
  },
})
