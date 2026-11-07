/**
 * createOverlay – put guide bubbles and personal notes on top of a running web app.
 *
 * The app itself is not modified: the UI lives in a <in4o-root> element with a
 * Shadow DOM, annotations live in overlay files (one per layer).
 */
import { arrow, autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom'
import { emptyOverlay, newAnnotation } from '../core/overlay.ts'
import type { Annotation, AnnotationKind, ElementSelector, OverlayFile } from '../core/types.ts'
import { defaultRoute, describeElement, pickTarget, resolveElement, type ElementMatch } from './locate.ts'
import type { LayerSource } from './sources.ts'
import { EMBED_CSS, ICON } from './styles.ts'

export interface LayerConfig {
  id: string
  label: string
  source: LayerSource
  /** Users may add / edit / delete annotations in this layer. */
  editable?: boolean
  /** Kind of annotation created in this layer. guide = manual (tour-able), note = memo. Default note. */
  kind?: Extract<AnnotationKind, 'guide' | 'note'>
  visible?: boolean
}

export interface OverlayOptions {
  /** Identifier of the app (stored as document.source of the overlay files). */
  app: string
  layers: LayerConfig[]
  user?: { name: string }
  /** Screen key; annotations are shown only on the screen they were made on. Default: pathname with ids replaced. */
  route?: () => string
  /** Attribute prefix: data-<prefix>-key / -scope / -ignore. Default "in4o". */
  prefix?: string
  /** Show the floating launcher button. Default true. */
  launcher?: boolean
  onChange?(layerId: string, file: OverlayFile): void
}

export type OverlayMode = 'view' | 'pick' | 'off'

export interface OverlayController {
  setMode(mode: OverlayMode): void
  readonly mode: OverlayMode
  /** Start the guided tour over the guide annotations of the current screen. */
  startTour(layerId?: string): void
  setLayerVisible(layerId: string, visible: boolean): void
  /** Force re-locating elements (normally automatic). */
  refresh(): void
  exportLayer(layerId: string): OverlayFile
  importLayer(layerId: string, file: OverlayFile): void
  destroy(): void
}

interface LayerState {
  config: LayerConfig
  file: OverlayFile
  visible: boolean
}

interface Placed {
  layer: LayerState
  annotation: Annotation
  selector: ElementSelector
  match: ElementMatch | null
}

type Bubble =
  | { type: 'view'; id: string }
  | { type: 'edit'; element: Element; layerId: string; existing?: Placed }
  | { type: 'tour'; ids: string[]; index: number }

const sel = (a: Annotation) => a.target.selectors.find((s): s is ElementSelector => s.type === 'ElementSelector')

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: (Node | string | null | false | undefined)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener)
    else if (k === 'html') el.innerHTML = String(v) // only used with our own static SVG
    else if (k in el && k !== 'list') (el as unknown as Record<string, unknown>)[k] = v
    else el.setAttribute(k, String(v))
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c)
  return el
}

