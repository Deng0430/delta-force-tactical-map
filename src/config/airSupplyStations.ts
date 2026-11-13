import type { AirSupplyInfo, MapProp, ModeMapOverride, ModeMapProp } from '../types'

interface PcAirSupplyStation {
  id: string
  lat: number
  lng: number
  worldZcm: number
  legacyPosition?: readonly [number, number]
  legacyIndex?: number
}

/** PC 1.101.37119.18.19：BP_VehicleSupplyStation_Air 的世界位置。
 * 来源 map-audits-20261112/pc/{ascent,stormeye}/pc-source-vs-current-2d.json。
 * 天际港来源 air-vehicle-service-audit/pc-air-service-locations.json；XY 使用
 * mapMetricCalibration.json 中经独立据点验证的 Dday/Skyline P0 投影。
 * 攀升仅取 Iceland 基础地图两点，排除 Iceland_HVTAirCombat 的两个专用点。
 * XY 已按原生 MapInfo 投影；Z 直接由厘米换算为米，不作海拔/离地推算。
 */
export const PC_AIR_SUPPLY_STATIONS: Readonly<Record<string, readonly PcAirSupplyStation[]>> = {
  ascent: [
    { id: 'iceland_air_2', lat: -95.43898, lng: 68.71296, worldZcm: -16327.0986328125, legacyPosition: [-95.439, 68.713], legacyIndex: 33 },
    { id: 'iceland_air2', lat: -132.82802, lng: 185.18218, worldZcm: 29269.876953125, legacyPosition: [-132.831, 185.208], legacyIndex: 37 },
  ],
  stormeye: [
    { id: 'naval_air_0', lat: -113.96177381820064, lng: 203.30760091768053, worldZcm: 13027.435546875 },
    { id: 'naval_air_2', lat: -113.96177381820064, lng: 27.243598619449408, worldZcm: 13027.435546875 },
  ],
  skyport: [
    { id: 'skyline_air2_5', lat: -71.7376, lng: 77.9776, worldZcm: 13830 },
    { id: 'skyline_air_2', lat: -112.672, lng: 181.8688, worldZcm: 7270 },
  ],
}

const stationInfo = (station: PcAirSupplyStation): AirSupplyInfo => ({ elevationMeters: station.worldZcm / 100, reference: 'pc-world-z' })
const samePosition = (prop: { lat: number; lng: number }, position: readonly [number, number]) => Math.abs(prop.lat - position[0]) < 0.000001 && Math.abs(prop.lng - position[1]) < 0.000001
const isSupply = (prop: { name: string; icon: string }) => prop.icon === 'q_zjbjz' && ['载具补给站', '空中载具补给站'].includes(prop.name)

/** 攻防原始道具入口；不改动移动端独立数据。 */
export function withPcAirSupplyProps(mapId: string, props: MapProp[]): MapProp[] {
  const stations = PC_AIR_SUPPLY_STATIONS[mapId]
  if (!stations) return props
  const result = props.map((prop) => {
    const station = stations.find((s) => isSupply(prop) && samePosition(prop, s.legacyPosition ?? [s.lat, s.lng]))
    return station ? { ...prop, name: '空中载具补给站', airSupply: stationInfo(station) } : prop
  })
  for (const station of stations) {
    if (station.legacyPosition || result.some((p) => isSupply(p) && samePosition(p, [station.lat, station.lng]))) continue
    result.push({ name: '空中载具补给站', icon: 'q_zjbjz', lat: station.lat, lng: station.lng, stage: '', airSupply: stationInfo(station) })
  }
  return result
}

/** 默认 PC 模式与一次性迁移共用；保留既有 UID/位置/阶段，不复活已删除的攀升旧点。 */
export function withPcAirSupplyStations(current: ModeMapOverride): ModeMapOverride {
  const stations = PC_AIR_SUPPLY_STATIONS[current.mapId]
  if (!stations) return current
  const props = current.props.map((prop) => {
    const station = stations.find((s) => isSupply(prop) && (
      (s.legacyIndex !== undefined && [`sync_${current.mapId}_prop-${s.legacyIndex}`, `builtin_wta_${current.mapId}_prop-${s.legacyIndex}`].includes(prop.uid))
      || samePosition(prop, s.legacyPosition ?? [s.lat, s.lng])))
    return station ? { ...prop, name: '空中载具补给站', airSupply: stationInfo(station) } : prop
  })
  for (const station of stations) {
    if (station.legacyPosition || props.some((p) => p.uid === `pc_air_supply_${current.mapId}_${station.id}` || (isSupply(p) && samePosition(p, [station.lat, station.lng])))) continue
    const prop: ModeMapProp = { uid: `pc_air_supply_${current.mapId}_${station.id}`, stageId: '*', name: '空中载具补给站', icon: 'q_zjbjz', lat: station.lat, lng: station.lng, airSupply: stationInfo(station), verification: 'confirmed' }
    props.push(prop)
  }
  return JSON.stringify(props) === JSON.stringify(current.props) ? current : { ...current, props, updatedAt: Date.now() }
}
