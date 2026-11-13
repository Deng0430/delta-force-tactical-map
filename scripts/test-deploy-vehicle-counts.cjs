const assert = require('node:assert/strict')
const test = require('node:test')
const { createConfigLoader } = require('./lib/load-config-module.cjs')
const load = createConfigLoader()
const { normalizeDeploymentCount } = load('src/utils/deployVehicleCounts.ts')
const { loadModeConfigStore, normalizeModeConfigStore, buildRuntimeModeData,
  buildOfficialModeData, importModeConfigData, MODE_CONFIG_STORAGE_KEY } = load('src/utils/modeConfigStorage.ts')
const { deployForPlatform } = load('src/config/gameDataPlatform.ts')
const previousStorage = globalThis.localStorage
globalThis.localStorage = { getItem: () => null }
test.after(() => {
  if (previousStorage === undefined) delete globalThis.localStorage
  else globalThis.localStorage = previousStorage
})
const winner = (store) => store.profiles.find((p) => p.id === 'winner-takes-all')
const targetSpawn = (store) => winner(store).platformMaps.pc.ascent.spawns.find((s) => s.uid === 'spawn_wta_pc_ascent_s1_attack_57mcir')
const helicopter = (store) => targetSpawn(store).deployVehicles.find((v) => v.icon === 'tjzsj')
const oldStore = () => {
  const store = structuredClone(loadModeConfigStore())
  store.version = 52
  helicopter(store).cd = 150
  for (const p of store.profiles) for (const maps of Object.values(p.platformMaps)) {
    for (const map of Object.values(maps)) for (const spawn of map.spawns) {
      for (const v of spawn.deployVehicles) delete v.deployCount
    }
  }
  return store
}

