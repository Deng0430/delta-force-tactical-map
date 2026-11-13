import type { GameDataPlatform } from './gameDataPlatform'
import type { ModeMapOverride, Side, StageConfig, StageVehicle } from '../types'
import snapshot from './trenchPcCommanderData.json'
import { mergeModeMapSnapshot } from '../utils/mergeModeMapSnapshot'

const source = snapshot.maps.trench
const desired = source.map as unknown as ModeMapOverride
const previous = source.previousMap as unknown as ModeMapOverride
const stages = source.official.stages as unknown as StageConfig[]
const ruleStages = new Map(source.evidence.refresh.map((rule) => [rule.ruleUid, rule.stageId]))
export const TRENCH_PC_COMMANDER_NOTE = desired.notes.split('\n').at(-1)!
const semanticKey = (value: unknown) => JSON.stringify(value, (key, item) => key === 'updatedAt' ? undefined
  : item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)

/** Independent MapID605 defaults; do not share objects with ordinary AD or mobile. */
export function trenchPcCommanderDefaults(): ModeMapOverride {
  const copy = structuredClone(desired)
  return { ...copy, updatedAt: Date.now(),
    zones: copy.zones.map((zone) => ({ ...zone, objectiveUid: zone.objectiveUid })),
    spawns: copy.spawns.map((spawn) => ({ ...spawn, deployVehicles: spawn.deployVehicles.map((vehicle) => ({ ...vehicle, legendKey: vehicle.legendKey })) })),
  }
}

export function trenchPcCommanderStageVehicles(stageId: string, side: Side): StageVehicle[] {
  const stage = stages.find((stage) => stage.id === stageId)
  return structuredClone((side === 'attack' ? stage?.attackVehicles : stage?.defenseVehicles) ?? [])
}

/** v72: update untouched source fields once; preserve custom entities, deletion and moved/shared refresh points. */
export function withTrenchPcCommanderData(current: ModeMapOverride, modeId: string, platform: GameDataPlatform): ModeMapOverride {
  if (modeId !== 'winner-takes-all' || platform !== 'pc' || current.mapId !== 'trench') return current
  const next = mergeModeMapSnapshot(current, previous, desired, (rule) => ruleStages.get(rule.uid) ?? rule.objective)
  if (next === current) return current
  const moved = new Set(current.vehicleRefreshPoints.filter((point) => {
    const old = previous.vehicleRefreshPoints.find((old) => old.uid === point.uid)
    return old && (point.lat !== old.lat || point.lng !== old.lng)
  }).map((point) => point.uid))
  const vehicleRefreshRules = next.vehicleRefreshRules.map((rule) => {
    const existing = current.vehicleRefreshRules.find((old) => old.uid === rule.uid)
    const old = previous.vehicleRefreshRules.find((old) => old.uid === rule.uid)
    return existing && old && existing.refreshPointUid === old.refreshPointUid && moved.has(existing.refreshPointUid)
      ? { ...rule, refreshPointUid: existing.refreshPointUid } : rule
  })
  const referenced = new Set(vehicleRefreshRules.map((rule) => rule.refreshPointUid))
  const existingIds = new Set(current.vehicleRefreshPoints.map((point) => point.uid))
  const result = { ...next, vehicleRefreshRules, vehicleRefreshPoints: next.vehicleRefreshPoints
    .filter((point) => existingIds.has(point.uid) || referenced.has(point.uid))
    .map((point) => moved.has(point.uid) ? structuredClone(current.vehicleRefreshPoints.find((old) => old.uid === point.uid)!) : point) }
  return semanticKey(result) === semanticKey(current) ? current : result
}
