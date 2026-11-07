import { describe, quoteOf, resolve } from './anchor.ts'
import type { AnchorResult, Annotation, Author, DocumentRef, OverlayFile } from './types.ts'
import { OVERLAY_FORMAT_VERSION } from './types.ts'

export function newId(): string {
  return globalThis.crypto.randomUUID()
}

export function emptyOverlay(document: DocumentRef): OverlayFile {
  return { version: OVERLAY_FORMAT_VERSION, document, annotations: [] }
}

export function createAnnotation(
  text: string,
  fp: string,
  range: { start: number; end: number },
  init: Pick<Annotation, 'kind' | 'text' | 'author'> & Partial<Annotation>,
): Annotation {
  const now = new Date().toISOString()
  return {
    id: newId(),
    status: 'open',
    replies: [],
    createdAt: now,
    updatedAt: now,
    ...init,
    target: { selectors: describe(text, range.start, range.end), fingerprint: fp },
  }
}

/** Re-target an (e.g. orphaned) annotation to a new range, keeping its history. */
export function reanchor(a: Annotation, text: string, fp: string, range: { start: number; end: number }): Annotation {
  return {
    ...a,
    target: { selectors: describe(text, range.start, range.end), fingerprint: fp },
    updatedAt: new Date().toISOString(),
  }
}

export interface Anchored {
  annotation: Annotation
  anchor: AnchorResult
}

/** Resolve every annotation against the current text, sorted by position (orphans last). */
export function anchorAll(text: string, annotations: Annotation[]): Anchored[] {
  return annotations
    .map((annotation) => ({ annotation, anchor: resolve(text, annotation.target) }))
    .sort((a, b) => {
      const sa = a.anchor.start < 0 ? Infinity : a.anchor.start
      const sb = b.anchor.start < 0 ? Infinity : b.anchor.start
      return sa - sb || a.annotation.createdAt.localeCompare(b.annotation.createdAt)
    })
}

/**
 * Merge two overlay files (e.g. two reviewers working offline, or a git merge).
 * Per annotation the most recently updated version wins; replies are unioned.
 */
export function mergeOverlays(a: OverlayFile, b: OverlayFile): OverlayFile {
  const byId = new Map<string, Annotation>()
  for (const x of [...a.annotations, ...b.annotations]) {
    const prev = byId.get(x.id)
    if (!prev) {
      byId.set(x.id, x)
      continue
    }
    const winner = prev.updatedAt >= x.updatedAt ? prev : x
    const replies = new Map([...prev.replies, ...x.replies].map((r) => [r.id, r]))
    byId.set(x.id, {
      ...winner,
      replies: [...replies.values()].sort((p, q) => p.createdAt.localeCompare(q.createdAt)),
    })
  }
  return { ...a, annotations: [...byId.values()] }
}

/** Shape an AI reviewer must return. Quotes are located in the text by us. */
export interface AiFinding {
  quote: string
  comment: string
  suggestion?: string | null
  severity?: 'info' | 'minor' | 'major'
}

export function findingsToAnnotations(
  text: string,
  fp: string,
  findings: AiFinding[],
  author: Author,
): { annotations: Annotation[]; unlocated: AiFinding[] } {
  const annotations: Annotation[] = []
  const unlocated: AiFinding[] = []
  for (const f of findings) {
    const quote = f.quote?.trim()
    if (!quote) {
      unlocated.push(f)
      continue
    }
    const r = resolve(text, { selectors: [{ type: 'TextQuoteSelector', exact: quote.replace(/\s+/g, ' '), prefix: '', suffix: '' }] }, { minScore: 0.8 })
    if (r.status === 'orphaned') {
      unlocated.push(f)
      continue
    }
    annotations.push(
      createAnnotation(text, fp, r, {
        kind: f.suggestion ? 'suggestion' : 'comment',
        text: f.comment,
        suggestion: f.suggestion ?? undefined,
        severity: f.severity,
        author,
        draft: true,
      }),
    )
  }
  return { annotations, unlocated }
}

const STATUS_LABEL: Record<AnchorResult['status'], string> = {
  exact: '一致',
  moved: '位置移動',
  fuzzy: '本文変更あり',
  orphaned: '参照先消失',
}

/** Human readable review report (Markdown). */
export function toMarkdownReport(overlay: OverlayFile, text?: string): string {
  const rows = text
    ? anchorAll(text, overlay.annotations)
    : overlay.annotations.map((annotation) => ({ annotation, anchor: undefined as AnchorResult | undefined }))
  const lines: string[] = [`# レビュー: ${overlay.document.title ?? overlay.document.source}`, '']
  lines.push(`- 対象: \`${overlay.document.source}\``)
  lines.push(`- 指摘数: ${overlay.annotations.length}（未解決 ${overlay.annotations.filter((a) => a.status === 'open').length}）`, '')
  rows.forEach(({ annotation: a, anchor }, i) => {
    const q = quoteOf(a.target)
    const tags = [a.kind === 'suggestion' ? '修正提案' : 'コメント', a.status === 'resolved' ? '解決済' : '未解決']
    if (a.severity) tags.push(a.severity)
    if (anchor) tags.push(STATUS_LABEL[anchor.status])
    if (a.author.kind === 'ai') tags.push(`AI${a.author.via ? `:${a.author.via}` : ''}`)
    lines.push(`## ${i + 1}. ${tags.join(' / ')}`, '')
    if (q) lines.push(`> ${q.exact.replace(/\n/g, ' ')}`, '')
    if (a.suggestion !== undefined) lines.push('```diff', `- ${q?.exact ?? ''}`, `+ ${a.suggestion}`, '```', '')
    lines.push(`**${a.author.name}**: ${a.text}`, '')
    for (const r of a.replies) lines.push(`- **${r.author.name}**: ${r.text}`)
    if (a.replies.length) lines.push('')
  })
  return lines.join('\n')
}

/** Very small runtime validation for files coming from outside. */
export function parseOverlay(json: unknown): OverlayFile {
  const o = json as Partial<OverlayFile>
  if (!o || typeof o !== 'object' || o.version !== OVERLAY_FORMAT_VERSION || !o.document || !Array.isArray(o.annotations))
    throw new Error('overlay file: unsupported format')
  for (const a of o.annotations) {
    if (typeof a?.id !== 'string' || !Array.isArray(a?.target?.selectors)) throw new Error('overlay file: invalid annotation')
    a.replies ??= []
  }
  return o as OverlayFile
}
