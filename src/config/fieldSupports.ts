import type { FieldSupportDefinition } from '../types'

const BASE = '/icons/field-supports'

interface FieldSupportRange {
  radiusMeters: number
  label: string
  color: string
  kind?: 'damage' | 'effect' | 'placement'
}

/** 制导导弹水平伤害范围；由米制底图标定换算，不使用旧实例的示意半径。 */
export const GUIDED_MISSILE_DAMAGE_RANGES = [
  { radiusMeters: 15, label: '15 米内：满伤 310', color: '#ef4b46' },
  { radiusMeters: 30, label: '30 米内：步兵致死', color: '#f59b3d' },
  { radiusMeters: 35, label: '35 米：衰减至 0 伤害', color: '#f4cf67' },
] as const

/** PC 指挥官配置；最低伤害为配置参数，不代表外沿的实测扣血。 */
export const ARTILLERY_SALVO_STATS = {
  shellCount: 25,
  fireIntervalSeconds: 1.5,
  explosionRadiusMeters: 8,
  fullDamageRadiusMeters: 2.5,
  baseInfantryDamage: 120,
  minInfantryDamage: 50,
  placementScaleMeters: 13,
  randomOffsetMeters: 5,
} as const

const ARTILLERY_MAX_PLACEMENT_RADIUS_METERS = ARTILLERY_SALVO_STATS.placementScaleMeters + ARTILLERY_SALVO_STATS.randomOffsetMeters
const ARTILLERY_MAX_IMPACT_RADIUS_METERS = ARTILLERY_MAX_PLACEMENT_RADIUS_METERS + ARTILLERY_SALVO_STATS.explosionRadiusMeters

/** 单发伤害参数保留在说明中，炮兵齐射地图圈采用整轮范围。 */
export const ARTILLERY_SALVO_DAMAGE_RANGES = [
  { radiusMeters: ARTILLERY_SALVO_STATS.fullDamageRadiusMeters, label: `单发人物满伤半径：${ARTILLERY_SALVO_STATS.fullDamageRadiusMeters} 米`, color: '#ef4b46' },
  { radiusMeters: ARTILLERY_SALVO_STATS.explosionRadiusMeters, label: `单发人物爆炸半径：${ARTILLERY_SALVO_STATS.explosionRadiusMeters} 米`, color: '#f59b3d' },
] as const

/** PC 区域烟幕（地图工具中的烟幕覆盖），单团与整轮布点尺度分开。 */
export const SMOKE_COVER_STATS = {
  shellCount: 6,
  fireIntervalSeconds: .8,
  cloudRadiusMeters: 6,
  cloudHeightMeters: 4,
  cloudLifetimeSeconds: 15,
  fadeInSeconds: 1,
  fadeOutSeconds: 1,
  placementScaleMeters: 30,
  randomOffsetMeters: 2,
} as const

/** PC 默认未开放；持续效果参数不能用于推算每跳或总伤害。 */
export const THERMOBARIC_BOMB_STATS = {
  shellCount: 1,
  explosionRadiusMeters: 5,
  fullDamageRadiusMeters: 2.5,
  baseInfantryDamage: 110,
  minInfantryDamage: 50,
  baseVehicleDamage: 900,
  minVehicleDamage: 400,
  effectRadiusMeters: 30,
  effectDelaySeconds: 1,
  effectDurationSeconds: 10,
  effectPeriodSeconds: .5,
} as const

/**
 * 布点参数依用户要求暂按圆半径展示，虚线不代表已验证的整轮覆盖边界。
 * 炮兵依用户指定展示 13 米布点、18 米最大布点及 26 米最外可能伤害范围。
 */
