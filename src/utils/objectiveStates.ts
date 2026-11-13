import type { CapturePoint, TacticalObjectiveState } from '../types'

/** 阶段是据点身份的一部分；同名 C2 在 S3/S4 中分别存储。 */
export function objectiveStateKey(stageId: string, name: string): string {
  return JSON.stringify([stageId, name])
}

export function parseObjectiveStateKey(key: string): [string, string] | null {
  try {
    const value: unknown = JSON.parse(key)
    return Array.isArray(value) && value.length === 2 && value.every((item) => typeof item === 'string')
      ? value as [string, string] : null
  } catch { return null }
}

export function normalizeObjectiveName(value: string): string {
  return value.trim().replace(/^据点/i, '').replace(/点$/i, '').replace(/\s+/g, '').toUpperCase()
}

/** 唯一名称可恢复其阶段；重名旧键只能归入来源阶段，不能复制给两阶段。 */
export function scopeLegacyObjectiveValues<T>(
  values: Record<string, T>, stageId: string,
  stages?: Array<{ id: string; points: CapturePoint[] }>,
): Record<string, T> {
  const result = { ...values }
  for (const [name, value] of Object.entries(values)) {
    if (parseObjectiveStateKey(name)) continue
    const matches = stages?.filter((stage) => stage.points.some((point) => normalizeObjectiveName(point.name) === normalizeObjectiveName(name)))
    const targetStageId = matches?.length === 1 ? matches[0].id : stageId
    const key = objectiveStateKey(targetStageId, name)
    if (!Object.prototype.hasOwnProperty.call(result, key)) result[key] = value
    delete result[name]
  }
  return result
}

/** 旧存档的名称键只允许当前阶段读取，不能同时投射到其他同名阶段。 */
export function readStageObjectiveValue<T>(
  values: Record<string, T>, stageId: string, name: string, legacyActiveStageId?: string,
): T | undefined {
  const key = objectiveStateKey(stageId, name)
  if (Object.prototype.hasOwnProperty.call(values, key)) return values[key]
  return legacyActiveStageId === stageId ? values[name] : undefined
}

export function writeStageObjectiveValue<T>(values: Record<string, T>, stageId: string, name: string, value: T): Record<string, T> {
  const next = { ...values, [objectiveStateKey(stageId, name)]: value }
  delete next[name]
  return next
}

/** 保留现有推进规则，按独立阶段写入归属，避免同名目标互相覆盖。 */
export function objectiveStatesForStageChange(
  states: Record<string, TacticalObjectiveState>,
  stages: Array<{ id: string; points: CapturePoint[] }>,
  fromIndex: number, toIndex: number,
): Record<string, TacticalObjectiveState> {
  const result = scopeLegacyObjectiveValues(states, stages[fromIndex]?.id ?? stages[toIndex]?.id ?? 'S1', stages)
  for (let index = 0; index < stages.length; index++) {
    const stage = stages[index]
    for (const point of stage.points) {
      const key = objectiveStateKey(stage.id, point.name)
      if (index === toIndex) result[key] = { owner: 'neutral', capturingSide: null, progress: 0 }
      else if (index > toIndex) result[key] = { owner: 'defense', capturingSide: null, progress: 100 }
      else if (toIndex > fromIndex && index >= Math.max(0, fromIndex)) result[key] = { owner: 'attack', capturingSide: null, progress: 100 }
    }
  }
  return result
}
