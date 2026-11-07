import type {
  AnchorResult,
  AnnotationTarget,
  Selector,
  TextPositionSelector,
  TextQuoteSelector,
} from './types.ts'
import { similarity } from './text.ts'

export const CONTEXT_LENGTH = 32

/** Build selectors for [start, end) of the normalized document text. */
export function describe(text: string, start: number, end: number): Selector[] {
  return [
    {
      type: 'TextQuoteSelector',
      exact: text.slice(start, end),
      prefix: text.slice(Math.max(0, start - CONTEXT_LENGTH), start),
      suffix: text.slice(end, end + CONTEXT_LENGTH),
    },
    { type: 'TextPositionSelector', start, end },
  ]
}

export function quoteOf(target: Pick<AnnotationTarget, 'selectors'>): TextQuoteSelector | undefined {
  return target.selectors.find((s): s is TextQuoteSelector => s.type === 'TextQuoteSelector')
}

export function positionOf(target: Pick<AnnotationTarget, 'selectors'>): TextPositionSelector | undefined {
  return target.selectors.find((s): s is TextPositionSelector => s.type === 'TextPositionSelector')
}

const ORPHAN: AnchorResult = { status: 'orphaned', start: -1, end: -1, score: 0 }

export interface ResolveOptions {
  /** Minimum similarity for an approximate (fuzzy) match. Default 0.7 */
  minScore?: number
}

/**
 * Locate an annotation target in the (normalized) document text.
 *
 * Strategy, cheapest first:
 *  1. position selector + exact quote      -> exact
 *  2. all exact occurrences, pick best by surrounding context -> exact / moved
 *  3. prefix … suffix "bridge" (quoted text was edited in place) -> fuzzy
 *  4. approximate string search (bounded edit distance) -> fuzzy
 *  5. give up -> orphaned (the annotation is kept, never silently dropped)
 */
export function resolve(
  text: string,
  target: Pick<AnnotationTarget, 'selectors'>,
  opts: ResolveOptions = {},
): AnchorResult {
  const minScore = opts.minScore ?? 0.7
  const quote = quoteOf(target)
  const pos = positionOf(target)

  if (!quote) {
    if (pos && pos.end <= text.length) return { status: 'moved', start: pos.start, end: pos.end, score: 0.5 }
    return ORPHAN
  }
  const { exact, prefix, suffix } = quote
  if (!exact) return ORPHAN

  // 1. fast path
  if (pos && text.slice(pos.start, pos.end) === exact && contextMatches(text, pos.start, pos.end, quote)) {
    return { status: 'exact', start: pos.start, end: pos.end, score: 1 }
  }

  // 2. exact occurrences elsewhere
  const occ = occurrences(text, exact, 2000)
  if (occ.length) {
    let best = occ[0]!
    let bestScore = -Infinity
    for (const idx of occ) {
      const before = text.slice(Math.max(0, idx - prefix.length), idx)
      const after = text.slice(idx + exact.length, idx + exact.length + suffix.length)
      let score = ctxSimilarity(prefix, before) + ctxSimilarity(suffix, after)
      if (pos) score += 0.1 / (1 + Math.abs(idx - pos.start) / 1000)
      if (score > bestScore) {
        bestScore = score
        best = idx
      }
    }
    const end = best + exact.length
    const exactCtx = contextMatches(text, best, end, quote)
    const status = exactCtx && (!pos || pos.start === best) ? 'exact' : 'moved'
    return { status, start: best, end, score: 1 }
  }

  // 3. bridge between surrounding context
  const bridged = bridge(text, quote)
  if (bridged) return bridged

  // 4. approximate search
  const approx = approximate(text, exact)
  if (approx && approx.score >= minScore) return { status: 'fuzzy', ...approx }

  return ORPHAN
}

function contextMatches(text: string, start: number, end: number, q: TextQuoteSelector): boolean {
  return text.slice(start - q.prefix.length, start) === q.prefix && text.slice(end, end + q.suffix.length) === q.suffix
}

function occurrences(text: string, needle: string, limit: number): number[] {
  const out: number[] = []
  let i = text.indexOf(needle)
  while (i >= 0 && out.length < limit) {
    out.push(i)
    i = text.indexOf(needle, i + 1)
  }
  return out
}

function ctxSimilarity(expected: string, actual: string): number {
  return expected ? similarity(expected, actual) : 1
}

const KEY = 16

