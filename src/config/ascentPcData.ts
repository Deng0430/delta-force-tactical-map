import type { ModeMapOverride, ModeMapProp, ModeZone, StageConfig } from '../types'
import snapshot from './ascentPcData.json'

export const ASCENT_PC_DATA_NOTE = '2026-11-13 PC攀升：按MapID 54/601共用关卡核对活动区、占领区和地图道具；S5为S4尖塔坍塌后的备用区域。资源基线不等同于在线服务器覆盖。'
const copy = (points: number[][]): [number, number][] => points.map(([lat, lng]) => [lat, lng])
const sourceStages = new Map(snapshot.stages.map((stage) => [stage.id, stage]))
const sourceObjective = (stageId: string, name: string) => sourceStages.get(stageId)?.objectives
  .find((point) => point.name === name || (stageId === 'S4' && name === '据点D' && point.name === '据点D1'))

/** 攻防的底层 PC 入口；手游路由不调用。保留四个原阶段的出生点和载具。 */
export function withAscentPcStages(stages: StageConfig[]): StageConfig[] {
  const result = stages.map((stage) => {
    const source = sourceStages.get(stage.id)
    if (!source) return stage
    return { ...stage,
      zone: { name: stage.zone?.name ?? `${stage.id} · 据点活动区`, latlngs: copy(source.frontline) },
      attackBaseZone: copy(source.attackBaseZone), defenseBaseZone: copy(source.defenseBaseZone),
      points: stage.points.map((point) => {
        const replacement = sourceObjective(stage.id, point.name)
        return replacement ? { ...point, lat: replacement.lat, lng: replacement.lng, capturable: copy(replacement.captureArea) } : point
      }),
    }
  })
  if (!result.some((stage) => stage.id === 'S5')) {
    const source = sourceStages.get('S5')!
    const spawns = snapshot.event.eventSpawns.map((spawn) => ({ ...spawn, stageId: 'S5', side: spawn.side as 'attack' | 'defense' }))
    result.push({ id: 'S5', label: snapshot.event.label,
      zone: { name: 'S5 · 尖塔坍塌后据点活动区', latlngs: copy(source.frontline) },
      attackBaseZone: copy(source.attackBaseZone), defenseBaseZone: copy(source.defenseBaseZone),
      points: source.objectives.map((point) => ({ name: point.name, icon: point.icon, note: 'S4尖塔坍塌后 · 服务器层',
        lat: point.lat, lng: point.lng, capturable: copy(point.captureArea) })),
      spawns, attackSpawns: spawns.filter((s) => s.side === 'attack').map((s) => [s.lat, s.lng]),
      defenseSpawns: spawns.filter((s) => s.side === 'defense').map((s) => [s.lat, s.lng]),
      attackSpawnNames: spawns.filter((s) => s.side === 'attack').map((s) => s.name),
      defenseSpawnNames: spawns.filter((s) => s.side === 'defense').map((s) => s.name),
      // 只恢复原生事件区域/出生Hub，不推定事件后的载具额度与冷却。
      attackVehicles: [], defenseVehicles: [],
    })
  }
  return result
}

const builtinUid = (uid: string) => /^(?:sync_ascent_|builtin_wta_ascent_|pc_ascent_)/.test(uid)
const legacyUids = (index: number) => [`sync_ascent_prop-${index}`, `builtin_wta_ascent_prop-${index}`]
export const ASCENT_PC_WEAPON_CORRECTION_NOTE = '2026-11-13 攀升道具类型修正：依据原生PlayerMarkingType将两处LD3000改为火神炮；撤下误标为密集阵、启用条件未核实的基地自动设施。'

/** v61仅纠正误分类的道具，不重新套用v58区域/坐标、复活点或载具配置。 */
export function withAscentPcWeaponCorrections(current: ModeMapOverride): ModeMapOverride {
  if (current.mapId !== 'ascent') return current
  const props = current.props.filter((prop) => !snapshot.excludedProps.some((excluded) =>
    prop.uid === excluded.uid && prop.name === excluded.previousName && prop.icon === excluded.previousIcon
    && prop.lat === excluded.lat && prop.lng === excluded.lng && ['*', '全局'].includes(prop.stageId)))
    .map((prop) => {
      const source = snapshot.props.find((source) => source.legacyIcon &&
        (source.uid === prop.uid || (source.legacyIndex !== undefined && legacyUids(source.legacyIndex).includes(prop.uid)))
        && prop.icon === source.legacyIcon && prop.name === '固定防空炮')
      return source ? { ...prop, name: source.name, icon: source.icon } : prop
    })
  const notes = current.notes.split('\n').includes(ASCENT_PC_WEAPON_CORRECTION_NOTE) ? current.notes
    : [current.notes, ASCENT_PC_WEAPON_CORRECTION_NOTE].filter(Boolean).join('\n')
  if (notes === current.notes && props.length === current.props.length && props.every((prop, i) => prop === current.props[i])) return current
  return { ...current, props, notes, updatedAt: Date.now() }
}

