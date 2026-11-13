import type { MapProp, ModeMapOverride, ModeMapProp } from '../types'
import data from './ascentPcZiplines.json'
import { normalizeZiplineEndpoint } from '../utils/mapZiplines'

/** Preserve the original prop order so unrelated stock marker UIDs remain stable. */
export function ascentPcZiplineProps(current: MapProp[]): MapProp[] {
  const props = current.map((prop) => {
    if (prop.name !== '滑索' || prop.icon !== 'q_hs') return prop
    const old = data.legacyByMode['attack-defense'].find((p) => Math.abs(prop.lat - p.lat) < .000001 && Math.abs(prop.lng - p.lng) < .000001)
    const template = old && data.props.find((p) => p.uid === old.endpointUid)
    return template ? { ...prop, lat: template.lat, lng: template.lng, zipline: normalizeZiplineEndpoint(template.zipline)! } : prop
  })
  const pairs = new Set(props.filter((prop) => prop.zipline).map((prop) => `${prop.zipline!.lineId}:${prop.zipline!.endpoint}`))
  for (const template of data.props) {
    if (pairs.has(`${template.zipline.lineId}:${template.zipline.endpoint}`)) continue
    props.push({ name: template.name, icon: template.icon, lat: template.lat, lng: template.lng, stage: '', zipline: normalizeZiplineEndpoint(template.zipline)! })
  }
  return props
}

/** Keep original lower-marker identities and edits; add the newly recovered endpoints. */
export function withAscentPcZiplines(current: ModeMapOverride, mode: 'attack-defense' | 'winner-takes-all'): ModeMapOverride {
  if (current.mapId !== 'ascent') return current
  const templates = new Map(data.props.map((prop) => [prop.uid, prop]))
  const legacy = new Map(data.legacyByMode[mode].map((prop) => [prop.uid, prop]))
  const props = current.props.map((prop) => {
    if (prop.zipline || prop.name !== '滑索' || prop.icon !== 'q_hs' || prop.stageId !== '*') return prop
    const old = legacy.get(prop.uid)
    const target = templates.get(old?.endpointUid ?? prop.uid)
    if (!target) return prop
    const untouched = old && Math.abs(prop.lat - old.lat) < .000001 && Math.abs(prop.lng - old.lng) < .000001
    return { ...prop, ...(untouched ? { lat: target.lat, lng: target.lng } : {}), zipline: normalizeZiplineEndpoint(target.zipline)! }
  })
  const pairs = new Set(props.filter((prop) => prop.zipline).map((prop) => `${prop.zipline!.lineId}:${prop.zipline!.endpoint}`))
  const legacyEndpoints = new Set([...legacy.values()].map((prop) => prop.endpointUid))
  for (const template of data.props) {
    const key = `${template.zipline.lineId}:${template.zipline.endpoint}`
    if (pairs.has(key) || legacyEndpoints.has(template.uid)) continue
    const prop: ModeMapProp = { uid: template.uid, stageId: '*', name: template.name, icon: template.icon,
      lat: template.lat, lng: template.lng, verification: 'confirmed', zipline: normalizeZiplineEndpoint(template.zipline)! }
    props.push(prop)
    pairs.add(key)
  }
  if (JSON.stringify(props) === JSON.stringify(current.props)) return current
  return { ...current, props, updatedAt: Date.now() }
}
