import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { WebSocketServer } from 'ws'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { parseOverlay } from '../core/index.ts'
import { CollabHub } from './collab.ts'
import { listDocuments, loadDocument, refFromRoom } from './documents.ts'
import type { AiProvider } from './ai.ts'

export * from './documents.ts'
export * from './ai.ts'
export { CollabHub } from './collab.ts'

export interface ServerOptions {
  /** Directory containing the documents to review (read-only for us). */
  root: string
  /** Where overlay files are stored. Default: <root>/.overlay */
  dataDir?: string
  port?: number
  host?: string
  ai?: AiProvider
  /** Built web UI to serve (packages/web/dist). */
  staticDir?: string
  /** Set when exposing the server beyond localhost. */
  publicMode?: boolean
}

/**
 * Browser pages on other origins can send requests to a localhost server.
 * State-changing / costly endpoints therefore require a custom header (which
 * forces a CORS preflight that we never approve) and a same-host Origin.
 */
function isTrustedRequest(headers: Headers, host: string | undefined): boolean {
  if (headers.get('x-in4o-client') !== '1') return false
  const origin = headers.get('origin')
  if (!origin) return true // non-browser client (CLI, curl)
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

export function createApp(opts: ServerOptions & { hub: CollabHub }) {
  const root = path.resolve(opts.root)
  const app = new Hono()

  app.use('/api/*', async (c, next) => {
    if (c.req.method !== 'GET' || c.req.path.startsWith('/api/document')) {
      if (!isTrustedRequest(c.req.raw.headers, c.req.header('host'))) return c.json({ error: 'forbidden' }, 403)
    }
    await next()
  })

  app.onError((err, c) => c.json({ error: err.message }, 400))

  app.get('/api/info', (c) =>
    c.json({
      mode: 'server',
      root: path.basename(root),
      ai: opts.ai ? { name: opts.ai.name, description: opts.ai.description } : null,
    }),
  )

  app.get('/api/files', async (c) => c.json({ files: await listDocuments(root) }))

  /** Rendered + sanitized document (file under root, or remote URL via server-side fetch). */
  app.get('/api/document', async (c) => {
    const doc = await loadDocument(root, { path: c.req.query('path'), url: c.req.query('url') }, { blockPrivateNetworks: opts.publicMode })
    return c.json(doc)
  })

  app.get('/api/overlay/:room', async (c) => c.json(await opts.hub.get(c.req.param('room'))))

  /** Merge an overlay file into the room (import / CLI push). */
  app.put('/api/overlay/:room', async (c) => {
    const room = c.req.param('room')
    const overlay = parseOverlay(await c.req.json())
    const ref = refFromRoom(room)
    if (overlay.document.source !== ref.source) return c.json({ error: 'document mismatch' }, 409)
    return c.json(await opts.hub.merge(room, overlay))
  })

  app.post('/api/ai/review', async (c) => {
    if (!opts.ai) return c.json({ error: 'AI provider is not configured (start with --ai codex|claude|openai|mock)' }, 501)
    const body = await c.req.json<{ text: string; title?: string; instruction?: string }>()
    if (typeof body.text !== 'string' || !body.text.trim()) return c.json({ error: 'text required' }, 400)
    const findings = await opts.ai.review(
      { text: body.text, title: body.title, instruction: body.instruction?.slice(0, 2000) },
      c.req.raw.signal,
    )
    return c.json({ provider: opts.ai.name, findings })
  })

  if (opts.staticDir && existsSync(opts.staticDir)) {
    const rel = path.relative(process.cwd(), opts.staticDir)
    app.use('/*', serveStatic({ root: rel }))
    app.get('*', serveStatic({ path: path.join(rel, 'index.html') }))
  }
  return app
}

export function startServer(opts: ServerOptions) {
  const root = path.resolve(opts.root)
  const dataDir = path.resolve(opts.dataDir ?? path.join(root, '.overlay'))
  const hub = new CollabHub(dataDir)
  const app = createApp({ ...opts, root, hub })
  const host = opts.host ?? '127.0.0.1'
  const port = opts.port ?? 4141
  const server = serve({ fetch: app.fetch, port, hostname: host })

  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/ws/')) return socket.destroy()
    const origin = req.headers.origin
    if (origin && new URL(origin).host !== req.headers.host) return socket.destroy()
    wss.handleUpgrade(req, socket, head, (ws) => void hub.handleConnection(ws, req))
  })

  const shutdown = async () => {
    await hub.flush()
    process.exit(0)
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  return { server, hub, url: `http://${host}:${port}`, dataDir }
}
