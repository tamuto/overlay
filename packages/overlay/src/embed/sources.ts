/**
 * Where a layer's overlay file comes from / is saved to.
 *
 *  urlSource    read-only file shipped with the app (manual / onboarding guides)
 *  localSource  the user's own notes in this browser (localStorage)
 *  memorySource tests, or a custom backend wired via onChange
 *
 * Implement LayerSource yourself to store notes in your own API.
 */
import { parseOverlay } from '../core/overlay.ts'
import type { OverlayFile } from '../core/types.ts'

export interface LayerSource {
  load(): Promise<OverlayFile | null>
  /** Omit for read-only sources. */
  save?(file: OverlayFile): Promise<void>
  /** Push updates made elsewhere (other tab, realtime backend). Returns unsubscribe. */
  subscribe?(cb: (file: OverlayFile) => void): () => void
}

export function urlSource(url: string, init?: RequestInit): LayerSource {
  return {
    async load() {
      const res = await fetch(url, init)
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`in4o: failed to load ${url}: ${res.status}`)
      return parseOverlay(await res.json())
    },
  }
}

export function localSource(key: string): LayerSource {
  const storageKey = `in4o:layer:${key}`
  const read = (): OverlayFile | null => {
    try {
      const raw = localStorage.getItem(storageKey)
      return raw ? parseOverlay(JSON.parse(raw)) : null
    } catch {
      return null
    }
  }
  return {
    async load() {
      return read()
    },
    async save(file) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(file))
      } catch {
        /* storage full / unavailable – keep in memory only */
      }
    },
    subscribe(cb) {
      // keep several tabs of the app in sync
      const onStorage = (e: StorageEvent) => {
        if (e.key !== storageKey) return
        const f = read()
        if (f) cb(f)
      }
      addEventListener('storage', onStorage)
      return () => removeEventListener('storage', onStorage)
    },
  }
}

export function memorySource(initial: OverlayFile | null = null): LayerSource & { current: OverlayFile | null } {
  const src = {
    current: initial,
    async load() {
      return src.current
    },
    async save(file: OverlayFile) {
      src.current = file
    },
  }
  return src
}