export function createOverlay(options: OverlayOptions): OverlayController {
  const prefix = options.prefix ?? 'in4o'
  const getRoute = options.route ?? (() => defaultRoute(location))
  const author = { name: options.user?.name ?? 'me', kind: 'human' as const }

  // ── DOM scaffold ───────────────────────────────────────────
  const host = document.createElement(`${prefix}-root`)
  const shadow = host.attachShadow({ mode: 'open' })
  shadow.append(h('style', {}, EMBED_CSS))
  const pinLayer = h('div')
  const outline = h('div', { class: 'outline hidden' }, h('span', { class: 'label hidden' }))
  const bubbleEl = h('div', { class: 'bubble hidden', role: 'dialog' })
  const panel = h('div', { class: 'panel hidden' })
  const launcher = h('button', { class: 'launcher', 'aria-label': 'ガイドとメモ', title: 'ガイドとメモ', html: ICON.launcher })
  const banner = h('div', { class: 'banner hidden' })
  const toastEl = h('div', { class: 'toast hidden' })
  shadow.append(pinLayer, outline, bubbleEl, panel, banner, toastEl)
  if (options.launcher !== false) shadow.append(launcher)
  document.body.append(host)

  // ── state ──────────────────────────────────────────────────
  const layers = new Map<string, LayerState>()
  for (const config of options.layers)
    layers.set(config.id, { config, file: emptyOverlay({ type: 'app', source: options.app }), visible: config.visible ?? true })
  let mode: OverlayMode = 'view'
  let route = getRoute()
  let placed: Placed[] = []
  let bubble: Bubble | null = null
  let reattachId: string | null = null
  let hoverTarget: Element | null = null
  let stopBubbleUpdate: (() => void) | null = null
  const pins = new Map<string, HTMLButtonElement>()
  const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const cleanups: (() => void)[] = []

  const editableLayers = () => [...layers.values()].filter((l) => l.config.editable)
  const find = (id: string) => placed.find((p) => p.annotation.id === id)

  // ── persistence ────────────────────────────────────────────
  function commit(layer: LayerState, annotations: Annotation[]) {
    layer.file = { ...layer.file, annotations }
    clearTimeout(saveTimers.get(layer.config.id))
    saveTimers.set(
      layer.config.id,
      setTimeout(() => {
        void layer.config.source.save?.(layer.file)
        options.onChange?.(layer.config.id, layer.file)
      }, 200),
    )
    resolveAll()
  }
  const upsert = (layer: LayerState, a: Annotation) =>
    commit(layer, [...layer.file.annotations.filter((x) => x.id !== a.id), { ...a, updatedAt: new Date().toISOString() }])
  const remove = (layer: LayerState, id: string) => commit(layer, layer.file.annotations.filter((x) => x.id !== id))

  for (const layer of layers.values()) {
    layer.config.source
      .load()
      .then((file) => {
        if (file) layer.file = file
        resolveAll()
      })
      .catch((e) => console.warn(`[in4o] layer "${layer.config.id}"`, e))
    const unsub = layer.config.source.subscribe?.((file) => {
      layer.file = file
      resolveAll()
    })
    if (unsub) cleanups.push(unsub)
  }

  // ── locating ───────────────────────────────────────────────
  function resolveAll() {
    route = getRoute()
    const next: Placed[] = []
    for (const layer of layers.values()) {
      if (!layer.visible) continue
      for (const annotation of layer.file.annotations) {
        const selector = sel(annotation)
        if (!selector) continue
        if (annotation.target.route && annotation.target.route !== route) continue
        next.push({ layer, annotation, selector, match: resolveElement(document, selector, { prefix, exclude: host }) })
      }
    }
    placed = next
    if (bubble?.type === 'view' && !find(bubble.id)?.match) closeBubble()
    renderPins()
    renderPanel()
    schedule()
  }

  let resolveTimer: ReturnType<typeof setTimeout> | undefined
  const resolveSoon = () => {
    clearTimeout(resolveTimer)
    resolveTimer = setTimeout(resolveAll, 150)
  }

  // ── pins ───────────────────────────────────────────────────
  function renderPins() {
    const live = new Set<string>()
    let n = 0
    for (const p of placed) {
      if (!p.match || mode === 'off') continue
      const id = p.annotation.id
      live.add(id)
      let pin = pins.get(id)
      if (!pin) {
        pin = h('button', { class: 'pin', onClick: (e: Event) => (e.stopPropagation(), openView(id)) })
        pins.set(id, pin)
        pinLayer.append(pin)
      }
      const guide = p.annotation.kind === 'guide'
      pin.className = `pin ${guide ? 'guide' : 'note'} ${p.match.status === 'fuzzy' ? 'fuzzy' : ''} ${bubble?.type === 'view' && bubble.id === id ? 'active' : ''}`
      pin.title = p.annotation.title || p.annotation.text.slice(0, 60)
      pin.setAttribute('aria-label', `${guide ? 'ガイド' : 'メモ'}: ${pin.title}`)
      if (guide) pin.textContent = p.annotation.order !== undefined ? String(p.annotation.order) : '?'
      else if (!pin.querySelector('svg')) pin.innerHTML = ICON.note
      n++
    }
    for (const [id, pin] of pins) if (!live.has(id)) (pin.remove(), pins.delete(id))
    const count = launcher.querySelector('.count')
    if (n) {
      if (count) count.textContent = String(n)
      else launcher.append(h('span', { class: 'count' }, String(n)))
    } else count?.remove()
  }

  let frame = 0
  function schedule() {
    if (!frame) frame = requestAnimationFrame(positionAll)
  }

  function positionAll() {
    frame = 0
    const vw = innerWidth
    const vh = innerHeight
    const stack = new Map<Element, number>()
    for (const p of placed) {
      const pin = pins.get(p.annotation.id)
      if (!pin || !p.match) continue
      const r = p.match.element.getBoundingClientRect()
      const off = stack.get(p.match.element) ?? 0
      stack.set(p.match.element, off + 1)
      const hidden = (r.width === 0 && r.height === 0) || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw
      pin.classList.toggle('hidden', hidden)
      if (hidden) continue
      const pt = p.selector.point
      const x = pt ? r.left + r.width * pt.x - 11 : r.right - 12 - off * 24
      const y = pt ? r.top + r.height * pt.y - 11 : r.top - 10
      pin.style.left = `${Math.min(Math.max(2, x), vw - 24)}px`
      pin.style.top = `${Math.min(Math.max(2, y), vh - 24)}px`
    }
    // outline follows hovered element (pick) or the current bubble's element
    const target =
      mode === 'pick' ? hoverTarget : bubble?.type === 'tour' ? find(bubble.ids[bubble.index]!)?.match?.element : bubble?.type === 'edit' ? bubble.element : null
    if (target) {
      const r = target.getBoundingClientRect()
      outline.classList.remove('hidden')
      Object.assign(outline.style, { left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px` })
    } else outline.classList.add('hidden')
  }

  // ── bubbles ────────────────────────────────────────────────
  function closeBubble() {
    stopBubbleUpdate?.()
    stopBubbleUpdate = null
    bubble = null
    bubbleEl.classList.add('hidden')
    bubbleEl.replaceChildren()
    outline.className = 'outline hidden'
    renderPins()
    schedule()
  }

  type Child = Node | string | null | false | undefined

  function showBubble(reference: Element, content: Child[], cls: string) {
    stopBubbleUpdate?.()
    const arrowEl = h('div', { class: 'arrow' })
    bubbleEl.replaceChildren(
      h('button', { class: 'close', 'aria-label': '閉じる', onClick: () => (reattachId = null, closeBubble()) }, '×'),
      ...content.filter((c): c is Node | string => c !== null && c !== undefined && c !== false),
      arrowEl,
    )
    bubbleEl.className = `bubble ${cls}`
    const update = () =>
      computePosition(reference, bubbleEl, {
        strategy: 'fixed',
        placement: 'bottom',
        middleware: [offset(12), flip({ padding: 8 }), shift({ padding: 8 }), arrow({ element: arrowEl })],
      }).then(({ x, y, placement, middlewareData }) => {
        Object.assign(bubbleEl.style, { left: `${x}px`, top: `${y}px` })
        const side = placement.split('-')[0] as 'top' | 'bottom' | 'left' | 'right'
        const opposite = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }[side]
        const a = middlewareData.arrow
        Object.assign(arrowEl.style, { left: a?.x != null ? `${a.x}px` : '', top: a?.y != null ? `${a.y}px` : '', right: '', bottom: '', [opposite]: '-5px' })
      })
    stopBubbleUpdate = autoUpdate(reference, bubbleEl, update)
  }

  const time = (iso: string) => new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'numeric', day: 'numeric' })

  function openView(id: string) {
    const p = find(id)
    if (!p?.match) return
    bubble = { type: 'view', id }
    const a = p.annotation
    const editable = p.layer.config.editable
    showBubble(
      p.match.element,
      [
        a.title ? h('h3', {}, a.title) : null,
        h('div', { class: 'body' }, a.text),
        p.match.status === 'fuzzy'
          ? h('div', { class: 'warn' }, '画面が変わったため、別の要素を指している可能性があります。', editable ? h('button', { class: 'btn', style: 'margin-left:6px', onClick: () => startReattach(id) }, '付け直す') : null)
          : null,
        h('div', { class: 'meta' }, `${p.layer.config.label} · ${a.author.name} · ${time(a.updatedAt)}`),
        editable
          ? h(
              'div',
              { class: 'row' },
              h('button', { class: 'btn', onClick: () => openEditor(p.match!.element, p.layer.config.id, p) }, '編集'),
              h('span', { class: 'grow' }),
              h('button', { class: 'btn danger', onClick: () => confirm('削除しますか？') && (remove(p.layer, id), closeBubble()) }, '削除'),
            )
          : null,
      ],
      a.kind === 'guide' ? 'guide' : 'note',
    )
    renderPins()
  }

  function openEditor(element: Element, layerId: string, existing?: Placed) {
    bubble = { type: 'edit', element, layerId, existing }
    const choices = editableLayers()
    let layer = layers.get(layerId) ?? choices[0]!
    const a = existing?.annotation
    const isGuide = () => (layer.config.kind ?? 'note') === 'guide'
    const title = h('input', { type: 'text', value: a?.title ?? '', placeholder: '見出し（任意）' })
    const order = h('input', { type: 'number', value: a?.order !== undefined ? String(a.order) : '', placeholder: 'ツアーの順番（任意）', min: '1' })
    const guideFields = h('div', {}, h('label', { class: 'field' }, '見出し', title), h('label', { class: 'field' }, '順番', order))
    const text = h('textarea', { value: a?.text ?? '', placeholder: 'メモ・説明を入力（Ctrl/⌘ + Enter で保存）' })
    const layerSelect =
      !existing && choices.length > 1
        ? h(
            'select',
            {
              onChange: (e: Event) => {
                layer = layers.get((e.target as HTMLSelectElement).value)!
                guideFields.classList.toggle('hidden', !isGuide())
              },
            },
            ...choices.map((l) => h('option', { value: l.config.id, selected: l === layer }, l.config.label)),
          )
        : null
    guideFields.classList.toggle('hidden', !isGuide())
    const save = () => {
      if (!text.value.trim()) return text.focus()
      const extra = isGuide()
        ? { title: title.value.trim() || undefined, order: order.value ? Number(order.value) : undefined }
        : { title: undefined, order: undefined }
      if (a && existing) upsert(existing.layer, { ...a, ...extra, text: text.value.trim() })
      else
        upsert(
          layer,
          newAnnotation(
            { selectors: [describeElement(element, { prefix })], fingerprint: '', route },
            { kind: layer.config.kind ?? 'note', text: text.value.trim(), author, ...extra },
          ),
        )
      closeBubble()
      if (mode === 'pick') setMode('view')
    }
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save()
    })
    const name = describeElement(element, { prefix }).name
    showBubble(
      element,
      [
        h('h3', {}, existing ? '編集' : isGuide() ? 'ガイドを追加' : 'メモを追加'),
        h('div', { class: 'meta', style: 'margin-top:0' }, `対象: ${element.tagName.toLowerCase()}${name ? `「${name.slice(0, 30)}」` : ''}`),
        layerSelect ? h('label', { class: 'field' }, '保存先', layerSelect) : null,
        guideFields,
        h('label', { class: 'field' }, '内容', text),
        h(
          'div',
          { class: 'row' },
          h('span', { class: 'grow' }),
          h('button', { class: 'btn', onClick: () => closeBubble() }, 'キャンセル'),
          h('button', { class: 'btn primary', onClick: save }, '保存'),
        ),
      ],
      isGuide() ? 'guide' : 'note',
    )
    outline.className = `outline ${isGuide() ? 'guide' : ''}`
    schedule()
    setTimeout(() => text.focus(), 0)
  }

  // ── tour ───────────────────────────────────────────────────
  function tourList(layerId?: string): string[] {
    return placed
      .filter((p) => p.match && p.annotation.kind === 'guide' && (!layerId || p.layer.config.id === layerId))
      .sort((a, b) => {
        const oa = a.annotation.order ?? Infinity
        const ob = b.annotation.order ?? Infinity
        if (oa !== ob) return oa - ob
        const ra = a.match!.element.getBoundingClientRect()
        const rb = b.match!.element.getBoundingClientRect()
        return ra.top - rb.top || ra.left - rb.left
      })
      .map((p) => p.annotation.id)
  }

  function showStep(ids: string[], index: number) {
    const p = find(ids[index]!)
    if (!p?.match) return closeBubble()
    bubble = { type: 'tour', ids, index }
    panel.classList.add('hidden')
    p.match.element.scrollIntoView({ block: 'center', behavior: 'smooth' })
    showBubble(
      p.match.element,
      [
        p.annotation.title ? h('h3', {}, p.annotation.title) : null,
        h('div', { class: 'body' }, p.annotation.text),
        h(
          'div',
          { class: 'row' },
          h('span', { class: 'meta grow', style: 'margin:0' }, `${index + 1} / ${ids.length}`),
          h('button', { class: 'btn', disabled: index === 0, onClick: () => showStep(ids, index - 1) }, '戻る'),
          index < ids.length - 1
            ? h('button', { class: 'btn primary', onClick: () => showStep(ids, index + 1) }, '次へ')
            : h('button', { class: 'btn primary', onClick: () => closeBubble() }, '完了'),
        ),
      ],
      'guide',
    )
    outline.className = 'outline spot'
    schedule()
  }

  // ── picking ────────────────────────────────────────────────
  const fromUs = (e: Event) => e.composedPath().includes(host)
  const BLOCKED = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'touchstart', 'submit']

  function onPickMove(e: PointerEvent) {
    if (fromUs(e)) return
    const t = e.target instanceof Element ? pickTarget(e.target, { prefix }) : null
    hoverTarget = t ?? (e.target as Element)
    outline.className = `outline ${t ? '' : 'blocked'}`
    const label = outline.querySelector('.label')!
    label.classList.remove('hidden')
    label.textContent = t ? `${t.tagName.toLowerCase()} ${describeElement(t, { prefix }).name?.slice(0, 30) ?? ''}` : 'ここには付けられません'
    schedule()
  }

  function onPickBlock(e: Event) {
    if (fromUs(e) || mode !== 'pick' || bubble?.type === 'edit') return
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
    if (e.type !== 'click') return
    const t = e.target instanceof Element ? pickTarget(e.target, { prefix }) : null
    if (!t) return toast('この要素には付けられません')
    outline.querySelector('.label')!.classList.add('hidden')
    if (reattachId) {
      const p = placed.find((x) => x.annotation.id === reattachId) ?? findAnywhere(reattachId)
      reattachId = null
      setMode('view')
      if (p) {
        upsert(p.layer, { ...p.annotation, target: { ...p.annotation.target, selectors: [describeElement(t, { prefix })], route } })
        toast('付け直しました')
      }
      return
    }
    const target = editableLayers()[0]
    if (target) openEditor(t, target.config.id)
  }

  function findAnywhere(id: string): Placed | undefined {
    for (const layer of layers.values()) {
      const annotation = layer.file.annotations.find((a) => a.id === id)
      const selector = annotation && sel(annotation)
      if (annotation && selector) return { layer, annotation, selector, match: null }
    }
  }

  function startReattach(id: string) {
    closeBubble()
    reattachId = id
    setMode('pick')
  }

  function setMode(next: OverlayMode) {
    if (next === 'pick' && !editableLayers().length) return
    mode = next
    for (const t of BLOCKED) {
      removeEventListener(t, onPickBlock, true)
      if (next === 'pick') addEventListener(t, onPickBlock, true)
    }
    removeEventListener('pointermove', onPickMove, true)
    if (next === 'pick') {
      addEventListener('pointermove', onPickMove, true)
      banner.replaceChildren(
        reattachId ? '付け直す要素をクリック' : 'メモを付ける要素をクリック',
        h('button', { onClick: () => ((reattachId = null), setMode('view')) }, 'やめる (Esc)'),
      )
      banner.classList.remove('hidden')
      panel.classList.add('hidden')
    } else {
      hoverTarget = null
      banner.classList.add('hidden')
      outline.querySelector('.label')?.classList.add('hidden')
      if (bubble?.type !== 'edit') outline.classList.add('hidden')
    }
    if (next === 'off') closeBubble()
    pinLayer.classList.toggle('hidden', next === 'off')
    renderPins()
    renderPanel()
    schedule()
  }

  // ── panel ──────────────────────────────────────────────────
  function renderPanel() {
    if (panel.classList.contains('hidden')) return
    const tour = tourList()
    const missing = placed.filter((p) => !p.match)
    const download = (layer: LayerState) => {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([JSON.stringify(layer.file, null, 2) + '\n'], { type: 'application/json' }))
      a.download = `${options.app}.${layer.config.id}.overlay.json`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    }
    const upload = (layer: LayerState) => {
      const input = h('input', { type: 'file', accept: '.json,application/json' })
      input.addEventListener('change', async () => {
        const f = input.files?.[0]
        if (!f) return
        try {
          controller.importLayer(layer.config.id, JSON.parse(await f.text()))
          toast('取り込みました')
        } catch (e) {
          toast(`取り込めません: ${(e as Error).message}`)
        }
      })
      input.click()
    }
    const parts: Child[] = [
      h('h2', {}, 'ガイドとメモ'),
      ...[...layers.values()].map((l) => {
        const here = placed.filter((p) => p.layer === l)
        return h(
          'label',
          { class: 'layer' },
          h('input', { type: 'checkbox', checked: l.visible, onChange: (e: Event) => controller.setLayerVisible(l.config.id, (e.target as HTMLInputElement).checked) }),
          h('span', { class: 'dot', style: `background:var(${l.config.kind === 'guide' ? '--in4o-guide' : '--in4o-accent'})` }),
          l.config.label,
          h('span', { class: 'n' }, l.visible ? `この画面 ${here.filter((p) => p.match).length}件` : '非表示'),
        )
      }),
      h(
        'div',
        { class: 'row' },
        tour.length ? h('button', { class: 'btn primary', onClick: () => showStep(tour, 0) }, `ガイドを見る (${tour.length})`) : null,
        editableLayers().length ? h('button', { class: 'btn', onClick: () => setMode('pick') }, '＋ この画面に追加') : null,
      ),
      missing.length ? h('h4', {}, `この画面で見つからない (${missing.length})`) : null,
      ...missing.map((p) =>
        h(
          'div',
          { class: 'missing' },
          `${p.annotation.title ? `${p.annotation.title}: ` : ''}${p.annotation.text.slice(0, 60)}`,
          h('div', { class: 'meta', style: 'margin:0' }, `${p.layer.config.label} · 対象「${p.selector.name?.slice(0, 20) ?? p.selector.tag}」`),
          p.layer.config.editable
            ? h(
                'div',
                { class: 'row' },
                h('button', { class: 'btn', onClick: () => startReattach(p.annotation.id) }, '要素を選び直す'),
                h('button', { class: 'btn danger', onClick: () => confirm('削除しますか？') && remove(p.layer, p.annotation.id) }, '削除'),
              )
            : null,
        ),
      ),
      ...(editableLayers().length ? [h('h4', {}, 'ファイル')] : []),
      ...editableLayers().map((l) =>
        h(
          'div',
          { class: 'row', style: 'margin-top:4px' },
          h('span', { class: 'grow' }, l.config.label),
          h('button', { class: 'btn', onClick: () => download(l) }, '書き出し'),
          h('button', { class: 'btn', onClick: () => upload(l) }, '取り込み'),
        ),
      ),
    ]
    panel.replaceChildren(...parts.filter((c): c is Node | string => c !== null && c !== undefined && c !== false))
  }

  let toastTimer: ReturnType<typeof setTimeout> | undefined
  function toast(msg: string) {
    toastEl.textContent = msg
    toastEl.classList.remove('hidden')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2200)
  }

  launcher.addEventListener('click', () => {
    panel.classList.toggle('hidden')
    renderPanel()
  })

  // ── global listeners ───────────────────────────────────────
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    if (mode === 'pick') (reattachId = null), setMode('view')
    else if (bubble) closeBubble()
    else panel.classList.add('hidden')
  }
  const onOutsideClick = (e: MouseEvent) => {
    if (fromUs(e) || mode === 'pick') return
    if (bubble?.type === 'view') closeBubble()
    panel.classList.add('hidden')
  }
  addEventListener('keydown', onKey, true)
  addEventListener('click', onOutsideClick, true)
  addEventListener('scroll', schedule, { capture: true, passive: true })
  addEventListener('resize', schedule)
  const mo = new MutationObserver(resolveSoon)
  mo.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true, attributeFilter: undefined })
  // route changes of SPA routers (history API / hash) – polling is router-agnostic
  const routeTimer = setInterval(() => {
    if (getRoute() !== route) {
      closeBubble()
      resolveAll()
    }
  }, 300)

  const controller: OverlayController = {
    setMode,
    get mode() {
      return mode
    },
    startTour(layerId) {
      const ids = tourList(layerId)
      if (ids.length) showStep(ids, 0)
      else toast('この画面のガイドはありません')
    },
    setLayerVisible(id, visible) {
      const l = layers.get(id)
      if (!l) return
      l.visible = visible
      resolveAll()
    },
    refresh: resolveAll,
    exportLayer: (id) => layers.get(id)!.file,
    importLayer(id, file) {
      const l = layers.get(id)
      if (!l) throw new Error(`unknown layer ${id}`)
      if (!Array.isArray(file?.annotations)) throw new Error('overlay file expected')
      const byId = new Map(l.file.annotations.map((a) => [a.id, a]))
      for (const a of file.annotations) {
        const cur = byId.get(a.id)
        if (!cur || cur.updatedAt < a.updatedAt) byId.set(a.id, { ...a, replies: a.replies ?? [] })
      }
      commit(l, [...byId.values()])
    },
    destroy() {
      setMode('view')
      closeBubble()
      removeEventListener('keydown', onKey, true)
      removeEventListener('click', onOutsideClick, true)
      removeEventListener('scroll', schedule, true)
      removeEventListener('resize', schedule)
      mo.disconnect()
      clearInterval(routeTimer)
      clearTimeout(resolveTimer)
      cancelAnimationFrame(frame)
      cleanups.forEach((c) => c())
      host.remove()
    },
  }
  resolveAll()
  return controller
}
