import snapshot from './pcInfantrySpawnAreas.json'
import ascentSnapshot from './ascentPcInfantrySpawnAreas.json'
import ascentAttackDefenseSnapshot from './ascentPcAttackDefenseInfantry.json'
import flashpointSnapshot from './flashpointPcInfantrySpawnAreas.json'
import emberSnapshot from './emberPcInfantrySpawnAreas.json'
import stormeyeSnapshot from './stormeyePcInfantrySpawnAreas.json'
import trenchSnapshot from './trenchPcInfantrySpawnAreas.json'
import type { CapturePoint, Side, StageSpawnPoint } from '../types'
import type { GameDataPlatform } from './gameDataPlatform'

export type InfantrySpawnGroupKind = 'inner' | 'outer'

export interface InfantrySpawnGroup {
  side: Side
  kind: InfantrySpawnGroupKind
  areas: Array<{ id: string; points: [number, number][] }>
  unresolvedCount: number
}

export interface InfantrySpawnObjective {
  id: string
  groups: InfantrySpawnGroup[]
}

export interface InfantrySpawnBase {
  sourceHubActor: string
  side: Side
  areas: InfantrySpawnGroup['areas']
  unresolvedCount: number
  footSoldierDisabled: boolean
}

interface CandidateSnapshot {
  mapId: string
  platform: string
  modeIds: string[]
  areas: Array<{ id: string; points: number[][] }>
  objectives: Array<{ id: string; stageId: string; icon: string; marker: number[];
    groups: Array<{ side: string; kind: string; areaIds: string[]; unresolvedAreaIds: string[] }> }>
  bases: Array<{ modeId: string; stageId: string; spawnUid: string; side: string; marker: number[];
    sourceHubActor: string; areaIds: string[]; unresolvedAreaIds: string[]; footSoldierDisabled?: boolean }>
}

const snapshots: CandidateSnapshot[] = [snapshot, ascentSnapshot, flashpointSnapshot, ascentAttackDefenseSnapshot, emberSnapshot, stormeyeSnapshot, trenchSnapshot]
const registry = new Map(snapshots.flatMap((data) => data.modeIds.map((modeId) => [
  `${data.mapId}:${data.platform}:${modeId}`,
  { data, areasById: new Map(data.areas.map((area) => [area.id, area])) },
] as const)))

function candidateSource(mapId: string, platform: GameDataPlatform, modeId: string) {
  return registry.get(`${mapId}:${platform}:${modeId}`) ?? null
}

export function infantrySpawnAreasForBase(
  mapId: string,
  platform: GameDataPlatform,
  modeId: string,
  stageId: string,
  spawn: StageSpawnPoint,
): InfantrySpawnBase | null {
  const source = candidateSource(mapId, platform, modeId)
  if (!source) return null
  const binding = source.data.bases.find((base) => base.modeId === modeId && base.stageId === stageId
    && spawn.stageId === stageId && base.spawnUid === spawn.uid && base.side === spawn.side
    && Math.hypot(base.marker[0] - spawn.lat, base.marker[1] - spawn.lng) < 0.01)
  if (!binding) return null
  return {
    sourceHubActor: binding.sourceHubActor,
    side: binding.side as Side,
    areas: binding.areaIds.flatMap((id) => {
      const area = source.areasById.get(id)
      return area ? [{ id, points: area.points as [number, number][] }] : []
    }),
    unresolvedCount: binding.unresolvedAreaIds.length,
    footSoldierDisabled: binding.footSoldierDisabled === true,
  }
}

/** Exact stage/icon binding plus original location avoids borrowing another objective's data. */
export function infantrySpawnAreasForObjective(
  mapId: string,
  platform: GameDataPlatform,
  modeId: string,
  stageId: string,
  point: CapturePoint,
): InfantrySpawnObjective | null {
  const source = candidateSource(mapId, platform, modeId)
  if (!source) return null
  const objective = source.data.objectives.find((item) => item.stageId === stageId && item.icon === point.icon
    && Math.hypot(item.marker[0] - point.lat, item.marker[1] - point.lng) < 0.01)
  if (!objective) return null
  return {
    id: objective.id,
    groups: objective.groups.map((group) => ({
      side: group.side as Side,
      kind: group.kind as InfantrySpawnGroupKind,
      areas: group.areaIds.flatMap((id) => {
        const area = source.areasById.get(id)
        return area ? [{ id, points: area.points as [number, number][] }] : []
      }),
      unresolvedCount: group.unresolvedAreaIds.length,
    })),
  }
}

export interface InfantrySpawnInspection {
  expanded: boolean
  side: Side
  inner: boolean
  outer: boolean
}

export function visibleInfantrySpawnGroups(
  objective: InfantrySpawnObjective | null,
  inspection: InfantrySpawnInspection,
): InfantrySpawnGroup[] {
  if (!objective || !inspection.expanded) return []
  return objective.groups.filter((group) => group.side === inspection.side && inspection[group.kind])
}
