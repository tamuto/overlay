import { useEffect, useMemo, useRef, useState } from 'react'
import {
  anchorAll,
  createAnnotation,
  fingerprint,
  findingsToAnnotations,
  parseOverlay,
  reanchor,
  toMarkdownReport,
  type AnnotationKind,
} from '@overlay/core'
import { aiReview, download, fetchInfo, listFiles, loadLocalFile, loadRemote, toParams, type LoadedDoc, type ServerInfo } from './api.ts'
import { DocumentFrame, type FrameSelection } from './DocumentFrame.tsx'
import { AnnotationCard, Composer, FILTERS, matchesFilter, type Filter } from './Sidebar.tsx'
import { colorFor, useOverlayStore } from './store.ts'

function useUserName() {
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem('overlay:user') || `reviewer-${Math.floor(Math.random() * 900 + 100)}`
    } catch {
      return 'reviewer'
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('overlay:user', name)
    } catch {
      /* ignore */
    }
  }, [name])
  return [name, setName] as const
}

/** Document selection is kept in the URL hash so links can be shared: #path=docs/a.md or #url=https://… */
function readHash(): { path?: string; url?: string } {
  const p = new URLSearchParams(location.hash.slice(1))
  return { path: p.get('path') ?? undefined, url: p.get('url') ?? undefined }
}

