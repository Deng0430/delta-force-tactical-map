import type { GameDataPlatform } from './gameDataPlatform'
import type { ModeMapOverride, Side, StageVehicle } from '../types'
import snapshot from './pcOrdinaryAttackDefenseData.json'
import { mergeModeMapSnapshot } from '../utils/mergeModeMapSnapshot'

interface PcOrdinarySnapshot {
  previousMap: ModeMapOverride
  map: ModeMapOverride
  previousStageVehicles: Array<{ id: string; attackVehicles: StageVehicle[]; defenseVehicles: StageVehicle[] }>
  official: { stages: Array<{ id: string; attackVehicles: StageVehicle[]; defenseVehicles: StageVehicle[] }> }
}

const maps = snapshot.maps as unknown as Record<string, PcOrdinarySnapshot>
export const PC_ORDINARY_ATTACK_DEFENSE_MAP_IDS = Object.keys(maps)

/** Independent frozen defaults; never borrow a commander or mobile profile. */
export function pcOrdinaryAttackDefenseDefaults(mapId: string): ModeMapOverride | null {
  const source = maps[mapId]
  return source ? { ...structuredClone(source.map), updatedAt: Date.now() } : null
}

/** Preserve pre-update fallback vehicles outside PC ordinary mode, including commander exports. */
export function pcOrdinaryStageVehicles(mapId: string, platform: GameDataPlatform, modeId: string, stageId: string, side: Side): StageVehicle[] | undefined {
  const source = platform === 'pc' ? maps[mapId] : undefined
  if (!source) return undefined
  const stages = modeId === 'attack-defense' ? source.official.stages : source.previousStageVehicles
  const stage = stages.find((stage) => stage.id === stageId)
  return stage ? structuredClone(side === 'attack' ? stage.attackVehicles : stage.defenseVehicles) : undefined
}

/** One-time, field-level migration for these four PC attack/defense maps only. */
export function withPcOrdinaryAttackDefense(current: ModeMapOverride, modeId: string, platform: GameDataPlatform): ModeMapOverride {
  const source = modeId === 'attack-defense' && platform === 'pc' ? maps[current.mapId] : undefined
  if (!source) return current
  return mergeModeMapSnapshot(current, source.previousMap, source.map)
}
