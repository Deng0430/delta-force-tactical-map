/**
 * 客户端 CommonHud 图集中的原始透明图标，分别保留手游/PC来源。
 * 仅替换显示素材，不改变 PC/手游的载具、数量或刷新规则。
 * 用户确认：0111 为侦察直升机，0109 为轻型战术车；鱼鹰仍用 0117，山猫暂用PC 0118。
 */
export const MOBILE_VEHICLE_HUD_SPRITES: Readonly<Record<string, string>> = {
  aakfc: '0101',
  cfz: '0102',
  m1a4zztk: '0103',
  losvjpc: '0109',
  atvqdxc: '0105',
  tjzsj: '0106',
  g1bzc: '0107',
  orvtjc: '0108',
  lstjp: '0110',
  xnzsj: '0111',
  qxtk: '0113',
  f45azdj: '0114',
  sxzjc: '0115',
  mtt: '0116',
  ymfg: '0117',
}

/** PC CommonHud 新增图标；用户指定山猫暂用0118，不代表自动核实了原生车型绑定。 */
export const PC_VEHICLE_HUD_SPRITES: Readonly<Record<string, string>> = {
  csvp: '0118',
}

export const VEHICLE_LEGEND_ASSET_BY_DEPLOY_KEY: Readonly<Record<string, string>> = {
  ...Object.fromEntries(Object.entries(MOBILE_VEHICLE_HUD_SPRITES).map(([key, sprite]) => [
    key, `/icons/vehicles/mobile-hud/HUD_Screen_Icon_${sprite}.png`,
  ])),
  ...Object.fromEntries(Object.entries(PC_VEHICLE_HUD_SPRITES).map(([key, sprite]) => [
    key, `/icons/vehicles/pc-hud/HUD_Screen_Icon_${sprite}.png`,
  ])),
  // 提取资源尚未确认攻击艇专用图；不以冲锋舟/摩托艇冒充攻击艇。
  ucb9597: '/icons/vehicles/legend/UCB-95-97攻击艇-透明.png',
}

export function vehicleLegendAssetUrl(deployKey: string): string | undefined {
  const key = deployKey.replace(/^(nav_|q_|deploy_)/, '')
  const canonicalKey = key === 'fkc' ? 'aakfc' : key === 'zczsj' ? 'xnzsj' : key
  return VEHICLE_LEGEND_ASSET_BY_DEPLOY_KEY[canonicalKey]
}
