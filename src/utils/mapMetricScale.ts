export interface MetricScaleReading {
  distanceMeters: number
  widthPx: number
  label: string
}

/** CRS.Simple 的 1 地图单位在 zoom=z 时占 2^z 个 CSS 像素，与屏幕 DPI 无关。 */
export function metricScaleReading(metersPerMapUnit: number | undefined, zoom: number, maxWidthPx = 120): MetricScaleReading | null {
  if (!Number.isFinite(metersPerMapUnit) || !metersPerMapUnit || metersPerMapUnit <= 0
    || !Number.isFinite(zoom) || !Number.isFinite(maxWidthPx) || maxWidthPx <= 0) return null
  const metersPerPixel = metersPerMapUnit / 2 ** zoom
  const maxMeters = metersPerPixel * maxWidthPx
  if (!Number.isFinite(maxMeters) || maxMeters <= 0) return null
  const magnitude = 10 ** Math.floor(Math.log10(maxMeters))
  const leading = maxMeters / magnitude
  const distanceMeters = (leading >= 5 ? 5 : leading >= 2 ? 2 : 1) * magnitude
  const value = Number((distanceMeters >= 1000 ? distanceMeters / 1000 : distanceMeters).toPrecision(10))
  return {
    distanceMeters,
    widthPx: distanceMeters / metersPerPixel,
    label: `${value} ${distanceMeters >= 1000 ? '千米' : '米'}`,
  }
}