export function App() {
  const [info, setInfo] = useState<ServerInfo | null | undefined>(undefined)
  const [files, setFiles] = useState<string[]>([])
  const [doc, setDoc] = useState<LoadedDoc | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [userName, setUserName] = useUserName()
  const [docText, setDocText] = useState('')
  const [readableText, setReadableText] = useState('')
  const [selection, setSelection] = useState<FrameSelection | null>(null)
  const [composing, setComposing] = useState<{ start: number; end: number; quote: string; kind: AnnotationKind } | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [scrollRequest, setScrollRequest] = useState<{ id: string; n: number } | null>(null)
  const [filter, setFilter] = useState<Filter>('open')
  const [urlInput, setUrlInput] = useState('')
  const [aiState, setAiState] = useState<{ running: boolean; message?: string }>({ running: false })
  const [instruction, setInstruction] = useState('')
  const importRef = useRef<HTMLInputElement>(null)
  const openRef = useRef<HTMLInputElement>(null)

  const docKey = doc ? `${doc.ref.type}:${doc.ref.source}` : null
  const store = useOverlayStore(docKey, doc?.room ?? null, userName)
  const fp = useMemo(() => (docText ? fingerprint(docText) : ''), [docText])
  const anchored = useMemo(() => (docText ? anchorAll(docText, store.annotations) : []), [docText, store.annotations])
  const visible = anchored.filter((x) => matchesFilter(filter, x))
  const indexOf = useMemo(() => new Map(anchored.map((x, i) => [x.annotation.id, i + 1])), [anchored])
  const stale = anchored.filter((x) => x.annotation.target.fingerprint !== fp)
  const counts = Object.fromEntries(FILTERS.map((f) => [f.id, anchored.filter((x) => matchesFilter(f.id, x)).length]))

  useEffect(() => {
    fetchInfo().then(async (i) => {
      setInfo(i)
      if (!i) return
      setFiles(await listFiles())
      const h = readHash()
      if (h.path || h.url) void open(h)
    })
    // shared links / back-forward between documents
    const onHash = () => {
      const h = readHash()
      if (h.path || h.url) void open(h)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (doc && fp) store.setDocument({ ...doc.ref, fingerprint: fp })
  }, [doc, fp])

  async function open(input: { path?: string; url?: string }) {
    setLoading(true)
    setError(null)
    try {
      const d = await loadRemote(input)
      resetDoc(d)
      history.replaceState(null, '', `#${toParams(input)}`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  function resetDoc(d: LoadedDoc) {
    setDocText('')
    setSelection(null)
    setComposing(null)
    setActiveId(null)
    setDoc(d)
  }

  function focus(id: string, scroll = true) {
    setActiveId(id)
    if (scroll) setScrollRequest({ id, n: Date.now() })
  }

  function startCompose(kind: AnnotationKind) {
    if (!selection) return
    setComposing({ start: selection.start, end: selection.end, quote: selection.quote, kind })
    setSelection(null)
  }

  async function runAi() {
    if (!docText || !doc) return
    setAiState({ running: true, message: `${info?.ai?.description} で添削中…` })
    try {
      const { provider, findings } = await aiReview({ text: readableText || docText, title: doc.ref.title, instruction: instruction || undefined })
      const { annotations, unlocated } = findingsToAnnotations(docText, fp, findings, { name: `AI (${provider})`, kind: 'ai', via: provider })
      annotations.forEach((a) => store.upsert(a))
      setFilter('draft')
      setAiState({ running: false, message: `${annotations.length} 件の下書きを追加${unlocated.length ? `（位置特定できず ${unlocated.length} 件）` : ''}` })
    } catch (e) {
      setAiState({ running: false, message: `AI 添削に失敗: ${(e as Error).message}` })
    }
  }

  const exportName = doc ? `${doc.ref.source.replace(/^https?:\/\//, '').replace(/[^\w.-]+/g, '_')}.overlay.json` : 'overlay.json'

  return (
    <div className="flex h-full flex-col">
      {/* ── header ─────────────────────────────── */}
      <header className="flex flex-wrap items-center gap-2 border-b border-stone-200 bg-white px-4 py-2">
        <h1 className="mr-2 font-semibold tracking-tight">
          <span className="text-amber-500">◆</span> Overlay
        </h1>
        {info && (
          <select
            className="max-w-56 rounded-md border border-stone-300 bg-white px-2 py-1 text-sm"
            value={doc?.ref.type !== 'url' ? doc?.ref.source ?? '' : ''}
            onChange={(e) => e.target.value && open({ path: e.target.value })}
          >
            <option value="">{info.root}/ の文書を選択…</option>
            {files.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        )}
        {info && (
          <form
            className="flex min-w-60 flex-1 gap-1"
            onSubmit={(e) => {
              e.preventDefault()
              if (urlInput) void open({ url: urlInput })
            }}
          >
            <input className="min-w-0 flex-1 rounded-md border border-stone-300 px-2 py-1 text-sm" placeholder="https://… Web ページを開く" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} />
            <button className="btn-ghost" type="submit">開く</button>
          </form>
        )}
        <button className="btn-ghost" onClick={() => openRef.current?.click()} title="ローカルファイルをブラウザ内で開く（アップロードしない）">
          ファイル…
        </button>
        <input
          ref={openRef}
          type="file"
          accept=".md,.markdown,.html,.htm,.txt"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (f) resetDoc(await loadLocalFile(f))
            e.target.value = ''
          }}
        />
        <div className="ml-auto flex items-center gap-2">
          {store.realtime && (
            <span className={`flex items-center gap-1 text-xs ${store.connected ? 'text-emerald-700' : 'text-stone-400'}`}>
              <span className={`size-2 rounded-full ${store.connected ? 'bg-emerald-500' : 'bg-stone-300'}`} />
              {store.connected ? 'リアルタイム共有中' : '接続中…'}
            </span>
          )}
          <div className="flex -space-x-1">
            {store.peers.map((p) => (
              <span key={p.clientId} title={p.name} className="inline-flex size-6 items-center justify-center rounded-full border-2 border-white text-[11px] font-semibold text-white" style={{ background: p.color }}>
                {p.name.slice(0, 1).toUpperCase()}
              </span>
            ))}
          </div>
          <label className="flex items-center gap-1 text-xs text-stone-500">
            名前
            <input className="w-28 rounded-md border border-stone-300 px-2 py-1 text-sm" value={userName} onChange={(e) => setUserName(e.target.value)} style={{ borderLeft: `4px solid ${colorFor(userName)}` }} />
          </label>
        </div>
      </header>

      {error && <div className="bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</div>}
      {doc && stale.length > 0 && (
        <div className="border-b border-orange-200 bg-orange-50 px-4 py-1.5 text-sm text-orange-900">
          文書は指摘作成後に更新されています — {(['moved', 'fuzzy', 'orphaned'] as const).map((s) => {
            const n = stale.filter((x) => x.anchor.status === s).length
            return n ? <span key={s} className="mr-3">{{ moved: '位置移動', fuzzy: '本文変更あり', orphaned: '参照先消失' }[s]} {n}件</span> : null
          })}
          {stale.every((x) => x.anchor.status === 'exact') && '指摘箇所への影響はありません'}
          <button className="ml-2 underline" onClick={() => setFilter('attention')}>要確認を表示</button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* ── document ─────────────────────────── */}
        <main className="relative min-w-0 flex-1">
          {doc ? (
            <DocumentFrame
              html={doc.html}
              anchored={anchored}
              activeId={activeId}
              scrollRequest={scrollRequest}
              pending={composing}
              onText={(t, r) => {
                setDocText(t)
                setReadableText(r)
              }}
              onSelect={setSelection}
              onMarkClick={(id) => {
                focus(id, false)
                const a = anchored.find((x) => x.annotation.id === id)
                if (a && !matchesFilter(filter, a)) setFilter('all')
                document.getElementById(`card-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
              }}
              onNavigate={(url) => {
                if (info && confirm(`${url}\nをオーバーレイで開きますか？（キャンセルで新しいタブ）`)) void open({ url })
                else window.open(url, '_blank', 'noopener')
              }}
            />
          ) : (
            <Welcome info={info} loading={loading} />
          )}
          {selection && !composing && (
            <div
              className="fixed z-10 flex gap-1 rounded-lg bg-stone-900 p-1 shadow-lg"
              style={{ top: Math.max(8, selection.rect.top - 44), left: Math.max(8, (selection.rect.left + selection.rect.right) / 2 - 80) }}
            >
              <button className="rounded px-2 py-1 text-sm text-white hover:bg-stone-700" onMouseDown={(e) => e.preventDefault()} onClick={() => startCompose('comment')}>
                💬 コメント
              </button>
              <button className="rounded px-2 py-1 text-sm text-white hover:bg-stone-700" onMouseDown={(e) => e.preventDefault()} onClick={() => startCompose('suggestion')}>
                ✎ 修正提案
              </button>
            </div>
          )}
        </main>

        {/* ── sidebar ──────────────────────────── */}
        <aside className="flex w-[380px] shrink-0 flex-col border-l border-stone-200 bg-stone-50">
          <div className="space-y-2 border-b border-stone-200 p-3">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-sm font-semibold" title={doc?.ref.source}>{doc?.ref.title ?? '指摘'}</h2>
              <span className="ml-auto text-xs text-stone-500">{store.annotations.length} 件</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {FILTERS.map((f) => (
                <button key={f.id} onClick={() => setFilter(f.id)} className={`rounded-full px-2.5 py-0.5 text-xs ${filter === f.id ? 'bg-stone-800 text-white' : 'bg-white text-stone-600 ring-1 ring-stone-200'}`}>
                  {f.label} {counts[f.id] ? <span className="opacity-70">{counts[f.id]}</span> : null}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1 text-xs">
              <button className="btn-ghost text-xs" disabled={!doc} onClick={() => doc && download(exportName, JSON.stringify(store.exportOverlay({ ...doc.ref, fingerprint: fp }), null, 2) + '\n')}>
                書き出し
              </button>
              <button className="btn-ghost text-xs" disabled={!doc} onClick={() => importRef.current?.click()}>取り込み</button>
              <button className="btn-ghost text-xs" disabled={!doc} onClick={() => doc && download(exportName.replace(/\.json$/, '.md'), toMarkdownReport(store.exportOverlay(doc.ref), docText), 'text/markdown')}>
                レポート
              </button>
              <input
                ref={importRef}
                type="file"
                accept=".json"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (!f) return
                  try {
                    const o = parseOverlay(JSON.parse(await f.text()))
                    if (doc && o.document.source !== doc.ref.source && !confirm(`別の文書 (${o.document.source}) の指摘です。取り込みますか？`)) return
                    alert(`${store.importOverlay(o)} 件を取り込みました`)
                  } catch (err) {
                    alert((err as Error).message)
                  }
                }}
              />
            </div>
            {info?.ai && doc && (
              <div className="rounded-lg bg-violet-50 p-2">
                <div className="flex gap-1">
                  <input className="min-w-0 flex-1 rounded-md border border-violet-200 px-2 py-1 text-xs" placeholder="AI 添削の観点（任意）" value={instruction} onChange={(e) => setInstruction(e.target.value)} />
                  <button className="rounded-md bg-violet-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-50" disabled={aiState.running || !docText} onClick={runAi}>
                    {aiState.running ? '実行中…' : 'AI 添削'}
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-violet-700">{aiState.message ?? `${info.ai.description} — 結果は下書きとして追加されます`}</p>
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {composing && (
              <Composer
                quote={composing.quote}
                kind={composing.kind}
                onKind={(kind) => setComposing({ ...composing, kind })}
                onCancel={() => setComposing(null)}
                onSubmit={({ text, suggestion }) => {
                  const a = createAnnotation(docText, fp, composing, { kind: composing.kind, text, suggestion, author: { name: userName, kind: 'human' } })
                  store.upsert(a)
                  setComposing(null)
                  if (!matchesFilter(filter, { annotation: a, anchor: { status: 'exact', start: 0, end: 0, score: 1 } })) setFilter('open')
                  focus(a.id, false)
                }}
              />
            )}
            {doc && !composing && store.annotations.length === 0 && (
              <p className="rounded-lg border border-dashed border-stone-300 p-4 text-center text-sm text-stone-500">本文のテキストを選択して指摘を追加</p>
            )}
            {visible.map((item) => (
              <div id={`card-${item.annotation.id}`} key={item.annotation.id}>
                <AnnotationCard
                  index={indexOf.get(item.annotation.id)!}
                  item={item}
                  docText={docText}
                  active={activeId === item.annotation.id}
                  userName={userName}
                  canReanchor={!!selection}
                  onFocus={() => focus(item.annotation.id)}
                  onChange={(a) => store.upsert(a)}
                  onDelete={() => store.remove(item.annotation.id)}
                  onReanchor={() => {
                    if (!selection) return
                    store.upsert(reanchor(item.annotation, docText, fp, selection))
                    setSelection(null)
                  }}
                  onAcceptPosition={() => store.upsert(reanchor(item.annotation, docText, fp, item.anchor))}
                />
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  )
}

function Welcome({ info, loading }: { info: ServerInfo | null | undefined; loading: boolean }) {
  if (info === undefined || loading) return <div className="p-10 text-stone-400">読み込み中…</div>
  return (
    <div className="mx-auto max-w-xl p-10 text-stone-700">
      <h2 className="mb-3 text-xl font-semibold">元の文書に手を入れずに、添削を重ねる</h2>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {info ? (
          <>
            <li>上のメニューから <code>{info.root}/</code> 内の Markdown / HTML を選ぶ</li>
            <li>または Web ページの URL を入力（サーバ経由で取得し、スクリプトを除去して表示）</li>
            <li>指摘は <code>.overlay/</code> に保存され、同じ文書を開いている人とリアルタイムに共有されます</li>
          </>
        ) : (
          <>
            <li>サーバなし（スタンドアロン）モードです。「ファイル…」からローカルの Markdown / HTML を開けます</li>
            <li>指摘はこのブラウザに保存されます。共有は「書き出し」した <code>.overlay.json</code> を渡してください</li>
            <li>リアルタイム共有・URL 取得・AI 添削は <code>overlay serve</code> で起動したときに使えます</li>
          </>
        )}
      </ul>
    </div>
  )
}
