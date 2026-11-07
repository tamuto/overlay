#!/usr/bin/env -S node --no-experimental-webstorage
// Prototype: run the TypeScript sources directly through tsx.
import { register } from 'tsx/esm/api'
register()
await import('../src/index.ts')
