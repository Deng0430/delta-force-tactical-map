import type { ModeDeployVehicle, ModeMapOverride, ModeMapProp, ModeSpawnPoint, VehicleSpawnerInfo } from '../types'
import snapshot from './stormeyePcWinnerData.json'

export const STORMEYE_PC_WINNER_NOTE = '2026-11-13 风暴眼PC胜者MapID608：同步5阶段、7据点、26个基地Hub与22个活动/占领区域；按明确Hub引用同步部署车型与生成位，保留现有CD、并发数量及部署次数。9组兵力条件去重，修正三处山猫车型，A180/A140拆分刷新位置。B140突击车规则已核对，但主/子关卡未找到生成器，位置沿用原标注；静态资源不代表线上服务器最终覆盖。'
const copy = (points: number[][]): [number, number][] => points.map(([lat, lng]) => [lat, lng])
const same = (a: unknown, b: unknown) => JSON.stringify(a, canonical) === JSON.stringify(b, canonical)
function canonical(_key: string, value: unknown): unknown {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value
}
const at = (point: { lat: number; lng: number }, position: number[]) => point.lat === position[0] && point.lng === position[1]
const builtin = (uid: string) => uid.startsWith('builtin_wta_stormeye_')
const freshUid = (desired: string, used: Set<string>) => {
  let uid = desired
  for (let n = 1; used.has(uid); n++) uid = `${desired}_${n}`
  used.add(uid)
  return uid
}

