import type { GameDataPlatform } from './gameDataPlatform'
import type { ModeMapOverride, Side, StageConfig, StageVehicle } from '../types'
import snapshot from './emberPcCommanderData.json'
import { mergeModeMapSnapshot } from '../utils/mergeModeMapSnapshot'

const source = snapshot.maps.ember
const desired = source.map as unknown as ModeMapOverride
const previous = source.previousMap as unknown as ModeMapOverride
const stages = source.official.stages as unknown as StageConfig[]
const ruleStages = new Map(source.evidence.refresh.map((rule) => [rule.ruleUid, rule.stageId]))

/** Fresh PC commander defaults use this independent frozen snapshot, never ordinary AD or mobile. */
export function emberPcCommanderDefaults(): ModeMapOverride {
  const copy = structuredClone(desired)
  // Match the existing normalizer's optional-key shape from the first load onward.
  return { ...copy, updatedAt: Date.now(),
    zones: copy.zones.map((zone) => ({ ...zone, objectiveUid: zone.objectiveUid })),
    spawns: copy.spawns.map((spawn) => ({ ...spawn, deployVehicles: spawn.deployVehicles.map((vehicle) => ({ ...vehicle, legendKey: vehicle.legendKey })) })),
  }
}

export function emberPcCommanderStageVehicles(stageId: string, side: Side): StageVehicle[] {
  const stage = stages.find((stage) => stage.id === stageId)
  return structuredClone((side === 'attack' ? stage?.attackVehicles : stage?.defenseVehicles) ?? [])
}

/** v71 repairs only the seven markers omitted by the v69 snapshot, once. */
export function withEmberPcCommanderRetainedProps(current: ModeMapOverride, modeId: string, platform: GameDataPlatform): ModeMapOverride {
  if (modeId !== 'winner-takes-all' || platform !== 'pc' || current.mapId !== 'ember') return current
  const retainedIds = new Set(source.evidence.retainedOfficialProps.map((prop) => prop.uid))
  const missing = desired.props.filter((prop) => retainedIds.has(prop.uid) && !current.props.some((existing) =>
    existing.uid === prop.uid || (existing.icon === prop.icon && existing.stageId === prop.stageId
      && Math.hypot(existing.lat - prop.lat, existing.lng - prop.lng) < 1 / 4.6875)))
  return missing.length ? { ...current, props: [...current.props, ...structuredClone(missing)], updatedAt: Date.now() } : current
}

/** v69 updates only untouched source fields; a moved/shared custom refresh point remains user-owned. */
export function withEmberPcCommanderData(current: ModeMapOverride, modeId: string, platform: GameDataPlatform): ModeMapOverride {
  if (modeId !== 'winner-takes-all' || platform !== 'pc' || current.mapId !== 'ember') return current
  const next = mergeModeMapSnapshot(current, previous, desired, (rule) => ruleStages.get(rule.uid) ?? rule.objective)
  if (next === current) return current
  const movedPoints = new Set(current.vehicleRefreshPoints.filter((point) => {
    const old = previous.vehicleRefreshPoints.find((old) => old.uid === point.uid)
    return old && (point.lat !== old.lat || point.lng !== old.lng)
  }).map((point) => point.uid))
  const vehicleRefreshRules = next.vehicleRefreshRules.map((rule) => {
    const existing = current.vehicleRefreshRules.find((old) => old.uid === rule.uid)
    const oldDefault = previous.vehicleRefreshRules.find((old) => old.uid === rule.uid)
    if (!existing || !oldDefault || existing.refreshPointUid !== oldDefault.refreshPointUid
      || !movedPoints.has(existing.refreshPointUid)) return rule
    return { ...rule, refreshPointUid: existing.refreshPointUid }
  })
  const referenced = new Set(vehicleRefreshRules.map((rule) => rule.refreshPointUid))
  const oldPointIds = new Set(current.vehicleRefreshPoints.map((point) => point.uid))
  return { ...next, vehicleRefreshRules, vehicleRefreshPoints: next.vehicleRefreshPoints
    .filter((point) => oldPointIds.has(point.uid) || referenced.has(point.uid))
    .map((point) => movedPoints.has(point.uid) ? structuredClone(current.vehicleRefreshPoints.find((old) => old.uid === point.uid)!) : point) }
}
