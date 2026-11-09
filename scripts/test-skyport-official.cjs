const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { createConfigLoader } = require('./lib/load-config-module.cjs')
const { buildSkyportSnapshot, SOURCE_URL } = require('./generate-skyport-official.cjs')

const root = path.resolve(__dirname, '..')
const load = createConfigLoader(root)
const snapshot = load('src/config/skyportOfficial.json')
const { MAPS, MAP_BY_ID } = load('src/config/maps.ts')
const { stagesForPlatform, propsForPlatform, deployForPlatform } = load('src/config/gameDataPlatform.ts')
const { stageCount } = load('src/config/points.ts')
const {
  loadModeConfigStore, normalizeModeConfigStore, buildRuntimeModeData,
  buildOfficialModeData, importModeConfigData, MODE_CONFIG_STORAGE_KEY,
} = load('src/utils/modeConfigStorage.ts')
const storage = new Map()
let writes = 0
const originalStorage = globalThis.localStorage
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => { writes++; storage.set(key, value) },
}
test.after(() => {
  if (originalStorage === undefined) delete globalThis.localStorage
  else globalThis.localStorage = originalStorage
})

const platforms = ['pc', 'mobile']
const modes = ['attack-defense', 'winner-takes-all']
const clone = (value) => JSON.parse(JSON.stringify(value))
const profileOf = (store, mode) => store.profiles.find((profile) => profile.id === mode)
const mapOf = (store, mode, platform) => profileOf(store, mode).platformMaps[platform].skyport
const dataOf = ({ notes, updatedAt, ...data }) => data
function freshStore() {
  storage.clear()
  return loadModeConfigStore()
}
function oldStore() {
  const store = clone(freshStore())
  store.version = 40
  for (const mode of modes) {
    const profile = profileOf(store, mode)
    delete profile.maps.skyport
    for (const platform of platforms) delete profile.platformMaps[platform].skyport
  }
  return store
}

function assertNoSharedObjects(left, right) {
  const leftObjects = new Set()
  function visit(value, callback, visited = new Set()) {
    if (!value || typeof value !== 'object' || visited.has(value)) return
    visited.add(value)
    callback(value)
    for (const child of Object.values(value)) visit(child, callback, visited)
  }
  visit(left, (value) => leftObjects.add(value))
  visit(right, (value) => assert.ok(!leftObjects.has(value), '不同模式/数据端存在共享的对象或数组'))
}