/** PC 胜者初始化及 v65 一次性迁移；普通攻防、手游、自建实体不重新套用。 */
export function withStormeyePcWinnerData(current: ModeMapOverride): ModeMapOverride {
  if (current.mapId !== 'stormeye') return current
  const sourceStages = new Map(snapshot.stages.map((stage) => [stage.id, stage]))
  const objectives = current.objectives.map((point) => {
    const source = builtin(point.uid) ? sourceStages.get(point.stageId)?.objectives.find((p) => p.name === point.name) : undefined
    return source ? { ...point, lat: source.lat, lng: source.lng } : point
  })
  const zones = current.zones.map((zone) => {
    const stage = sourceStages.get(zone.stageId)
    if (!stage || !builtin(zone.uid)) return zone
    let points: number[][] | undefined
    if (zone.role === 'frontline') points = stage.frontline
    if (zone.role === 'attack-base') points = stage.attackBaseZone
    if (zone.role === 'defense-base') points = stage.defenseBaseZone
    if (zone.role === 'capture') {
      const point = current.objectives.find((p) => builtin(p.uid) && p.stageId === zone.stageId && p.captureZoneUid === zone.uid)
      if (point) points = stage.objectives.find((p) => p.name === point.name)?.captureArea
    }
    return points ? { ...zone, points: copy(points), verification: 'confirmed' as const } : zone
  })
  const spawns = [...current.spawns]
  const usedSpawnUids = new Set(spawns.map((s) => s.uid))
  for (const stage of snapshot.stages) for (const source of stage.spawns) {
    if (!current.stages.some((s) => s.id === stage.id)) continue
    let index = spawns.findIndex((s) => (s.uid === source.uid || (!source.legacyPosition && s.uid.startsWith(`${source.uid}_`)))
      && s.stageId === stage.id && s.side === source.side)
    // 旧基地删除是用户编辑；只新增本次首次恢复的 S5 守方第三基地。
    if (index < 0 && source.legacyPosition) continue
    if (index < 0) {
      const spawn: ModeSpawnPoint = { uid: freshUid(source.uid, usedSpawnUids), stageId: stage.id,
        side: source.side as 'attack' | 'defense', name: source.name, lat: source.lat, lng: source.lng,
        vehicleDeploy: false, vehicleCategories: [], deployVehicles: [], verification: 'confirmed' }
      spawns.push(spawn); index = spawns.length - 1
    }
    const old = spawns[index]
    const entries = snapshot.deployments.filter((d) => d.stageId === stage.id && d.side === source.side && d.spawnUid === source.uid)
    const legacy = snapshot.legacyDeployments.filter((d) => d.stageId === stage.id && d.side === source.side && d.spawnUid === source.uid)
    const deployVehicles = old.deployVehicles.filter((vehicle) => {
      if (entries.some((entry) => entry.vehicle.icon === vehicle.icon)) return true
      const prior = legacy.find((d) => d.vehicle.icon === vehicle.icon)?.vehicle
      // 只撤下资源已不再挂载的原样旧卡片，保留手改参数和自建车型。
      return !prior || vehicle.cd !== prior.cd || vehicle.num !== prior.num
        || (vehicle.deployCount ?? 1) !== ((prior as { deployCount?: number }).deployCount ?? 1) || Boolean(vehicle.deployPositions?.length)
        || vehicle.allowTeammate !== prior.allowTeammate || vehicle.category !== prior.category
        || vehicle.name !== prior.name || vehicle.badge !== prior.badge || vehicle.legendKey !== prior.legendKey
    }).map((vehicle): ModeDeployVehicle => {
      const entry = entries.find((entry) => entry.vehicle.icon === vehicle.icon)
      return entry ? { ...vehicle, deployPositions: vehicle.deployPositions?.length
        ? copy(vehicle.deployPositions) : copy(entry.vehicle.deployPositions),
      clientSpawner: structuredClone(entry.vehicle.clientSpawner) as VehicleSpawnerInfo } : vehicle
    })
    for (const entry of entries) {
      if (deployVehicles.some((vehicle) => vehicle.icon === entry.vehicle.icon) || entry.legacyVehicle) continue
      deployVehicles.push({ ...structuredClone(entry.vehicle), category: entry.vehicle.category as ModeDeployVehicle['category'],
        legendKey: entry.vehicle.legendKey,
        deployPositions: copy(entry.vehicle.deployPositions), clientSpawner: structuredClone(entry.vehicle.clientSpawner) as VehicleSpawnerInfo })
    }
    const unchangedPosition = source.legacyPosition && at(old, source.legacyPosition)
    spawns[index] = { ...old, ...(unchangedPosition ? { lat: source.lat, lng: source.lng } : {}),
      name: old.name === source.legacyName ? source.name : old.name,
      deployVehicles, vehicleDeploy: deployVehicles.length > 0,
      vehicleCategories: [...new Set(deployVehicles.map((v) => v.category))] }
  }
  const points = [...current.vehicleRefreshPoints]
  const pointUids = new Set(points.map((point) => point.uid))
  const rules = [...current.vehicleRefreshRules]
  for (const update of snapshot.refreshUpdates) {
    const index = rules.findIndex((rule) => rule.uid === update.uid)
    if (index < 0) continue
    const rule = rules[index], prior = update.legacyRule
    if (rule.objective !== prior.objective || rule.side !== prior.side || rule.action !== prior.action
      || rule.trigger.type !== prior.trigger.type || String(rule.trigger.value) !== String(prior.trigger.value)
      || (rule.vehicle.icon !== prior.vehicle.icon && rule.vehicle.icon !== update.rule.vehicle.icon)) continue
    const point = current.vehicleRefreshPoints.find((p) => p.uid === rule.refreshPointUid)
    if (!point) continue
    let uid = point.uid
    const alreadyMigrated = point.uid === update.point.uid || point.uid.startsWith(`${update.point.uid}_`)
    if (!alreadyMigrated && point.uid === update.legacyPoint.uid) {
      const moved = !at(point, [update.legacyPoint.lat, update.legacyPoint.lng])
      uid = freshUid(update.point.uid, pointUids)
      points.push({ ...update.point, uid, ...(moved ? { lat: point.lat, lng: point.lng } : {}),
        ...(moved || point.name !== update.legacyPoint.name ? { name: point.name } : {}), verification: 'confirmed' })
    }
    const { legendKey: _oldLegend, ...vehicle } = rule.vehicle
    const replacement = update.rule.vehicle
    const positionNote = 'PC资源已核对该刷新条件；未找到对应生成器，刷新位置暂沿用现有标注。'
    rules[index] = { ...rule, refreshPointUid: uid,
      vehicle: { ...vehicle, name: replacement.name, icon: replacement.icon, iconUrl: replacement.iconUrl,
        badge: replacement.badge, category: replacement.category as ModeDeployVehicle['category'],
        legendKey: replacement.legendKey },
      clientSpawner: structuredClone(update.rule.clientSpawner) as VehicleSpawnerInfo,
      note: !update.positionKnown && rule.note === prior.note ? [rule.note, positionNote].filter(Boolean).join('\n') : rule.note }
  }
  // 拆点后仅清理不再被规则引用、且没有用户修改的原始公共点。
  const references = new Set(rules.map((rule) => rule.refreshPointUid))
  const vehicleRefreshPoints = points.filter((point) => references.has(point.uid)
    || !snapshot.refreshUpdates.some((u) => point.uid === u.legacyPoint.uid && point.name === u.legacyPoint.name
      && at(point, [u.legacyPoint.lat, u.legacyPoint.lng])))
  const props: ModeMapProp[] = current.props.filter((prop) => !snapshot.retiredProps.some((old) =>
    prop.uid === `builtin_wta_stormeye_prop-${old.legacyIndex}` && prop.name === old.name && prop.icon === old.icon
      && at(prop, [old.lat, old.lng])))
  for (const source of snapshot.props) {
    const uid = source.legacyIndex !== undefined ? `builtin_wta_stormeye_prop-${source.legacyIndex}` : source.uid
    const index = props.findIndex((p) => p.uid === uid && (p.icon === source.icon || ('legacyIcon' in source && p.icon === source.legacyIcon)))
    if (index < 0 && (source.legacyIndex !== undefined || props.some((p) => p.uid === uid))) continue
    const old = index < 0 ? undefined : props[index]
    const legacy = source.legacyIndex !== undefined ? snapshot.legacyProps[source.legacyIndex] : undefined
    const moved = old && !at(old, legacy ? [legacy.lat, legacy.lng] : [source.lat, source.lng])
    const prop: ModeMapProp = { ...(old ?? {}), uid, name: old && legacy && old.name !== legacy.name ? old.name : source.name,
      icon: source.icon, stageId: old?.stageId ?? (source.stage || '*'), lat: moved ? old.lat : source.lat, lng: moved ? old.lng : source.lng,
      verification: 'confirmed', ...(source.zipline ? { zipline: { ...source.zipline,
        endpoint: source.zipline.endpoint as 'green' | 'red', orientation: source.zipline.orientation as 'vertical' | 'span' } } : {}),
      ...(source.airSupply ? { airSupply: { ...source.airSupply, reference: 'pc-world-z' as const } } : {}) }
    if (index < 0) props.push(prop)
    else props[index] = prop
  }
  const notes = current.notes.split('\n').includes(STORMEYE_PC_WINNER_NOTE) ? current.notes
    : [current.notes, STORMEYE_PC_WINNER_NOTE].filter(Boolean).join('\n')
  const next = { ...current, zones, objectives, spawns, props, notes, vehicleRefreshPoints, vehicleRefreshRules: rules }
  return same(next, current) ? current : { ...next, updatedAt: Date.now() }
}
