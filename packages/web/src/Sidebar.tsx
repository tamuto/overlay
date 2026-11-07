import { useState } from 'react'
import { newId, quoteOf, type AnchorStatus, type Anchored, type Annotation, type AnnotationKind } from '@overlay/core'
import { colorFor } from './store.ts'

const ANCHOR_BADGE: Record<AnchorStatus, { label: string; cls: string; hint: string }> = {
  exact: { label: '一致', cls: 'bg-emerald-100 text-emerald-800', hint: '指摘時と同じ位置・同じ文面' },
  moved: { label: '位置移動', cls: 'bg-sky-100 text-sky-800', hint: '文面は同じだが周辺が編集され位置が変わった' },
  fuzzy: { label: '本文変更あり', cls: 'bg-orange-100 text-orange-800', hint: '指摘箇所の文面自体が変更されている。内容を再確認してください' },
  orphaned: { label: '参照先消失', cls: 'bg-rose-100 text-rose-800', hint: '指摘箇所が見つからない。削除されたか大きく書き換えられた可能性' },
}

export type Filter = 'all' | 'open' | 'attention' | 'draft' | 'resolved'
export const FILTERS: { id: Filter; label: string }[] = [
  { id: 'open', label: '未解決' },
  { id: 'attention', label: '要確認' },
  { id: 'draft', label: 'AI下書き' },
  { id: 'resolved', label: '解決済' },
  { id: 'all', label: 'すべて' },
]

export function matchesFilter(f: Filter, { annotation: a, anchor }: Anchored): boolean {
  switch (f) {
    case 'all': return true
    case 'open': return a.status === 'open' && !a.draft
    case 'attention': return anchor.status === 'fuzzy' || anchor.status === 'orphaned'
    case 'draft': return !!a.draft
    case 'resolved': return a.status === 'resolved'
  }
}

