const fs = require('fs')
const path = require('path')
const vm = require('vm')

const source = process.argv[2] || path.join(process.env.TEMP || '.', 'df_official_map_mgjcq.js')
const target = path.resolve('src/config/mogOldTownOfficial.json')
const PROP_NAMES = new Set(['载具补给站', '固定防空炮', '固定机枪', '岸防炮', '滑索', '电梯', '固定弹药箱'])
const VEHICLES = {
  qxtk: { badge: '轻', category: 'tank' },
  atvqdxc: { badge: '全', category: 'recon' },
  lstjp: { badge: '炮', category: 'ifv', legendKey: 'nav_lstjp' },
}

const context = { window: {} }
vm.createContext(context)
vm.runInContext(fs.readFileSync(source, 'utf8'), context)
const info = context.window.mgjcq.info
const round = (value) => Math.round(value * 1000) / 1000
const convert = (x, y) => [
  round(-128 - (info.centerY + Number(y)) / (info.height / 128)),
  round(128 - (info.centerX - Number(x)) / (info.width / 128)),
]
const point = (item) => convert(item.x, item.y)
const border = (item = {}) => (item.border || []).map((value) => {
  const match = /X=([\d.-]+),Y=([\d.-]+)/.exec(value)
  return match && convert(match[1], match[2])
}).filter(Boolean)
const clean = (value) => !value || value === '-' ? '' : value

function stageOf(items, initEntry, index) {
  const initItems = initEntry?.typeList || items
  const objectives = items.filter((item) => /^q_jd_/.test(item.icon || ''))
  const attackBases = initItems.filter((item) => item.icon === 'g_jdbsd_r')
  const defenseBases = initItems.filter((item) => item.icon === 'f_jdbsd_g')
  const zone = items.find((item) => item.icon === 'g_qy')
  const vehicleGroups = new Map()
  for (const item of items) {
    const icon = (item.icon || '').replace(/^deploy_/, '')
    if (!VEHICLES[icon]) continue
    const key = `${item.name}:${icon}`
    const entry = vehicleGroups.get(key) || {
      name: item.name,
      badge: VEHICLES[icon].badge,
      category: VEHICLES[icon].category,
      icon,
      trigger: clean(item['激活条件']),
      pos: point(item),
      posList: [],
    }
    entry.posList.push(point(item))
    vehicleGroups.set(key, entry)
  }
  const baseBorder = (bases) => border(bases.find((item) => item.border?.length))
  const positions = (bases) => bases.map(point)
  return {
    id: `S${index + 1}`,
    label: `阶段${index + 1}`,
    points: objectives.map((item) => {
      const [lat, lng] = point(item)
      return { name: item.name, lat, lng, note: clean(item['自定义区域']), icon: item.icon, capturable: border(item) }
    }),
    zone: zone ? { name: `S${index + 1} · 摩格旧城区 S${index + 1} 防线`, latlngs: border(zone) } : null,
    attackSpawns: positions(attackBases),
    attackSpawnNames: attackBases.map((item) => clean(item['自定义区域'])),
    defenseSpawns: positions(defenseBases),
    defenseSpawnNames: defenseBases.map((item) => clean(item['自定义区域'])),
    attackBaseZone: baseBorder(attackBases),
    defenseBaseZone: baseBorder(defenseBases),
    attackVehicles: [...vehicleGroups.values()],
    defenseVehicles: [],
  }
}

function deployOf(entries, stage) {
  const result = { attack: [], defense: [] }
  for (const item of entries) {
    const icon = item.icon.replace(/^deploy_/, '')
    const meta = VEHICLES[icon] || { badge: item.name.slice(0, 1), category: 'recon' }
    const side = item['阵营'] === '防守方' ? 'defense' : 'attack'
    result[side].push({
      name: item.name,
      icon,
      ...(meta.legendKey ? { legendKey: meta.legendKey } : {}),
      iconUrl: `/icons/vehicles/deploy/deploy_${icon}.png`,
      cd: Number(item.CD) || (icon === 'lstjp' ? 90 : 0),
      num: Number(item.num) || 1,
      // 摩格旧城区当前官方 deploy 的备注为空；应用必须关联到一个稳定复活点。
      // 按官网数组语义使用该阵营本阶段的一号阵地作为方向盘挂载点。
      note: clean(item['备注']) || (side === 'attack' ? stage.attackSpawnNames[0] : stage.defenseSpawnNames[0]),
      allowTeammate: item['允许非队友的友方部署'] === '是',
      badge: meta.badge,
      category: meta.category,
    })
  }
  return result
}

function mapOf(raw) {
  const stages = raw.mapArticle.map((items, index) => stageOf(items, raw.init[index], index))
  const props = raw.mapArticle.flatMap((items, index) => items.filter((item) => PROP_NAMES.has(item.name)).map((item) => {
    const [lat, lng] = point(item)
    return { name: item.name, icon: item.icon, lat, lng, stage: `S${index + 1}` }
  }))
  return {
    stages,
    props,
    deploy: Object.fromEntries(raw.deploy.map((entries, index) => [`S${index + 1}`, deployOf(entries, stages[index])])),
  }
}

const pc = mapOf(context.window.mgjcq_pc)
const mobile = mapOf(context.window.mgjcq_mobile)
const output = {
  source: 'https://game.gtimg.cn/images/dfm/cp/a20240729directory/js/lib/map_mgjcq.js',
  generatedAt: '2026-09-11',
  mapId: 'mogoldtown',
  pc,
  mobile,
}
fs.writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`)
console.log(`Wrote ${target}`)
