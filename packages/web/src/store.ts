/**
 * Annotation store backed by a Y.Doc.
 *  - server mode: synced through the overlay server (y-websocket protocol)
 *  - standalone:  persisted in localStorage; share by exporting the overlay file
 */
import { useEffect, useMemo, useState } from 'react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { OVERLAY_FORMAT_VERSION, type Annotation, type DocumentRef, type OverlayFile } from '@infodb/overlay'

export interface Peer {
  clientId: number
  name: string
  color: string
}

export interface OverlayStore {
  annotations: Annotation[]
  connected: boolean
  realtime: boolean
  peers: Peer[]
  upsert(a: Annotation): void
  remove(id: string): void
  importOverlay(o: OverlayFile): number
  exportOverlay(document: DocumentRef): OverlayFile
  setDocument(ref: DocumentRef): void
}

const COLORS = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777']
export const colorFor = (name: string) => COLORS[[...name].reduce((h, c) => h + c.charCodeAt(0), 0) % COLORS.length]!

function storageKey(key: string) {
  return `in4o:doc:${key}`
}

export function useOverlayStore(docKey: string | null, room: string | null, userName: string): OverlayStore {
  const ydoc = useMemo(() => new Y.Doc(), [docKey, room])
  const map = ydoc.getMap<Annotation>('annotations')
  const [connected, setConnected] = useState(false)
  const [peers, setPeers] = useState<Peer[]>([])
  const [provider, setProvider] = useState<WebsocketProvider | null>(null)

  // connect / persist
  useEffect(() => {
    if (!docKey) return
    if (room) {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const p = new WebsocketProvider(`${proto}://${location.host}/ws`, room, ydoc)
      p.on('status', (e: { status: string }) => setConnected(e.status === 'connected'))
      const onAwareness = () => {
        const list: Peer[] = []
        p.awareness.getStates().forEach((s, clientId) => {
          const u = (s as { user?: { name: string; color: string } }).user
          if (u) list.push({ clientId, ...u })
        })
        setPeers(list)
      }
      p.awareness.on('change', onAwareness)
      setProvider(p)
      return () => {
        p.awareness.off('change', onAwareness)
        p.destroy()
        setProvider(null)
        setConnected(false)
        setPeers([])
      }
    }
    // standalone: localStorage persistence
    try {
      const saved = localStorage.getItem(storageKey(docKey))
      if (saved) Y.applyUpdate(ydoc, Uint8Array.from(atob(saved), (c) => c.charCodeAt(0)))
    } catch {
      /* storage unavailable – in-memory only */
    }
    const save = () => {
      try {
        const u = Y.encodeStateAsUpdate(ydoc)
        let bin = ''
        for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000))
        localStorage.setItem(storageKey(docKey), btoa(bin))
      } catch {
        /* ignore */
      }
    }
    ydoc.on('update', save)
    return () => ydoc.off('update', save)
  }, [ydoc, docKey, room])

  useEffect(() => {
    provider?.awareness.setLocalStateField('user', { name: userName, color: colorFor(userName) })
  }, [provider, userName])

  const [annotations, setAnnotations] = useState<Annotation[]>([])
  useEffect(() => {
    const update = () => setAnnotations([...map.values()])
    update()
    map.observe(update)
    return () => map.unobserve(update)
  }, [map])

  return {
    annotations,
    connected,
    realtime: !!room,
    peers,
    upsert: (a) => map.set(a.id, { ...a, updatedAt: new Date().toISOString() }),
    remove: (id) => map.delete(id),
    importOverlay(o) {
      let n = 0
      ydoc.transact(() => {
        for (const a of o.annotations) {
          const cur = map.get(a.id)
          if (!cur || cur.updatedAt < a.updatedAt) {
            map.set(a.id, a)
            n++
          }
        }
      })
      return n
    },
    exportOverlay: (document) => ({
      version: OVERLAY_FORMAT_VERSION,
      document,
      annotations: [...map.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    }),
    setDocument(ref) {
      const meta = ydoc.getMap<DocumentRef>('meta')
      const cur = meta.get('document')
      if (!cur || cur.fingerprint !== ref.fingerprint || cur.title !== ref.title) meta.set('document', ref)
    },
  }
}
