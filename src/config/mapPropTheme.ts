export interface MapPropTheme {
  color: string
  size: number
}

/** 正式版、模式配置器与 HTML 导出共用道具颜色和视觉尺寸。 */
export const MAP_PROP_THEMES: Readonly<Record<string, MapPropTheme>> = {
  载具补给站: { color: '#2f6fed', size: 28 },
  空中载具补给站: { color: '#2f6fed', size: 28 },
  固定防空炮: { color: '#e0453a', size: 28 },
  密集阵: { color: '#32b8c6', size: 28 },
  火神炮: { color: '#e0453a', size: 28 },
  固定机枪: { color: '#f08c2a', size: 26 },
  岸防炮: { color: '#d63f3f', size: 28 },
  滑索: { color: '#2ec4b6', size: 24 },
  电梯: { color: '#8b98ab', size: 24 },
  固定弹药箱: { color: '#f4cf67', size: 24 },
}

export const DEFAULT_MAP_PROP_THEME: MapPropTheme = { color: '#8b98ab', size: 26 }

export function mapPropThemeOf(name: string): MapPropTheme {
  return MAP_PROP_THEMES[name] ?? DEFAULT_MAP_PROP_THEME
}
