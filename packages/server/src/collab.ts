/**
 * Minimal Yjs sync server (y-websocket wire protocol) with file persistence.
 *
 * Y.Doc layout (shared with the web client):
 *   ydoc.getMap('annotations')  id -> Annotation (plain JSON)
 *   ydoc.getMap('meta')         'document' -> DocumentRef
 *
 * Each room is persisted as a normal *.overlay.json file, so realtime sessions
 * and file-based sharing (git, mail, ...) use exactly the same data.
 */
import type { IncomingMessage } from 'node:http'
import type { WebSocket } from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { emptyOverlay, OVERLAY_FORMAT_VERSION, type Annotation, type DocumentRef, type OverlayFile } from '@overlay/core'
import { readOverlay, refFromRoom, writeOverlay } from './documents.ts'

const MSG_SYNC = 0
const MSG_AWARENESS = 1

interface Room {
  name: string
  doc: Y.Doc
  awareness: awarenessProtocol.Awareness
  conns: Map<WebSocket, Set<number>>
  saveTimer?: NodeJS.Timeout
}

export class CollabHub {
  private rooms = new Map<string, Promise<Room>>()
  constructor(private dataDir: string) {}

  /** Seed a Y.Doc from an overlay file. */
  static applyOverlay(doc: Y.Doc, overlay: OverlayFile) {
    doc.transact(() => {
      const map = doc.getMap<Annotation>('annotations')
      for (const a of overlay.annotations) {
        const cur = map.get(a.id)
        if (!cur || cur.updatedAt < a.updatedAt || cur.replies.length < a.replies.length) map.set(a.id, a)
      }
      const meta = doc.getMap<DocumentRef>('meta')
      const prev = meta.get('document')
      meta.set('document', { ...prev, ...overlay.document })
    })
  }

  static toOverlay(doc: Y.Doc, fallback: Pick<DocumentRef, 'type' | 'source'>): OverlayFile {
    const document = doc.getMap<DocumentRef>('meta').get('document') ?? fallback
    const annotations = [...doc.getMap<Annotation>('annotations').values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    return { version: OVERLAY_FORMAT_VERSION, document, annotations }
  }

  private load(name: string): Promise<Room> {
    let p = this.rooms.get(name)
    if (!p) {
      p = (async () => {
        const ref = refFromRoom(name)
        const doc = new Y.Doc()
        const overlay = (await readOverlay(this.dataDir, ref)) ?? emptyOverlay(ref as DocumentRef)
        CollabHub.applyOverlay(doc, overlay)
        const room: Room = { name, doc, awareness: new awarenessProtocol.Awareness(doc), conns: new Map() }
        room.awareness.setLocalState(null)
        doc.on('update', (update: Uint8Array, origin: unknown) => {
          const enc = encoding.createEncoder()
          encoding.writeVarUint(enc, MSG_SYNC)
          syncProtocol.writeUpdate(enc, update)
          this.broadcast(room, encoding.toUint8Array(enc), origin)
          this.scheduleSave(room)
        })
        room.awareness.on('update', ({ added, updated, removed }: Record<string, number[]>, origin: unknown) => {
          const changed = [...added!, ...updated!, ...removed!]
          const ids = room.conns.get(origin as WebSocket)
          if (ids) {
            added!.forEach((id) => ids.add(id))
            removed!.forEach((id) => ids.delete(id))
          }
          const enc = encoding.createEncoder()
          encoding.writeVarUint(enc, MSG_AWARENESS)
          encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(room.awareness, changed))
          this.broadcast(room, encoding.toUint8Array(enc))
        })
        return room
      })()
      this.rooms.set(name, p)
      p.catch(() => this.rooms.delete(name))
    }
    return p
  }

  private broadcast(room: Room, msg: Uint8Array, except?: unknown) {
    for (const ws of room.conns.keys()) if (ws !== except && ws.readyState === 1) ws.send(msg)
  }

  private scheduleSave(room: Room) {
    clearTimeout(room.saveTimer)
    room.saveTimer = setTimeout(() => void this.save(room), 500)
  }

  private async save(room: Room) {
    const overlay = CollabHub.toOverlay(room.doc, refFromRoom(room.name))
    if (overlay.annotations.length === 0 && !(await readOverlay(this.dataDir, overlay.document))) return
    await writeOverlay(this.dataDir, overlay).catch((e) => console.error('[overlay] save failed', e))
  }

  /** Current state of a room (live if open, otherwise from disk). */
  async get(room: string): Promise<OverlayFile> {
    return CollabHub.toOverlay((await this.load(room)).doc, refFromRoom(room))
  }

  /** Merge an overlay file into a room (used by REST PUT and AI results). */
  async merge(room: string, overlay: OverlayFile): Promise<OverlayFile> {
    const r = await this.load(room)
    CollabHub.applyOverlay(r.doc, overlay)
    return CollabHub.toOverlay(r.doc, refFromRoom(room))
  }

  async handleConnection(ws: WebSocket, req: IncomingMessage) {
    const name = decodeURIComponent((req.url ?? '').replace(/^\/ws\/?/, '').split('?')[0] ?? '')
    let room: Room
    try {
      room = await this.load(name)
    } catch {
      ws.close(4000, 'invalid room')
      return
    }
    ws.binaryType = 'arraybuffer'
    room.conns.set(ws, new Set())
    ws.on('message', (data: ArrayBuffer) => {
      try {
        const dec = decoding.createDecoder(new Uint8Array(data))
        const enc = encoding.createEncoder()
        const type = decoding.readVarUint(dec)
        if (type === MSG_SYNC) {
          encoding.writeVarUint(enc, MSG_SYNC)
          syncProtocol.readSyncMessage(dec, enc, room.doc, ws)
          if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc))
        } else if (type === MSG_AWARENESS) {
          awarenessProtocol.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(dec), ws)
        }
      } catch (e) {
        console.error('[overlay] bad ws message', e)
      }
    })
    ws.on('close', () => {
      const ids = room.conns.get(ws)
      room.conns.delete(ws)
      if (ids?.size) awarenessProtocol.removeAwarenessStates(room.awareness, [...ids], null)
    })
    // initial sync step 1 + current awareness
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MSG_SYNC)
    syncProtocol.writeSyncStep1(enc, room.doc)
    ws.send(encoding.toUint8Array(enc))
    const states = [...room.awareness.getStates().keys()]
    if (states.length) {
      const a = encoding.createEncoder()
      encoding.writeVarUint(a, MSG_AWARENESS)
      encoding.writeVarUint8Array(a, awarenessProtocol.encodeAwarenessUpdate(room.awareness, states))
      ws.send(encoding.toUint8Array(a))
    }
  }

  async flush() {
    for (const p of this.rooms.values()) {
      const r = await p
      clearTimeout(r.saveTimer)
      await this.save(r)
    }
  }
}
