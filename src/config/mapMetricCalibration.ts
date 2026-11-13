import calibration from './mapMetricCalibration.json'
import { ASCENT_PC_S5_TILE_URL } from './stageBasemaps'

/** 标定绑定具体底图；换了未知底图或地图未标定时，不猜测米制系数。 */
export function metersPerMapUnitForBasemap(mapId: string, tileUrl: string): number | undefined {
  const record = calibration.maps[mapId as keyof typeof calibration.maps]
  const registeredEventRender = mapId === 'ascent' && tileUrl === ASCENT_PC_S5_TILE_URL
  if (!record || (record.tileUrl !== tileUrl && !registeredEventRender)) return undefined
  const x = record.worldExtentXYcm[0] * 2 / 100 / record.mapUnitsXY[0]
  const y = record.worldExtentXYcm[1] * 2 / 100 / record.mapUnitsXY[1]
  // 单一比例尺只适用于各方向比例相同的平面地图。
  if (!Number.isFinite(x) || x <= 0 || Math.abs(x - y) > 1e-9) return undefined
  return x
}
