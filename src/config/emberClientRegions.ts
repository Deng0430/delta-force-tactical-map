import type { ModeMapOverride, StageConfig } from '../types'
import snapshot from './emberClientRegions.json'
import pcWinnerS1 from './emberPcWinnerS1.json'

/** 用户指定共用于双端攻防/胜者；来源仍是共用关卡，并非已验证的 PC 胜者覆盖。 */
export const EMBER_CLIENT_REGION_SOURCE = snapshot.source
export const EMBER_CLIENT_REGION_NOTE = '2026-11-09 烬区区域同步：S1–S3 使用共用关卡提取边界；PC 胜者专属映射尚未确认。'
export const EMBER_PC_WINNER_REGION_NOTE = '2026-11-10 PC 胜者烬区区域核实：S1 据点活动区采用 PC 指挥官 MapID=602 的 35 点轮廓；其余 S1–S3 边界已逐项对照 PC 资源。'

type ClientStage = {
  id: string
  frontline: number[][]
  attackBaseZone: number[][]
  defenseBaseZone: number[][]
  captureAreas: Partial<Record<string, number[][]>>
}

const clientStages: ClientStage[] = snapshot.stages
const stageById = new Map(clientStages.map((stage) => [stage.id, stage]))
const copyPoints = (points: number[][]): [number, number][] => points.map(([lat, lng]) => [lat, lng])

/** PC 胜者的内置初始化和 v46 迁移共用同一份已核实 S1 边界。 */
export function withEmberPcWinnerS1Region(current: ModeMapOverride): ModeMapOverride {
  if (current.mapId !== 'ember' || !current.stages.some((stage) => stage.id === 'S1')) return current
  const target = current.zones.find((zone) => zone.stageId === 'S1' && zone.role === 'frontline')
  const points = copyPoints(pcWinnerS1.frontline)
  const usedUids = new Set(current.zones.map((zone) => zone.uid))
  const baseUid = 'builtin_wta_ember_S1_front'
  let uid = baseUid
  for (let suffix = 1; !target && usedUids.has(uid); suffix++) {
    uid = `${baseUid}_pc${suffix}`
  }
  const replacement = target
    ? { ...target, points }
    : { uid, stageId: 'S1', name: 'S1 · 据点活动区',
        role: 'frontline' as const, kind: 'neutral' as const, color: '#f4cf67', points,
        verification: 'confirmed' as const }
  const coordinatesChanged = !target || JSON.stringify(target.points) !== JSON.stringify(points)
  const priorNotes = current.notes.split('\n').filter((line) => line !== EMBER_CLIENT_REGION_NOTE)
  if (!priorNotes.includes(EMBER_PC_WINNER_REGION_NOTE)) priorNotes.push(EMBER_PC_WINNER_REGION_NOTE)
  const notes = priorNotes.filter(Boolean).join('\n')
  if (!coordinatesChanged && notes === current.notes) return current
  const zones = target
    ? current.zones.map((zone) => zone === target ? replacement : zone)
    : [...current.zones, replacement]
  return { ...current, zones, notes, updatedAt: Date.now() }
}

/** 只覆盖已有 S1–S3 的四类区域；不复制阵营、阶段、标点、复活点或载具。 */
export function withEmberClientRegions(mapId: string, stages: StageConfig[]): StageConfig[] {
  if (mapId !== 'ember') return stages
  return stages.map((stage) => {
    const source = stageById.get(stage.id)
    if (!source) return stage
    return {
      ...stage,
      zone: { name: stage.zone?.name ?? `${stage.id} · 据点活动区`, latlngs: copyPoints(source.frontline) },
      attackBaseZone: copyPoints(source.attackBaseZone),
      defenseBaseZone: copyPoints(source.defenseBaseZone),
      points: stage.points.map((point) => {
        const capture = source.captureAreas[point.name]
        return capture ? { ...point, capturable: copyPoints(capture) } : point
      }),
    }
  })
}

/** 一次性迁移已有内置区域，保留实体 UID、样式、自建区域与其余地图数据。 */
export function syncEmberClientRegionZones(current: ModeMapOverride, builtin: ModeMapOverride): ModeMapOverride {
  const replacements = new Map(builtin.zones
    .filter((zone) => stageById.has(zone.stageId) && zone.role !== 'custom')
    .map((zone) => [zone.uid, zone]))
  let changed = false
  const zones = current.zones.map((zone) => {
    const replacement = replacements.get(zone.uid)
    if (!replacement || replacement.stageId !== zone.stageId || replacement.role !== zone.role
        || JSON.stringify(zone.points) === JSON.stringify(replacement.points)) return zone
    changed = true
    return { ...zone, points: copyPoints(replacement.points) }
  })
  const existingUids = new Set(zones.map((zone) => zone.uid))
  for (const replacement of replacements.values()) {
    if (existingUids.has(replacement.uid)) continue
    zones.push(structuredClone(replacement))
    changed = true
  }
  const builtinObjectives = new Map(builtin.objectives
    .filter((point) => stageById.has(point.stageId))
    .map((point) => [point.uid, point]))
  const objectives = current.objectives.map((point) => {
    const replacement = builtinObjectives.get(point.uid)
    if (!replacement || replacement.stageId !== point.stageId
        || point.captureZoneUid === replacement.captureZoneUid) return point
    // 已绑定有效自建占领区的据点保留用户关联；只补齐丢失的内置关联。
    if (point.captureZoneUid && zones.some((zone) => zone.uid === point.captureZoneUid)) return point
    changed = true
    return { ...point, captureZoneUid: replacement.captureZoneUid }
  })
  const notes = current.notes.includes(EMBER_CLIENT_REGION_NOTE)
    ? current.notes : [current.notes, EMBER_CLIENT_REGION_NOTE].filter(Boolean).join('\n')
  if (notes !== current.notes) changed = true
  return changed ? { ...current, zones, objectives, notes, updatedAt: Date.now() } : current
}
