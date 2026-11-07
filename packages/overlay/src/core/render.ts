import { marked } from 'marked'

/** Minimal readable stylesheet for rendered Markdown (inside the sandboxed iframe). */
export const MARKDOWN_CSS = `
body{margin:0;background:#fff;color:#1f2328;font:16px/1.75 system-ui,-apple-system,"Segoe UI","Hiragino Sans","Noto Sans JP",sans-serif}
.markdown-body{max-width:820px;margin:0 auto;padding:40px 32px 120px}
h1,h2,h3,h4{line-height:1.3;margin:1.6em 0 .6em}h1{font-size:2em;border-bottom:1px solid #d1d9e0;padding-bottom:.3em}
h2{font-size:1.5em;border-bottom:1px solid #d1d9e0;padding-bottom:.3em}
code{background:#f2f4f7;border-radius:4px;padding:.15em .35em;font-size:.9em}
pre{background:#f6f8fa;padding:14px 16px;border-radius:8px;overflow:auto}pre code{background:none;padding:0}
blockquote{margin:0;padding:0 1em;color:#59636e;border-left:4px solid #d1d9e0}
table{border-collapse:collapse}td,th{border:1px solid #d1d9e0;padding:6px 12px}
img{max-width:100%}a{color:#0969da}
`

export function renderMarkdownBody(markdown: string): string {
  return marked.parse(markdown, { gfm: true, async: false }) as string
}

/** Wrap rendered Markdown in a standalone HTML document. */
export function markdownDocument(markdown: string, title = ''): string {
  const esc = title.replace(/[<&>"]/g, (c) => `&#${c.charCodeAt(0)};`)
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc}</title><style>${MARKDOWN_CSS}</style></head><body><article class="markdown-body">${renderMarkdownBody(markdown)}</article></body></html>`
}