function Avatar({ name, ai }: { name: string; ai?: boolean }) {
  return (
    <span
      className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white ${ai ? 'bg-violet-600' : ''}`}
      style={ai ? undefined : { background: colorFor(name) }}
      title={name}
    >
      {ai ? 'AI' : name.slice(0, 1).toUpperCase()}
    </span>
  )
}

const time = (iso: string) => new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export function SuggestionDiff({ from, to }: { from: string; to: string }) {
  return (
    <div className="rounded-md border border-stone-200 bg-stone-50 p-2 text-[13px] leading-relaxed">
      <del className="bg-rose-100 text-rose-900 decoration-rose-400">{from}</del>
      <span className="mx-1 text-stone-400">→</span>
      <ins className="bg-emerald-100 text-emerald-900 no-underline">{to || '（削除）'}</ins>
    </div>
  )
}

interface CardProps {
  index: number
  item: Anchored
  docText: string
  active: boolean
  userName: string
  canReanchor: boolean
  onFocus(): void
  onChange(a: Annotation): void
  onDelete(): void
  onReanchor(): void
  onAcceptPosition(): void
}

export function AnnotationCard({ index, item, docText, active, userName, canReanchor, onFocus, onChange, onDelete, onReanchor, onAcceptPosition }: CardProps) {
  const { annotation: a, anchor } = item
  const [reply, setReply] = useState('')
  const [editing, setEditing] = useState(false)
  const [draftText, setDraftText] = useState(a.text)
  const [draftSuggestion, setDraftSuggestion] = useState(a.suggestion ?? '')
  const q = quoteOf(a.target)
  const original = q?.exact ?? ''
  const current = anchor.status === 'orphaned' ? '' : docText.slice(anchor.start, anchor.end)
  const badge = ANCHOR_BADGE[anchor.status]

  return (
    <article
      onClick={onFocus}
      className={`group rounded-xl border bg-white p-3 shadow-sm transition ${active ? 'border-amber-400 ring-2 ring-amber-200' : 'border-stone-200 hover:border-stone-300'} ${a.status === 'resolved' ? 'opacity-70' : ''} ${a.draft ? 'border-dashed border-violet-300' : ''}`}
    >
      <header className="mb-2 flex items-center gap-2 text-xs">
        <span className="font-mono text-stone-400">#{index}</span>
        <Avatar name={a.author.name} ai={a.author.kind === 'ai'} />
        <span className="truncate font-medium text-stone-700">{a.author.name}</span>
        <span className="text-stone-400">{time(a.createdAt)}</span>
        <span className="ml-auto flex gap-1">
          {a.severity && a.severity !== 'info' && (
            <span className={`rounded px-1.5 py-0.5 ${a.severity === 'major' ? 'bg-rose-600 text-white' : 'bg-stone-200 text-stone-700'}`}>{a.severity}</span>
          )}
          <span className={`rounded px-1.5 py-0.5 ${badge.cls}`} title={badge.hint}>{badge.label}</span>
        </span>
      </header>

      <blockquote className="mb-2 line-clamp-3 border-l-4 border-stone-300 pl-2 text-[13px] text-stone-600">
        {anchor.status === 'fuzzy' ? current : original}
      </blockquote>
      {anchor.status === 'fuzzy' && (
        <p className="mb-2 text-[12px] text-orange-700">
          指摘時の文面: <span className="line-through">{original}</span>
        </p>
      )}

      {editing ? (
        <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
          <textarea className="w-full rounded-md border border-stone-300 p-2 text-sm" rows={3} value={draftText} onChange={(e) => setDraftText(e.target.value)} />
          {a.kind === 'suggestion' && (
            <textarea className="w-full rounded-md border border-sky-300 p-2 text-sm" rows={2} value={draftSuggestion} onChange={(e) => setDraftSuggestion(e.target.value)} />
          )}
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setEditing(false)}>取消</button>
            <button
              className="btn-primary"
              onClick={() => {
                onChange({ ...a, text: draftText, suggestion: a.kind === 'suggestion' ? draftSuggestion : undefined })
                setEditing(false)
              }}
            >
              保存
            </button>
          </div>
        </div>
      ) : (
        <>
          {a.kind === 'suggestion' && a.suggestion !== undefined && <SuggestionDiff from={anchor.status === 'fuzzy' ? current : original} to={a.suggestion} />}
          {a.text && <p className="mt-2 whitespace-pre-wrap text-sm text-stone-800">{a.text}</p>}
        </>
      )}

      {a.replies.length > 0 && (
        <ul className="mt-3 space-y-2 border-t border-stone-100 pt-2">
          {a.replies.map((r) => (
            <li key={r.id} className="flex gap-2 text-sm">
              <Avatar name={r.author.name} ai={r.author.kind === 'ai'} />
              <div>
                <span className="text-xs font-medium text-stone-600">{r.author.name}</span>
                <span className="ml-2 text-xs text-stone-400">{time(r.createdAt)}</span>
                <p className="whitespace-pre-wrap text-stone-800">{r.text}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className={`mt-3 space-y-2 ${active ? '' : 'hidden group-hover:block'}`} onClick={(e) => e.stopPropagation()}>
        {a.draft ? (
          <div className="flex gap-2">
            <button className="btn-primary flex-1" onClick={() => onChange({ ...a, draft: false })}>採用する</button>
            <button className="btn-ghost flex-1" onClick={onDelete}>破棄</button>
          </div>
        ) : (
          <>
            {(anchor.status === 'fuzzy' || anchor.status === 'orphaned') && (
              <div className="flex gap-2 rounded-md bg-orange-50 p-2 text-xs">
                {anchor.status === 'fuzzy' && (
                  <button className="btn-ghost" onClick={onAcceptPosition} title="現在の文面を新しい指摘箇所として確定">この位置で確定</button>
                )}
                <button className="btn-ghost" disabled={!canReanchor} onClick={onReanchor} title="本文を選択してから押す">
                  選択範囲に付け替え
                </button>
              </div>
            )}
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (!reply.trim()) return
                onChange({ ...a, replies: [...a.replies, { id: newId(), author: { name: userName, kind: 'human' }, text: reply.trim(), createdAt: new Date().toISOString() }] })
                setReply('')
              }}
            >
              <input className="min-w-0 flex-1 rounded-md border border-stone-300 px-2 py-1 text-sm" placeholder="返信…" value={reply} onChange={(e) => setReply(e.target.value)} />
              <button className="btn-ghost" type="submit">送信</button>
            </form>
            <div className="flex gap-2 text-xs">
              <button className="btn-ghost" onClick={() => onChange({ ...a, status: a.status === 'open' ? 'resolved' : 'open' })}>
                {a.status === 'open' ? '解決にする' : '再開'}
              </button>
              <button className="btn-ghost" onClick={() => setEditing(true)}>編集</button>
              <button className="btn-ghost ml-auto text-rose-700" onClick={() => confirm('この指摘を削除しますか？') && onDelete()}>削除</button>
            </div>
          </>
        )}
      </div>
    </article>
  )
}

interface ComposerProps {
  quote: string
  kind: AnnotationKind
  onKind(k: AnnotationKind): void
  onSubmit(v: { text: string; suggestion?: string }): void
  onCancel(): void
}

export function Composer({ quote, kind, onKind, onSubmit, onCancel }: ComposerProps) {
  const [text, setText] = useState('')
  const [suggestion, setSuggestion] = useState(quote)
  return (
    <form
      className="rounded-xl border-2 border-emerald-400 bg-white p-3 shadow-md"
      onSubmit={(e) => {
        e.preventDefault()
        if (!text.trim() && (kind === 'comment' || suggestion === quote)) return
        onSubmit({ text: text.trim(), suggestion: kind === 'suggestion' ? suggestion : undefined })
      }}
    >
      <div className="mb-2 flex gap-1 text-xs">
        {(['comment', 'suggestion'] as const).map((k) => (
          <button type="button" key={k} onClick={() => onKind(k)} className={`rounded-full px-3 py-1 ${kind === k ? 'bg-stone-800 text-white' : 'bg-stone-100 text-stone-600'}`}>
            {k === 'comment' ? 'コメント' : '修正提案'}
          </button>
        ))}
      </div>
      <blockquote className="mb-2 line-clamp-3 border-l-4 border-emerald-300 pl-2 text-[13px] text-stone-600">{quote}</blockquote>
      {kind === 'suggestion' && (
        <label className="mb-2 block text-xs text-stone-500">
          置き換え後の文面
          <textarea className="mt-1 w-full rounded-md border border-sky-300 p-2 text-sm text-stone-900" rows={3} value={suggestion} onChange={(e) => setSuggestion(e.target.value)} />
        </label>
      )}
      <textarea
        autoFocus
        className="w-full rounded-md border border-stone-300 p-2 text-sm"
        rows={3}
        placeholder={kind === 'comment' ? '指摘内容' : '理由（任意）'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit()
        }}
      />
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onCancel}>取消</button>
        <button type="submit" className="btn-primary">追加 <kbd className="ml-1 text-[10px] opacity-70">⌘↵</kbd></button>
      </div>
    </form>
  )
}
