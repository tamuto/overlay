import { defineConfig } from 'tsup'

export default defineConfig([
  {
    // library entries (browser-safe core + embed, node server)
    entry: { 'core/index': 'src/core/index.ts', 'embed/index': 'src/embed/index.ts', 'server/index': 'src/server/index.ts' },
    format: 'esm',
    target: 'es2022',
    dts: true,
    sourcemap: true,
    clean: false,
    splitting: true,
  },
  {
    entry: { 'cli/index': 'src/cli/index.ts' },
    format: 'esm',
    platform: 'node',
    target: 'node22',
    banner: { js: '#!/usr/bin/env -S node --no-experimental-webstorage' },
    clean: false,
  },
])
