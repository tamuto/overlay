/** Provider-agnostic pieces of AI review (prompt + output schema). */

export const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['quote', 'comment', 'suggestion', 'severity'],
        properties: {
          quote: { type: 'string', description: 'Verbatim excerpt copied from the document (short, unique).' },
          comment: { type: 'string', description: 'Why this should change.' },
          suggestion: { type: ['string', 'null'], description: 'Replacement text for the quote, or null.' },
          severity: { type: 'string', enum: ['info', 'minor', 'major'] },
        },
      },
    },
  },
} as const

export interface ReviewRequest {
  /** Normalized plain text of the document (what annotations anchor to). */
  text: string
  title?: string
  /** Free-form reviewer instruction, e.g. "技術文書として誤字脱字と曖昧な表現を指摘" */
  instruction?: string
  language?: string
}

export function buildReviewPrompt(req: ReviewRequest): string {
  return [
    'あなたはドキュメントのレビュアーです。以下のドキュメントを添削してください。',
    req.instruction ? `レビュー観点: ${req.instruction}` : 'レビュー観点: 誤字脱字、文法、分かりにくい表現、事実関係の疑わしい箇所、構成上の問題。',
    `コメントは${req.language ?? '日本語'}で書いてください。`,
    '',
    '出力ルール:',
    '- JSON のみを出力する: {"findings":[{"quote":..., "comment":..., "suggestion":..., "severity":...}]}',
    '- quote はドキュメントから一字一句そのままコピーした短い抜粋（指摘対象を一意に特定できる長さ、最大120文字）',
    '- quote には Markdown の装飾記号（#, **, `, - など）や HTML タグを含めず、表示される本文テキストだけを使う',
    '- suggestion は quote を置き換える修正案。置き換え案がない場合は null',
    '- severity は info / minor / major',
    '- ファイルの読み書きやコマンド実行は不要。ドキュメントはこのプロンプト内にある',
    '',
    `<document title="${(req.title ?? '').replace(/"/g, "'")}">`,
    req.text,
    '</document>',
  ].join('\n')
}

/** Extract the findings JSON even when the model wraps it in prose / code fences. */
export function parseFindings(output: string): { findings: import('./overlay.ts').AiFinding[] } {
  const trimmed = output.trim()
  const candidates = [trimmed, trimmed.replace(/^```(?:json)?\s*|\s*```$/g, '')]
  const brace = trimmed.indexOf('{')
  const last = trimmed.lastIndexOf('}')
  if (brace >= 0 && last > brace) candidates.push(trimmed.slice(brace, last + 1))
  for (const c of candidates) {
    try {
      const v = JSON.parse(c)
      if (Array.isArray(v?.findings)) return v
      if (Array.isArray(v)) return { findings: v }
    } catch {
      /* try next */
    }
  }
  throw new Error('AI output did not contain findings JSON')
}
