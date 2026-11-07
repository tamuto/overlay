/**
 * AI reviewers.
 *
 * The AI never writes to the document or to the overlay directly: it returns
 * "findings" ({quote, comment, suggestion}) which are located in the text and
 * added as *draft* annotations that a human accepts or discards.
 *
 *  codex   – local `codex exec` (OpenAI Codex CLI). Uses the user's
 *            "Sign in with ChatGPT" session, so it is billed to the ChatGPT
 *            plan instead of per-token API usage. Local use only.
 *  claude  – local `claude -p` (Claude Code), same idea with a Claude plan.
 *  openai  – OpenAI Responses API with OPENAI_API_KEY (for hosted/service use).
 *  mock    – rule based, offline, free. For demos and tests.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildReviewPrompt, FINDINGS_SCHEMA, parseFindings, type AiFinding, type ReviewRequest } from '@overlay/core'

export interface AiProvider {
  name: string
  /** Shown in the UI so users know where the text is sent. */
  description: string
  review(req: ReviewRequest, signal?: AbortSignal): Promise<AiFinding[]>
}

const MAX_CHARS = 60_000

function clip(req: ReviewRequest): ReviewRequest {
  return req.text.length > MAX_CHARS ? { ...req, text: req.text.slice(0, MAX_CHARS) } : req
}

function run(cmd: string, args: string[], input: string, opts: { cwd: string; signal?: AbortSignal; timeoutMs?: number }) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ['pipe', 'pipe', 'pipe'], signal: opts.signal })
    let out = ''
    let err = ''
    const timer = setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs ?? 300_000)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`${cmd} を起動できません: ${e.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error(`${cmd} exited with ${code}: ${err.slice(-2000)}`))
    })
    child.stdin.end(input)
  })
}

export const codexProvider = (model?: string): AiProvider => ({
  name: 'codex',
  description: 'Codex CLI（Sign in with ChatGPT / ローカル実行・プラン内）',
  async review(req, signal) {
    // run in an empty temp dir with a read-only sandbox: the agent gets nothing to touch
    const dir = await mkdtemp(path.join(tmpdir(), 'overlay-codex-'))
    try {
      const schema = path.join(dir, 'schema.json')
      const outFile = path.join(dir, 'out.json')
      await writeFile(schema, JSON.stringify(FINDINGS_SCHEMA))
      const args = ['exec', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only', '--color', 'never',
        '--output-schema', schema, '-o', outFile, '-C', dir]
      if (model) args.push('-m', model)
      args.push('-')
      await run('codex', args, buildReviewPrompt(clip(req)), { cwd: dir, signal })
      return parseFindings(await readFile(outFile, 'utf8')).findings
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
})

export const claudeProvider = (model?: string): AiProvider => ({
  name: 'claude',
  description: 'Claude Code CLI（ローカル実行・プラン内）',
  async review(req, signal) {
    const dir = await mkdtemp(path.join(tmpdir(), 'overlay-claude-'))
    try {
      const args = ['-p', '--output-format', 'json', '--tools', '', '--json-schema', JSON.stringify(FINDINGS_SCHEMA)]
      if (model) args.push('--model', model)
      const out = await run('claude', args, buildReviewPrompt(clip(req)), { cwd: dir, signal })
      const envelope = JSON.parse(out) as { result?: string; structured_output?: unknown; is_error?: boolean }
      if (envelope.is_error) throw new Error(`claude: ${envelope.result}`)
      if (envelope.structured_output) return parseFindings(JSON.stringify(envelope.structured_output)).findings
      return parseFindings(envelope.result ?? '').findings
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
})

export const openaiProvider = (model = process.env.OVERLAY_OPENAI_MODEL ?? 'gpt-5-mini'): AiProvider => ({
  name: 'openai',
  description: `OpenAI API (${model}) – 従量課金`,
  async review(req, signal) {
    const key = process.env.OPENAI_API_KEY
    if (!key) throw new Error('OPENAI_API_KEY is not set')
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal,
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        input: buildReviewPrompt(clip(req)),
        text: { format: { type: 'json_schema', name: 'findings', strict: true, schema: FINDINGS_SCHEMA } },
      }),
    })
    if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${(await res.text()).slice(0, 500)}`)
    const data = (await res.json()) as { output_text?: string; output?: { content?: { type: string; text?: string }[] }[] }
    const text = data.output_text ?? data.output?.flatMap((o) => o.content ?? []).find((c) => c.type === 'output_text')?.text ?? ''
    return parseFindings(text).findings
  },
})

/** Offline rule-based reviewer – handy for trying the UI without any account. */
export const mockProvider = (): AiProvider => ({
  name: 'mock',
  description: 'ルールベースのダミー（オフライン・無料）',
  async review(req) {
    const rules: { re: RegExp; comment: string; fix?: (m: string) => string; severity: AiFinding['severity'] }[] = [
      { re: /することができ(る|ます)/g, comment: '冗長な表現です。「できる」で十分です。', fix: (m) => m.replace('することができ', 'でき'), severity: 'minor' },
      { re: /(ので、|ため、)[^。\n]{0,40}(ので、|ため、)/g, comment: '理由の接続が連続していて読みにくくなっています。', severity: 'minor' },
      { re: /\b(TODO|FIXME|TBD)\b/g, comment: '未記入の箇所が残っています。', severity: 'major' },
      { re: /([^。\n]{120,}?。)/g, comment: '一文が長すぎます（120文字以上）。分割を検討してください。', severity: 'info' },
      { re: /(\S)\1{2,}/g, comment: '同じ文字が連続しています。誤入力ではありませんか？', severity: 'minor' },
    ]
    const findings: AiFinding[] = []
    for (const r of rules) {
      for (const m of req.text.matchAll(r.re)) {
        const quote = m[0].length > 120 ? m[0].slice(0, 120) : m[0]
        findings.push({ quote, comment: r.comment, suggestion: r.fix ? r.fix(m[0]) : null, severity: r.severity })
        if (findings.length > 20) return findings
      }
    }
    return findings
  },
})

export function createProvider(spec: string | undefined): AiProvider | undefined {
  if (!spec || spec === 'none') return undefined
  const [name, model] = spec.split(':', 2)
  switch (name) {
    case 'codex': return codexProvider(model)
    case 'claude': return claudeProvider(model)
    case 'openai': return openaiProvider(model)
    case 'mock': return mockProvider()
    default: throw new Error(`unknown AI provider: ${spec} (codex | claude | openai[:model] | mock | none)`)
  }
}
