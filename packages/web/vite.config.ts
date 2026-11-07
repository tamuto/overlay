import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const api = process.env.OVERLAY_API ?? 'http://127.0.0.1:4141'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // use the TypeScript sources of @infodb/overlay inside the workspace
  resolve: { conditions: ['source', 'module', 'browser', 'development|production'] },
  // the review UI ships inside the published package (served by `overlay serve`)
  build: { outDir: '../overlay/dist/web', emptyOutDir: true },
  server: {
    proxy: {
      '/api': { target: api },
      '/ws': { target: api.replace(/^http/, 'ws'), ws: true },
    },
  },
})
