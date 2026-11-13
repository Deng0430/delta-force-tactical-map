import type { ModeDeployVehicle, ModeMapOverride, ModeMapProp, VehicleSpawnerInfo } from '../types'
import snapshot from './flashpointPcWinnerData.json'
import { normalizeDeploymentCount } from '../utils/deployVehicleCounts'

export const FLASHPOINT_PC_WINNER_NOTE = '2026-11-13 临界点PC胜者同步MapID603：3阶段、5据点及活动判定轮廓，11个复活Hub、13项部署与18个生成位；静态模板CD仅保留为来源信息，界面CD、可部署数量与累计部署次数保留原配置，不由生成器个数推定。Camp原表无显式触发条件，不等同于地图自然刷新；S2/S3 ORV生成器ID未唯一对应，保留待核实，不补造坐标/阈值。'
export const FLASHPOINT_PC_LIMIT_NOTE = '2026-11-13 临界点PC胜者：仅对7项已关联部署载具应用Standard阶段/阵营/车型限额；S1攻方轮式突击炮3、突击车3、侦察直升机2，S1守方防空车3，S2攻方轮式突击炮1、S3双方轮式突击炮各1。不补建未关联部署点，不修改CD、同时部署数量或ATV；静态限额不跨阶段累加，线上重置/覆盖机制仍待核实。'
const copy = (points: number[][]): [number, number][] => points.map(([lat, lng]) => [lat, lng])
const builtin = (uid: string) => uid.startsWith('builtin_wta_flashpoint_')
const dataKey = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)

/** 仅供 PC 胜者默认值及一次性迁移调用；不影响普通攻防、手游和后续用户编辑。 */
export function withFlashpointPcWinnerData(current: ModeMapOverride): ModeMapOverride {
  if (current.mapId !== 'flashpoint') return current
  const stages = new Map(snapshot.stages.map((stage) => [stage.id, stage]))
  const objectives = current.objectives.map((point) => {
    const source = builtin(point.uid) ? stages.get(point.stageId)?.objectives.find((p) => p.name === point.name) : undefined
    return source ? { ...point, lat: source.lat, lng: source.lng } : point
  })
  const zones = current.zones.map((zone) => {
    const stage = stages.get(zone.stageId)
    if (!builtin(zone.uid) || !stage) return zone
    let points: number[][] | undefined
    if (zone.role === 'frontline') points = stage.frontline
    if (zone.role === 'attack-base') points = stage.attackBaseZone
    if (zone.role === 'defense-base') points = stage.defenseBaseZone
    if (zone.role === 'capture') {
      const objective = current.objectives.find((p) => p.stageId === zone.stageId && p.captureZoneUid === zone.uid && builtin(p.uid))
      if (objective) points = stage.objectives.find((p) => p.name === objective.name)?.captureArea
    }
    return points ? { ...zone, points: copy(points), verification: 'confirmed' as const } : zone
  })
  const spawns = current.spawns.map((spawn) => {
    const source = stages.get(spawn.stageId)?.spawns.find((s) => s.uid === spawn.uid && s.side === spawn.side)
    if (!source) return spawn
    const untouchedPosition = spawn.lat === source.legacyPosition[0] && spawn.lng === source.legacyPosition[1]
    const deployVehicles = spawn.deployVehicles.map((vehicle): ModeDeployVehicle => {
      const entry = snapshot.deployments.find((d) => d.stageId === spawn.stageId && d.side === spawn.side
        && d.spawnUid === spawn.uid && d.vehicle.icon === vehicle.icon)
      if (!entry) return vehicle
      return { ...vehicle,
        // 静态生成器模板不是线上部署CD的最终依据；不要改写/隐藏现有配置。
        num: entry.legacyVehicle && vehicle.num !== entry.legacyVehicle.num ? vehicle.num : entry.vehicle.num,
        deployPositions: vehicle.deployPositions?.length ? copy(vehicle.deployPositions) : copy(entry.vehicle.deployPositions),
        clientSpawner: structuredClone(entry.vehicle.clientSpawner) as VehicleSpawnerInfo,
      }
    })
    return { ...spawn, ...(untouchedPosition ? { lat: source.lat, lng: source.lng } : {}),
      name: spawn.name === source.legacyName ? source.name : spawn.name,
      deployVehicles, vehicleDeploy: deployVehicles.length > 0,
      vehicleCategories: [...new Set(deployVehicles.map((v) => v.category))] }
  })
  const props: ModeMapProp[] = current.props.filter((p) => !snapshot.retiredProps.some((old) =>
    p.uid === `builtin_wta_flashpoint_prop-${old.legacyIndex}` && p.icon === old.icon && p.name === old.name
    && p.lat === old.lat && p.lng === old.lng))
  for (const source of snapshot.props) {
    const uid = source.legacyIndex === undefined ? source.uid : `builtin_wta_flashpoint_prop-${source.legacyIndex}`
    const index = props.findIndex((p) => p.uid === uid && (p.icon === source.icon || p.icon === source.legacyIcon))
    // Respect deletions of existing markers; only newly recovered actors are introduced.
    if (index < 0 && source.legacyIndex !== undefined) continue
    if (index < 0 && props.some((p) => p.uid === uid)) continue
    const old = index >= 0 ? props[index] : undefined
    const retiredReference = source.legacyIndex === undefined ? undefined
      : snapshot.legacyProps[source.legacyIndex]
    const moved = old && retiredReference && (old.lat !== retiredReference.lat || old.lng !== retiredReference.lng)
    const prop: ModeMapProp = {
      ...(old ?? {}), uid, stageId: old?.stageId ?? (source.stage || '*'),
      name: old && retiredReference && old.name !== retiredReference.name ? old.name : source.name, icon: source.icon,
      lat: moved ? old.lat : source.lat, lng: moved ? old.lng : source.lng,
      verification: 'confirmed',
      ...(source.zipline ? { zipline: { ...source.zipline, endpoint: source.zipline.endpoint as 'green' | 'red',
        orientation: source.zipline.orientation as 'vertical' | 'span' } } : {}),
    }
    if (index >= 0) props[index] = prop
    else props.push(prop)
  }
  const notes = current.notes.split('\n').includes(FLASHPOINT_PC_WINNER_NOTE) ? current.notes
    : [current.notes, FLASHPOINT_PC_WINNER_NOTE].filter(Boolean).join('\n')
  const next = { ...current, zones, objectives, spawns, props, notes }
  const limited = withFlashpointPcWinnerDeploymentLimits(next)
  if (dataKey(limited) === dataKey(current)) return current
  return { ...limited, updatedAt: Date.now() }
}

