import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const api = process.env.OVERLAY_API ?? 'http://127.0.0.1:4141'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': { target: api },
      '/ws': { target: api.replace(/^http/, 'ws'), ws: true },
    },
  },
})
