import type { ModeDeployVehicle, ModeMapOverride, ModeMapProp, ModeSpawnPoint, ModeZone } from '../types'
import snapshot from './skyportPcHotfixData.json'
import { DEPLOY_VEHICLE_CATALOG, type StageDeploy } from './deployVehicles'
import { normalizeDeploymentCount } from '../utils/deployVehicleCounts'
import { normalizeZiplineEndpoint } from '../utils/mapZiplines'

export type SkyportBuiltinMode = 'attack-defense' | 'winner-takes-all'
export const SKYPORT_PC_HOTFIX_NOTE = '2026-11-12 PC 天际港热更新：基地、载具刷新位置、C3 初始显示和滑索已核对。'
export const SKYPORT_PC_COMMANDER_NOTE = '已核对 PC 指挥官 MapID=616 基础条目与共享热更；新增载具阈值、实战冷却仍待核实。'
export const SKYPORT_PC_STAGE_FOUR_NOTE = 'S4 为大事件后的 C3 阶段：双方各两个基地，载具仅恢复 AAV/G1 基地关联。C区主轮廓仅供参考；事件后攻守活动区、载具次数与有效冷却待核实。'

const stockIcons = new Set(['sxzjc', 'cfz', 'mtt', 'qxtk', 'g1bzc'])

function comparable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparable)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, comparable(item)]))
}

function modeVehicle(vehicle: ModeDeployVehicle): ModeDeployVehicle {
  const catalog = DEPLOY_VEHICLE_CATALOG.find((item) => item.icon === vehicle.icon)
  return {
    name: catalog?.name ?? vehicle.name, icon: vehicle.icon, iconUrl: catalog?.iconUrl ?? vehicle.iconUrl,
    legendKey: vehicle.legendKey, badge: vehicle.badge, category: vehicle.category,
    cd: vehicle.cd, num: vehicle.num, allowTeammate: vehicle.allowTeammate,
    deployCount: normalizeDeploymentCount(vehicle.deployCount),
    ...(vehicle.cooldownKnown === false ? { cooldownKnown: false } : {}),
  }
}