const FIELD_SUPPORT_RANGES: Record<string, readonly FieldSupportRange[] | undefined> = {
  'guided-missile': GUIDED_MISSILE_DAMAGE_RANGES,
  'artillery-salvo': [
    { radiusMeters: ARTILLERY_SALVO_STATS.placementScaleMeters, label: `布点范围：半径 ${ARTILLERY_SALVO_STATS.placementScaleMeters} 米`, color: '#f4cf67', kind: 'placement' },
    { radiusMeters: ARTILLERY_MAX_PLACEMENT_RADIUS_METERS, label: `最大布点范围：半径 ${ARTILLERY_MAX_PLACEMENT_RADIUS_METERS} 米`, color: '#83b7ff', kind: 'placement' },
    { radiusMeters: ARTILLERY_MAX_IMPACT_RADIUS_METERS, label: `最外可能伤害范围：半径 ${ARTILLERY_MAX_IMPACT_RADIUS_METERS} 米`, color: '#ef4b46', kind: 'effect' },
  ],
  'smoke-cover': [
    { radiusMeters: SMOKE_COVER_STATS.cloudRadiusMeters, label: `单团烟幕半径：${SMOKE_COVER_STATS.cloudRadiusMeters} 米`, color: '#c2cdd5', kind: 'effect' },
    { radiusMeters: SMOKE_COVER_STATS.placementScaleMeters, label: `布点圆示意：半径 ${SMOKE_COVER_STATS.placementScaleMeters} 米（暂定）`, color: '#8d9da8', kind: 'placement' },
  ],
  'thermobaric-bomb': [
    { radiusMeters: THERMOBARIC_BOMB_STATS.fullDamageRadiusMeters, label: `初始人物满伤半径：${THERMOBARIC_BOMB_STATS.fullDamageRadiusMeters} 米`, color: '#ef4b46' },
    { radiusMeters: THERMOBARIC_BOMB_STATS.explosionRadiusMeters, label: `初始人物爆炸半径：${THERMOBARIC_BOMB_STATS.explosionRadiusMeters} 米`, color: '#f59b3d' },
    { radiusMeters: THERMOBARIC_BOMB_STATS.effectRadiusMeters, label: `持续效果范围参数：半径 ${THERMOBARIC_BOMB_STATS.effectRadiusMeters} 米`, color: '#f4cf67', kind: 'effect' },
  ],
}

/** 统一换算伤害、烟幕、持续效果与暂定布点圈，未标定地图不猜测比例。 */
export function fieldSupportRangeRings(definitionId: string, metersPerMapUnit?: number) {
  const ranges = FIELD_SUPPORT_RANGES[definitionId]
  if (!ranges || !Number.isFinite(metersPerMapUnit)
    || !metersPerMapUnit || metersPerMapUnit <= 0) return []
  return ranges.map((range, index) => ({
    ...range,
    mapRadius: range.radiusMeters / metersPerMapUnit,
    weight: index === 0 ? 2 : 1.5,
    opacity: index === ranges.length - 1 ? .75 : .95,
    fill: range.kind !== 'placement',
    fillOpacity: range.kind === 'placement' ? 0 : index === 0 ? .12 : .045,
    dashArray: range.kind === 'placement' ? '7 5' : index === ranges.length - 1 ? '5 4' : undefined,
  }))
}

