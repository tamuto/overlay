/**
 * Locating UI elements of a running web app.
 *
 * The app does NOT need any special attributes. When it has them, they are used
 * first; otherwise several signals recorded at pick time (role, accessible name,
 * surrounding row/section, structural path …) are scored against the current
 * DOM – the same "record redundantly, re-find by similarity" idea as the text
 * anchoring for documents.
 *
 * Attributes (prefix configurable, default "in4o"):
 *   data-in4o-key="order.save"   stable identifier of a control
 *   data-in4o-scope="order-row"  a repeated container (list row, card); children are disambiguated by it
 *   data-in4o-ignore             nothing inside can be picked; its text is never recorded
 */
import type { AnchorStatus, ElementSelector } from '../core/types.ts'
import { similarity } from '../core/text.ts'

export interface LocateOptions {
  prefix?: string
  /** Elements to never match (our own UI). */
  exclude?: Element | null
}

const attr = (prefix: string, name: string) => `data-${prefix}-${name}`
const norm = (s: string | null | undefined, max = 80) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** Quote a value for use inside an attribute selector (CSS.escape is not available everywhere). */
const q = (v: string) => `"${v.replace(/["\\]/g, '\\$&')}"`

const INTERACTIVE =
  'a[href],button,input:not([type=hidden]),select,textarea,summary,label,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=radio],[role=switch],[role=option],[role=combobox],[role=textbox],[contenteditable=""],[contenteditable=true],[tabindex]:not([tabindex="-1"])'

const CONTAINER =
  'tr,li,[role=row],[role=listitem],[role=gridcell],[role=dialog],dialog,fieldset,form,article,section,[role=region],nav,aside,header,footer'

/** React useId (":r1:"), generated hashes, framework prefixes … are not stable. */
export function isStableId(id: string | null | undefined): id is string {
  if (!id || id.length > 64) return false
  if (/^[:«]|^\d|[:«»]/.test(id)) return false
  if (/[0-9a-f]{6,}/i.test(id) && /\d/.test(id)) return false
  if (/^(react|ember|mui|radix|headlessui|rc-|el-|ext-|j_id|ui-id|ng-|v-)/i.test(id)) return false
  return true
}

const IMPLICIT_ROLE: Record<string, string | ((el: Element) => string | undefined)> = {
  A: (el) => (el.hasAttribute('href') ? 'link' : undefined),
  BUTTON: 'button',
  SELECT: 'combobox',
  TEXTAREA: 'textbox',
  IMG: 'img',
  H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading', H5: 'heading', H6: 'heading',
  NAV: 'navigation',
  DIALOG: 'dialog',
  SUMMARY: 'button',
  INPUT: (el) => {
    const t = (el.getAttribute('type') ?? 'text').toLowerCase()
    if (['button', 'submit', 'reset', 'image'].includes(t)) return 'button'
    if (t === 'checkbox') return 'checkbox'
    if (t === 'radio') return 'radio'
    if (t === 'range') return 'slider'
    return 'textbox'
  },
}

export function roleOf(el: Element): string | undefined {
  const explicit = el.getAttribute('role')
  if (explicit) return explicit.split(/\s+/)[0]
  const r = IMPLICIT_ROLE[el.tagName]
  return typeof r === 'function' ? r(el) : r
}

function textOf(el: Element | null, prefix: string): string {
  if (!el) return ''
  if (el.closest(`[${attr(prefix, 'ignore')}]`)) return ''
  return norm(el.textContent)
}

/** Text of a <label> without the controls inside it (a wrapping label would otherwise include <option> texts). */
function labelText(label: Element, prefix: string): string {
  if (label.closest(`[${attr(prefix, 'ignore')}]`)) return ''
  const copy = label.cloneNode(true) as Element
  copy.querySelectorAll('input,select,textarea,button').forEach((c) => c.remove())
  return norm(copy.textContent)
}

function labelsOf(el: Element, prefix: string): string {
  const doc = el.ownerDocument
  const parts: string[] = []
  const id = el.getAttribute('id')
  if (id) doc.querySelectorAll(`label[for=${q(id)}]`).forEach((l) => parts.push(labelText(l, prefix)))
  const wrap = el.closest('label')
  if (wrap) parts.push(labelText(wrap, prefix))
  return norm(parts.filter(Boolean).join(' '))
}

