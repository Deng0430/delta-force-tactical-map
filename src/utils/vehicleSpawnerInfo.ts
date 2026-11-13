import type { ModeMapOverride, VehicleSpawnerInfo } from '../types'

/** 导入/旧存档不能绕过规范化，也不把原始源码字段直接当运行时规则。 */
export function normalizeVehicleSpawnerInfo(value: unknown): VehicleSpawnerInfo | undefined {
  if (!value || typeof value !== 'object') return undefined
  const info = value as Partial<VehicleSpawnerInfo>
  if ((info.platform !== 'pc' && info.platform !== 'mobile')
    || (info.section !== 'standard' && info.section !== 'camp')
    || !Number.isInteger(info.mapId) || !Number.isInteger(info.vehicleId)
    || typeof info.tablePath !== 'string' || !info.tablePath
    || typeof info.rowName !== 'string' || !info.rowName
    || typeof info.template !== 'string' || !info.template
    || typeof info.sourceVehicleName !== 'string'
    || typeof info.singleUse !== 'boolean'
    || (info.cooldownStatus !== 'template-unresolved' && info.cooldownStatus !== 'pc-template-verified')
    || (info.positionStatus !== 'existing-unverified' && info.positionStatus !== 'pc-level-verified')) return undefined
  const spawnerIds = Array.isArray(info.spawnerIds)
    ? [...new Set(info.spawnerIds.filter((id): id is string => typeof id === 'string' && Boolean(id)))] : []
  if (!spawnerIds.length) return undefined
  if (info.cooldownStatus === 'pc-template-verified' && (info.platform !== 'pc'
    || typeof info.templateVehicleCd !== 'number' || !Number.isFinite(info.templateVehicleCd) || info.templateVehicleCd < 0
    || typeof info.templateSelfVehicleCd !== 'number' || !Number.isFinite(info.templateSelfVehicleCd) || info.templateSelfVehicleCd < 0)) return undefined
  const indices = (input: unknown) => Array.isArray(input)
    ? [...new Set(input.filter((n): n is number => Number.isInteger(n) && n >= 0))] : []
  if (info.singleUse && (!Number.isInteger(info.singleUseLimit) || Number(info.singleUseLimit) < 1)) return undefined
  return {
    platform: info.platform, mapId: Number(info.mapId), tablePath: info.tablePath,
    rowName: info.rowName, section: info.section, template: info.template,
    vehicleId: Number(info.vehicleId), sourceVehicleName: info.sourceVehicleName,
    spawnerIds, sectorIndices: indices(info.sectorIndices), conditionKeys: indices(info.conditionKeys),
    singleUse: info.singleUse,
    ...(info.singleUse ? { singleUseLimit: Number(info.singleUseLimit) } : {}),
    dynamicallyBalanced: Boolean(info.dynamicallyBalanced),
    cooldownStatus: info.cooldownStatus, positionStatus: info.positionStatus,
    ...(info.cooldownStatus === 'pc-template-verified' ? {
      templateVehicleCd: info.templateVehicleCd, templateSelfVehicleCd: info.templateSelfVehicleCd,
    } : {}),
    ...(info.vehicleNameConflict ? { vehicleNameConflict: true } : {}),
  }
}

export function vehicleSpawnerSummary(info: VehicleSpawnerInfo): string {
  return info.singleUse
    ? `本配置单次使用 · 上限 ${info.singleUseLimit}`
    : '本配置非单次使用 · 总次数待核实'
}

export function vehicleSpawnerDetails(info: VehicleSpawnerInfo, legacyCd: number): string[] {
  return [
    `来源：${info.platform === 'pc' ? 'PC' : '手游'}客户端表 · ${info.rowName}（${info.mapId}）。`,
    `生成点：${info.spawnerIds.join('、')}。`,
    ...(info.sectorIndices.length > 1 ? ['同一生成点在多个配置数组重复出现，已去重；不累计成多辆载具。'] : []),
    `${vehicleSpawnerSummary(info)}；不代表整局重生次数或全局同时在场上限。`,
    info.cooldownStatus === 'pc-template-verified'
      ? `PC静态模板已解析：VehicleCD=${info.templateVehicleCd}s，SelfVehicleCD=${info.templateSelfVehicleCd}s；在线对局最终冷却仍待核实，不采用未启用的 SelfInfo。`
      : `冷却待核实：公共模板 ${info.template} 尚未解析；当前配置 ${legacyCd}s 仅作参考，未采用未启用的 SelfInfo。`,
    info.positionStatus === 'pc-level-verified'
      ? '位置：已核对 PC 关卡的载具生成位坐标。'
      : '位置沿用现有地图标注，尚未确认对应数据端的专属关卡坐标。',
    ...(info.vehicleNameConflict
      ? [`源表车型名称与 ID 存在矛盾（${info.vehicleId} / ${info.sourceVehicleName}），暂保留原车型，等待核实。`] : []),
  ]
}

/** v45 只为已知内置载具补齐来源。不重建地图、不移动标记、不恢复用户删除的条目。 */
export function syncEmberPcWinnerSpawnerInfo(current: ModeMapOverride, builtin: ModeMapOverride): ModeMapOverride {
  let changed = false
  const spawns = current.spawns.map((spawn) => {
    const original = builtin.spawns.find((item) => item.uid === spawn.uid && item.stageId === spawn.stageId && item.side === spawn.side)
    if (!original) return spawn
    let spawnChanged = false
    const deployVehicles = spawn.deployVehicles.map((vehicle) => {
      const info = original.deployVehicles.find((item) => item.icon === vehicle.icon)?.clientSpawner
      if (!info || JSON.stringify(info) === JSON.stringify(vehicle.clientSpawner)) return vehicle
      spawnChanged = changed = true
      return { ...vehicle, clientSpawner: structuredClone(info) }
    })
    return spawnChanged ? { ...spawn, deployVehicles } : spawn
  })
  const vehicleRefreshRules = current.vehicleRefreshRules.map((rule) => {
    const original = builtin.vehicleRefreshRules.find((item) => item.uid === rule.uid
      && item.vehicle.icon === rule.vehicle.icon && item.side === rule.side
      && item.action === rule.action && item.objective === rule.objective
      && item.trigger.type === rule.trigger.type && item.trigger.value === rule.trigger.value)
    if (!original?.clientSpawner || JSON.stringify(original.clientSpawner) === JSON.stringify(rule.clientSpawner)) return rule
    changed = true
    return { ...rule, clientSpawner: structuredClone(original.clientSpawner) }
  })
  return changed ? { ...current, spawns, vehicleRefreshRules, updatedAt: Date.now() } : current
}
