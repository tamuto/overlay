/**
 * Text normalization.
 *
 * Anchoring works on a whitespace-normalized view of the document text so
 * that re-formatting (re-indented HTML, re-wrapped Markdown paragraphs, ...)
 * does not break annotations. `toRaw` / `toNorm` translate offsets between the
 * normalized text and the raw text (e.g. DOM textContent).
 */
export interface NormalizedText {
  /** Whitespace collapsed to single spaces, trimmed. */
  text: string
  /** normalized index -> raw index (length = text.length + 1) */
  toRaw: Int32Array
  /** raw index -> normalized index (length = raw.length + 1) */
  toNorm: Int32Array
}

const WS = /\s/

export function normalizeText(raw: string): NormalizedText {
  const out: string[] = []
  const toRaw: number[] = []
  const toNorm = new Int32Array(raw.length + 1)
  let pendingSpace = -1 // raw index of the first whitespace of the current run
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!
    if (WS.test(ch)) {
      if (pendingSpace < 0) pendingSpace = i
      continue // filled in by the backward pass below
    }
    if (pendingSpace >= 0 && out.length > 0) {
      out.push(' ')
      toRaw.push(pendingSpace)
    }
    pendingSpace = -1
    toNorm[i] = out.length
    out.push(ch)
    toRaw.push(i)
  }
  toRaw.push(raw.length)
  toNorm[raw.length] = out.length
  // whitespace chars map to the position of the next normalized char
  for (let i = raw.length - 1; i >= 0; i--) {
    if (WS.test(raw[i]!)) toNorm[i] = Math.min(toNorm[i + 1]!, out.length)
  }
  return { text: out.join(''), toRaw: Int32Array.from(toRaw), toNorm }
}

/** Small, fast, non-cryptographic hash (cyrb53) – used to detect document changes. */
export function fingerprint(text: string): string {
  const s = normalizeText(text).text
  let h1 = 0xdeadbeef ^ s.length
  let h2 = 0x41c6ce57 ^ s.length
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')
}

/** Levenshtein distance (two-row DP). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = new Uint32Array(b.length + 1)
  let cur = new Uint32Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    const ca = a.charCodeAt(i - 1)
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost)
    }
    ;[prev, cur] = [cur, prev]
  }
  return prev[b.length]!
}

/** 0..1 similarity based on edit distance. */
export function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length)
  if (max === 0) return 1
  return 1 - levenshtein(a, b) / max
}
