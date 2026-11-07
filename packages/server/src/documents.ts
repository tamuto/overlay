import { readFile, readdir, mkdir, writeFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { parseHTML } from 'linkedom'
import { createHash } from 'node:crypto'
import { extractText, readableText, fingerprint, markdownDocument, parseOverlay, type DocumentRef, type OverlayFile } from '@overlay/core'

export interface LoadedDocument {
  ref: DocumentRef
  /** Sanitized standalone HTML, rendered by the client in a sandboxed iframe. */
  html: string
  /** Normalized text annotations anchor to. */
  text: string
  /** Text with line structure, given to AI reviewers. */
  readable: string
  room: string
}

const DOC_EXT = /\.(md|markdown|html?)$/i
const IGNORED_DIRS = new Set(['node_modules', '.git', '.overlay', 'dist', '.serena'])

export async function listDocuments(root: string): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') && e.name !== '.github') continue
      if (e.isDirectory()) {
        if (!IGNORED_DIRS.has(e.name)) await walk(path.join(dir, e.name))
      } else if (DOC_EXT.test(e.name)) out.push(path.relative(root, path.join(dir, e.name)).split(path.sep).join('/'))
    }
  }
  await walk(root)
  return out.sort()
}

export function safeJoin(rootDir: string, rel: string): string {
  const root = path.resolve(rootDir)
  const full = path.resolve(root, rel)
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error('path outside of root')
  return full
}

/**
 * Remove active content. The client additionally renders inside
 * <iframe sandbox="allow-same-origin"> (no scripts), so this is defense in depth
 * and keeps text extraction identical between browser and CLI.
 */
export function sanitizeHtml(html: string, baseHref?: string): string {
  const { document } = parseHTML(html.includes('<html') ? html : `<!doctype html><html><head></head><body>${html}</body></html>`)
  document.querySelectorAll('script,noscript,iframe,object,embed,meta[http-equiv],link[rel=preload],link[rel=modulepreload],base').forEach((n: Element) => n.remove())
  document.querySelectorAll('*').forEach((el: Element) => {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name)
      else if (/^(href|src|action|formaction)$/i.test(attr.name) && /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name)
    }
  })
  const head = document.head ?? document.documentElement
  if (!document.querySelector('meta[charset]')) {
    const meta = document.createElement('meta')
    meta.setAttribute('charset', 'utf-8')
    head.prepend(meta)
  }
  if (baseHref) {
    const base = document.createElement('base')
    base.setAttribute('href', baseHref)
    head.prepend(base)
  }
  return '<!doctype html>' + document.documentElement.outerHTML
}

export function documentText(html: string): string {
  const { document } = parseHTML(html)
  return extractText(document.body).text
}

function titleOf(html: string, fallback: string): string {
  const { document } = parseHTML(html)
  return document.querySelector('title')?.textContent?.trim() || document.querySelector('h1')?.textContent?.trim() || fallback
}

/** Room ids are reversible so the server can find the storage file after a restart. */
export function roomFor(ref: Pick<DocumentRef, 'type' | 'source'>): string {
  const key = ref.type === 'url' ? `url:${ref.source}` : `file:${ref.source}`
  return Buffer.from(key).toString('base64url')
}

export function refFromRoom(room: string): Pick<DocumentRef, 'type' | 'source'> {
  const key = Buffer.from(room, 'base64url').toString()
  if (key.startsWith('url:')) return { type: 'url', source: key.slice(4) }
  if (key.startsWith('file:')) {
    const source = key.slice(5)
    return { type: /\.html?$/i.test(source) ? 'html' : 'markdown', source }
  }
  throw new Error('invalid room')
}

/** Where the overlay (review) file for a document is stored. Never next to/inside the original. */
export function overlayPath(dataDir: string, ref: Pick<DocumentRef, 'type' | 'source'>): string {
  if (ref.type === 'url') {
    const u = new URL(ref.source)
    const h = createHash('sha256').update(ref.source).digest('hex').slice(0, 12)
    const slug = (u.pathname.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'index').slice(0, 60)
    return path.join(dataDir, 'web', u.host.replace(/[^a-zA-Z0-9.-]/g, '_'), `${slug}-${h}.overlay.json`)
  }
  return safeJoin(path.join(dataDir, 'files'), `${ref.source}.overlay.json`)
}

export async function readOverlay(dataDir: string, ref: Pick<DocumentRef, 'type' | 'source'>): Promise<OverlayFile | null> {
  try {
    return parseOverlay(JSON.parse(await readFile(overlayPath(dataDir, ref), 'utf8')))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
}

export async function writeOverlay(dataDir: string, overlay: OverlayFile): Promise<string> {
  const p = overlayPath(dataDir, overlay.document)
  await mkdir(path.dirname(p), { recursive: true })
  await writeFile(p, JSON.stringify(overlay, null, 2) + '\n')
  return p
}

export interface FetchOptions {
  /** Refuse loopback / private network targets (enable when exposed as a service). */
  blockPrivateNetworks?: boolean
}

function isPrivateHost(host: string): boolean {
  return (
    /^(localhost|.*\.local|.*\.internal)$/i.test(host) ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^\[?(::1|f[cd]|fe80)/i.test(host)
  )
}

export async function loadDocument(
  root: string,
  input: { path?: string; url?: string },
  opts: FetchOptions = {},
): Promise<LoadedDocument> {
  let ref: DocumentRef
  let html: string
  let readable: string | undefined
  if (input.url) {
    const u = new URL(input.url)
    if (!/^https?:$/.test(u.protocol)) throw new Error('only http(s) URLs are supported')
    if (opts.blockPrivateNetworks && isPrivateHost(u.hostname)) throw new Error('private network targets are blocked')
    const res = await fetch(u, { headers: { 'user-agent': 'overlay-review/0.1', accept: 'text/html,text/markdown,text/plain' }, redirect: 'follow' })
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
    const body = await res.text()
    const ctype = res.headers.get('content-type') ?? ''
    const isMarkdown = /markdown|text\/plain/.test(ctype) || /\.(md|markdown)$/i.test(u.pathname)
    html = isMarkdown ? sanitizeHtml(markdownDocument(body, u.pathname.split('/').pop()), res.url) : sanitizeHtml(body, res.url)
    ref = { type: 'url', source: input.url, title: titleOf(html, u.host) }
  } else if (input.path) {
    const full = safeJoin(root, input.path)
    if (!(await stat(full)).isFile()) throw new Error('not a file')
    const body = await readFile(full, 'utf8')
    const isHtml = /\.html?$/i.test(full)
    if (!isHtml) readable = body
    html = sanitizeHtml(isHtml ? body : markdownDocument(body, path.basename(full)))
    ref = { type: isHtml ? 'html' : 'markdown', source: input.path, title: titleOf(html, path.basename(full)) }
  } else throw new Error('path or url required')
  const text = documentText(html)
  ref.fingerprint = fingerprint(text)
  readable ??= readableText(parseHTML(html).document.body)
  return { ref, html, text, readable, room: roomFor(ref) }
}
