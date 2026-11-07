import { describe, expect, it } from 'vitest'
import { parseHTML } from 'linkedom'
import { defaultRoute, describeElement, isStableId, resolveElement } from './locate.ts'

const page = (body: string) => parseHTML(`<!doctype html><html><body>${body}</body></html>`).document as unknown as Document

const ORDERS = `
<main>
  <h1>受注一覧</h1>
  <button id=":r1:">新規作成</button>
  <table><tbody>
    <tr><td>A-001</td><td>山田商事</td><td><button>編集</button></td></tr>
    <tr><td>A-002</td><td>佐藤工業</td><td><button>編集</button></td></tr>
  </tbody></table>
  <form aria-label="検索"><label for="q">キーワード</label><input id="q" placeholder="品名"></form>
</main>`

describe('describe/resolve without app attributes', () => {
  it('records role, accessible name and row context; ignores unstable ids', () => {
    const doc = page(ORDERS)
    const btn = doc.querySelectorAll('button')[2]! // 編集 of A-002
    const s = describeElement(btn)
    expect(s).toMatchObject({ tag: 'button', role: 'button', name: '編集' })
    expect(s.context).toContain('佐藤工業')
    expect(describeElement(doc.querySelector('button')!).id).toBeUndefined() // ":r1:"
    expect(describeElement(doc.querySelector('input')!).name).toBe('キーワード')
    const sel = page('<label>ステータス<select><option>受付</option><option>出荷済</option></select></label>').querySelector('select')!
    expect(describeElement(sel).name).toBe('ステータス')
  })

  it('re-finds the right row button after the layout changes', () => {
    const s = describeElement(page(ORDERS).querySelectorAll('button')[2]!)
    // a new row is inserted at the top, and a wrapper div is added
    const changed = page(
      ORDERS.replace('<tbody>', '<tbody><tr><td>A-000</td><td>鈴木物産</td><td><button>編集</button></td></tr>').replace('<main>', '<main><div class="wrap">'),
    )
    const m = resolveElement(changed, s)
    expect(m?.element.closest('tr')?.textContent).toContain('佐藤工業')
  })

  it('finds a button whose label changed slightly (fuzzy) and gives up when it is gone', () => {
    const s = describeElement(page(ORDERS).querySelector('button')!)
    const m = resolveElement(page(ORDERS.replace('新規作成', '新規作成する')), s)
    expect(m?.element.textContent).toBe('新規作成する')
    expect(m?.status).toBe('fuzzy')
    expect(resolveElement(page('<main><p>empty</p></main>'), s)).toBeNull()
  })
})

describe('with data-in4o-* attributes', () => {
  const KEYED = `
    <ul>
      <li data-in4o-scope="order-row">A-001 山田商事 <button data-in4o-key="order.edit">編集</button></li>
      <li data-in4o-scope="order-row">A-002 佐藤工業 <button data-in4o-key="order.edit">編集</button></li>
    </ul>
    <div data-in4o-ignore><button>secret</button></div>
    <button data-in4o-key="order.save">保存</button>`

  it('key wins even if the label changes completely', () => {
    const s = describeElement(page(KEYED).querySelector('[data-in4o-key="order.save"]')!)
    expect(s.key).toBe('order.save')
    const m = resolveElement(page(KEYED.replace('>保存<', '>Save<')), s)
    expect(m).toMatchObject({ status: 'exact' })
    expect(m!.element.textContent).toBe('Save')
  })

  it('scope disambiguates repeated keys', () => {
    const s = describeElement(page(KEYED).querySelectorAll('[data-in4o-key="order.edit"]')[1]!)
    expect(s.scope?.key).toBe('order-row')
    const m = resolveElement(page(KEYED), s)
    expect(m!.element.parentElement!.textContent).toContain('佐藤工業')
  })

  it('never matches inside data-in4o-ignore, and a custom prefix works', () => {
    const doc = page(KEYED)
    const s = describeElement(doc.querySelector('[data-in4o-ignore] button')!)
    expect(resolveElement(doc, s)?.element.textContent).not.toBe('secret')
    const custom = page('<button data-acme-key="x">A</button>')
    expect(describeElement(custom.querySelector('button')!, { prefix: 'acme' }).key).toBe('x')
  })
})

describe('helpers', () => {
  it('isStableId', () => {
    expect(isStableId('email')).toBe(true)
    expect(isStableId(':r3:')).toBe(false)
    expect(isStableId('mui-12')).toBe(false)
    expect(isStableId('a1b2c3d4e5')).toBe(false)
  })
  it('defaultRoute replaces ids and supports hash routers', () => {
    expect(defaultRoute({ pathname: '/orders/123/edit', hash: '' })).toBe('/orders/:id/edit')
    expect(defaultRoute({ pathname: '/', hash: '#/users/5f1c2a9b7e?tab=1' })).toBe('/users/:id')
  })
})
