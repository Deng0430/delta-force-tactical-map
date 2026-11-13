import calibration from './mapMetricCalibration.json'

const SURFACE_MANIFESTS = {
  trench: '/maps/trench-surfaces-v4/manifest.json',
  ember: '/maps/ember-surfaces-v1/manifest.json',
  ascent: '/maps/ascent-surfaces-v3/manifest.json',
  flashpoint: '/maps/flashpoint-surfaces-v3/manifest.json',
  stormeye: '/maps/stormeye-surfaces-v3/manifest.json',
  skyport: '/maps/skyport-surfaces-v1/manifest.json',
} as const

type SurfaceMapId = keyof typeof SURFACE_MANIFESTS

interface SurfaceCalibration {
  tileUrl: string
  surfaceReferenceTileUrl: string
  worldExtentXYcm: readonly number[]
  mapUnitsXY: readonly number[]
  surfaceSampleWindowGrid?: { left: number; top: number; right: number; bottom: number }
}

interface SurfaceModelRegistration {
  mapId: SurfaceMapId
  tileUrl: string
  referenceTileUrl: string
  columns: number
  rows: number
  metersPerMapUnit: number
  mapBounds: { west: number; east: number; north: number; south: number }
  sourceNote?: string
}

const PC_REFERENCE_NOTE = 'PC原始静态模型参考高度；未独立核验手游几何。'
const calibratedMaps = calibration.maps as Partial<Record<SurfaceMapId, SurfaceCalibration>>

/** 从已标定的真实米宽高推导1米格网；最后一格可不足1米。 */
function surfaceRegistration(mapId: SurfaceMapId): SurfaceModelRegistration | undefined {
  const record = calibratedMaps[mapId]
  if (!record || record.mapUnitsXY[0] !== 256 || record.mapUnitsXY[1] !== 256) return undefined
  const widthMeters = record.worldExtentXYcm[0] * 2 / 100
  const heightMeters = record.worldExtentXYcm[1] * 2 / 100
  const metersPerMapUnit = widthMeters / record.mapUnitsXY[0]
  if (!Number.isFinite(widthMeters) || !Number.isFinite(heightMeters) || widthMeters <= 0 || heightMeters <= 0
    || metersPerMapUnit !== heightMeters / record.mapUnitsXY[1]) return undefined
  // Existing packs retain their independent, fixed 1200m calibration guard.
  if ((mapId === 'trench' || mapId === 'ember') && (widthMeters !== 1200 || heightMeters !== 1200)) return undefined
  const fullColumns = Math.ceil(widthMeters)
  const fullRows = Math.ceil(heightMeters)
  const window = record.surfaceSampleWindowGrid ?? { left: 0, top: 0, right: fullColumns, bottom: fullRows }
  if (![window.left, window.top, window.right, window.bottom].every(Number.isSafeInteger)
    || window.left < 0 || window.top < 0 || window.right > fullColumns || window.bottom > fullRows
    || window.left >= window.right || window.top >= window.bottom) return undefined
  return {
    mapId, tileUrl: record.tileUrl, referenceTileUrl: record.surfaceReferenceTileUrl,
    columns: window.right-window.left, rows: window.bottom-window.top, metersPerMapUnit,
    mapBounds: { west: window.left/metersPerMapUnit, east: Math.min(widthMeters, window.right)/metersPerMapUnit,
      north: -window.top/metersPerMapUnit, south: -Math.min(heightMeters, window.bottom)/metersPerMapUnit },
    ...(mapId === 'trench' || mapId === 'ember' ? {} : {
      sourceNote: PC_REFERENCE_NOTE + (mapId === 'skyport' ? ' 仅覆盖原生地形有效范围，边缘保留水平测距。' : ''),
    }),
  }
}

/** 高度参考不共享模式/部署数据；新三图PC模型未独立核验手游几何。 */
export function surfaceModelManifestForBasemap(mapId: string, tileUrl: string): string | undefined {
  if (!Object.hasOwn(SURFACE_MANIFESTS, mapId)) return undefined
  const id = mapId as SurfaceMapId
  if (tileUrl !== surfaceRegistration(id)?.tileUrl) return undefined
  return SURFACE_MANIFESTS[id]
}

/** 压缩前后的已标定底图共用格网；只接受当前 URL 和明确登记的高度参考 URL。 */
export function surfaceModelForManifest(manifestUrl: string): SurfaceModelRegistration | undefined {
  for (const mapId of Object.keys(SURFACE_MANIFESTS) as SurfaceMapId[]) {
    if (manifestUrl === SURFACE_MANIFESTS[mapId]) return surfaceRegistration(mapId)
  }
  return undefined
}