/** Only built-in PC entities are migrated; custom entities and mobile profiles remain independent. */
export function withSkyportPcHotfix(current: ModeMapOverride, mode: SkyportBuiltinMode): ModeMapOverride {
  if (current.mapId !== 'skyport') return current
  const data = mode === 'attack-defense' ? snapshot.attackDefense : snapshot.commanderDraft
  const deployments = data.deploy as unknown as Record<string, StageDeploy>
  const legacy = snapshot.legacyModeMaps[mode]
  const legacySpawns = new Map(legacy.spawns.map((spawn) => [spawn.uid, spawn]))
  const affected = new Set(snapshot.affectedSpawnUids)
  const templates = data.stages.flatMap((stage) => stage.spawns)
  const templateByUid = new Map(templates.map((spawn) => [spawn.uid, spawn]))
  const spawns = current.spawns.map((spawn) => {
    const template = templateByUid.get(spawn.uid)
    const original = legacySpawns.get(spawn.uid)
    if (!template || (!affected.has(spawn.uid) && mode !== 'winner-takes-all')
      || template.stageId !== spawn.stageId || template.side !== spawn.side) return spawn
    const updatePosition = affected.has(spawn.uid)
    const name = !updatePosition || (original && spawn.name !== original.name) ? spawn.name : template.name
    const replacements = deployments[template.stageId][template.side as 'attack' | 'defense']
      .filter((vehicle) => vehicle.spawnUid === template.uid)
      .map(({ spawnUid: _spawnUid, note: _note, ...vehicle }) => modeVehicle(vehicle))
    const deployVehicles = [...spawn.deployVehicles.filter((vehicle) => !stockIcons.has(vehicle.icon)), ...replacements]
    return { ...spawn, name, lat: updatePosition ? template.lat : spawn.lat, lng: updatePosition ? template.lng : spawn.lng, deployVehicles,
      vehicleDeploy: deployVehicles.length > 0,
      vehicleCategories: [...new Set(deployVehicles.map((v) => v.category))], verification: 'confirmed' as const }
  })
  const usedSpawnUids = new Set(spawns.map((spawn) => spawn.uid))
  for (const template of templates.filter((spawn) => affected.has(spawn.uid))) {
    // Existing built-in nodes deleted by the user stay deleted; only newly added hotfix nodes are inserted.
    if (legacySpawns.has(template.uid) || usedSpawnUids.has(template.uid)) continue
    const group = deployments[template.stageId]
    const deployVehicles = group[template.side as 'attack' | 'defense']
      .filter((v) => v.spawnUid === template.uid)
      .map(({ spawnUid: _spawnUid, note: _note, ...vehicle }) => modeVehicle(vehicle))
    spawns.push({ ...template, side: template.side as ModeSpawnPoint['side'], deployVehicles,
      vehicleDeploy: deployVehicles.length > 0, vehicleCategories: [...new Set(deployVehicles.map((v) => v.category))],
      verification: 'confirmed' })
    usedSpawnUids.add(template.uid)
  }

  const hidden = new Map(legacy.objectives.map((point) => [point.uid, point]))
  const removed = current.objectives.filter((point) => {
    const original = hidden.get(point.uid)
    return original?.stageId === point.stageId && original.icon === point.icon
  })
  const removedIds = new Set(removed.map((point) => point.uid))
  const objectives = current.objectives.filter((point) => !removedIds.has(point.uid))
  const zones = current.zones.filter((zone) => !removed.some((point) => zone.uid === point.captureZoneUid
    && zone.stageId === point.stageId && zone.role === 'capture'))

  const ziplineTemplates: ModeMapProp[] = snapshot.sharedZiplineProps.map((prop) => ({
    uid: prop.uid, stageId: '*', name: prop.name, icon: prop.icon, lat: prop.lat, lng: prop.lng, verification: 'confirmed',
    zipline: normalizeZiplineEndpoint(prop.zipline)!,
  }))
  const sameProp = (a: ModeMapProp, b: ModeMapProp) => a.name === b.name && a.icon === b.icon
    && Math.abs(a.lat - b.lat) < 0.000001 && Math.abs(a.lng - b.lng) < 0.000001
  const props = current.props.map((prop) => {
    const source = ziplineTemplates.find((item) => sameProp(prop, item))
    return source && prop.uid.startsWith('sync_skyport_prop-') ? { ...prop, uid: source.uid, zipline: { ...source.zipline! } } : prop
  })
  const usedPropUids = new Set(props.map((prop) => prop.uid))
  for (const prop of ziplineTemplates) {
    if (usedPropUids.has(prop.uid) || props.some((item) => sameProp(item, prop))) continue
    props.push({ ...prop })
    usedPropUids.add(prop.uid)
  }
  const merge = <T extends { uid: string }>(existing: T[], updates: T[]): T[] => {
    const byUid = new Map(updates.map((item) => [item.uid, item]))
    return [...existing.map((item) => byUid.has(item.uid) ? structuredClone(byUid.get(item.uid)!) : item),
      ...updates.filter((item) => !existing.some((prior) => prior.uid === item.uid)).map((item) => structuredClone(item))]
  }
  const vehicleRefreshPoints = merge(current.vehicleRefreshPoints, data.vehicleRefreshPoints as ModeMapOverride['vehicleRefreshPoints'])
  const vehicleRefreshRules = merge(current.vehicleRefreshRules, (data.vehicleRefreshRules as ModeMapOverride['vehicleRefreshRules'])
    .map((rule) => ({ ...rule, vehicle: modeVehicle(rule.vehicle) })))
  const oldCommanderNotes = new Set(['指挥官共用位置已更新，独立载具规则仍待核对。',
    '胜者为王临时底稿：深复制对应游戏数据端的攻防数据，尚未进行胜者专属适配；后续编辑与攻防相互独立。'])
  const noteLines = current.notes.split('\n').filter((note) => mode !== 'winner-takes-all' || !oldCommanderNotes.has(note))
  for (const note of [SKYPORT_PC_HOTFIX_NOTE, ...(mode === 'winner-takes-all' ? [SKYPORT_PC_COMMANDER_NOTE] : [])]) {
    if (!noteLines.includes(note)) noteLines.push(note)
  }
  const next = { ...current, spawns, objectives, zones, props, vehicleRefreshPoints, vehicleRefreshRules,
    notes: noteLines.filter(Boolean).join('\n') }
  return withSkyportPcStageFour(JSON.stringify(comparable(next)) === JSON.stringify(comparable(current))
    ? current : { ...next, updatedAt: Date.now() }, mode)
}