/** v70：只补齐已关联内置载具的车型限额；保留自定义次数、删除和其他地图内容。 */
export function withFlashpointPcWinnerDeploymentLimits(current: ModeMapOverride): ModeMapOverride {
  if (current.mapId !== 'flashpoint') return current
  let changed = false
  const spawns = current.spawns.map((spawn) => {
    const deployVehicles = spawn.deployVehicles.map((vehicle): ModeDeployVehicle => {
      const entry = snapshot.deployments.find((d) => d.stageId === spawn.stageId && d.side === spawn.side
        && d.spawnUid === spawn.uid && d.vehicle.icon === vehicle.icon && d.deploymentLimit)
      if (!entry?.deploymentLimit) return vehicle
      const limit = entry.deploymentLimit.value
      const count = normalizeDeploymentCount(vehicle.deployCount)
      if (count !== (entry.legacyVehicle?.deployCount ?? 1) && count !== limit) return vehicle
      if (vehicle.deployCount === limit && vehicle.deployCountKnown !== false) return vehicle
      const { deployCountKnown: _known, ...rest } = vehicle
      changed = true
      return { ...rest, deployCount: limit }
    })
    return deployVehicles.some((vehicle, index) => vehicle !== spawn.deployVehicles[index])
      ? { ...spawn, deployVehicles } : spawn
  })
  const notes = current.notes.split('\n').includes(FLASHPOINT_PC_LIMIT_NOTE) ? current.notes
    : [current.notes, FLASHPOINT_PC_LIMIT_NOTE].filter(Boolean).join('\n')
  return changed || notes !== current.notes ? { ...current, spawns, notes, updatedAt: Date.now() } : current
}

/** v64：只撤回 v63 自动写入的临界点 CD，不重新同步区域或覆盖后续编辑。 */
export function repairFlashpointPcWinnerCooldowns(current: ModeMapOverride): ModeMapOverride {
  if (current.mapId !== 'flashpoint') return current
  let changed = false
  const spawns = current.spawns.map((spawn) => {
    const deployVehicles = spawn.deployVehicles.map((vehicle): ModeDeployVehicle => {
      const entry = snapshot.deployments.find((d) => d.stageId === spawn.stageId && d.side === spawn.side
        && d.spawnUid === spawn.uid && d.vehicle.icon === vehicle.icon)
      const info = vehicle.clientSpawner
      const source = entry?.vehicle.clientSpawner
      if (!entry?.legacyVehicle || vehicle.cooldownKnown !== false || !info || !source
        || info.platform !== 'pc' || info.mapId !== 603 || info.rowName !== source.rowName
        || info.cooldownStatus !== 'pc-template-verified' || info.template !== source.template
        || info.vehicleId !== source.vehicleId || info.section !== source.section
        || dataKey(info.spawnerIds) !== dataKey(source.spawnerIds)) return vehicle
      const { cooldownKnown: _cooldownKnown, ...rest } = vehicle
      changed = true
      return { ...rest,
        cd: vehicle.cd === source.templateVehicleCd ? entry.legacyVehicle.cd : vehicle.cd }
    })
    return deployVehicles.some((vehicle, index) => vehicle !== spawn.deployVehicles[index])
      ? { ...spawn, deployVehicles } : spawn
  })
  return changed ? { ...current, spawns, updatedAt: Date.now() } : current
}
