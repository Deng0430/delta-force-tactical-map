const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const util = require('node:util')
const { createConfigLoader } = require('./lib/load-config-module.cjs')

const SOURCE_URL = 'https://game.gtimg.cn/images/dfm/cp/a20240729directory/js/lib/map_tjg.js'
const TILE_BASE = 'https://game.gtimg.cn/images/dfm/cp/a20240729directory/img'
const root = path.resolve(__dirname, '..')
const load = createConfigLoader(root)
const { makeAttackDefenseSpawnUid } = load('src/config/attackDefenseSpawns.ts')
const { DEPLOY_VEHICLE_CATALOG } = load('src/config/deployVehicles.ts')
const PROP_NAMES = new Set(['载具补给站', '固定防空炮', '固定机枪', '岸防炮', '滑索', '电梯', '固定弹药箱', '密集阵', '火神炮'])
const GROUND_VEHICLES = { q_lstjp: { badge: '炮', category: 'ifv' }, q_lqqdxc: { badge: '全', category: 'recon' } }
const round = (value) => Math.round(value * 1000) / 1000
const clean = (value) => value == null || value === '-' ? '' : String(value).trim()

function buildSkyportSnapshot(source, generatedAt) {
  const context = { window: {} }
  vm.createContext(context, { codeGeneration: { strings: false, wasm: false } })
  vm.runInContext(source, context, { timeout: 3000, filename: 'official-map_tjg.js' })
  const official = context.window
  const info = official.tjg?.info
  assert.ok(info && info.width > 0 && info.height > 0, '缺少官方地图标定参数')
  assert.equal(info.names_pc, info.names_mobile, '两端底图不同，需要单独核对地图路由')
  const warnings = new Set()
  const coordinate = (x, y) => {
    assert.ok(x !== '' && x != null && y !== '' && y != null && Number.isFinite(Number(x)) && Number.isFinite(Number(y)), '地图坐标缺失或无效')
    const px = Number(x), py = Number(y)
    const xr = info.width / 128, yr = info.height / 128
    if (info.rotate === 90) return [round(-128 + (info.centerX - px) / xr), round(128 - (info.centerY + py) / yr)]
    if (info.rotate === -90) return [round(-128 - (info.centerX - px) / xr), round(128 + (info.centerY + py) / yr)]
    return [round(-128 - (info.centerY + py) / yr), round(128 - (info.centerX - px) / xr)]
  }
  const point = (item) => coordinate(item.x, item.y)
  const border = (item) => (item?.border ?? []).map((value) => {
    const match = /X=([\d.+-]+),\s*Y=([\d.+-]+)/.exec(value)
    assert.ok(match, `无法识别区域顶点：${value}`)
    return coordinate(match[1], match[2])
  })

  function mapOf(platform) {
    const raw = official[`tjg_${platform}`]
    assert.ok(Array.isArray(raw?.mapArticle) && raw.mapArticle.length > 0, `缺少 ${platform} 攻防数据`)
    assert.equal(raw.init.length, raw.mapArticle.length)
    assert.equal(raw.deploy.length, raw.mapArticle.length)
    const stages = raw.mapArticle.map((items, index) => {
      const stageId = `S${index + 1}`
      const core = raw.init[index].typeList
      const objectives = core.filter((item) => /^q_jd_/.test(item.icon))
      const objectiveIcons = new Set(objectives.map((item) => item.icon))
      const extras = items.filter((item) => /^q_jd_/.test(item.icon) && !objectiveIcons.has(item.icon))
      if (extras.length) warnings.add(`${stageId} 官方明细重复包含 ${extras.map((item) => item.name).join('、')}；据点以官方 init 阶段定义为准，避免跨阶段重复。`)
      const bases = (side) => core.filter((item) => item.icon === (side === 'attack' ? 'g_jdbsd_r' : 'f_jdbsd_g'))
      const spawns = ['attack', 'defense'].flatMap((side) => bases(side).map((item, spawnIndex) => {
        const [lat, lng] = point(item)
        return {
          uid: makeAttackDefenseSpawnUid(platform, 'skyport', stageId, side, lat, lng),
          stageId, side, name: clean(item['自定义区域']) || `${stageId} · ${side === 'attack' ? '进攻方' : '防守方'}复活点 ${spawnIndex + 1}`,
          lat, lng,
        }
      }))
      const groups = new Map()
      for (const item of items) {
        if (/^(q_jd_|g_qy|g_jdbsd_r|f_jdbsd_g)/.test(item.icon) || PROP_NAMES.has(item.name)) continue
        const meta = GROUND_VEHICLES[item.icon]
        assert.ok(meta, `尚未识别的新地图元素：${item.name}/${item.icon}`)
        const key = `${item.name}:${item.icon}`
        const vehicle = groups.get(key) ?? { name: item.name, icon: item.icon, ...meta, trigger: clean(item['激活条件']), pos: point(item), posList: [] }
        vehicle.posList.push(point(item))
        groups.set(key, vehicle)
      }
      const frontline = core.find((item) => item.icon === 'g_qy')
      return {
        id: stageId, label: `阶段${index + 1}`,
        points: objectives.map((item) => {
          const [lat, lng] = point(item)
          return { name: item.name, icon: item.icon, note: clean(item['自定义区域']), lat, lng, capturable: border(item) }
        }),
        zone: frontline ? { name: `天际港 ${stageId} 防线`, latlngs: border(frontline) } : null,
        spawns,
        attackSpawns: spawns.filter((spawn) => spawn.side === 'attack').map((spawn) => [spawn.lat, spawn.lng]),
        defenseSpawns: spawns.filter((spawn) => spawn.side === 'defense').map((spawn) => [spawn.lat, spawn.lng]),
        attackSpawnNames: spawns.filter((spawn) => spawn.side === 'attack').map((spawn) => spawn.name),
        defenseSpawnNames: spawns.filter((spawn) => spawn.side === 'defense').map((spawn) => spawn.name),
        attackBaseZone: border(bases('attack').find((item) => item.border?.length)),
        defenseBaseZone: border(bases('defense').find((item) => item.border?.length)),
        attackVehicles: [...groups.values()], defenseVehicles: [],
      }
    })
    const props = new Map()
    raw.mapArticle.forEach((items, index) => items.filter((item) => PROP_NAMES.has(item.name)).forEach((item) => {
      const [lat, lng] = point(item)
      const key = `${item.name}:${item.icon}:${lat}:${lng}`
      const entry = props.get(key) ?? { name: item.name, icon: item.icon, lat, lng, stages: new Set() }
      entry.stages.add(`S${index + 1}`)
      props.set(key, entry)
    }))
    const deploy = Object.fromEntries(stages.map((stage, index) => {
      const deployments = { attack: [], defense: [] }
      for (const item of raw.deploy[index]) {
        assert.ok(['进攻方', '防守方'].includes(item['阵营']), '未知载具阵营')
        const side = item['阵营'] === '防守方' ? 'defense' : 'attack'
        const icon = item.name === '轻型坦克' ? 'qxtk' : item.icon.replace(/^deploy_/, '')
        const template = DEPLOY_VEHICLE_CATALOG.find((entry) => entry.icon === icon)
        assert.ok(template, `载具目录中缺少 ${item.name}/${icon}`)
        if (icon !== item.icon.replace(/^deploy_/, '')) warnings.add('官方轻型坦克沿用主战坦克图标键；按项目既有规范转换为 qxtk。')
        if (item.Sector !== stage.id) warnings.add(`${stage.id} ${side} ${item.name} 的源 Sector 为 ${item.Sector}；以官方部署列表所在阶段及复活点关联为准。`)
        const candidates = stage.spawns.filter((spawn) => spawn.side === side && spawn.name === clean(item['备注']))
        assert.equal(candidates.length, 1, `${platform} ${stage.id} ${item.name} 无法唯一关联复活点`)
        assert.ok(clean(item.CD) && Number.isFinite(Number(item.CD)), '官方载具冷却时间缺失')
        assert.ok(Number(item.num) > 0, '官方载具数量无效')
        deployments[side].push({
          ...template, cd: Number(item.CD), num: Number(item.num),
          note: candidates[0].name, spawnUid: candidates[0].uid,
          allowTeammate: item['允许非队友的友方部署'] === '是',
        })
      }
      return [stage.id, deployments]
    }))
    return {
      stages, deploy,
      props: [...props.values()].flatMap(({ stages: memberships, ...prop }) => memberships.size === stages.length
        ? [{ ...prop, stage: '' }]
        : [...memberships].map((stage) => ({ ...prop, stage }))),
    }
  }

  const pc = mapOf('pc'), mobile = mapOf('mobile')
  return {
    source: SOURCE_URL, generatedAt, mapId: 'skyport',
    sourceSha256: crypto.createHash('sha256').update(source).digest('hex'),
    sourceInfo: JSON.parse(JSON.stringify(info)),
    officialPcMobileParity: ['init', 'mapArticle', 'deploy'].every((key) => util.isDeepStrictEqual(official.tjg_pc[key], official.tjg_mobile[key])),
    importNotes: [...warnings],
    mapConfig: {
      id: 'skyport', name: '天际港', enName: 'Skyport', layerName: info.names_pc,
      tileUrl: `${TILE_BASE}/${info.names_pc}/{z}_{x}_{y}.jpg`,
      minZoom: info.minZoom, initZoom: info.initZoom, maxZoom: 8, maxNativeZoom: 4,
      boundsW: info.boundsW, boundsH: info.boundsH,
      southWest: [0, -80], northEast: [-(info.boundsH - 70), -info.boundsW], initCenter: [info.initX, info.initY],
    },
    pc, mobile,
  }
}