/** v50 adds the post-event view without replacing S1–S3 edits or custom objects. */
export function withSkyportPcStageFour(current: ModeMapOverride, mode: SkyportBuiltinMode): ModeMapOverride {
  if (current.mapId !== 'skyport') return current
  const data = mode === 'attack-defense' ? snapshot.attackDefense : snapshot.commanderDraft
  const stage = data.stages.find((item) => item.id === 'S4')!
  const point = stage.points[0]
  const objectiveUid = 'sync_skyport_S4_objective-0'
  const captureUid = 'sync_skyport_S4_point-0'
  const frontUid = 'sync_skyport_S4_front'
  const pointPairs = (points: number[][]): [number, number][] => points.map(([lat, lng]) => [lat, lng])
  const templates: ModeZone[] = [
    { uid: frontUid, stageId: 'S4', name: `S4 · ${stage.zone!.name}`, kind: 'neutral', role: 'frontline',
      objectiveUid: undefined, color: '#f4cf67', points: pointPairs(stage.zone!.latlngs), verification: 'draft' },
    { uid: captureUid, stageId: 'S4', name: `S4 · ${point.name}占领区`, kind: 'neutral', role: 'capture',
      objectiveUid, color: '#f4cf67', points: pointPairs(point.capturable), verification: 'confirmed' },
  ]
  const zones = current.zones.map((zone) => zone.uid === frontUid && !current.notes.includes(SKYPORT_PC_STAGE_FOUR_NOTE)
    && JSON.stringify(zone.points) === JSON.stringify(templates[0].points) ? { ...zone, verification: 'draft' as const } : zone)
  for (const template of templates) if (!zones.some((zone) => zone.uid === template.uid)) zones.push(template)
  const objectives = current.objectives.some((item) => item.uid === objectiveUid) ? current.objectives : [...current.objectives,
    { uid: objectiveUid, stageId: 'S4', name: point.name, icon: point.icon, note: point.note, captureZoneUid: captureUid,
      lat: point.lat, lng: point.lng, verification: 'confirmed' as const }]
  const spawns = [...current.spawns]
  for (const template of stage.spawns) {
    if (spawns.some((spawn) => spawn.uid === template.uid)) continue
    const deployVehicles = (data.deploy.S4[template.side as 'attack' | 'defense'] as unknown as Array<ModeDeployVehicle & { spawnUid: string }>)
      .filter((vehicle) => vehicle.spawnUid === template.uid).map(modeVehicle)
    spawns.push({ ...template, side: template.side as ModeSpawnPoint['side'], vehicleDeploy: deployVehicles.length > 0,
      vehicleCategories: [...new Set(deployVehicles.map((vehicle) => vehicle.category))], deployVehicles, verification: 'confirmed' })
  }
  const propTemplates: ModeMapProp[] = snapshot.eventZiplineProps.map((prop) => ({ uid: prop.uid, stageId: 'S4',
    name: prop.name, icon: prop.icon, lat: prop.lat, lng: prop.lng, verification: 'confirmed', zipline: normalizeZiplineEndpoint(prop.zipline)! }))
  const props = current.props.map((prop) => {
    const template = propTemplates.find((item) => prop.stageId === item.stageId && prop.icon === item.icon
      && Math.abs(prop.lat - item.lat) < 0.000001 && Math.abs(prop.lng - item.lng) < 0.000001)
    return template && prop.uid.startsWith('sync_skyport_prop-') ? { ...prop, uid: template.uid, zipline: { ...template.zipline! } } : prop
  })
  for (const prop of propTemplates) if (!props.some((item) => item.uid === prop.uid)) props.push(prop)
  const stages = [...current.stages]
  if (!stages.some((item) => item.id === 'S4')) stages.splice(stages.findIndex((item) => item.id === 'S3') + 1, 0,
    { id: stage.id, label: stage.label })
  const next = { ...current, stages, zones, objectives, spawns, props,
    notes: current.notes.includes(SKYPORT_PC_STAGE_FOUR_NOTE) ? current.notes
      : [current.notes, SKYPORT_PC_STAGE_FOUR_NOTE].filter(Boolean).join('\n') }
  return JSON.stringify(comparable(next)) === JSON.stringify(comparable(current)) ? current : { ...next, updatedAt: Date.now() }
}

