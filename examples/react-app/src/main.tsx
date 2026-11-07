import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createOverlay, localSource, urlSource, type LayerConfig } from '@infodb/overlay/embed'
import './index.css'
import { App } from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

/*
 * Overlay layers
 *  - manual: guide bubbles written by the system side, shipped as a static file (read-only for users)
 *  - memo:   each user's own notes, kept in this browser
 *  - ?author: system side authoring mode – write guides on the real screens, then
 *             "書き出し" and replace public/help.overlay.json with the exported file.
 */
const authoring = new URLSearchParams(location.search).has('author')
const layers: LayerConfig[] = [
  { id: 'manual', label: 'マニュアル', kind: 'guide', source: urlSource('/help.overlay.json') },
  { id: 'memo', label: '自分のメモ', kind: 'note', editable: true, source: localSource('react-app-example:memo') },
]
if (authoring) layers.unshift({ id: 'guide-draft', label: 'ガイド（編集中）', kind: 'guide', editable: true, source: localSource('react-app-example:guide-draft') })

const overlay = createOverlay({ app: 'react-app-example', layers, user: { name: authoring ? 'system' : 'user' } })

// exposed for trying things from the devtools console
Object.assign(window, { overlay })
