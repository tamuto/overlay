/** Styles of the embed UI. Lives inside a Shadow DOM, so it never leaks into the app (and vice versa). */
export const EMBED_CSS = `
:host{
  --in4o-accent:#f59e0b; --in4o-guide:#2563eb; --in4o-warn:#ea580c; --in4o-ink:#1c1917; --in4o-muted:#78716c;
  --in4o-surface:#ffffff; --in4o-line:#e7e5e4; --in4o-radius:12px;
  position:fixed; inset:0; pointer-events:none; z-index:2147483000;
  font:14px/1.6 system-ui,-apple-system,"Segoe UI","Hiragino Sans","Noto Sans JP",sans-serif; color:var(--in4o-ink);
}
*{box-sizing:border-box}
button{font:inherit;cursor:pointer}
.pin{position:fixed;pointer-events:auto;display:flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:2px solid #fff;border-radius:50%;
  background:var(--in4o-accent);color:#fff;font:700 12px/1 system-ui,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.35);transition:transform .12s}
.pin:hover,.pin.active{transform:scale(1.2)}
.pin.guide{background:var(--in4o-guide)}
.pin.fuzzy{outline:2px dashed var(--in4o-warn);outline-offset:1px}
.pin svg{width:12px;height:12px}
.outline{position:fixed;pointer-events:none;border:2px solid var(--in4o-accent);border-radius:6px;background:rgba(245,158,11,.08);transition:all .08s}
.outline.guide{border-color:var(--in4o-guide);background:rgba(37,99,235,.06)}
.outline.blocked{border-color:#a8a29e;border-style:dashed;background:rgba(120,113,108,.08)}
.outline.spot{box-shadow:0 0 0 9999px rgba(15,23,42,.5);background:transparent;border-color:#fff}
.outline .label{position:absolute;left:-2px;bottom:100%;margin-bottom:4px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  padding:1px 8px;border-radius:6px;background:var(--in4o-ink);color:#fff;font-size:12px}
.bubble{position:fixed;left:0;top:0;pointer-events:auto;width:max-content;max-width:min(340px,calc(100vw - 16px));padding:12px 14px;border-radius:var(--in4o-radius);
  background:var(--in4o-surface);box-shadow:0 10px 30px rgba(0,0,0,.18),0 0 0 1px rgba(0,0,0,.06)}
.bubble.guide{border-top:3px solid var(--in4o-guide)}
.bubble.note{border-top:3px solid var(--in4o-accent)}
.arrow{position:absolute;width:10px;height:10px;background:var(--in4o-surface);transform:rotate(45deg)}
.bubble h3{margin:0 18px 4px 0;font-size:15px}
.bubble .body{white-space:pre-wrap;word-break:break-word}
.bubble .meta{margin-top:8px;font-size:12px;color:var(--in4o-muted)}
.bubble .warn{margin-top:8px;padding:6px 8px;border-radius:8px;background:#fff7ed;color:#9a3412;font-size:12px}
.bubble .close{position:absolute;top:6px;right:6px;width:24px;height:24px;border:0;border-radius:6px;background:transparent;color:var(--in4o-muted);font-size:16px;line-height:1}
.bubble .close:hover{background:#f5f5f4}
.row{display:flex;gap:6px;align-items:center;margin-top:10px}
.row .grow{flex:1}
.btn{padding:4px 10px;border:1px solid var(--in4o-line);border-radius:8px;background:#fff;color:var(--in4o-ink);font-size:13px}
.btn:hover{background:#f5f5f4}
.btn.primary{border-color:var(--in4o-ink);background:var(--in4o-ink);color:#fff}
.btn.primary:hover{opacity:.85}
.btn.danger{color:#be123c}
.btn:disabled{opacity:.4;cursor:default}
textarea,input[type=text],input[type=number],select{width:100%;padding:6px 8px;border:1px solid #d6d3d1;border-radius:8px;font:inherit;color:inherit;background:#fff}
textarea{min-height:84px;resize:vertical}
label.field{display:block;margin-top:8px;font-size:12px;color:var(--in4o-muted)}
.launcher{position:fixed;right:20px;bottom:20px;pointer-events:auto;width:48px;height:48px;border:0;border-radius:50%;background:var(--in4o-ink);color:#fff;
  box-shadow:0 6px 20px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center}
.launcher svg{width:22px;height:22px}
.launcher .count{position:absolute;top:-2px;right:-2px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--in4o-accent);font:700 11px/18px system-ui,sans-serif}
.panel{position:fixed;right:20px;bottom:78px;pointer-events:auto;width:min(330px,calc(100vw - 40px));max-height:70vh;overflow:auto;padding:14px;border-radius:16px;
  background:var(--in4o-surface);box-shadow:0 12px 40px rgba(0,0,0,.2),0 0 0 1px rgba(0,0,0,.06)}
.panel h2{margin:0 0 8px;font-size:15px}
.panel h4{margin:12px 0 4px;font-size:12px;color:var(--in4o-muted);font-weight:600}
.layer{display:flex;align-items:center;gap:8px;padding:4px 0}
.layer .dot{width:10px;height:10px;border-radius:50%}
.layer .n{margin-left:auto;font-size:12px;color:var(--in4o-muted)}
.missing{padding:6px 8px;margin-top:4px;border-radius:8px;background:#fafaf9;font-size:13px}
.missing .row{margin-top:4px}
.banner{position:fixed;top:12px;left:50%;transform:translateX(-50%);pointer-events:auto;padding:6px 14px;border-radius:999px;background:var(--in4o-ink);color:#fff;font-size:13px;box-shadow:0 4px 14px rgba(0,0,0,.25)}
.banner button{margin-left:8px;border:0;background:transparent;color:#fcd34d;text-decoration:underline}
.toast{position:fixed;bottom:84px;left:50%;transform:translateX(-50%);padding:6px 14px;border-radius:8px;background:var(--in4o-ink);color:#fff;font-size:13px}
.hidden{display:none!important}
`

export const ICON = {
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  launcher: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/></svg>',
}