/** v49 adds verified commander records while retaining all v48 position/facility edits. */
export function withSkyportPcCommanderRules(current: ModeMapOverride): ModeMapOverride {
  if (current.mapId !== 'skyport') return current
  const updated = withSkyportPcHotfix(current, 'winner-takes-all')
  const byUid = new Map(updated.spawns.map((spawn) => [spawn.uid, spawn]))
  const spawns = current.spawns.map((spawn) => {
    const next = byUid.get(spawn.uid)
    return next && next.stageId === spawn.stageId && next.side === spawn.side ? { ...spawn,
      deployVehicles: next.deployVehicles, vehicleCategories: next.vehicleCategories, vehicleDeploy: next.vehicleDeploy } : spawn
  })
  const next = { ...current, spawns, notes: updated.notes,
    vehicleRefreshPoints: updated.vehicleRefreshPoints, vehicleRefreshRules: updated.vehicleRefreshRules }
  return JSON.stringify(comparable(next)) === JSON.stringify(comparable(current)) ? current : { ...next, updatedAt: Date.now() }
}

/** v51 adopts the requested ORV threshold for the existing S2 FSV rule only. */
export function withSkyportPcS2FsvCondition(current: ModeMapOverride, mode: SkyportBuiltinMode): ModeMapOverride {
  if (current.mapId !== 'skyport') return current
  const data = mode === 'attack-defense' ? snapshot.attackDefense : snapshot.commanderDraft
  const template = data.vehicleRefreshRules.find((rule) => rule.objective === 'S2')!
  const vehicleRefreshRules = current.vehicleRefreshRules.map((rule) => {
    if (rule.uid !== template.uid || rule.objective !== 'S2' || rule.side !== 'attack'
      || rule.action !== 'refresh' || rule.vehicle.icon !== 'lstjp') return rule
    return { ...rule, trigger: { type: 'map-event' as const, value: template.trigger.value } }
  })
  const next = { ...current, vehicleRefreshRules }
  return JSON.stringify(comparable(next)) === JSON.stringify(comparable(current)) ? current : { ...next, updatedAt: Date.now() }
}

/** Remove the generated S2 FSV explanation without changing conditions or user notes. */
export function withoutSkyportPcS2FsvNote(current: ModeMapOverride, mode: SkyportBuiltinMode): ModeMapOverride {
  if (current.mapId !== 'skyport') return current
  const data = mode === 'attack-defense' ? snapshot.attackDefense : snapshot.commanderDraft
  const uid = data.vehicleRefreshRules.find((rule) => rule.objective === 'S2')!.uid
  const generatedNotes = new Set(['按用户要求，沿用原 S2 ORV 的80%兵力条件。', '低兵力时刷新，具体兵力阈值待核实。'])
  const vehicleRefreshRules = current.vehicleRefreshRules.map((rule) => {
    if (rule.uid !== uid || rule.objective !== 'S2' || rule.side !== 'attack'
      || rule.action !== 'refresh' || rule.vehicle.icon !== 'lstjp') return rule
    const note = rule.note.split('\n').filter((line) => !generatedNotes.has(line.trim())).join('\n')
    return note === rule.note ? rule : { ...rule, note }
  })
  const next = { ...current, vehicleRefreshRules }
  return JSON.stringify(comparable(next)) === JSON.stringify(comparable(current)) ? current : { ...next, updatedAt: Date.now() }
}

/** Attach source pairing to existing PC stock endpoints without moving or recreating them. */
export function withSkyportPcZiplineMetadata(current: ModeMapOverride, correctInheritedTransforms = false): ModeMapOverride {
  if (current.mapId !== 'skyport') return current
  const templates = new Map([...snapshot.sharedZiplineProps, ...snapshot.eventZiplineProps].map((prop) => [prop.uid, prop]))
  const priorPositions = new Map(snapshot.priorZiplinePositions.map((prop) => [prop.uid, prop.latlng]))
  const props = current.props.map((prop) => {
    const template = templates.get(prop.uid)
    if (!template || prop.name !== template.name || prop.icon !== template.icon
      || prop.stageId !== (template.stage || '*')) return prop
    const prior = priorPositions.get(prop.uid)
    const updatePosition = correctInheritedTransforms && prior && Math.abs(prop.lat - prior[0]) < .000001 && Math.abs(prop.lng - prior[1]) < .000001
    return { ...prop, ...(updatePosition ? { lat: template.lat, lng: template.lng } : {}), zipline: normalizeZiplineEndpoint(template.zipline)! }
  })
  const next = { ...current, props }
  return JSON.stringify(comparable(next)) === JSON.stringify(comparable(current)) ? current : { ...next, updatedAt: Date.now() }
}
