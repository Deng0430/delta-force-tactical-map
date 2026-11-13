const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const { createConfigLoader } = require('./lib/load-config-module.cjs')
const load = createConfigLoader()
const {
  loadModeConfigStore, normalizeModeConfigStore, buildRuntimeModeData,
  buildOfficialModeData, importModeConfigData, MODE_CONFIG_STORAGE_KEY,
} = load('src/utils/modeConfigStorage.ts')
const { normalizeVehicleSpawnerInfo, vehicleSpawnerDetails } = load('src/utils/vehicleSpawnerInfo.ts')
const previousStorage = globalThis.localStorage
globalThis.localStorage = { getItem: () => null }
test.after(() => {
  if (previousStorage === undefined) delete globalThis.localStorage
  else globalThis.localStorage = previousStorage
})
const pcOfficial = load('src/config/winnerTakesAllOfficial.json')
const profile = (store) => store.profiles.find((p) => p.id === 'winner-takes-all')
const mapOf = (store) => profile(store).platformMaps.pc.ember
const allDeploy = (map) => Object.values(map.deploy).flatMap((stage) => [...stage.attack, ...stage.defense])
const entries = (map) => [...allDeploy(map), ...map.vehicleRefreshRules]
const withoutInfo = (value) => JSON.parse(JSON.stringify(value, (key, val) =>
  ['clientSpawner', 'createdAt', 'updatedAt'].includes(key) ? undefined : val))
const oldStore = () => {
  const store = withoutInfo(loadModeConfigStore())
  store.version = 44
  return store
}

test('PC ember contains three deployment records and three deduplicated camp rules with source information', () => {
  const map = pcOfficial.maps.ember
  assert.equal(entries(map).length, 6)
  for (const entry of entries(map)) {
    const info = entry.clientSpawner
    assert.equal(info.platform, 'pc')
    assert.equal(info.mapId, 602)
    assert.match(info.tablePath, /\/R13N\/Common\/PC\/.*BreakthroughVehicleSpawnerTable\.uasset$/)
    assert.equal(info.rowName, '指挥官烬区攻防')
    assert.equal(info.cooldownStatus, 'template-unresolved')
    assert.equal(info.positionStatus, info.section === 'standard' ? 'pc-level-verified' : 'existing-unverified')
    assert.deepEqual(normalizeVehicleSpawnerInfo(info), info)
  }
  const deploy = allDeploy(map)
  assert.deepEqual(deploy.map((v) => [v.icon, v.num, v.cd]), [['atvqdxc', 2, 15], ['m1a4zztk', 1, 120], ['qxtk', 1, 90]])
  assert.deepEqual(deploy[0].clientSpawner.spawnerIds, ['S1_GTI_ATV', 'S1_GTI_ATV2'])
  assert.equal(deploy[0].clientSpawner.singleUse, false)
  assert.equal(deploy[0].clientSpawner.singleUseLimit, undefined)
  for (const v of deploy.slice(1)) {
    assert.equal(v.clientSpawner.singleUse, true)
    assert.equal(v.clientSpawner.singleUseLimit, 1)
  }
  const rules = map.vehicleRefreshRules
  assert.deepEqual(rules.map((r) => [r.objective, r.trigger.value, r.vehicle.icon, r.quantity]),
    [['A', 130, 'orvtjc', 1], ['A', 100, 'sxzjc', 1], ['B', 120, 'orvtjc', 1]])
  for (const r of rules) {
    assert.equal(r.clientSpawner.singleUse, false)
    assert.equal(r.clientSpawner.singleUseLimit, undefined)
    assert.deepEqual(r.clientSpawner.sectorIndices, [0, 1, 2])
    assert.equal(r.clientSpawner.spawnerIds.length, 1)
    assert.equal(r.clientSpawner.template, 'Template4')
  }
  assert.equal(rules[1].clientSpawner.vehicleId, 1101006)
  assert.equal(rules[1].clientSpawner.sourceVehicleName, 'M1A4主战坦克')
  assert.equal(rules[1].clientSpawner.vehicleNameConflict, true)
  assert.deepEqual(map.vehicleRefreshPoints, [{ uid: 'vehicle_refresh_point_msu28emv_1', name: 'A/B点载具刷新位置 1', lat: -128.37654068092343, lng: 39.00464483547793 }])
})