test('天际港进入正式版/编辑器共用的地图目录，使用官方标定和原生 4 级瓦片', () => {
  assert.equal(MAPS.filter((map) => map.id === 'skyport').length, 1)
  assert.equal(MAPS.length, 13)
  const config = MAP_BY_ID.skyport
  assert.equal(config.name, '天际港')
  assert.equal(config.layerName, 'map_tjg')
  assert.equal(config.maxNativeZoom, 4)
  assert.deepEqual(config.initCenter, [snapshot.sourceInfo.initX, snapshot.sourceInfo.initY])
  assert.deepEqual(config.northEast, [-230, 300])
  assert.ok(config.tileUrl.includes('/map_tjg/{z}_{x}_{y}.jpg'))
  assert.equal(stageCount('skyport'), 3)
  for (const file of ['src/components/Toolbar.tsx', 'src/components/ModeConfigWorkbench.tsx']) {
    assert.match(fs.readFileSync(path.join(root, file), 'utf8'), /MAPS\.map\(/, file)
  }
})

test('双端固化三个阶段/七个据点，完整保留防线、占领区和攻守活动区', () => {
  for (const platform of platforms) {
    const stages = snapshot[platform].stages
    assert.deepEqual(stages.map((stage) => stage.points.map((point) => point.name)), [
      ['据点A1', '据点A2'], ['据点B1', '据点B2'], ['据点C1', '据点C2', '据点C3'],
    ])
    assert.deepEqual(stages.map((stage) => stage.spawns.length), [4, 4, 5])
    assert.deepEqual(stages.map((stage) => [stage.attackBaseZone.length, stage.defenseBaseZone.length]), [[17, 9], [7, 10], [21, 16]])
    assert.deepEqual(stages.map((stage) => stage.zone.latlngs.length), [8, 7, 19])
    assert.deepEqual(stages.map((stage) => stage.points.map((point) => point.capturable.length)), [[5, 5], [5, 16], [8, 7, 5]])
    assert.deepEqual([stages[0].points[0].lat, stages[0].points[0].lng], [-126.758, 160.868])
    for (const stage of stages) {
      for (const spawn of stage.spawns) assert.ok(spawn.uid.startsWith(`spawn_ad_${platform}_skyport_`))
      for (const area of [stage.attackBaseZone, stage.defenseBaseZone, stage.zone.latlngs, ...stage.points.map((point) => point.capturable)]) {
        assert.ok(area.every((point) => point.length === 2 && point.every(Number.isFinite)))
      }
    }
  }
})

test('载具全部通过同阶段/同阵营 UID 挂载；S2 轻坦使用正确阶段和图标', () => {
  for (const platform of platforms) {
    const map = snapshot[platform]
    assert.deepEqual(Object.values(map.deploy).map((stage) => [stage.attack.length, stage.defense.length]), [[1, 1], [3, 2], [3, 0]])
    for (const stage of map.stages) {
      for (const side of ['attack', 'defense']) {
        for (const vehicle of map.deploy[stage.id][side]) {
          const matches = stage.spawns.filter((spawn) => spawn.uid === vehicle.spawnUid && spawn.side === side)
          assert.equal(matches.length, 1)
          assert.equal(vehicle.note, matches[0].name)
          assert.equal(vehicle.num, 1)
          assert.ok(fs.existsSync(path.join(root, 'public', vehicle.iconUrl.replace(/^\//, ''))))
        }
      }
    }
    const tank = map.deploy.S2.defense.find((vehicle) => vehicle.icon === 'qxtk')
    assert.equal(tank.name, 'GTQ-35轻型坦克')
    assert.equal(tank.cd, 90)
    assert.ok(tank.spawnUid.includes('_s2_defense_'))
    assert.ok(tank.iconUrl.includes('轻型坦克'))
  }
})

test('34 个全局道具不按阶段重复叠加，火神炮/两栖全地形车使用本地图标', () => {
  for (const platform of platforms) {
    const map = snapshot[platform]
    assert.equal(map.props.length, 34)
    assert.ok(map.props.every((prop) => prop.stage === ''))
    assert.equal(map.props.filter((prop) => prop.name === '火神炮').length, 1)
    assert.equal(new Set(map.props.map((prop) => `${prop.name}:${prop.lat}:${prop.lng}`)).size, 34)
    for (const item of [...map.props, ...map.stages.flatMap((stage) => [...stage.points, ...stage.attackVehicles])]) {
      assert.ok(fs.existsSync(path.join(root, 'public/icons/map-props', `${item.icon}.png`)), item.icon)
    }
  }
  for (const icon of ['q_hsp', 'q_lqqdxc']) {
    assert.equal(fs.readFileSync(path.join(root, 'public/icons/map-props', `${icon}.png`)).subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  }
  for (const file of ['src/components/LeftPanel.tsx', 'src/components/ModeAssetPalette.tsx']) assert.ok(fs.readFileSync(path.join(root, file), 'utf8').includes('火神炮'))
})

test('PC 与手游攻防路由分别使用独立阶段、道具和部署对象', () => {
  const pcStages = stagesForPlatform('pc').skyport
  const mobileStages = stagesForPlatform('mobile').skyport
  assert.notEqual(pcStages, mobileStages)
  assert.notEqual(pcStages[0].points, mobileStages[0].points)
  assert.notEqual(propsForPlatform('pc').skyport, propsForPlatform('mobile').skyport)
  const pcDeploy = deployForPlatform('pc').skyport
  const mobileDeploy = deployForPlatform('mobile').skyport
  assert.notEqual(pcDeploy, mobileDeploy)
  const previous = pcDeploy.S1.attack[0].cd
  try {
    pcDeploy.S1.attack[0].cd = 555
    assert.equal(mobileDeploy.S1.attack[0].cd, 90)
    assert.equal(snapshot.pc.deploy.S1.attack[0].cd, 90)
  } finally { pcDeploy.S1.attack[0].cd = previous }
})

test('新用户四份配置齐全，胜者为王深复制对应端攻防而不是动态共用', () => {
  const store = freshStore()
  assert.equal(store.version, 41)
  const maps = modes.flatMap((mode) => platforms.map((platform) => mapOf(store, mode, platform)))
  assert.equal(new Set(maps).size, 4)
  assert.equal(new Set(maps.map((map) => map.spawns)).size, 4)
  for (let i = 0; i < maps.length; i++) for (let j = i + 1; j < maps.length; j++) assertNoSharedObjects(maps[i], maps[j])
  for (const platform of platforms) {
    const attack = mapOf(store, 'attack-defense', platform)
    const winner = mapOf(store, 'winner-takes-all', platform)
    assert.deepEqual(dataOf(winner), dataOf(attack))
    assert.ok(winner.notes.includes('临时底稿'))
    assert.equal(winner.vehicleRefreshRules.length, 0)
    assert.notEqual(winner.spawns[0].deployVehicles, attack.spawns[0].deployVehicles)
  }
  mapOf(store, 'attack-defense', 'pc').spawns[0].deployVehicles[0].cd = 555
  for (const [mode, platform] of [['winner-takes-all', 'pc'], ['winner-takes-all', 'mobile'], ['attack-defense', 'mobile']]) assert.equal(mapOf(store, mode, platform).spawns[0].deployVehicles[0].cd, 90)
  for (const mode of modes) assert.equal(profileOf(store, mode).maps, profileOf(store, mode).platformMaps.pc)
})

test('旧 v40 存档补齐四份天际港，不改动其他地图、活动模式或自定义档案', () => {
  const old = oldStore()
  old.activeModeId = 'my-mode'
  old.profiles.push({ ...clone(profileOf(old, 'winner-takes-all')), id: 'my-mode', name: '自定义' })
  profileOf(old, 'attack-defense').platformMaps.pc.ascent.notes = '保留现有修改'
  const original = clone(old)
  const baseline = normalizeModeConfigStore({ ...old, version: 41 })
  const migrated = normalizeModeConfigStore(old)
  assert.equal(migrated.version, 41)
  assert.equal(migrated.activeModeId, 'my-mode')
  assert.deepEqual(old, original)
  assert.deepEqual(profileOf(migrated, 'my-mode'), profileOf(baseline, 'my-mode'))
  for (const mode of modes) for (const platform of platforms) {
    assert.equal(mapOf(migrated, mode, platform).stages.length, 3)
    const before = profileOf(baseline, mode).platformMaps[platform]
    const after = profileOf(migrated, mode).platformMaps[platform]
    for (const id of Object.keys(before).filter((id) => id !== 'skyport')) assert.deepEqual(after[id], before[id], `${mode}/${platform}/${id}`)
  }
  const newMaps = modes.flatMap((mode) => platforms.map((platform) => mapOf(migrated, mode, platform)))
  for (let i = 0; i < newMaps.length; i++) for (let j = i + 1; j < newMaps.length; j++) assertNoSharedObjects(newMaps[i], newMaps[j])
  assert.deepEqual(normalizeModeConfigStore(migrated), migrated)
})

test('迁移保留已有天际港编辑，只为缺失模式从同端已有攻防配置深复制', () => {
  const old = freshStore()
  old.version = 40
  for (const platform of platforms) {
    const attack = mapOf(old, 'attack-defense', platform)
    attack.notes = `${platform} 已编辑`
    attack.spawns[0].lat += platform === 'pc' ? 1 : 2
    delete profileOf(old, 'winner-takes-all').platformMaps[platform].skyport
  }
  const migrated = normalizeModeConfigStore(old)
  for (const platform of platforms) {
    assert.equal(mapOf(migrated, 'attack-defense', platform).notes, `${platform} 已编辑`)
    assert.deepEqual(dataOf(mapOf(migrated, 'winner-takes-all', platform)), dataOf(mapOf(migrated, 'attack-defense', platform)))
  }
  mapOf(migrated, 'winner-takes-all', 'pc').notes = '胜者独立编辑'
  const reloaded = normalizeModeConfigStore(migrated)
  assert.equal(mapOf(reloaded, 'winner-takes-all', 'pc').notes, '胜者独立编辑')
  assert.equal(mapOf(reloaded, 'attack-defense', 'pc').notes, 'pc 已编辑')
})

test('旧存档迁移立即写回，后续启动保留独立编辑且不重复初始化', () => {
  const old = oldStore()
  storage.set(MODE_CONFIG_STORAGE_KEY, JSON.stringify(old))
  const before = writes
  const migrated = loadModeConfigStore()
  assert.equal(writes, before + 1)
  assert.equal(JSON.parse(storage.get(MODE_CONFIG_STORAGE_KEY)).version, 41)
  mapOf(migrated, 'winner-takes-all', 'mobile').notes = '手游胜者手动编辑'
  storage.set(MODE_CONFIG_STORAGE_KEY, JSON.stringify(migrated))
  const reloaded = loadModeConfigStore()
  assert.equal(writes, before + 1)
  assert.equal(mapOf(reloaded, 'winner-takes-all', 'mobile').notes, '手游胜者手动编辑')
})

test('四份配置运行时、正式导出与单图导入均有效且不会串模式/数据端', () => {
  for (const mode of modes) for (const platform of platforms) {
    const store = freshStore()
    const runtime = buildRuntimeModeData(profileOf(store, mode), platform, 'skyport')
    assert.deepEqual(runtime.issues, [])
    const exported = buildOfficialModeData(profileOf(store, mode), platform, 'skyport')
    assert.equal(exported.mode.id, mode)
    assert.equal(exported.gameDataPlatform, platform)
    assert.deepEqual(Object.keys(exported.maps), ['skyport'])
    assert.deepEqual(exported.maps.skyport, runtime.map)
    const imported = importModeConfigData(store, clone(exported), platform === 'pc' ? 'mobile' : 'pc')
    assert.ok(imported)
    assert.equal(imported.gameDataPlatform, platform)
    assert.equal(imported.profileId, mode)
    assert.equal(imported.mapId, 'skyport')
    const roundTrip = buildOfficialModeData(profileOf(imported.store, mode), platform, 'skyport')
    assert.deepEqual(roundTrip.maps.skyport, exported.maps.skyport)
    const otherPlatform = platform === 'pc' ? 'mobile' : 'pc'
    assert.equal(mapOf(imported.store, mode, otherPlatform), mapOf(store, mode, otherPlatform))
  }
})

test('实时核对官方脚本，固化内容与当前 PC/手游数据一致', { skip: process.env.CHECK_OFFICIAL_SOURCE !== '1' }, async () => {
  const response = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(20000) })
  assert.equal(response.status, 200)
  const current = buildSkyportSnapshot(await response.text(), snapshot.generatedAt)
  assert.deepEqual(clone(current), snapshot)
  for (const z of [1, 4]) {
    const scale = 2 ** z
    const [lat, lng] = snapshot.mapConfig.initCenter
    const url = snapshot.mapConfig.tileUrl.replace('{z}', z).replace('{x}', Math.floor(lng * scale / 256)).replace('{y}', Math.floor(-lat * scale / 256))
    const tile = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15000) })
    assert.equal(tile.status, 200)
    assert.match(tile.headers.get('content-type'), /image\/jpeg/)
  }
})
