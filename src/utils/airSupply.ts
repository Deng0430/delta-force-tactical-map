import type { AirSupplyInfo } from '../types'

/** 与垂直滑索使用同规格角标；内联 SVG 保证 HTML 导出不依赖字体或外链。 */
export const AIR_SUPPLY_BADGE_HTML = '<span class="prop-air-supply" aria-hidden="true"><svg viewBox="0 0 24 24" width="11" height="11"><path fill="currentColor" d="M11 2h2l1 7 8 5v2l-8-2-1 6 3 2v1l-4-1-4 1v-1l3-2-1-6-8 2v-2l8-5z"/></svg></span>'

export function normalizeAirSupplyInfo(value: unknown): AirSupplyInfo | undefined {
  if (!value || typeof value !== 'object') return undefined
  const info = value as Partial<AirSupplyInfo>
  return info.reference === 'pc-world-z' && typeof info.elevationMeters === 'number' && Number.isFinite(info.elevationMeters)
    ? { elevationMeters: info.elevationMeters, reference: info.reference } : undefined
}

/** 自包含，HTML 导出也使用同一文案；不将世界坐标宣称为海拔。 */
export function airSupplyHeightLabel(info?: AirSupplyInfo): string {
  if (!info || info.reference !== 'pc-world-z' || typeof info.elevationMeters !== 'number' || !Number.isFinite(info.elevationMeters)) return '高度：未设置'
  return `高度：${Number(info.elevationMeters.toFixed(1))} 米（PC 世界坐标）`
}