function bridge(text: string, q: TextQuoteSelector): AnchorResult | null {
  const pKey = q.prefix.slice(-KEY)
  const sKey = q.suffix.slice(0, KEY)
  // need at least one meaningful context key; doc boundaries count as context
  const pOk = pKey.length >= 6 || (q.prefix.length === 0)
  const sOk = sKey.length >= 6 || (q.suffix.length === 0)
  if (!pOk || !sOk || (q.prefix.length === 0 && q.suffix.length === 0)) return null

  const starts = q.prefix.length === 0 ? [0] : occurrences(text, pKey, 200).map((i) => i + pKey.length)
  const maxSpan = q.exact.length * 2 + 64
  let best: AnchorResult | null = null
  for (const s of starts) {
    let e: number
    if (q.suffix.length === 0) {
      e = text.length
      if (e - s > maxSpan) continue
    } else {
      e = text.indexOf(sKey, s)
      if (e < 0 || e - s > maxSpan) continue
    }
    if (e <= s) continue
    const candidate = text.slice(s, e)
    const score = similarity(candidate, q.exact)
    // trust strong context even when the quoted text was rewritten heavily
    const strongContext = pKey.length >= 12 && sKey.length >= 12
    if (score < 0.3 && !strongContext) continue
    if (!best || score > best.score) best = { status: 'fuzzy', start: s, end: e, score }
  }
  return best
}

const MAX_DIRECT = 256
const CHUNK = 64

/** Approximate substring search. Returns the best region and its similarity. */
export function approximate(text: string, pattern: string): { start: number; end: number; score: number } | null {
  if (!pattern || !text) return null
  if (pattern.length <= MAX_DIRECT) {
    const m = sellers(text, pattern)
    if (!m) return null
    return { start: m.start, end: m.end, score: 1 - m.distance / pattern.length }
  }
  // long quotes: locate head and tail separately, then join
  const head = sellers(text, pattern.slice(0, CHUNK))
  const tail = sellers(text, pattern.slice(-CHUNK))
  if (!head || !tail || tail.end <= head.start) return null
  const span = tail.end - head.start
  if (span < pattern.length * 0.5 || span > pattern.length * 1.5) return null
  const region = text.slice(head.start, tail.end)
  const score =
    pattern.length <= 4000 ? similarity(region, pattern) : 1 - (head.distance + tail.distance) / (2 * CHUNK)
  return { start: head.start, end: tail.end, score }
}

/**
 * Sellers' algorithm: minimum edit distance of `pattern` against any substring
 * of `text`. O(|text| * |pattern|).
 */
function sellers(text: string, pattern: string): { start: number; end: number; distance: number } | null {
  const m = pattern.length
  const maxK = Math.floor(m * 0.4)
  let col = new Uint32Array(m + 1)
  let next = new Uint32Array(m + 1)
  for (let i = 0; i <= m; i++) col[i] = i
  let bestD = Infinity
  let bestEnd = -1
  for (let j = 1; j <= text.length; j++) {
    next[0] = 0
    const c = text.charCodeAt(j - 1)
    for (let i = 1; i <= m; i++) {
      const cost = pattern.charCodeAt(i - 1) === c ? 0 : 1
      next[i] = Math.min(col[i]! + 1, next[i - 1]! + 1, col[i - 1]! + cost)
    }
    if (next[m]! < bestD) {
      bestD = next[m]!
      bestEnd = j
    }
    ;[col, next] = [next, col]
  }
  if (bestEnd < 0 || bestD > maxK) return null

  // find the start: anchored match of the reversed pattern, ending at bestEnd
  const winStart = Math.max(0, bestEnd - m - maxK)
  const win = text.slice(winStart, bestEnd)
  let bestLen = m
  let bestLenD = Infinity
  let prev = new Uint32Array(m + 1)
  let cur = new Uint32Array(m + 1)
  for (let i = 0; i <= m; i++) prev[i] = i
  // column 0 = empty suffix of window
  if (prev[m]! < bestLenD) {
    bestLenD = prev[m]!
    bestLen = 0
  }
  for (let l = 1; l <= win.length; l++) {
    cur[0] = l
    const c = win.charCodeAt(win.length - l)
    for (let i = 1; i <= m; i++) {
      const cost = pattern.charCodeAt(m - i) === c ? 0 : 1
      cur[i] = Math.min(prev[i]! + 1, cur[i - 1]! + 1, prev[i - 1]! + cost)
    }
    if (cur[m]! <= bestLenD) {
      bestLenD = cur[m]!
      bestLen = l
    }
    ;[prev, cur] = [cur, prev]
  }
  return { start: bestEnd - bestLen, end: bestEnd, distance: bestD }
}
