import type { Map as LeafletMap } from 'leaflet'

export const DIAGNOSTIC_CHANNEL = 'map-tools.beginner-diagnostics'
interface DiagnosticContext {
  frameId: string; runId: number; mapId: string; mode: string; stage: string | null; view: string
  drawings: string; map: LeafletMap | null
}
let readContext: (() => DiagnosticContext) | undefined
const instances = new WeakMap<object, number>()
let nextInstance = 0
const documentId = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`

export function configureDemoDiagnostics(read?: () => DiagnosticContext) { readContext = read }

/** Observational only; never throw into the input/React/Leaflet pipeline. */
export function traceDemo(event: string, detail?: unknown) {
  if (!readContext) return
  try {
    const ctx = readContext(), map = ctx.map
    if (map && !instances.has(map)) instances.set(map, ++nextInstance)
    const saved = JSON.parse(ctx.drawings).features.map((feature: { properties?: Record<string, unknown>; geometry: unknown }) => ({
      uid: feature.properties?.uid, type: feature.properties?.type, geometry: feature.geometry,
    }))
    const layers: unknown[] = []
    map?.eachLayer(layer => {
      const source = layer as unknown as { feature?: { properties?: Record<string, unknown> }; getElement?: () => Element | undefined; toGeoJSON?: () => unknown }
      if (!source.feature?.properties?.type) return
      const el = source.getElement?.()
      if (el?.matches('.draw-hit-area, .draw-text-hit-wrap') || el?.hasAttribute('data-draw-hit-key')) return
      const rect = el?.getBoundingClientRect()
      layers.push({ uid: source.feature.properties.uid, type: source.feature.properties.type, connected: Boolean(el?.isConnected),
        geometry: source.toGeoJSON?.(), rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
        opacity: el ? getComputedStyle(el).opacity : null })
    })
    window.parent.postMessage({ channel: DIAGNOSTIC_CHANNEL, event, detail: typeof detail === 'function' ? detail() : detail, time: Date.now(), documentId,
      frameId: ctx.frameId, runId: ctx.runId, mapInstance: map ? instances.get(map) : null,
      context: { mapId: ctx.mapId, mode: ctx.mode, stage: ctx.stage, view: ctx.view },
      saved, layers, selectionBoxes: document.querySelectorAll('.edit-selection-box').length,
      center: map?.getCenter(), zoom: map?.getZoom(),
    }, window.location.origin)
  } catch { /* Diagnostics must not affect the observed operation. */ }
}
