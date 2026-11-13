import type { MapProp, ModeMapOverride, ModeObjectivePoint, ModeZone, StageConfig } from '../types'
import type { StageDeploy } from './deployVehicles'

export const EMBER_STAGE_FOUR_NOTE = '2026-11-09 用户确认：烬区 S4 保留原攻方两个复活点，仅保留 C2 据点及占领区；其余阶段数据从同端同模式 S3 独立复制。'
const stageFourUid = (uid: string) => `ember_S4:${uid}`
const stageFourName = (name: string) => name.replace(/\bS3\b/g, 'S4')

/** 保留 S4 两个攻方点的位置、名称和身份，其余基础阶段字段由 S3 复制。 */
export function withEmberStageFourStages(stages: StageConfig[]): StageConfig[] {
  const source = stages.find((stage) => stage.id === 'S3')
  const target = stages.find((stage) => stage.id === 'S4')
  if (!source || !target) return stages
  const attack = target.spawns.filter((spawn) => spawn.side === 'attack')
  if (attack.length !== 2) throw new Error('烬区 S4 必须保留两个攻方复活点。')
  const defense = source.spawns.filter((spawn) => spawn.side === 'defense').map((spawn) => ({
    ...structuredClone(spawn), uid: stageFourUid(spawn.uid), stageId: 'S4', name: stageFourName(spawn.name),
  }))
  const next: StageConfig = {
    ...structuredClone(source), id: 'S4', label: target.label,
    points: structuredClone(source.points.filter((point) => point.name === '据点C2')),
    zone: source.zone ? { ...structuredClone(source.zone), name: stageFourName(source.zone.name) } : null,
    spawns: [...structuredClone(attack), ...defense],
    attackSpawns: attack.map((spawn) => [spawn.lat, spawn.lng]),
    attackSpawnNames: attack.map((spawn) => spawn.name),
    defenseSpawns: defense.map((spawn) => [spawn.lat, spawn.lng]),
    defenseSpawnNames: defense.map((spawn) => spawn.name),
  }
  return stages.map((stage) => stage.id === 'S4' ? next : stage)
}

export function withEmberStageFourProps(props: MapProp[]): MapProp[] {
  return [...props.filter((prop) => prop.stage !== 'S4'),
    ...props.filter((prop) => prop.stage === 'S3').map((prop) => ({ ...structuredClone(prop), stage: 'S4' }))]
}

/** 阶段载具部署复制后以目标阶段的复活点 UID 重新绑定。 */
export function withEmberStageFourDeploy(stages: StageConfig[], deploy: Record<string, StageDeploy>): Record<string, StageDeploy> {
  const source = stages.find((stage) => stage.id === 'S3')
  const target = stages.find((stage) => stage.id === 'S4')
  if (!source || !target) return deploy
  const next: StageDeploy = { attack: [], defense: [] }
  for (const side of ['attack', 'defense'] as const) {
    const from = source.spawns.filter((spawn) => spawn.side === side)
    const to = target.spawns.filter((spawn) => spawn.side === side)
    next[side] = (deploy.S3?.[side] ?? []).map((vehicle) => {
      const index = from.findIndex((spawn) => vehicle.spawnUid ? spawn.uid === vehicle.spawnUid : spawn.name === vehicle.note)
      if (index < 0 || !to[index]) throw new Error(`烬区 S4 ${vehicle.name}：无法从 S3 重新绑定复活点。`)
      return { ...structuredClone(vehicle), spawnUid: to[index].uid, note: to[index].name }
    })
  }
  return { ...deploy, S4: next }
}

