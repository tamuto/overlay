import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // resolve @infodb/overlay to its TypeScript sources inside this workspace
  resolve: { conditions: ['source', 'module', 'browser', 'development|production'] },
})