async function generate() {
  const response = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(30000) })
  assert.ok(response.ok, `官方数据下载失败：HTTP ${response.status}`)
  const generatedAt = process.argv.find((arg) => arg.startsWith('--date='))?.slice(7)
    ?? new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
  const snapshot = buildSkyportSnapshot(await response.text(), generatedAt)
  const icons = new Set([snapshot.pc, snapshot.mobile].flatMap((map) => [
    ...map.props.map((prop) => prop.icon),
    ...map.stages.flatMap((stage) => [...stage.points, ...stage.attackVehicles, ...stage.defenseVehicles].map((item) => item.icon)),
  ]))
  for (const icon of icons) {
    const target = path.join(root, 'public/icons/map-props', `${icon}.png`)
    if (fs.existsSync(target)) continue
    const asset = await fetch(`${TILE_BASE}/dzc_i/${icon}.png`, { signal: AbortSignal.timeout(15000) })
    assert.ok(asset.ok && asset.headers.get('content-type')?.includes('image/png'), `图标下载失败：${icon}`)
    const bytes = Buffer.from(await asset.arrayBuffer())
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', '图标不是有效 PNG')
    fs.writeFileSync(target, bytes)
  }
  const target = path.join(root, 'src/config/skyportOfficial.json')
  fs.writeFileSync(target, `${JSON.stringify(snapshot, null, 2)}\n`)
  console.log(`Wrote ${target}; PC/mobile: ${snapshot.pc.stages.length} stages, ${snapshot.pc.props.length} props each.`)
  snapshot.importNotes.forEach((note) => console.log(note))
}

if (require.main === module) generate().catch((error) => { console.error(error); process.exitCode = 1 })
module.exports = { buildSkyportSnapshot, SOURCE_URL }