test('deployment count is a positive integer, defaulting to 1 independently of simultaneous quantity', () => {
  for (const value of [undefined, null, 0, -1, 1.5, NaN, Infinity, '2', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(normalizeDeploymentCount(value), 1)
  }
  assert.equal(normalizeDeploymentCount(2), 2)
  assert.equal(normalizeDeploymentCount(7), 7)
})

test('fresh PC commander uses source Ascent, Flashpoint and Trench counts; other deployment counts default to 1', () => {
  const store = loadModeConfigStore()
  assert.equal(store.version, 72)
  assert.deepEqual([helicopter(store).num, helicopter(store).deployCount, helicopter(store).cd], [1, 2, 100])
  for (const p of store.profiles) for (const [platform, maps] of Object.entries(p.platformMaps)) {
    for (const [mapId, map] of Object.entries(maps)) for (const spawn of map.spawns) for (const v of spawn.deployVehicles) {
      const file = mapId === 'ascent' ? 'ascentPcWinnerDeployData.json'
        : mapId === 'flashpoint' ? 'flashpointPcWinnerData.json' : undefined
      const source = p.id === 'winner-takes-all' && platform === 'pc' && file
        ? load(`src/config/${file}`).deployments.find((entry) => entry.spawnUid === spawn.uid && entry.vehicle.icon === v.icon) : undefined
      const trench = p.id === 'winner-takes-all' && platform === 'pc' && mapId === 'trench'
        ? load('src/config/trenchPcCommanderData.json').maps.trench.map.spawns.find((s) => s.uid === spawn.uid)?.deployVehicles.find((entry) => entry.icon === v.icon) : undefined
      assert.equal(v.deployCount, trench?.deployCount ?? source?.vehicle.deployCount ?? 1, `${p.id}/${platform}/${mapId}/${v.icon}`)
    }
  }
  for (const platform of ['pc', 'mobile']) for (const stages of Object.values(deployForPlatform(platform))) {
    for (const stage of Object.values(stages)) for (const v of [...stage.attack, ...stage.defense]) assert.equal(v.deployCount, 1)
  }
  const runtime = buildRuntimeModeData(winner(store), 'pc', 'ascent')
  assert.deepEqual(runtime.issues, [])
  assert.equal(runtime.map.deploy.S1.attack.find((v) => v.icon === 'tjzsj').deployCount, 2)
})

test('v52 migration changes only the PC winner helicopter and preserves custom map edits and quantities', () => {
  const old = oldStore()
  targetSpawn(old).name = '自定义海上基地'
  targetSpawn(old).lat += 1
  helicopter(old).num = 3
  const original = structuredClone(old)
  const baseline = normalizeModeConfigStore({ ...structuredClone(old), version: 53 })
  const migrated = normalizeModeConfigStore(old)
  assert.deepEqual(old, original)
  assert.deepEqual([helicopter(migrated).num, helicopter(migrated).deployCount, helicopter(migrated).cd], [3, 2, 100])
  assert.equal(targetSpawn(migrated).name, '自定义海上基地')
  assert.equal(targetSpawn(migrated).lat, targetSpawn(old).lat)
  helicopter(baseline).cd = 100
  helicopter(baseline).deployCount = 2
  const stable = (value) => JSON.parse(JSON.stringify(value, (key, val) => key === 'updatedAt' ? undefined : val))
  assert.deepEqual(stable(migrated), stable(baseline))
  assert.deepEqual(normalizeModeConfigStore(migrated), migrated)
})

test('migration preserves custom cooldown/count, does not restore deleted vehicles, and is not reapplied after editing', () => {
  const old = oldStore()
  helicopter(old).cd = 37
  helicopter(old).deployCount = 5
  const migrated = normalizeModeConfigStore(old)
  assert.equal(helicopter(migrated).cd, 37)
  assert.equal(helicopter(migrated).deployCount, 5)
  helicopter(migrated).cd = 150
  helicopter(migrated).deployCount = 1
  const reloaded = normalizeModeConfigStore(migrated)
  assert.equal(helicopter(reloaded).cd, 150)
  assert.equal(helicopter(reloaded).deployCount, 1)
  targetSpawn(old).deployVehicles = targetSpawn(old).deployVehicles.filter((v) => v.icon !== 'tjzsj')
  assert.equal(helicopter(normalizeModeConfigStore(old)), undefined)
})

test('official export/import and backup roundtrips retain editable count; old/invalid fields default to 1', () => {
  const store = loadModeConfigStore()
  helicopter(store).deployCount = 4
  const exported = buildOfficialModeData(winner(store), 'pc', 'ascent')
  const imported = importModeConfigData(store, structuredClone(exported), 'mobile')
  assert.equal(imported.gameDataPlatform, 'pc')
  const normalized = normalizeModeConfigStore(JSON.parse(JSON.stringify(imported.store)))
  assert.equal(helicopter(normalized).deployCount, 4)
  assert.deepEqual(buildOfficialModeData(winner(normalized), 'pc', 'ascent').maps.ascent, exported.maps.ascent)
  const entry = exported.maps.ascent.deploy.S1.attack.find((v) => v.icon === 'tjzsj')
  for (const value of [undefined, 0, -1, 1.8, '2']) {
    entry.deployCount = value
    const result = importModeConfigData(store, structuredClone(exported))
    assert.equal(helicopter(result.store).deployCount, 1)
    assert.equal(helicopter(result.store).num, 1)
  }
})

test('upgrading persists v53 once so existing installations see the corrected values without resetting configuration', () => {
  const data = new Map([[MODE_CONFIG_STORAGE_KEY, JSON.stringify(oldStore())]])
  let writes = 0
  globalThis.localStorage = { getItem: (key) => data.get(key), setItem: (key, value) => { writes++; data.set(key, value) } }
  try {
    assert.equal(helicopter(loadModeConfigStore()).deployCount, 2)
    assert.equal(writes, 1)
    loadModeConfigStore()
    assert.equal(writes, 1)
  } finally { globalThis.localStorage = { getItem: () => null } }
})
