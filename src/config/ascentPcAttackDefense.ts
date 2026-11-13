import type { ModeDeployVehicle, ModeMapOverride, Side, StageVehicle } from '../types'
import type { GameDataPlatform } from './gameDataPlatform'
import data from './ascentPcAttackDefenseData.json'

export const ASCENT_PC_ATTACK_DEFENSE_NOTE = '2026-11-13 PC攀升普通攻防：独立采用MapID54关卡、Template1部署和Template3兵力刷新；S5防守基地入口按用户实测停用。静态模板CD与运行时动态平衡分别记录。'

type Entity = { uid: string }
type RecordValue = Record<string, unknown>
const dataKey = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
const same = (a: unknown, b: unknown): boolean => dataKey(a) === dataKey(b)
const object = (value: unknown): value is RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value)
const sourceMap = (): ModeMapOverride => {
  const map = structuredClone(data.map) as unknown as ModeMapOverride
  const vehicle = (item: ModeDeployVehicle): ModeDeployVehicle => ({ ...item, legendKey: item.legendKey })
  map.spawns = map.spawns.map((spawn) => ({ ...spawn, deployVehicles: spawn.deployVehicles.map(vehicle) }))
  map.vehicleRefreshRules = map.vehicleRefreshRules.map((rule) => ({ ...rule, vehicle: vehicle(rule.vehicle) }))
  return map
}

/** Explicit reset/sync uses the recovered baseline, rather than merging an obsolete source. */
export function ascentPcAttackDefenseDefaults(): ModeMapOverride {
  return { ...sourceMap(),
    notes: `${data.map.notes}\n${ASCENT_PC_ATTACK_DEFENSE_NOTE}`, updatedAt: Date.now() }
}

/** Compatibility stage payload; conditional markers are rendered from the separate rules. */
export function ascentPcAttackDefenseStageVehicles(stageId: string, side: Side): StageVehicle[] {
  const result: StageVehicle[] = data.map.vehicleRefreshRules.filter((rule) => rule.side === side
    && stageId === `S${rule.clientSpawner.sectorIndices[0] + 1}`).map((rule) => {
    const point = data.map.vehicleRefreshPoints.find((candidate) => candidate.uid === rule.refreshPointUid)!
    const position: [number, number] = [point.lat, point.lng]
    return { name: rule.vehicle.name, badge: rule.vehicle.badge, category: rule.vehicle.category as StageVehicle['category'],
      icon: `q_${rule.vehicle.legendKey?.replace(/^nav_/, '') ?? rule.vehicle.icon}`,
      trigger: `进攻方剩余兵力阈值 ${rule.trigger.value}`, pos: position, posList: [position] }
  })
  if (stageId === 'S1' && side === 'attack') result.push(...structuredClone(data.legacyStageVehicles) as StageVehicle[])
  return result
}

/** Update untouched default fields while retaining edits from the user's existing save. */
function mergeRecord(current: RecordValue, previous: RecordValue, desired: RecordValue): RecordValue {
  const result = { ...current }
  for (const key of new Set([...Object.keys(previous), ...Object.keys(desired)])) {
    if (key === 'deployVehicles' && Array.isArray(current[key]) && Array.isArray(previous[key]) && Array.isArray(desired[key])) {
      result[key] = mergeVehicles(current[key] as ModeDeployVehicle[], previous[key] as ModeDeployVehicle[], desired[key] as ModeDeployVehicle[])
    } else if (same(current[key], previous[key])) {
      if (key in desired) result[key] = structuredClone(desired[key])
      else delete result[key]
    } else if (object(current[key]) && object(previous[key]) && object(desired[key])) {
      result[key] = mergeRecord(current[key], previous[key], desired[key])
    }
  }
  return result
}

function mergeVehicles(current: ModeDeployVehicle[], previous: ModeDeployVehicle[], desired: ModeDeployVehicle[]): ModeDeployVehicle[] {
  return mergeItems(current, previous, desired, (vehicle) => vehicle.icon)
}

function mergeItems<T extends object>(current: T[], previous: T[], desired: T[], key: (item: T) => string): T[] {
  const oldById = new Map(previous.map((item) => [key(item), item]))
  const newById = new Map(desired.map((item) => [key(item), item]))
  const result = current.flatMap((item) => {
    const old = oldById.get(key(item))
    const replacement = newById.get(key(item))
    if (!old) return [item]
    if (!replacement) return same(item, old) ? [] : [item]
    return [mergeRecord(item as RecordValue, old as RecordValue, replacement as RecordValue) as T]
  })
  for (const item of desired) {
    // A deleted existing default stays deleted; genuinely new resource actors are added.
    if (!oldById.has(key(item)) && !result.some((entry) => key(entry) === key(item))) result.push(structuredClone(item))
  }
  return result
}

/** Strictly PC ordinary attack/defense. Commander, mobile and custom modes are never touched. */
export function withAscentPcAttackDefense(current: ModeMapOverride, modeId: string, platform: GameDataPlatform): ModeMapOverride {
  if (modeId !== 'attack-defense' || platform !== 'pc' || current.mapId !== 'ascent') return current
  const previous = data.previousMap as unknown as ModeMapOverride
  const desired = sourceMap()
  const merge = <T extends Entity>(field: keyof Pick<ModeMapOverride, 'zones' | 'spawns' | 'objectives' | 'props' | 'vehicleRefreshPoints' | 'vehicleRefreshRules'>): T[] =>
    mergeItems(current[field] as unknown as T[], previous[field] as unknown as T[], desired[field] as unknown as T[], (item) => item.uid)
  const spawns = merge<ModeMapOverride['spawns'][number]>('spawns').map((spawn) => ({ ...spawn,
    vehicleDeploy: spawn.deployVehicles.length > 0,
    vehicleCategories: [...new Set(spawn.deployVehicles.map((vehicle) => vehicle.category))],
  }))
  const stages = mergeItems(current.stages, previous.stages, desired.stages, (stage) => stage.id)
  const notes = current.notes.split('\n').includes(ASCENT_PC_ATTACK_DEFENSE_NOTE) ? current.notes
    : [current.notes, ASCENT_PC_ATTACK_DEFENSE_NOTE].filter(Boolean).join('\n')
  const next: ModeMapOverride = { ...current, notes, stages, spawns,
    zones: merge('zones'), objectives: merge('objectives'), props: merge('props'),
    vehicleRefreshPoints: merge('vehicleRefreshPoints'), vehicleRefreshRules: merge('vehicleRefreshRules'),
  }
  return same(next, current) ? current : { ...next, updatedAt: Date.now() }
}
