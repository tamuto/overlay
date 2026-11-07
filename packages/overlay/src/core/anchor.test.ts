import { describe as suite, expect, it } from 'vitest'
import { describe, resolve } from './anchor.ts'
import { normalizeText, fingerprint } from './text.ts'
import { createAnnotation, findingsToAnnotations, mergeOverlays, emptyOverlay, toMarkdownReport } from './overlay.ts'

const base =
  'Overlay はドキュメントに直接手を入れずに添削を重ねるためのツールです。' +
  'レビュー対象のMarkdownやWebページを読み込み、選択した範囲にコメントを付けます。' +
  '指摘は別ファイルとして保存されるので、Git で共有したりリアルタイムに共同編集したりできます。'

function target(text: string, quote: string) {
  const start = text.indexOf(quote)
  return { selectors: describe(text, start, start + quote.length) }
}

suite('normalizeText', () => {
  it('collapses whitespace and maps offsets both ways', () => {
    const raw = '  Hello\n\n   world  foo '
    const n = normalizeText(raw)
    expect(n.text).toBe('Hello world foo')
    expect(raw.slice(n.toRaw[6]!, n.toRaw[11]!)).toBe('world')
    expect(n.toNorm[raw.indexOf('world')]).toBe(6)
  })
  it('fingerprint ignores formatting-only changes', () => {
    expect(fingerprint('a  b\nc')).toBe(fingerprint('a b c'))
    expect(fingerprint('a b c')).not.toBe(fingerprint('a b d'))
  })
})

suite('resolve', () => {
  const t = target(base, '選択した範囲にコメント')

  it('exact when unchanged', () => {
    const r = resolve(base, t)
    expect(r.status).toBe('exact')
    expect(base.slice(r.start, r.end)).toBe('選択した範囲にコメント')
  })

  it('moved when text was inserted before', () => {
    const edited = '【はじめに】この文書は概要です。' + base
    const r = resolve(edited, t)
    expect(r.status).toBe('moved')
    expect(edited.slice(r.start, r.end)).toBe('選択した範囲にコメント')
  })

  it('picks the right occurrence using context', () => {
    const text = 'Aの設定: 有効にする。Bの設定: 有効にする。Cの設定: 有効にする。'
    const start = text.indexOf('有効にする', text.indexOf('Bの設定'))
    const tt = { selectors: describe(text, start, start + 5) }
    const edited = '注意。' + text
    const r = resolve(edited, tt)
    expect(r.status).toBe('moved')
    expect(edited.slice(r.start - 6, r.start)).toBe('Bの設定: ')
  })

  it('fuzzy when the quoted text itself was edited', () => {
    const edited = base.replace('選択した範囲にコメント', '選択した箇所へコメント')
    const r = resolve(edited, t)
    expect(r.status).toBe('fuzzy')
    expect(edited.slice(r.start, r.end)).toContain('選択した箇所へコメント')
  })

  it('fuzzy via approximate search when context also changed', () => {
    const quote = 'リアルタイムに共同編集したりできます'
    const tt = target(base, quote)
    const edited = '全く別の文章になりました。リアルタイムで共同編集したりできます。おわり。'
    const r = resolve(edited, tt)
    expect(r.status).toBe('fuzzy')
    expect(edited.slice(r.start, r.end)).toContain('共同編集したりできます')
  })

  it('orphaned when the passage is gone', () => {
    const edited = 'このドキュメントは全面的に書き直されました。内容は無関係です。'
    expect(resolve(edited, t).status).toBe('orphaned')
  })
})

suite('overlay helpers', () => {
  const fp = fingerprint(base)
  const author = { name: 'alice', kind: 'human' as const }

  it('locates AI findings by quote', () => {
    const { annotations, unlocated } = findingsToAnnotations(
      base,
      fp,
      [
        { quote: 'Git で共有', comment: '具体的な手順を', suggestion: null, severity: 'minor' },
        { quote: '存在しない文章', comment: 'x' },
      ],
      { name: 'AI', kind: 'ai', via: 'mock' },
    )
    expect(annotations).toHaveLength(1)
    expect(annotations[0]!.draft).toBe(true)
    expect(unlocated).toHaveLength(1)
  })

  it('merges overlays (newest wins, replies unioned)', () => {
    const a = createAnnotation(base, fp, { start: 0, end: 7 }, { kind: 'comment', text: 'v1', author })
    const b = { ...a, text: 'v2', updatedAt: '2999-01-01T00:00:00.000Z', replies: [{ id: 'r1', author, text: 'ok', createdAt: 'x' }] }
    const o1 = { ...emptyOverlay({ type: 'markdown', source: 'a.md' }), annotations: [{ ...a, replies: [{ id: 'r0', author, text: 'hi', createdAt: 'a' }] }] }
    const o2 = { ...emptyOverlay({ type: 'markdown', source: 'a.md' }), annotations: [b] }
    const m = mergeOverlays(o1, o2)
    expect(m.annotations).toHaveLength(1)
    expect(m.annotations[0]!.text).toBe('v2')
    expect(m.annotations[0]!.replies.map((r) => r.id)).toEqual(['r0', 'r1'])
    expect(toMarkdownReport(m, base)).toContain('v2')
  })
})
