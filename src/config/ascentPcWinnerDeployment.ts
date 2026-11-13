import type { ModeDeployVehicle, ModeMapOverride } from '../types'
import { DEPLOY_VEHICLE_CATALOG } from './deployVehicles'
import { normalizeDeploymentCount } from '../utils/deployVehicleCounts'
import { normalizeVehicleSpawnerInfo } from '../utils/vehicleSpawnerInfo'
import snapshot from './ascentPcWinnerDeployData.json'

export const ASCENT_PC_DEPLOYMENT_NOTE = 'PC胜者攀升部署按MapID601资源配置：车型、生成位、次数开关及上限、模板CD。待核入口：S1攻方LOSV、S1攻方ATV、S2守方防空车、S2守方LOSV；仅保留来源记录，不猜测挂载。'
const asVehicle = (source: typeof snapshot.deployments[number]['vehicle']): ModeDeployVehicle => {
  const catalog = DEPLOY_VEHICLE_CATALOG.find((v) => v.icon === source.icon)
  return { name: source.name, icon: source.icon, legendKey: source.legendKey,
    category: (catalog?.category ?? source.category) as ModeDeployVehicle['category'],
    iconUrl: catalog?.iconUrl ?? source.iconUrl, badge: source.badge,
    num: source.num, cd: source.cd, deployCount: source.deployCount,
    ...(source.deployCountKnown === false ? { deployCountKnown: false } : {}),
    allowTeammate: source.allowTeammate,
    deployPositions: source.deployPositions.map(([lat, lng]) => [lat, lng]),
    clientSpawner: normalizeVehicleSpawnerInfo(source.clientSpawner) }
}

/** 全量PC资源作为内置基线；旧配置只替换原始默认值，保留用户主动修改。 */
export function withAscentPcWinnerDeployment(current: ModeMapOverride): ModeMapOverride {
  if (current.mapId !== 'ascent') return current
  const spawns = current.spawns.map((spawn) => {
    const entries = snapshot.deployments.filter((e) => e.stageId === spawn.stageId && e.side === spawn.side && e.spawnUid === spawn.uid)
    const retired = snapshot.removedLegacy.filter((r) => r.stageId === spawn.stageId && r.side === spawn.side && r.spawnUid === spawn.uid)
    if (!entries.length && !retired.length) return spawn
    let deployVehicles = spawn.deployVehicles.filter((v) => !retired.some((r) => r.vehicle.icon === v.icon
      && v.num === r.vehicle.num && v.cd === r.vehicle.cd
      && v.name === r.vehicle.name && v.badge === r.vehicle.badge
      && v.category === r.vehicle.category && v.allowTeammate === r.vehicle.allowTeammate
      && normalizeDeploymentCount(v.deployCount) === normalizeDeploymentCount((r.vehicle as Partial<ModeDeployVehicle>).deployCount)
      && !v.deployPositions?.length))
    deployVehicles = deployVehicles.map((vehicle): ModeDeployVehicle => {
      const entry = entries.find((e) => e.vehicle.icon === vehicle.icon)
      if (!entry) return vehicle
      const desired = asVehicle(entry.vehicle)
      const legacy = entry.legacyVehicle ?? desired
      const customCount = normalizeDeploymentCount(vehicle.deployCount) !== normalizeDeploymentCount(legacy.deployCount)
        && normalizeDeploymentCount(vehicle.deployCount) !== desired.deployCount
      const customCd = vehicle.cd !== legacy.cd && vehicle.cd !== desired.cd
      const next: ModeDeployVehicle = { ...vehicle, num: vehicle.num !== legacy.num ? vehicle.num : desired.num,
        cd: customCd ? vehicle.cd : desired.cd,
        deployCount: customCount ? vehicle.deployCount : desired.deployCount,
        deployPositions: vehicle.deployPositions?.length ? vehicle.deployPositions : desired.deployPositions,
        clientSpawner: desired.clientSpawner }
      if (!customCd) delete next.cooldownKnown
      if ((customCount ? vehicle.deployCountKnown : desired.deployCountKnown) === false) next.deployCountKnown = false
      else delete next.deployCountKnown
      return next
    })
    for (const entry of entries) {
      // Only a genuinely new resource entry is inserted; deleted legacy entries stay deleted.
      if (!entry.legacyVehicle && !deployVehicles.some((v) => v.icon === entry.vehicle.icon)) deployVehicles.push(asVehicle(entry.vehicle))
    }
    return { ...spawn, deployVehicles, vehicleDeploy: deployVehicles.length > 0,
      vehicleCategories: [...new Set(deployVehicles.map((v) => v.category))] }
  })
  const notes = current.notes.split('\n').includes(ASCENT_PC_DEPLOYMENT_NOTE) ? current.notes
    : [current.notes, ASCENT_PC_DEPLOYMENT_NOTE].filter(Boolean).join('\n')
  if (notes === current.notes && JSON.stringify(spawns) === JSON.stringify(current.spawns)) return current
  return { ...current, spawns, notes, updatedAt: Date.now() }
}
