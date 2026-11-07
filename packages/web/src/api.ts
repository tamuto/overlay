import DOMPurify from 'dompurify'
import { markdownDocument, type AiFinding, type DocumentRef } from '@infodb/overlay'

export interface ServerInfo {
  mode: 'server'
  root: string
  ai: { name: string; description: string } | null
}

export interface LoadedDoc {
  ref: DocumentRef
  html: string
  /** Realtime room id (server mode only). */
  room: string | null
}

const headers = { 'x-in4o-client': '1' }

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText)
  return body as T
}

/** Returns null when running as a static site without the overlay server. */
export async function fetchInfo(): Promise<ServerInfo | null> {
  try {
    const res = await fetch('/api/info')
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null
    return (await res.json()) as ServerInfo
  } catch {
    return null
  }
}

/** URLSearchParams from an object, skipping undefined values. */
export function toParams(o: Record<string, string | undefined>): URLSearchParams {
  return new URLSearchParams(Object.entries(o).filter((e): e is [string, string] => e[1] !== undefined))
}

export const listFiles = async () => (await json<{ files: string[] }>(await fetch('/api/files'))).files

export async function loadRemote(input: { path?: string; url?: string }): Promise<LoadedDoc> {
  const q = toParams(input)
  const doc = await json<{ ref: DocumentRef; html: string; room: string }>(await fetch(`/api/document?${q}`, { headers }))
  return { ref: doc.ref, html: doc.html, room: doc.room }
}

/** Standalone mode: open a local file in the browser – nothing is uploaded. */
export async function loadLocalFile(file: File): Promise<LoadedDoc> {
  const body = await file.text()
  const isHtml = /\.html?$/i.test(file.name)
  const raw = isHtml ? body : markdownDocument(body, file.name)
  const html = DOMPurify.sanitize(raw, { WHOLE_DOCUMENT: true, ADD_TAGS: ['style', 'link'], FORBID_TAGS: ['script', 'iframe', 'base'] })
  return {
    ref: { type: isHtml ? 'html' : 'markdown', source: file.name, title: file.name },
    html: `<!doctype html>${html}`,
    room: null,
  }
}

export async function aiReview(body: { text: string; title?: string; instruction?: string }) {
  return json<{ provider: string; findings: AiFinding[] }>(
    await fetch('/api/ai/review', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  )
}

export function download(name: string, content: string, type = 'application/json') {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([content], { type }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