/** 默认值和一次性存档迁移。只更新 PC 内置实体，自建实体、部署表和手游数据均不触碰。 */
export function withAscentPcData(current: ModeMapOverride): ModeMapOverride {
  if (current.mapId !== 'ascent') return current
  const stages = current.stages.map((s) => s.id === 'S5' ? { ...s, label: snapshot.event.label } : s)
  const zones = current.zones.map((zone) => {
    const source = sourceStages.get(zone.stageId)
    if (!source || !builtinUid(zone.uid)) return zone
    let points: number[][] | undefined
    if (zone.role === 'frontline') points = source.frontline
    if (zone.role === 'attack-base') points = source.attackBaseZone
    if (zone.role === 'defense-base') points = source.defenseBaseZone
    if (zone.role === 'capture') {
      const objective = current.objectives.find((o) => o.stageId === zone.stageId && o.captureZoneUid === zone.uid && builtinUid(o.uid))
      if (objective) points = sourceObjective(zone.stageId, objective.name)?.captureArea
    }
    return points ? { ...zone, points: copy(points), verification: 'confirmed' as const } : zone
  })
  const objectives = current.objectives.map((point) => {
    const source = builtinUid(point.uid) ? sourceObjective(point.stageId, point.name) : undefined
    return source ? { ...point, lat: source.lat, lng: source.lng } : point
  })
  const spawns = [...current.spawns]
  if (!stages.some((stage) => stage.id === 'S5')) {
    stages.push({ id: 'S5', label: snapshot.event.label })
    const source = sourceStages.get('S5')!
    const addZone = (suffix: string, role: ModeZone['role'], name: string, points: number[][], objectiveUid?: string) => {
      const uid = `pc_ascent_event_S5_${suffix}`
      // Do not overwrite a user entity even if it happens to use the new reserved ID.
      let available = uid
      for (let n = 1; zones.some((z) => z.uid === available); n++) available = `${uid}_${n}`
      zones.push({ uid: available, stageId: 'S5', role, name, points: copy(points),
        kind: role === 'attack-base' ? 'own' : role === 'defense-base' ? 'enemy' : 'neutral',
        color: role === 'attack-base' ? '#01ff84' : role === 'defense-base' ? '#e0453a' : '#f4cf67',
        verification: 'confirmed', ...(objectiveUid ? { objectiveUid } : {}) })
      return available
    }
    addZone('front', 'frontline', 'S5 · 尖塔坍塌后据点活动区', source.frontline)
    addZone('attack-base', 'attack-base', 'S5 · 进攻方活动区', source.attackBaseZone)
    addZone('defense-base', 'defense-base', 'S5 · 防守方活动区', source.defenseBaseZone)
    source.objectives.forEach((point, index) => {
      const uidBase = `pc_ascent_event_S5_objective-${index}`
      let uid = uidBase
      for (let n = 1; objectives.some((o) => o.uid === uid); n++) uid = `${uidBase}_${n}`
      const captureZoneUid = addZone(`capture-${index}`, 'capture', `S5 · ${point.name}占领区`, point.captureArea, uid)
      objectives.push({ uid, stageId: 'S5', name: point.name, icon: point.icon, lat: point.lat, lng: point.lng,
        note: 'S4尖塔坍塌后 · 服务器层', captureZoneUid, verification: 'confirmed' })
    })
    for (const source of snapshot.event.eventSpawns) {
      let uid = source.uid
      for (let n = 1; spawns.some((s) => s.uid === uid); n++) uid = `${source.uid}_${n}`
      spawns.push({ ...source, uid, stageId: 'S5', side: source.side as 'attack' | 'defense',
        vehicleDeploy: false, vehicleCategories: [], deployVehicles: [], verification: 'confirmed' })
    }
  }
  // Retire only untouched legacy markers absent from the complete current map-level scan.
  // A moved/renamed user override remains available for the user to review.
  const props: ModeMapProp[] = current.props.filter((prop) => !snapshot.retiredProps.some((old) =>
    legacyUids(old.legacyIndex).includes(prop.uid) && prop.icon === old.icon && prop.name === old.name
    && prop.lat === old.lat && prop.lng === old.lng))
  for (const source of snapshot.props) {
    const candidates = source.legacyIndex === undefined ? [source.uid] : [...legacyUids(source.legacyIndex), source.uid]
    const index = props.findIndex((prop) => candidates.includes(prop.uid) && (prop.icon === source.icon || prop.icon === source.legacyIcon))
    // Deleted legacy markers stay deleted; newly recovered resource actors are inserted once.
    if (index < 0 && source.legacyIndex !== undefined) continue
    const original = index >= 0 ? props[index] : undefined
    const moved = original && source.legacyPosition &&
      (original.lat !== source.legacyPosition[0] || original.lng !== source.legacyPosition[1])
    const replacement: ModeMapProp = { ...(original ?? {}), uid: original?.uid ?? source.uid,
      name: source.name, icon: source.icon, lat: moved ? original.lat : source.lat, lng: moved ? original.lng : source.lng,
      stageId: source.stages ? 'S4' : original?.stageId ?? '*', verification: 'confirmed',
      ...(source.airSupply ? { airSupply: { ...source.airSupply, reference: 'pc-world-z' as const } } : {}) }
    if (index >= 0) props[index] = replacement
    else {
      if (props.some((p) => p.uid === replacement.uid)) continue
      props.push(replacement)
    }
    if (source.stages) for (const stageId of source.stages.filter((s) => s !== 'S4')) {
      const uid = `${replacement.uid}_before_event_${stageId}`
      const found = props.findIndex((p) => p.uid === uid && p.icon === source.icon && p.stageId === stageId)
      const duplicate = { ...replacement, uid, stageId }
      if (found >= 0) props[found] = { ...props[found], ...duplicate }
      else if (!props.some((p) => p.uid === uid)) props.push(duplicate)
    }
  }
  const notes = current.notes.split('\n').includes(ASCENT_PC_DATA_NOTE) ? current.notes
    : [current.notes, ASCENT_PC_DATA_NOTE].filter(Boolean).join('\n')
  const next = withAscentPcWeaponCorrections({ ...current, stages, zones, objectives, spawns, props, notes })
  if (JSON.stringify(next) === JSON.stringify(current)) return current
  return { ...next, updatedAt: Date.now() }
}

