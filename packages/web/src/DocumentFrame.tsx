import { useEffect, useRef } from 'react'
import { clearHighlights, extractText, highlight, rangeToOffsets, readableText, type Anchored, type DocText } from '@infodb/overlay'

export interface FrameSelection {
  start: number
  end: number
  quote: string
  /** Selection rectangle in viewport coordinates of the parent page. */
  rect: { top: number; left: number; bottom: number; right: number }
}

interface Props {
  html: string
  anchored: Anchored[]
  activeId: string | null
  scrollRequest: { id: string; n: number } | null
  pending: { start: number; end: number } | null
  /** normalized text (anchoring) + readable text with line breaks (for AI) */
  onText(text: string, readable: string): void
  onSelect(sel: FrameSelection | null): void
  onMarkClick(id: string): void
  onNavigate(url: string): void
}

const FRAME_CSS = `
mark.in4o-mark{color:inherit;background:rgba(251,191,36,.32);border-bottom:2px solid #f59e0b;border-radius:2px;padding:0;cursor:pointer;transition:background .15s}
mark.in4o-mark.in4o-k-suggestion{background:rgba(56,189,248,.25);border-bottom-color:#0284c7}
mark.in4o-mark.in4o-s-draft{background:rgba(167,139,250,.22);border-bottom:2px dashed #7c3aed}
mark.in4o-mark.in4o-s-resolved{background:transparent;border-bottom:1px dotted #a8a29e}
mark.in4o-mark.in4o-a-fuzzy{border-bottom-style:wavy;border-bottom-color:#ea580c}
mark.in4o-mark.in4o-active{background:rgba(250,204,21,.65);box-shadow:0 0 0 2px rgba(234,179,8,.55)}
mark.in4o-mark.in4o-pending{background:rgba(34,197,94,.3);border-bottom-color:#16a34a}
mark.in4o-mark[data-in4o-mark-n]::after{content:attr(data-in4o-mark-n);display:inline-block;margin-left:2px;padding:0 4px;min-width:1.1em;font:600 10px/1.5 system-ui,sans-serif;color:#fff;background:#57534e;border-radius:8px;vertical-align:super;text-align:center}
mark.in4o-mark.in4o-active[data-in4o-mark-n]::after{background:#ca8a04}
`

export function DocumentFrame(props: Props) {
  const iframe = useRef<HTMLIFrameElement>(null)
  const docText = useRef<DocText | null>(null)
  const cb = useRef(props)
  cb.current = props

  const body = () => iframe.current?.contentDocument?.body ?? null

  function onLoad() {
    const doc = iframe.current?.contentDocument
    if (!doc?.body) return
    const style = doc.createElement('style')
    style.textContent = FRAME_CSS
    doc.head.appendChild(style)
    docText.current = extractText(doc.body)
    cb.current.onText(docText.current.text, readableText(doc.body))

    doc.addEventListener('mouseup', () => {
      // wait for the selection to settle
      setTimeout(() => {
        const sel = doc.getSelection()
        if (!sel || sel.isCollapsed || !sel.rangeCount || !docText.current) return cb.current.onSelect(null)
        const range = sel.getRangeAt(0)
        const off = rangeToOffsets(docText.current, range)
        if (!off) return cb.current.onSelect(null)
        const r = range.getBoundingClientRect()
        const f = iframe.current!.getBoundingClientRect()
        cb.current.onSelect({
          ...off,
          quote: docText.current.text.slice(off.start, off.end),
          rect: { top: r.top + f.top, bottom: r.bottom + f.top, left: r.left + f.left, right: r.right + f.left },
        })
      }, 0)
    })
    doc.addEventListener('click', (e) => {
      const t = e.target as Element
      const mark = t.closest?.('mark[data-in4o-mark-id]')
      const link = t.closest?.('a[href]') as HTMLAnchorElement | null
      if (link) {
        e.preventDefault()
        if (/^https?:/.test(link.href) && !link.getAttribute('href')!.startsWith('#')) cb.current.onNavigate(link.href)
        else if (link.hash) doc.getElementById(decodeURIComponent(link.hash.slice(1)))?.scrollIntoView({ behavior: 'smooth' })
        return
      }
      if (mark && doc.getSelection()?.isCollapsed) cb.current.onMarkClick(mark.getAttribute('data-in4o-mark-id')!)
    })
    doc.addEventListener('scroll', () => cb.current.onSelect(null))
  }

  // (re)draw highlights – only the rendered copy inside the iframe is touched
  useEffect(() => {
    const root = body()
    const doc = iframe.current?.contentDocument
    if (!root || !doc) return
    clearHighlights(root)
    let n = 0
    const draw = (start: number, end: number, id: string, cls: string, label?: string) => {
      const dt = extractText(root)
      const marks = highlight(dt, start, end, id, doc, `in4o-mark ${cls}`)
      if (label && marks.length) marks[marks.length - 1]!.setAttribute('data-in4o-mark-n', label)
    }
    for (const { annotation: a, anchor } of props.anchored) {
      n++
      if (anchor.status === 'orphaned') continue
      const cls = [
        `in4o-k-${a.kind}`,
        a.draft ? 'in4o-s-draft' : a.status === 'resolved' ? 'in4o-s-resolved' : '',
        anchor.status === 'fuzzy' ? 'in4o-a-fuzzy' : '',
        a.id === props.activeId ? 'in4o-active' : '',
      ].join(' ')
      draw(anchor.start, anchor.end, a.id, cls, String(n))
    }
    if (props.pending) draw(props.pending.start, props.pending.end, '__pending', 'in4o-pending')
    docText.current = extractText(root)
  }, [props.anchored, props.activeId, props.pending, props.html])

  useEffect(() => {
    if (!props.scrollRequest) return
    const el = body()?.querySelector(`mark[data-in4o-mark-id="${CSS.escape(props.scrollRequest.id)}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [props.scrollRequest])

  return (
    <iframe
      ref={iframe}
      title="document"
      srcDoc={props.html}
      onLoad={onLoad}
      // no allow-scripts: page scripts never run, but we can read/annotate the DOM
      sandbox="allow-same-origin allow-popups"
      className="h-full w-full border-0 bg-white"
    />
  )
}
