import type { ModeMapOverride } from '../types'

/** 完整校验一组生成位；拒绝损坏坐标，避免槽位顺序被筛选改变。 */
export function normalizeVehicleDeployPositions(value: unknown): [number, number][] | undefined {
  if (!Array.isArray(value) || !value.length || !value.every((point) => Array.isArray(point)
    && point.length === 2 && point.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate)))) return undefined
  return value.map((point) => [point[0], point[1]])
}

/** 已配置的槽位使用精确坐标，其余载具仍采用既有的复活点附近排布。 */
export function vehicleDeployPosition(
  entry: { deployPositions?: [number, number][] },
  fallback: [number, number],
  index: number,
): [number, number] {
  const point = normalizeVehicleDeployPositions(entry.deployPositions)?.[index]
  return point ?? [fallback[0] + index * 2.4, fallback[1]]
}

/** v59：只为仍存在的烬区 PC 胜者内置部署条目补齐生成位。 */
export function syncEmberPcVehicleDeployPositions(current: ModeMapOverride, builtin: ModeMapOverride): ModeMapOverride {
  return syncPcVehicleDeployPositions(current, builtin, 'ember')
}

/** v60：攀升按已核对的部署入口和车型补齐生成位。 */
export function syncAscentPcVehicleDeployPositions(current: ModeMapOverride, builtin: ModeMapOverride): ModeMapOverride {
  return syncPcVehicleDeployPositions(current, builtin, 'ascent')
}

function syncPcVehicleDeployPositions(current: ModeMapOverride, builtin: ModeMapOverride, mapId: 'ember' | 'ascent'): ModeMapOverride {
  if (current.mapId !== mapId || builtin.mapId !== mapId) return current
  let changed = false
  const spawns = current.spawns.map((spawn) => {
    const original = builtin.spawns.find((item) => item.uid === spawn.uid && item.stageId === spawn.stageId && item.side === spawn.side)
    if (!original) return spawn
    let spawnChanged = false
    const deployVehicles = spawn.deployVehicles.map((vehicle) => {
      if (vehicle.deployPositions?.length) return vehicle
      const source = original.deployVehicles.find((item) => item.icon === vehicle.icon)
      const positions = normalizeVehicleDeployPositions(source?.deployPositions)
      if (!positions) return vehicle
      spawnChanged = changed = true
      return {
        ...vehicle,
        deployPositions: positions,
        // 攀升 S2 两个 ATV 入口旧配置各为 2；实际各只有一个生成位。
        ...(mapId === 'ascent' && spawn.stageId === 'S2' && vehicle.icon === 'atvqdxc'
          && vehicle.num === 2 && source?.num === 1 && positions.length === 1 ? { num: 1 } : {}),
        ...(vehicle.clientSpawner ? { clientSpawner: { ...vehicle.clientSpawner, positionStatus: 'pc-level-verified' as const } } : {}),
      }
    })
    return spawnChanged ? { ...spawn, deployVehicles } : spawn
  })
  return changed ? { ...current, spawns, updatedAt: Date.now() } : current
}