/** 胜者为王地图工具中提供的阵地支援资源。 */
export const FIELD_SUPPORTS: FieldSupportDefinition[] = [
  {
    id: 'guided-missile', name: '制导导弹', iconUrl: `${BASE}/deploy_zddd.png`,
    description: '15米内满伤310 · 30米步兵致死 · 35米0伤',
    details: GUIDED_MISSILE_DAMAGE_RANGES.map((range) => range.label),
    defaultRadius: 35,
  },
  { id: 'strategic-beacon', name: '战略信标', iconUrl: `${BASE}/deploy_zlxb.png`, description: '部署战略信标 · 60s', detailNote: '60s', defaultRadius: 48 },
  {
    id: 'artillery-salvo', name: '炮兵齐射', iconUrl: `${BASE}/deploy_pbqf.png`,
    description: `${ARTILLERY_SALVO_STATS.shellCount} 发 · 间隔 ${ARTILLERY_SALVO_STATS.fireIntervalSeconds} 秒 · 最外影响半径 ${ARTILLERY_MAX_IMPACT_RADIUS_METERS} 米`,
    details: [
      `炮弹数量：${ARTILLERY_SALVO_STATS.shellCount} 发`,
      `发射间隔：${ARTILLERY_SALVO_STATS.fireIntervalSeconds} 秒`,
      ARTILLERY_SALVO_DAMAGE_RANGES[1].label,
      ARTILLERY_SALVO_DAMAGE_RANGES[0].label,
      `单发基础人物伤害：${ARTILLERY_SALVO_STATS.baseInfantryDamage} 点`,
      `单发最低人物伤害参数：${ARTILLERY_SALVO_STATS.minInfantryDamage} 点`,
      `布点范围：半径 ${ARTILLERY_SALVO_STATS.placementScaleMeters} 米`,
      `额外随机偏移参数：${ARTILLERY_SALVO_STATS.randomOffsetMeters} 米`,
      `最大布点范围：半径 ${ARTILLERY_MAX_PLACEMENT_RADIUS_METERS} 米`,
      `最外可能伤害范围：半径 ${ARTILLERY_MAX_IMPACT_RADIUS_METERS} 米`,
    ],
    detailNote: '黄色圈（13m）：布点范围；蓝色圈（18m）：包含随机偏移的最大布点范围；红色圈（26m）：包含爆炸半径的最外可能伤害范围。',
    defaultRadius: ARTILLERY_SALVO_STATS.placementScaleMeters,
  },
  {
    id: 'smoke-cover', name: '烟幕覆盖', iconUrl: `${BASE}/deploy_ymfg.png`,
    description: `${SMOKE_COVER_STATS.shellCount} 发 · 间隔 ${SMOKE_COVER_STATS.fireIntervalSeconds} 秒 · 单团半径 ${SMOKE_COVER_STATS.cloudRadiusMeters} 米`,
    details: [
      '区域烟幕：炮击投送烟幕，爆炸人物/载具伤害均为 0',
      `烟幕弹数量：${SMOKE_COVER_STATS.shellCount} 发；发射间隔：${SMOKE_COVER_STATS.fireIntervalSeconds} 秒`,
      `单团烟幕半径：${SMOKE_COVER_STATS.cloudRadiusMeters} 米；高度参数：${SMOKE_COVER_STATS.cloudHeightMeters} 米`,
      `单团寿命参数：${SMOKE_COVER_STATS.cloudLifetimeSeconds} 秒`,
      `淡入/淡出参数：各 ${SMOKE_COVER_STATS.fadeInSeconds} 秒（是否计入寿命未确认）`,
      `布点圆示意：半径 ${SMOKE_COVER_STATS.placementScaleMeters} 米（暂定）`,
      `额外随机偏移参数：${SMOKE_COVER_STATS.randomOffsetMeters} 米`,
    ],
    detailNote: 'PC 配置参考；整片覆盖由 6 团实际落点决定，30 米虚线仅为配置尺度圆示意。',
    defaultRadius: SMOKE_COVER_STATS.placementScaleMeters,
  },
  {
    id: 'thermobaric-bomb', name: '温压弹', iconUrl: `${BASE}/deploy_wyd.png`,
    description: `PC 默认未开放 · 初始爆炸 ${THERMOBARIC_BOMB_STATS.explosionRadiusMeters} 米 / 持续效果 ${THERMOBARIC_BOMB_STATS.effectRadiusMeters} 米`,
    details: [
      '配置说明：对建筑内人员造成伤害',
      `投弹数量：${THERMOBARIC_BOMB_STATS.shellCount} 发`,
      `初始爆炸：满伤半径 ${THERMOBARIC_BOMB_STATS.fullDamageRadiusMeters} 米 / 人物爆炸半径 ${THERMOBARIC_BOMB_STATS.explosionRadiusMeters} 米`,
      `人物伤害参数：基础 ${THERMOBARIC_BOMB_STATS.baseInfantryDamage} / 最低 ${THERMOBARIC_BOMB_STATS.minInfantryDamage}`,
      `载具伤害参数：基础 ${THERMOBARIC_BOMB_STATS.baseVehicleDamage} / 最低 ${THERMOBARIC_BOMB_STATS.minVehicleDamage}`,
      `持续效果范围参数：半径 ${THERMOBARIC_BOMB_STATS.effectRadiusMeters} 米`,
      `持续效果参数：延迟 ${THERMOBARIC_BOMB_STATS.effectDelaySeconds} 秒 / 持续 ${THERMOBARIC_BOMB_STATS.effectDurationSeconds} 秒`,
      `周期参数：${THERMOBARIC_BOMB_STATS.effectPeriodSeconds} 秒；每跳伤害未确认`,
    ],
    detailNote: 'PC 配置默认未开放，仅供自由推演参考；持续伤害及遮挡结算未确认。',
    defaultRadius: THERMOBARIC_BOMB_STATS.effectRadiusMeters,
  },
  { id: 'vehicle-airdrop', name: '载具空投', iconUrl: `${BASE}/deploy_clkt.png`, description: '向指定位置空投载具支援', defaultRadius: 48 },
]

export function fieldSupportOf(id: string): FieldSupportDefinition | undefined {
  return FIELD_SUPPORTS.find((item) => item.id === id)
}