/** Approximation of the accessible name. Never reads what the user typed into inputs. */
export function accessibleName(el: Element, prefix = 'in4o'): string {
  const aria = el.getAttribute('aria-label')
  if (aria) return norm(aria)
  const by = el.getAttribute('aria-labelledby')
  if (by) {
    const t = by.split(/\s+/).map((id) => textOf(el.ownerDocument.getElementById(id), prefix)).join(' ')
    if (t.trim()) return norm(t)
  }
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
    const type = (el.getAttribute('type') ?? '').toLowerCase()
    if (['button', 'submit', 'reset'].includes(type)) return norm(el.getAttribute('value'))
    return labelsOf(el, prefix) || norm(el.getAttribute('placeholder')) || norm(el.getAttribute('title'))
  }
  if (tag === 'IMG') return norm(el.getAttribute('alt')) || norm(el.getAttribute('title'))
  return textOf(el, prefix) || norm(el.getAttribute('title'))
}

function contextOf(el: Element, prefix: string): string | undefined {
  const c = el.parentElement?.closest(CONTAINER)
  if (!c) return undefined
  const heading = c.querySelector('h1,h2,h3,h4,h5,h6,legend,caption,[role=heading]')
  if (['TR', 'LI'].includes(c.tagName) || /row|listitem|gridcell/.test(c.getAttribute('role') ?? ''))
    return textOf(c, prefix) || undefined
  return norm(c.getAttribute('aria-label')) || textOf(heading, prefix) || undefined
}

