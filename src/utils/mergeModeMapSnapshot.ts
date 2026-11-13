import type { ModeDeployVehicle, ModeMapOverride, ModeVehicleRefreshRule } from '../types'

type DataRecord = Record<string, unknown>
const isRecord = (value: unknown): value is DataRecord => value !== null && typeof value === 'object' && !Array.isArray(value)
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

function mergeRecord(current: DataRecord, previous: DataRecord, desired: DataRecord): DataRecord {
  const result = { ...current }
  for (const field of new Set([...Object.keys(previous), ...Object.keys(desired)])) {
    if (field === 'deployVehicles' && Array.isArray(current[field]) && Array.isArray(previous[field]) && Array.isArray(desired[field])) {
      result[field] = mergeItems(current[field] as ModeDeployVehicle[], previous[field] as ModeDeployVehicle[], desired[field] as ModeDeployVehicle[], (vehicle) => vehicle.icon)
    } else if (same(current[field], previous[field])) {
      if (field in desired) result[field] = structuredClone(desired[field])
      else delete result[field]
    } else if (isRecord(current[field]) && isRecord(previous[field]) && isRecord(desired[field])) {
      result[field] = mergeRecord(current[field], previous[field], desired[field])
    }
  }
  return result
}

function mergeItems<T extends object>(current: T[], previous: T[], desired: T[], key: (item: T) => string): T[] {
  const oldById = new Map(previous.map((item) => [key(item), item]))
  const newById = new Map(desired.map((item) => [key(item), item]))
  const result = current.flatMap((item) => {
    const old = oldById.get(key(item)), replacement = newById.get(key(item))
    if (!old) return [item]
    if (!replacement) return same(item, old) ? [] : [item]
    return [mergeRecord(item as DataRecord, old as DataRecord, replacement as DataRecord) as T]
  })
  for (const item of desired) {
    // Keep deletions of old defaults; add only genuinely new source actors.
    if (!oldById.has(key(item)) && !result.some((entry) => key(entry) === key(item))) result.push(structuredClone(item))
  }
  return result
}

/** Field-level three-way migration, called only after the caller has checked mode/platform/map. */
export function mergeModeMapSnapshot(
  current: ModeMapOverride, previous: ModeMapOverride, desired: ModeMapOverride,
  stageForRule: (rule: ModeVehicleRefreshRule) => string = (rule) => rule.objective,
): ModeMapOverride {
  const next = { ...current }
  next.stages = mergeItems(current.stages, previous.stages, desired.stages, (stage) => stage.id)
  const stageIds = new Set(next.stages.map((stage) => stage.id))
  const allowedRules = desired.vehicleRefreshRules.filter((rule) => stageIds.has(stageForRule(rule)))
  const allowedPointIds = new Set(allowedRules.map((rule) => rule.refreshPointUid))
  for (const field of ['zones', 'spawns', 'objectives', 'props', 'vehicleRefreshPoints', 'vehicleRefreshRules'] as const) {
    const permitted = field === 'vehicleRefreshRules' ? allowedRules
      : field === 'vehicleRefreshPoints' ? desired.vehicleRefreshPoints.filter((point) => allowedPointIds.has(point.uid))
      : desired[field].filter((item) => item.stageId === '*' || stageIds.has(item.stageId))
    const merged = mergeItems<{ uid: string }>(current[field], previous[field], permitted, (item) => item.uid)
    Object.assign(next, { [field]: merged })
  }
  next.spawns = next.spawns.map((spawn) => ({ ...spawn, vehicleDeploy: spawn.deployVehicles.length > 0,
    vehicleCategories: [...new Set(spawn.deployVehicles.map((vehicle) => vehicle.category))] }))
  const note = desired.notes.split('\n').at(-1)!
  if (!next.notes.split('\n').includes(note)) next.notes = [next.notes, note].filter(Boolean).join('\n')
  return same(next, current) ? current : { ...next, updatedAt: Date.now() }
}
