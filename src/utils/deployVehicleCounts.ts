/** 累计部署次数包含首次部署；旧配置缺省为 1，与同时可用数量 num 独立。 */
export function normalizeDeploymentCount(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : 1
}

export function deploymentCountLabel(vehicle: { deployCount?: number; deployCountKnown?: boolean }): string {
  return vehicle.deployCountKnown === false ? '待确认' : String(normalizeDeploymentCount(vehicle.deployCount))
}
