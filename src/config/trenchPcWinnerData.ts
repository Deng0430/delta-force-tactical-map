import type { ModeMapOverride, ModeZone } from '../types'
import snapshot from './trenchPcWinnerData.json'
import { TRENCH_PC_COMMANDER_NOTE } from './trenchPcCommanderData'

export const TRENCH_PC_WINNER_DATA_NOTE = '2026-11-11 PC 胜者堑壕战同步 MapID=605 的关卡基线区域、占领区、据点中心和载具生成位置。'

const stageById = new Map(snapshot.stages.map((stage) => [stage.id, stage]))
const copyPoints = (points: number[][]): [number, number][] => points.map(([lat, lng]) => [lat, lng])

/** PC 胜者的内置初始化与一次性迁移共用 MapID 605 提取快照。 */
export function withTrenchPcWinnerData(current: ModeMapOverride, builtin = current): ModeMapOverride {
  if (current.mapId !== 'trench') return current
  // Historical v47 geometry must not downgrade a map already carrying the newer v72 baseline.
  if (current.notes.split('\n').includes(TRENCH_PC_COMMANDER_NOTE)) return current
  const sourceObjectives = new Map(builtin.objectives.map((objective) => [objective.uid,
    stageById.get(objective.stageId)?.objectives.find((source) => source.name === objective.name)]))
  const captureSources = new Map(builtin.objectives.map((objective) => [objective.captureZoneUid, sourceObjectives.get(objective.uid)]))
  const zones = [...current.zones]
  const usedZoneUids = new Set(zones.map((zone) => zone.uid))
  const captureUids = new Map<string, string>()
  for (const template of builtin.zones) {
    const stage = stageById.get(template.stageId)
    if (!stage) continue
    let points: number[][] | undefined
    if (template.role === 'frontline') points = stage.frontline
    if (template.role === 'attack-base') points = stage.attackBaseZone
    if (template.role === 'defense-base') points = stage.defenseBaseZone
    if (template.role === 'capture') points = captureSources.get(template.uid)?.captureArea
    if (!points) continue
    let index = zones.findIndex((zone) => zone.uid === template.uid
      && zone.stageId === template.stageId && zone.role === template.role)
    if (index < 0) {
      index = zones.findIndex((zone) => zone.uid.startsWith(`${template.uid}_pc605_`)
        && zone.stageId === template.stageId && zone.role === template.role)
    }
    let uid = index >= 0 ? zones[index].uid : template.uid
    for (let suffix = 1; index < 0 && usedZoneUids.has(uid); suffix++) {
      uid = `${template.uid}_pc605_${suffix}`
    }
    const replacement: ModeZone = {
      ...(index >= 0 ? zones[index] : template), uid,
      points: copyPoints(points), verification: 'confirmed',
    }
    if (index >= 0) zones[index] = replacement
    else zones.push(replacement)
    usedZoneUids.add(uid)
    captureUids.set(template.uid, uid)
  }
  const builtinObjectives = new Map(builtin.objectives.map((objective) => [objective.uid, objective]))
  const objectives = current.objectives.map((objective) => {
    const source = sourceObjectives.get(objective.uid)
    const template = builtinObjectives.get(objective.uid)
    if (!source || !template || objective.stageId !== template.stageId) return objective
    return {
      ...objective, lat: source.lat, lng: source.lng,
      captureZoneUid: captureUids.get(template.captureZoneUid) ?? objective.captureZoneUid,
      verification: 'confirmed' as const,
    }
  })
  const pointSources = new Map(snapshot.refreshPoints.map((point) => [point.uid, point]))
  const vehicleRefreshPoints = current.vehicleRefreshPoints.map((point) => {
    const source = pointSources.get(point.uid)
    return source ? { ...point, lat: source.lat, lng: source.lng, verification: 'confirmed' as const } : point
  })
  const usedPointUids = new Set(vehicleRefreshPoints.map((point) => point.uid))
  for (const source of snapshot.refreshPoints) {
    if (usedPointUids.has(source.uid)) continue
    vehicleRefreshPoints.push({ uid: source.uid, name: source.name,
      lat: source.lat, lng: source.lng, verification: 'confirmed' })
  }
  const rulePoints = new Map(snapshot.refreshRulePoints.map((rule) => [rule.uid, rule]))
  const vehicleRefreshRules = current.vehicleRefreshRules.map((rule) => {
    const source = rulePoints.get(rule.uid)
    if (!source || rule.objective !== source.objective || rule.vehicle.icon !== source.icon
        || rule.trigger.type !== 'tickets' || rule.trigger.value !== source.triggerValue) return rule
    return { ...rule, refreshPointUid: source.refreshPointUid }
  })
  const notes = current.notes.split('\n').includes(TRENCH_PC_WINNER_DATA_NOTE)
    ? current.notes : [current.notes, TRENCH_PC_WINNER_DATA_NOTE].filter(Boolean).join('\n')
  const next = { ...current, zones, objectives, vehicleRefreshPoints, vehicleRefreshRules, notes }
  const unchanged = notes === current.notes && (['zones', 'objectives', 'vehicleRefreshPoints', 'vehicleRefreshRules'] as const)
    .every((key) => JSON.stringify(next[key]) === JSON.stringify(current[key]))
  return unchanged ? current : { ...next, updatedAt: Date.now() }
}
