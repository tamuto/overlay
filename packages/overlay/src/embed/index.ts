/**
 * @infodb/overlay/embed – guides and notes on top of a running web app.
 *
 *   import { createOverlay, urlSource, localSource } from '@infodb/overlay/embed'
 *   createOverlay({
 *     app: 'my-app',
 *     layers: [
 *       { id: 'manual', label: 'マニュアル', kind: 'guide', source: urlSource('/help.overlay.json') },
 *       { id: 'memo', label: '自分のメモ', kind: 'note', editable: true, source: localSource('my-app') },
 *     ],
 *   })
 */
export { createOverlay, type LayerConfig, type OverlayController, type OverlayMode, type OverlayOptions } from './overlay.ts'
export { localSource, memorySource, urlSource, type LayerSource } from './sources.ts'
export { accessibleName, defaultRoute, describeElement, isStableId, pickTarget, resolveElement, roleOf, type ElementMatch, type LocateOptions } from './locate.ts'
export type { Annotation, ElementSelector, OverlayFile } from '../core/types.ts'
