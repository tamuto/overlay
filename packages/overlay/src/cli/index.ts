import { parseArgs } from 'node:util'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  anchorAll,
  emptyOverlay,
  findingsToAnnotations,
  fingerprint,
  mergeOverlays,
  parseOverlay,
  quoteOf,
  toMarkdownReport,
  type OverlayFile,
} from '../core/index.ts'
import { createProvider, loadDocument, overlayPath, readOverlay, startServer, writeOverlay } from '../server/index.ts'

const HELP = `overlay – 元文書に手を入れずに添削を重ねるレビューツール (prototype)

使い方:
  overlay serve [dir]            dir 配下の Markdown/HTML をレビューする Web UI を起動
      --port 4141  --host 127.0.0.1  --data <dir>(既定 <dir>/.overlay)
      --ai codex|claude|openai[:model]|mock   AI 添削に使うプロバイダ
      --public                   外部公開向け（プライベートネットワークへの取得を禁止）
  overlay check <doc|url>        指摘が今の文書のどこを指すか検証（参照先消失があれば exit 1）
  overlay report <doc|url>       指摘一覧を Markdown で出力 (-o file)
  overlay review <doc|url> --ai codex   AI 添削を実行し下書き指摘として overlay ファイルに追記
      --instruction "観点"

共通: --root <dir>（既定: カレント）  --overlay <file>（overlay ファイルを直接指定）
`

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: 'string' },
    host: { type: 'string' },
    data: { type: 'string' },
    root: { type: 'string' },
    overlay: { type: 'string' },
    ai: { type: 'string' },
    instruction: { type: 'string' },
    public: { type: 'boolean' },
    output: { type: 'string', short: 'o' },
    help: { type: 'boolean', short: 'h' },
  },
})

const [cmd, target] = positionals
const here = path.dirname(fileURLToPath(import.meta.url))

async function load(docArg: string) {
  const isUrl = /^https?:\/\//.test(docArg)
  const root = path.resolve(values.root ?? '.')
  const doc = await loadDocument(root, isUrl ? { url: docArg } : { path: path.relative(root, path.resolve(docArg)) })
  const dataDir = path.resolve(values.data ?? path.join(root, '.overlay'))
  const file = values.overlay ? path.resolve(values.overlay) : overlayPath(dataDir, doc.ref)
  let overlay: OverlayFile | null = values.overlay
    ? parseOverlay(JSON.parse(await readFile(file, 'utf8').catch(() => 'null')) ?? emptyOverlay(doc.ref))
    : await readOverlay(dataDir, doc.ref)
  overlay ??= emptyOverlay(doc.ref)
  return { doc, overlay, file, dataDir }
}

async function save(file: string, dataDir: string, overlay: OverlayFile) {
  if (values.overlay) await writeFile(file, JSON.stringify(overlay, null, 2) + '\n')
  else await writeOverlay(dataDir, overlay)
}

const ICON = { exact: '✓', moved: '↪', fuzzy: '≈', orphaned: '✗' } as const

async function main() {
  if (values.help || !cmd) {
    console.log(HELP)
    return
  }
  switch (cmd) {
    case 'serve': {
      const root = path.resolve(target ?? values.root ?? '.')
      // dist/cli/index.js -> dist/web ; src/cli/index.ts (dev) -> dist/web
      const staticDir = [path.resolve(here, '../web'), path.resolve(here, '../../dist/web')].find((d) => existsSync(path.join(d, 'index.html')))
      const { url, dataDir } = startServer({
        root,
        dataDir: values.data,
        port: values.port ? Number(values.port) : undefined,
        host: values.host,
        ai: createProvider(values.ai),
        staticDir,
        publicMode: values.public,
      })
      console.log(`overlay: ${url}\n  documents: ${root}\n  overlays:  ${dataDir}\n  ai:        ${values.ai ?? 'none'}`)
      break
    }
    case 'check': {
      if (!target) throw new Error('document required')
      const { doc, overlay, file } = await load(target)
      const results = anchorAll(doc.text, overlay.annotations)
      const changed = overlay.document.fingerprint && overlay.document.fingerprint !== doc.ref.fingerprint
      console.log(`${doc.ref.source}\n  overlay: ${path.relative(process.cwd(), file)}${changed ? '\n  ⚠ 文書は指摘作成後に更新されています' : ''}`)
      for (const { annotation: a, anchor } of results) {
        const q = quoteOf(a.target)?.exact.slice(0, 40) ?? ''
        console.log(`  ${ICON[anchor.status]} ${anchor.status.padEnd(8)} ${a.status === 'resolved' ? '[解決済] ' : ''}「${q}」 ${a.text.split('\n')[0]!.slice(0, 50)}`)
      }
      const counts = Object.groupBy(results, (r) => r.anchor.status)
      console.log(`  合計 ${results.length}: ` + Object.entries(counts).map(([k, v]) => `${k}=${v!.length}`).join(' '))
      if (counts.orphaned?.some((r) => r.annotation.status === 'open')) process.exitCode = 1
      break
    }
    case 'report': {
      if (!target) throw new Error('document required')
      const { doc, overlay } = await load(target)
      const md = toMarkdownReport(overlay, doc.text)
      if (values.output) await writeFile(values.output, md)
      else console.log(md)
      break
    }
    case 'review': {
      if (!target) throw new Error('document required')
      const provider = createProvider(values.ai ?? 'codex')
      if (!provider) throw new Error('--ai is required')
      const { doc, overlay, file, dataDir } = await load(target)
      console.error(`AI 添削中… (${provider.description})`)
      const findings = await provider.review({ text: doc.readable, title: doc.ref.title, instruction: values.instruction })
      const { annotations, unlocated } = findingsToAnnotations(doc.text, fingerprint(doc.text), findings, {
        name: `AI (${provider.name})`,
        kind: 'ai',
        via: provider.name,
      })
      const merged = mergeOverlays({ ...overlay, document: { ...overlay.document, ...doc.ref } }, { ...overlay, annotations })
      await save(file, dataDir, merged)
      console.log(`${annotations.length} 件の下書き指摘を追加しました（位置特定できず ${unlocated.length} 件）→ ${path.relative(process.cwd(), file)}`)
      break
    }
    default:
      console.log(HELP)
      process.exitCode = 2
  }
}

main().catch((e) => {
  console.error(`error: ${(e as Error).message}`)
  process.exit(1)
})
