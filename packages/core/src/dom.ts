/**
 * DOM helpers shared by the browser UI and the CLI (via linkedom).
 * They never touch the original document – only the rendered copy.
 */
import { normalizeText, type NormalizedText } from './text.ts'

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'svg', 'SVG'])
export const MARK_ATTR = 'data-overlay-id'

export function textNodes(root: Node): Text[] {
  const out: Text[] = []
  const walk = (n: Node) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) out.push(c as Text)
      else if (c.nodeType === 1 && !SKIP.has((c as Element).nodeName)) walk(c)
      else if (c.nodeType === 11) walk(c)
    }
  }
  walk(root)
  return out
}

export interface DocText extends NormalizedText {
  raw: string
  nodes: Text[]
  /** raw start offset of each node */
  starts: number[]
}

export function extractText(root: Node): DocText {
  const nodes = textNodes(root)
  const starts: number[] = []
  let raw = ''
  for (const n of nodes) {
    starts.push(raw.length)
    raw += n.data
  }
  return { raw, nodes, starts, ...normalizeText(raw) }
}

function locate(doc: DocText, rawOffset: number): { node: Text; offset: number } | null {
  if (!doc.nodes.length) return null
  // binary search for the node containing rawOffset
  let lo = 0
  let hi = doc.nodes.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (doc.starts[mid]! <= rawOffset) lo = mid
    else hi = mid - 1
  }
  const node = doc.nodes[lo]!
  return { node, offset: Math.min(rawOffset - doc.starts[lo]!, node.data.length) }
}

/** DOM Range -> normalized [start, end) */
export function rangeToOffsets(doc: DocText, range: Range): { start: number; end: number } | null {
  const raw = (container: Node, offset: number): number | null => {
    if (container.nodeType === 3) {
      const i = doc.nodes.indexOf(container as Text)
      return i < 0 ? null : doc.starts[i]! + offset
    }
    // element container: offset counts child nodes – find first text node at/after the boundary
    const FOLLOWING = 4
    const child = container.childNodes[offset]
    const isAtOrAfter = child
      ? (n: Node) => child === n || (child.compareDocumentPosition(n) & FOLLOWING) !== 0
      : (n: Node) => !container.contains(n) && (container.compareDocumentPosition(n) & FOLLOWING) !== 0
    const i = doc.nodes.findIndex(isAtOrAfter)
    return i < 0 ? doc.raw.length : doc.starts[i]!
  }
  const rs = raw(range.startContainer, range.startOffset)
  const re = raw(range.endContainer, range.endOffset)
  if (rs == null || re == null) return null
  const start = doc.toNorm[rs]!
  const end = doc.toNorm[re]!
  // trim a trailing space produced by selecting up to the start of a word
  let e = end
  while (e > start && doc.text[e - 1] === ' ') e--
  let s = start
  while (s < e && doc.text[s] === ' ') s++
  return s < e ? { start: s, end: e } : null
}

/** normalized [start, end) -> DOM Range */
export function offsetsToRange(doc: DocText, start: number, end: number, ownerDocument: Document): Range | null {
  const rs = doc.toRaw[start]
  const lastChar = doc.toRaw[Math.max(start, end - 1)]
  if (rs == null || lastChar == null) return null
  const a = locate(doc, rs)
  const b = locate(doc, lastChar + 1)
  if (!a || !b) return null
  const range = ownerDocument.createRange()
  range.setStart(a.node, a.offset)
  range.setEnd(b.node, b.offset)
  return range
}

/**
 * Wrap the text of [start, end) in <mark> elements (one per text node segment).
 * Returns the created elements. Call `clearHighlights` + re-extract text after.
 */
export function highlight(
  doc: DocText,
  start: number,
  end: number,
  id: string,
  ownerDocument: Document,
  className = 'overlay-mark',
): HTMLElement[] {
  const rs = doc.toRaw[start]
  const rLast = doc.toRaw[Math.max(start, end - 1)]
  if (rs == null || rLast == null) return []
  const re = rLast + 1
  const marks: HTMLElement[] = []
  for (let i = 0; i < doc.nodes.length; i++) {
    const node = doc.nodes[i]!
    const ns = doc.starts[i]!
    const ne = ns + node.data.length
    if (ne <= rs || ns >= re) continue
    const from = Math.max(rs, ns) - ns
    const to = Math.min(re, ne) - ns
    if (!node.data.slice(from, to).trim()) continue
    let target = node
    if (from > 0) target = target.splitText(from)
    if (to - from < target.data.length) target.splitText(to - from)
    const mark = ownerDocument.createElement('mark')
    mark.className = className
    mark.setAttribute(MARK_ATTR, id)
    target.parentNode!.insertBefore(mark, target)
    mark.appendChild(target)
    marks.push(mark)
  }
  return marks
}

export function clearHighlights(root: Element | Document): void {
  const marks = Array.from(root.querySelectorAll(`mark[${MARK_ATTR}]`))
  for (const m of marks) {
    const parent = m.parentNode
    if (!parent) continue
    while (m.firstChild) parent.insertBefore(m.firstChild, m)
    parent.removeChild(m)
    parent.normalize()
  }
}

const BLOCK = new Set(['ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BR', 'DD', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TR', 'UL', 'BUTTON'])

/** Plain text that keeps block structure (one block per line). Used as AI input. */
export function readableText(root: Node): string {
  let out = ''
  const walk = (n: Node) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) out += (c as Text).data.replace(/\s+/g, ' ')
      else if (c.nodeType === 1 && !SKIP.has((c as Element).nodeName)) {
        const block = BLOCK.has((c as Element).nodeName.toUpperCase())
        if (block) out += '\n'
        if ((c as Element).nodeName.toUpperCase() === 'LI') out += '- '
        walk(c)
        if (block) out += '\n'
      }
    }
  }
  walk(root)
  return out.split('\n').map((l) => l.trim()).filter(Boolean).join('\n')
}