function cssPath(el: Element, prefix: string): string {
  const parts: string[] = []
  let cur: Element | null = el
  for (let depth = 0; cur && cur.tagName !== 'BODY' && cur.tagName !== 'HTML' && depth < 8; depth++) {
    const key = cur.getAttribute(attr(prefix, 'key'))
    if (key) {
      parts.unshift(`[${attr(prefix, 'key')}=${q(key)}]`)
      break
    }
    const id = cur.getAttribute('id')
    if (isStableId(id)) {
      parts.unshift(`#${id.replace(/[^\w-]/g, (c) => `\\${c}`)}`)
      break
    }
    const tag = cur.tagName.toLowerCase()
    const parent: Element | null = cur.parentElement
    const same = parent ? Array.from(parent.children).filter((c) => c.tagName === cur!.tagName) : []
    parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(cur) + 1})` : tag)
    cur = parent
  }
  return parts.join(' > ')
}

/**
 * The element a click on `target` should attach to: a keyed element, else the
 * nearest interactive control, else the clicked element itself.
 */
export function pickTarget(target: Element, opts: LocateOptions = {}): Element | null {
  const prefix = opts.prefix ?? 'in4o'
  if (target.closest(`[${attr(prefix, 'ignore')}]`)) return null
  const keyed = target.closest(`[${attr(prefix, 'key')}]`)
  if (keyed) return keyed
  const interactive = target.closest(INTERACTIVE)
  if (interactive) return interactive
  if (target.tagName === 'BODY' || target.tagName === 'HTML') return null
  return target
}

export function describeElement(el: Element, opts: LocateOptions = {}): ElementSelector {
  const prefix = opts.prefix ?? 'in4o'
  const sel: ElementSelector = { type: 'ElementSelector', tag: el.tagName.toLowerCase() }
  const key = el.getAttribute(attr(prefix, 'key'))
  if (key) sel.key = key
  const scope = el.parentElement?.closest(`[${attr(prefix, 'scope')}]`)
  if (scope) sel.scope = { key: scope.getAttribute(attr(prefix, 'scope')) || undefined, text: textOf(scope, prefix).slice(0, 60) || undefined }
  const testId = el.getAttribute('data-testid') ?? el.getAttribute('data-test') ?? el.getAttribute('data-cy')
  if (testId) sel.testId = testId
  const id = el.getAttribute('id')
  if (isStableId(id)) sel.id = id
  const role = roleOf(el)
  if (role) sel.role = role
  const name = accessibleName(el, prefix)
  if (name) sel.name = name
  const context = contextOf(el, prefix)
  if (context && context !== name) sel.context = context
  sel.path = cssPath(el, prefix)
  return sel
}

export interface ElementMatch {
  element: Element
  status: AnchorStatus
  score: number
}

function visible(el: Element): boolean {
  return typeof (el as HTMLElement).getClientRects !== 'function' || (el as HTMLElement).getClientRects().length > 0 || !el.ownerDocument.defaultView?.getComputedStyle
}

/** Find the element described by `sel` in `doc`. Returns null when it cannot be located (orphaned). */
export function resolveElement(doc: Document, sel: ElementSelector, opts: LocateOptions = {}): ElementMatch | null {
  const prefix = opts.prefix ?? 'in4o'
  const usable = (el: Element) => (!opts.exclude || !opts.exclude.contains(el)) && !el.closest(`[${attr(prefix, 'ignore')}]`) && visible(el)
  const all = (selector: string) => Array.from(doc.querySelectorAll(selector)).filter(usable)

  const byScope = (els: Element[]): Element[] => {
    if (els.length < 2 || !sel.scope) return els
    const scored = els.map((el) => {
      const s = el.parentElement?.closest(`[${attr(prefix, 'scope')}]`)
      const keyOk = !sel.scope!.key || s?.getAttribute(attr(prefix, 'scope')) === sel.scope!.key
      return { el, score: (keyOk ? 1 : 0) + (sel.scope!.text ? similarity(sel.scope!.text, textOf(s ?? null, prefix).slice(0, 60)) : 0) }
    })
    const best = Math.max(...scored.map((x) => x.score))
    return scored.filter((x) => x.score === best).map((x) => x.el)
  }

  // 1. explicit attributes from the app – authoritative
  if (sel.key) {
    const found = byScope(all(`[${attr(prefix, 'key')}=${q(sel.key)}]`))
    if (found.length === 1) return { element: found[0]!, status: 'exact', score: 1 }
    // a guide written for "this control in any row" (scope without row text) → the first one
    if (found.length > 1 && sel.scope && !sel.scope.text) return { element: found[0]!, status: 'exact', score: 1 }
    if (found.length > 1) return pickBest(found, sel, prefix) ?? { element: found[0]!, status: 'fuzzy', score: 0.6 }
  }
  if (sel.testId) {
    const found = byScope(all(`[data-testid=${q(sel.testId)}],[data-test=${q(sel.testId)}],[data-cy=${q(sel.testId)}]`))
    if (found.length === 1) return { element: found[0]!, status: 'exact', score: 1 }
    if (found.length > 1) {
      const m = pickBest(found, sel, prefix)
      if (m) return m
    }
  }
  if (sel.id) {
    const el = doc.getElementById(sel.id)
    if (el && usable(el) && el.tagName.toLowerCase() === sel.tag) return { element: el, status: 'exact', score: 1 }
  }

  // 2. score candidates of the same kind
  const interactiveRole = sel.role && sel.role !== 'heading' && sel.role !== 'img'
  let candidates = all(interactiveRole ? INTERACTIVE : sel.tag)
  if (!candidates.length) candidates = all(sel.tag)
  return pickBest(candidates, sel, prefix)
}

function pickBest(candidates: Element[], sel: ElementSelector, prefix: string): ElementMatch | null {
  let pathMatch: Element | null = null
  if (sel.path) {
    try {
      pathMatch = candidates[0]?.ownerDocument.querySelector(sel.path) ?? null
    } catch {
      /* invalid selector after DOM changes */
    }
  }
  const scored = candidates.map((el) => {
    let s = 0
    let max = 0
    const role = roleOf(el)
    max += 1
    if (role === sel.role || (!sel.role && el.tagName.toLowerCase() === sel.tag)) s += 1
    if (sel.name) {
      max += 4
      s += 4 * similarity(sel.name, accessibleName(el, prefix))
    }
    if (sel.context) {
      max += 2
      s += 2 * similarity(sel.context, contextOf(el, prefix) ?? '')
    }
    if (sel.scope?.text) {
      max += 1.5
      const scope = el.parentElement?.closest(`[${attr(prefix, 'scope')}]`) ?? null
      s += 1.5 * similarity(sel.scope.text, textOf(scope, prefix).slice(0, 60))
    }
    if (sel.path) {
      max += 1
      if (el === pathMatch) s += 1
    }
    return { el, ratio: max ? s / max : 0 }
  })
  scored.sort((a, b) => b.ratio - a.ratio)
  const best = scored[0]
  if (!best || best.ratio < 0.6) return null
  const ambiguous = scored[1] !== undefined && best.ratio - scored[1].ratio < 0.02
  const status: AnchorStatus = best.ratio >= 0.95 && !ambiguous ? 'exact' : 'fuzzy'
  return { element: best.el, status, score: best.ratio }
}

/**
 * Default screen key: pathname (or hash route) with id-like segments replaced,
 * so "/orders/123" and "/orders/456" share the same guides and notes.
 */
export function defaultRoute(loc: Pick<Location, 'pathname' | 'hash'> = location): string {
  const path = loc.hash.startsWith('#/') ? loc.hash.slice(1).split('?')[0]! : loc.pathname
  return (
    path
      .split('/')
      .map((seg) => (/^\d+$|^[0-9a-f]{8,}$|^[0-9a-f-]{32,36}$/i.test(seg) ? ':id' : seg))
      .join('/') || '/'
  )
}
