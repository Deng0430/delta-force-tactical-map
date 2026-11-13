import type { ModeMapOverride, ModeVehicleRefreshPoint, ModeVehicleRefreshRule } from '../types'
import snapshot from './ascentPcRefreshData.json'
import { DEPLOY_VEHICLE_CATALOG } from './deployVehicles'

type Rule = Pick<ModeVehicleRefreshRule, 'uid' | 'objective' | 'side' | 'action' | 'trigger' | 'vehicle'>
const matches = (rule: Rule, source: { ruleUid?: string; objective: string; side: string; icon: string; trigger: { type: string; value: number | string } }) =>
  (!source.ruleUid || rule.uid === source.ruleUid) && rule.objective === source.objective && rule.side === source.side
  && rule.action === 'refresh' && rule.vehicle.icon === source.icon
  && rule.trigger.type === source.trigger.type && rule.trigger.value === source.trigger.value

/** v62：迁移仍存在的 PC 胜者攀升刷新规则；保留用户位置和规则编辑。 */
export function withAscentPcRefreshCoordinates(current: ModeMapOverride): ModeMapOverride {
  if (current.mapId !== 'ascent') return current
  const originalPoints = new Map(current.vehicleRefreshPoints.map((point) => [point.uid, point]))
  const points = [...current.vehicleRefreshPoints]
  let rules = [...current.vehicleRefreshRules]
  let changed = false
  const addPoint = (source: { uid: string; name: string; lat: number; lng: number }): string => {
    let uid = source.uid
    for (let i = 1; points.some((p) => p.uid === uid); i++) uid = `${source.uid}_${i}`
    points.push({ ...source, uid, verification: 'confirmed' })
    changed = true
    return uid
  }
  for (const source of snapshot.updates) {
    const index = rules.findIndex((r) => matches(r, source))
    if (index < 0) continue
    const rule = rules[index]
    const original = originalPoints.get(rule.refreshPointUid)
    if (!original || original.uid !== source.legacyPoint.uid
      || original.lat !== source.legacyPoint.lat || original.lng !== source.legacyPoint.lng) continue
    if (source.point.uid !== source.legacyPoint.uid) {
      const uid = addPoint(source.point)
      rules[index] = { ...rule, refreshPointUid: uid }
    } else {
      const pointIndex = points.findIndex((p) => p.uid === original.uid)
      if (pointIndex >= 0) {
        points[pointIndex] = { ...points[pointIndex], lat: source.point.lat, lng: source.point.lng }
        changed = true
      }
    }
  }
  const newRule = snapshot.newRule
  const alreadyPresent = rules.some((r) => matches(r, { objective: newRule.objective, side: newRule.side,
    icon: newRule.vehicle.icon, trigger: newRule.trigger }))
  if (!alreadyPresent && current.stages.some((stage) => stage.id === 'S4')) {
    const pointUid = addPoint(snapshot.newPoint)
    let uid = newRule.uid
    for (let i = 1; rules.some((r) => r.uid === uid); i++) uid = `${newRule.uid}_${i}`
    const catalog = DEPLOY_VEHICLE_CATALOG.find((vehicle) => vehicle.icon === newRule.vehicle.icon)
    rules.push({ ...structuredClone(newRule), uid, side: 'attack', action: 'refresh',
      vehicle: { ...structuredClone(newRule.vehicle), category: 'recon', deployCount: 1,
        iconUrl: catalog?.iconUrl ?? newRule.vehicle.iconUrl },
      trigger: { type: 'tickets', value: 100 }, refreshPointUid: pointUid, verification: 'confirmed' })
    changed = true
  }
  return changed ? { ...current, vehicleRefreshPoints: points as ModeVehicleRefreshPoint[],
    vehicleRefreshRules: rules, updatedAt: Date.now() } : current
}