test('fresh runtime loads PC information without leaking into any other map, mode or data platform', () => {
  const store = loadModeConfigStore()
  assert.equal(store.version, 72)
  const runtime = buildRuntimeModeData(profile(store), 'pc', 'ember')
  assert.deepEqual(runtime.issues, [])
  assert.equal(entries(runtime.map).filter((entry) => entry.clientSpawner).length, 6)
  for (const p of store.profiles) for (const [platform, maps] of Object.entries(p.platformMaps)) {
    for (const [mapId, map] of Object.entries(maps)) {
      // 独立核对的 PC 地图各自携带来源，不允许它们泄漏至手游或普通攻防。
      if (p.id === 'winner-takes-all' && platform === 'pc' && ['ascent', 'ember', 'flashpoint', 'stormeye', 'trench'].includes(mapId)) continue
      if (p.id === 'attack-defense' && platform === 'pc' && ['ascent', 'flashpoint', 'ember', 'stormeye', 'trench'].includes(mapId)) continue
      assert.equal(JSON.stringify(map).includes('clientSpawner'), false, `${p.id}/${platform}/${mapId}`)
    }
  }
  const first = allDeploy(runtime.map)[0].clientSpawner
  first.spawnerIds.push('runtime-only')
  assert.equal(pcOfficial.maps.ember.deploy.S1.attack[0].clientSpawner.spawnerIds.length, 2)
})

test('v44 migration updates only source info, preserving all user values and other map/mode/platform data', () => {
  const old = oldStore()
  const map = mapOf(old)
  const spawn = map.spawns.find((s) => s.deployVehicles.length)
  spawn.name = '我的复活点名称'
  spawn.lat += 1
  spawn.deployVehicles[0].cd = 37
  spawn.deployVehicles[0].num = 7
  map.vehicleRefreshPoints[0].lng += 2
  map.vehicleRefreshRules[0].note = '保留我的备注'
  old.profiles.push({ ...structuredClone(profile(old)), id: 'my-mode', name: '我的模式' })
  const original = structuredClone(old)
  // 与既有规范化流程对照：该流程本就修复 maps 别名、移除重复道具。
  const baseline = normalizeModeConfigStore({ ...structuredClone(old), version: 45 })
  const migrated = normalizeModeConfigStore(old)
  assert.deepEqual(old, original)
  assert.equal(migrated.version, 72)
  assert.deepEqual(withoutInfo(migrated.profiles), withoutInfo(baseline.profiles))
  assert.equal(mapOf(migrated).spawns.flatMap((s) => s.deployVehicles).filter((v) => v.clientSpawner).length, 3)
  assert.equal(mapOf(migrated).vehicleRefreshRules.filter((r) => r.clientSpawner).length, 3)
  assert.equal(profile(migrated).maps, profile(migrated).platformMaps.pc)
  assert.deepEqual(normalizeModeConfigStore(migrated), migrated)
})

test('migration does not restore deleted records or annotate changed identities/conditions', () => {
  const old = oldStore()
  const map = mapOf(old)
  map.spawns.find((s) => s.deployVehicles[0]?.icon === 'm1a4zztk').deployVehicles = []
  const lightTank = map.spawns.find((s) => s.deployVehicles[0]?.icon === 'qxtk')
  lightTank.uid = 'user-replaced-spawn'
  map.vehicleRefreshRules = map.vehicleRefreshRules.filter((r) => r.trigger.value !== 100)
  map.vehicleRefreshRules[0].trigger.value = 140
  const next = mapOf(normalizeModeConfigStore(old))
  assert.equal(next.spawns.flatMap((s) => s.deployVehicles).length, 2)
  assert.equal(next.spawns.flatMap((s) => s.deployVehicles).filter((v) => v.clientSpawner).length, 1)
  assert.equal(next.vehicleRefreshRules.length, 2)
  assert.equal(next.vehicleRefreshRules[0].trigger.value, 140)
  assert.equal(next.vehicleRefreshRules[0].clientSpawner, undefined)
  assert.ok(next.vehicleRefreshRules[1].clientSpawner)
})

test('the migration is one-time; current-version reload does not reapply information removed by the user', () => {
  const store = loadModeConfigStore()
  const map = mapOf(store)
  delete map.spawns.find((s) => s.deployVehicles.length).deployVehicles[0].clientSpawner
  delete map.vehicleRefreshRules[0].clientSpawner
  const next = normalizeModeConfigStore(store)
  assert.equal(mapOf(next).spawns.find((s) => s.deployVehicles.length).deployVehicles[0].clientSpawner, undefined)
  assert.equal(mapOf(next).vehicleRefreshRules[0].clientSpawner, undefined)
})

test('official single-map export/import and backup normalization retain source info without reapplying positions', () => {
  const store = loadModeConfigStore()
  mapOf(store).vehicleRefreshPoints[0].lat -= 3
  const exported = buildOfficialModeData(profile(store), 'pc', 'ember')
  assert.deepEqual(Object.keys(exported.maps), ['ember'])
  const imported = importModeConfigData(store, JSON.parse(JSON.stringify(exported)), 'mobile')
  assert.equal(imported.gameDataPlatform, 'pc')
  const normalized = normalizeModeConfigStore(JSON.parse(JSON.stringify(imported.store)))
  const roundTrip = buildOfficialModeData(profile(normalized), 'pc', 'ember')
  assert.deepEqual(roundTrip.maps.ember, exported.maps.ember)
  assert.deepEqual(profile(normalized).platformMaps.mobile, profile(normalizeModeConfigStore(store)).platformMaps.mobile)
})

