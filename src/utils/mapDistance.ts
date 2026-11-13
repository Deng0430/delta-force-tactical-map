/** 游戏地图平面距离；CRS.Simple 坐标不是地理经纬度。 */
export function horizontalMapDistance(
  from: readonly [number, number],
  to: readonly [number, number],
  metersPerMapUnit?: number,
): number | null {
  if (!Number.isFinite(metersPerMapUnit) || !metersPerMapUnit || metersPerMapUnit <= 0
    || ![...from, ...to].every(Number.isFinite)) return null
  return Math.hypot(to[0] - from[0], to[1] - from[1]) * metersPerMapUnit
}

export function formatMapDistance(meters: number): string {
  if (meters >= 1000) return `${Number((meters / 1000).toFixed(2))} 千米`
  return `${Number(meters.toFixed(meters < 10 ? 2 : 1))} 米`
}

/** 两点空间直线距离，不表示沿地形/道路的行走距离或无遮挡射线。 */
export function spatialMapDistance(horizontalMeters: number, fromHeight: number | null, toHeight: number | null): number | null {
  if (!Number.isFinite(horizontalMeters) || horizontalMeters < 0 || fromHeight === null || toHeight === null
    || !Number.isFinite(fromHeight) || !Number.isFinite(toHeight)) return null
  return Math.hypot(horizontalMeters, toHeight-fromHeight)
}
