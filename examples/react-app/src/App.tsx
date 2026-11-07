/**
 * A small "order management" SPA used to try @infodb/overlay/embed.
 *
 * Some controls carry data-in4o-* attributes (as the system side would add for
 * manual guides); most do not – user notes still attach to them.
 */
import { useEffect, useState } from 'react'

interface Order {
  id: number
  code: string
  customer: string
  item: string
  status: '受付' | '出荷済' | '保留'
}

const INITIAL: Order[] = [
  { id: 101, code: 'A-001', customer: '山田商事', item: 'ノートPC 10台', status: '受付' },
  { id: 102, code: 'A-002', customer: '佐藤工業', item: 'モニター 4台', status: '出荷済' },
  { id: 103, code: 'A-003', customer: '鈴木物産', item: 'キーボード 20個', status: '保留' },
]

function useHashRoute() {
  const [hash, setHash] = useState(location.hash || '#/orders')
  useEffect(() => {
    const on = () => setHash(location.hash || '#/orders')
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return hash.slice(1)
}

export function App() {
  const route = useHashRoute()
  const [orders, setOrders] = useState(INITIAL)
  const m = route.match(/^\/orders\/(\d+)/)
  const current = m ? orders.find((o) => o.id === Number(m[1])) : undefined

  return (
    <div className="min-h-screen">
      <header className="flex items-center gap-6 bg-slate-900 px-6 py-3 text-white">
        <span className="font-semibold">受注管理</span>
        <nav className="flex gap-4 text-sm">
          <a href="#/orders" className={route.startsWith('/orders') ? 'text-amber-300' : 'text-slate-300'}>受注</a>
          <a href="#/settings" data-in4o-key="nav.settings" className={route === '/settings' ? 'text-amber-300' : 'text-slate-300'}>設定</a>
        </nav>
      </header>
      <main className="mx-auto max-w-4xl p-6">
        {route === '/settings' ? (
          <Settings />
        ) : current ? (
          <OrderForm
            key={current.id}
            order={current}
            onSave={(o) => {
              setOrders(orders.map((x) => (x.id === o.id ? o : x)))
              location.hash = '#/orders'
            }}
          />
        ) : (
          <OrderList orders={orders} />
        )}
      </main>
    </div>
  )
}

function OrderList({ orders }: { orders: Order[] }) {
  const [q, setQ] = useState('')
  const shown = orders.filter((o) => `${o.code}${o.customer}${o.item}`.includes(q))
  return (
    <section>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-semibold">受注一覧</h1>
        <form className="ml-auto flex items-center gap-2" aria-label="検索" onSubmit={(e) => e.preventDefault()}>
          <label htmlFor="keyword" className="text-sm text-slate-600">キーワード</label>
          <input id="keyword" className="rounded border border-slate-300 px-2 py-1 text-sm" placeholder="受注番号・顧客名" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        <button data-in4o-key="orders.new" className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500" onClick={() => alert('新規作成（ダミー）')}>
          新規作成
        </button>
      </div>
      <table className="w-full overflow-hidden rounded-lg bg-white text-sm shadow">
        <thead className="bg-slate-100 text-left text-slate-600">
          <tr><th className="p-2">受注番号</th><th className="p-2">顧客</th><th className="p-2">品目</th><th className="p-2">状態</th><th className="p-2" /></tr>
        </thead>
        <tbody>
          {shown.map((o) => (
            <tr key={o.id} data-in4o-scope="order-row" className="border-t border-slate-100">
              <td className="p-2 font-mono">{o.code}</td>
              <td className="p-2">{o.customer}</td>
              <td className="p-2">{o.item}</td>
              <td className="p-2"><StatusBadge status={o.status} /></td>
              <td className="p-2 text-right">
                <a data-in4o-key="orders.edit" href={`#/orders/${o.id}`} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">編集</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function StatusBadge({ status }: { status: Order['status'] }) {
  const cls = { 受付: 'bg-sky-100 text-sky-800', 出荷済: 'bg-emerald-100 text-emerald-800', 保留: 'bg-amber-100 text-amber-800' }[status]
  return <span className={`rounded px-2 py-0.5 text-xs ${cls}`}>{status}</span>
}

function OrderForm({ order, onSave }: { order: Order; onSave(o: Order): void }) {
  const [o, setO] = useState(order)
  return (
    <form className="space-y-4 rounded-lg bg-white p-6 shadow" onSubmit={(e) => (e.preventDefault(), onSave(o))}>
      <h1 className="text-xl font-semibold">受注 {o.code} の編集</h1>
      <div className="grid grid-cols-2 gap-4">
        <label className="block text-sm">顧客<input className="mt-1 w-full rounded border border-slate-300 px-2 py-1" value={o.customer} onChange={(e) => setO({ ...o, customer: e.target.value })} /></label>
        <label className="block text-sm">品目<input className="mt-1 w-full rounded border border-slate-300 px-2 py-1" value={o.item} onChange={(e) => setO({ ...o, item: e.target.value })} /></label>
        <label className="block text-sm">
          ステータス
          <select className="mt-1 w-full rounded border border-slate-300 px-2 py-1" value={o.status} onChange={(e) => setO({ ...o, status: e.target.value as Order['status'] })}>
            <option>受付</option><option>出荷済</option><option>保留</option>
          </select>
        </label>
        {/* customer data that must never be copied into notes */}
        <label className="block text-sm" data-in4o-ignore>担当者メモ（社外秘）<input className="mt-1 w-full rounded border border-slate-300 px-2 py-1" defaultValue="与信確認済み" /></label>
      </div>
      <div className="flex justify-end gap-2">
        <a href="#/orders" className="rounded border border-slate-300 px-3 py-1.5 text-sm">キャンセル</a>
        <button data-in4o-key="order.save" className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white">保存</button>
      </div>
    </form>
  )
}

function Settings() {
  const [mail, setMail] = useState(true)
  return (
    <section className="space-y-4 rounded-lg bg-white p-6 shadow">
      <h1 className="text-xl font-semibold">設定</h1>
      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" checked={mail} onChange={(e) => setMail(e.target.checked)} /> 出荷時に通知メールを送る
      </label>
      <button className="rounded border border-slate-300 px-3 py-1.5 text-sm" onClick={() => alert('エクスポート（ダミー）')}>CSV エクスポート</button>
    </section>
  )
}