test('upgrading a saved store persists the current version and source info once', () => {
  const old = oldStore()
  const storage = new Map([[MODE_CONFIG_STORAGE_KEY, JSON.stringify(old)]])
  let writes = 0
  globalThis.localStorage = { getItem: (key) => storage.get(key), setItem: (key, value) => { writes++; storage.set(key, value) } }
  try {
    assert.equal(loadModeConfigStore().version, 72)
    assert.equal(writes, 1)
    assert.ok(mapOf(JSON.parse(storage.get(MODE_CONFIG_STORAGE_KEY))).vehicleRefreshRules[0].clientSpawner)
    loadModeConfigStore()
    assert.equal(writes, 1)
  } finally { globalThis.localStorage = { getItem: () => null } }
})

test('normalization and display never present dormant SelfInfo or false single-use limits as effective rules', () => {
  const info = pcOfficial.maps.ember.vehicleRefreshRules[1].clientSpawner
  assert.equal(normalizeVehicleSpawnerInfo({}), undefined)
  assert.equal(normalizeVehicleSpawnerInfo({ ...info, spawnerIds: [] }), undefined)
  assert.equal(normalizeVehicleSpawnerInfo({ ...info, singleUse: true, singleUseLimit: 0 }), undefined)
  assert.equal(normalizeVehicleSpawnerInfo({ ...info, singleUseLimit: 1 }).singleUseLimit, undefined)
  const text = vehicleSpawnerDetails(info, 90).join('\n')
  assert.match(text, /总次数待核实/)
  assert.match(text, /冷却待核实/)
  assert.match(text, /名称与 ID 存在矛盾/)
  assert.match(text, /沿用现有地图标注/)
  assert.doesNotMatch(text, /(?:5秒|5s|无限重生|整局仅1)/)
})

const sourceFile = path.resolve(__dirname, '../source/手游提取资源/烬区/载具刷新/PC覆盖/指挥官_胜者候选_MapID602.json')
test('local extracted PC table agrees with every frozen field (source is optional and ignored by Git)', {
  skip: !fs.existsSync(sourceFile) && 'local source extraction is not included in the repository',
}, () => {
  const source = JSON.parse(fs.readFileSync(sourceFile, 'utf8'))
  for (const entry of entries(pcOfficial.maps.ember)) {
    const info = entry.clientSpawner
    const camp = info.section === 'camp'
    assert.equal(info.tablePath, source.asset_path)
    assert.equal(info.rowName, source.row_name)
    assert.equal(info.mapId, source.MapID)
    assert.equal(info.template, source[camp ? 'CampTemplate' : 'StandardTemplate'].split('::').pop())
    const matches = []
    source[camp ? 'CampSpawnerDataSectorData' : 'StandardSpawnerSectorData'].forEach((sector, index) => {
      for (const side of sector.SpawnersOfCamp) for (const vehicle of side.value.SpawnersOfVehicle) {
        if (vehicle.key !== info.vehicleId) continue
        for (const spawner of vehicle.value.SpawnersData) if (info.spawnerIds.includes(spawner.SpawnerID)) {
          matches.push({ index, vehicle: vehicle.value, spawner })
        }
      }
    })
    assert.ok(matches.length)
    assert.deepEqual([...new Set(matches.map((m) => m.index))], info.sectorIndices)
    assert.deepEqual([...new Set(matches.map((m) => m.spawner.SpawnerID))], info.spawnerIds)
    assert.deepEqual([...new Set(matches.flatMap((m) => m.spawner.SpawnerActiveConditionInfoMap.map((c) => c.key)))], info.conditionKeys)
    for (const { vehicle, spawner } of matches) {
      assert.equal(vehicle.VehicleName, info.sourceVehicleName)
      assert.equal(vehicle.bIsSingleUse, info.singleUse)
      if (info.singleUse) assert.equal(vehicle.MaxNumberForSingleUse, info.singleUseLimit)
      assert.equal(spawner.bIsDynamicallyBalancedVehicle, info.dynamicallyBalanced)
      assert.equal(spawner.bIsUseSelfGovernedInfo, false)
      if (camp) for (const condition of spawner.SpawnerActiveConditionInfoMap) {
        for (const trigger of condition.value.BattleFieldSpawnerActiveConditionInfoMap) assert.equal(trigger.value, entry.trigger.value)
      }
    }
  }
})