/** 内置初始化和 v43 一次性迁移；用户后续编辑不动态跟随 S3。 */
export function withEmberStageFourMap(current: ModeMapOverride, fallbackAttackSpawns = current.spawns): ModeMapOverride {
  if (current.mapId !== 'ember' || !current.stages.some((stage) => stage.id === 'S3')) return current
  const originalAttack = current.spawns.filter((spawn) => spawn.stageId === 'S4' && spawn.side === 'attack')
  const preservedAttack = originalAttack.length === 2 ? originalAttack
    : fallbackAttackSpawns.filter((spawn) => spawn.stageId === 'S4' && spawn.side === 'attack')
  if (preservedAttack.length !== 2) throw new Error('烬区 S4 缺少两个已确认的攻方复活点。')
  const targetObjectives = current.objectives.filter((point) => point.stageId === 'S4')
  const sourceStageObjectives = current.objectives.filter((point) => point.stageId === 'S3')
  const sourceObjectives = sourceStageObjectives.filter((point) => point.name === '据点C2')
  const excludedObjectiveUids = new Set(sourceStageObjectives.filter((point) => point.name !== '据点C2').map((point) => point.uid))
  const excludedCaptureUids = new Set(sourceStageObjectives.filter((point) => point.name !== '据点C2').map((point) => point.captureZoneUid).filter(Boolean))
  const objectiveUids = new Map(sourceObjectives.map((point) => [point.uid,
    targetObjectives.find((target) => target.name === point.name)?.uid ?? stageFourUid(point.uid)]))
  const sourceZones = current.zones.filter((zone) => zone.stageId === 'S3'
    && !excludedCaptureUids.has(zone.uid) && (!zone.objectiveUid || !excludedObjectiveUids.has(zone.objectiveUid)))
  const targetZones = current.zones.filter((zone) => zone.stageId === 'S4')
  const usedZoneUids = new Set(current.zones.filter((zone) => zone.stageId !== 'S4').map((zone) => zone.uid))
  const zoneUids = new Map(sourceZones.map((zone) => {
    const sourceObjective = sourceObjectives.find((point) => point.captureZoneUid === zone.uid)
    const targetObjective = sourceObjective ? targetObjectives.find((point) => point.name === sourceObjective.name) : undefined
    const existing = sourceObjective
      ? targetZones.find((target) => target.uid === targetObjective?.captureZoneUid)
      : targetZones.find((target) => !usedZoneUids.has(target.uid) && target.role === zone.role && target.role !== 'capture'
        && (target.role !== 'custom' || target.name === stageFourName(zone.name)))
    const uid = existing && !usedZoneUids.has(existing.uid) ? existing.uid : stageFourUid(zone.uid)
    usedZoneUids.add(uid)
    return [zone.uid, uid]
  }))
  const zones: ModeZone[] = sourceZones.map((zone) => ({
    ...structuredClone(zone), uid: zoneUids.get(zone.uid)!, stageId: 'S4', name: stageFourName(zone.name),
    objectiveUid: zone.objectiveUid ? objectiveUids.get(zone.objectiveUid) : undefined,
  }))
  const objectives: ModeObjectivePoint[] = sourceObjectives.map((point) => ({
    ...structuredClone(point), uid: objectiveUids.get(point.uid)!, stageId: 'S4',
    captureZoneUid: point.captureZoneUid ? zoneUids.get(point.captureZoneUid) ?? '' : '',
  }))
  const sourceAttack = current.spawns.filter((spawn) => spawn.stageId === 'S3' && spawn.side === 'attack')
  const attack = preservedAttack.map((spawn, index) => ({
    ...structuredClone(spawn),
    ...(sourceAttack[index] ? {
      vehicleDeploy: sourceAttack[index].vehicleDeploy,
      vehicleCategories: structuredClone(sourceAttack[index].vehicleCategories),
      deployVehicles: structuredClone(sourceAttack[index].deployVehicles),
    } : {}),
  }))
  const oldDefense = current.spawns.filter((spawn) => spawn.stageId === 'S4' && spawn.side === 'defense')
  const defense = current.spawns.filter((spawn) => spawn.stageId === 'S3' && spawn.side === 'defense').map((spawn, index) => ({
    ...structuredClone(spawn), uid: oldDefense[index]?.uid ?? stageFourUid(spawn.uid),
    stageId: 'S4', name: stageFourName(spawn.name),
  }))
  const props = current.props.filter((prop) => prop.stageId === 'S3').map((prop) => ({
    ...structuredClone(prop), stageId: 'S4', uid: current.props.find((old) => old.stageId === 'S4'
      && old.name === prop.name && old.icon === prop.icon && old.lat === prop.lat && old.lng === prop.lng)?.uid ?? stageFourUid(prop.uid),
  }))
  const notes = current.notes.replace('，S4 沿用原配置。', '。')
    .replace('2026-11-09 用户确认：烬区 S4 仅保留原攻方两个复活点，其余阶段数据从同端同模式 S3 独立复制。', '')
  const next: ModeMapOverride = {
    ...current,
    stages: current.stages.some((stage) => stage.id === 'S4') ? current.stages
      : [...current.stages, { id: 'S4', label: '阶段4 · C1炸毁' }],
    zones: [...current.zones.filter((zone) => zone.stageId !== 'S4'), ...zones],
    objectives: [...current.objectives.filter((point) => point.stageId !== 'S4'), ...objectives],
    spawns: [...current.spawns.filter((spawn) => spawn.stageId !== 'S4'), ...attack, ...defense],
    props: [...current.props.filter((prop) => prop.stageId !== 'S4'), ...props],
    notes: notes.includes(EMBER_STAGE_FOUR_NOTE) ? notes : [notes, EMBER_STAGE_FOUR_NOTE].filter(Boolean).join('\n'),
  }
  if (JSON.stringify(next) === JSON.stringify(current)) return current
  return { ...next, updatedAt: Date.now() }
}
