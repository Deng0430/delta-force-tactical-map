const assert = require('node:assert/strict')
const test = require('node:test')
const { createConfigLoader } = require('./lib/load-config-module.cjs')
const load = createConfigLoader()
const api = load('src/utils/modeConfigStorage.ts')
const { vehicleDeployPosition } = load('src/utils/vehicleDeployPositions.ts')
const official = load('src/config/winnerTakesAllOfficial.json')
const originalStorage = globalThis.localStorage
globalThis.localStorage = { getItem: () => null }
test.after(() => {
  if (originalStorage === undefined) delete globalThis.localStorage
  else globalThis.localStorage = originalStorage
})
const winner = (store) => store.profiles.find((p) => p.id === 'winner-takes-all')
const ember = (store) => winner(store).platformMaps.pc.ember
const entries = (map) => map.spawns.flatMap((spawn) => spawn.deployVehicles)
const legacyPositions = [
  [-179.97944345541762, 47.2079576862382], [-180.38483706853052, 48.787927929490095],
  [-126.04032400936941, 31.596729194506494], [-122.07778013833416, 143.95729301572686],
]
const positions = load('src/config/emberPcCommanderData.json').maps.ember.map.spawns.flatMap((spawn) => spawn.deployVehicles.flatMap((vehicle) => vehicle.deployPositions))
const stable = (value) => JSON.parse(JSON.stringify(value, (key, val) => key === 'updatedAt' ? undefined : val))

test('runtime deployment uses the four PC spawner coordinates and keeps respawn markers separate', () => {
  const store = api.loadModeConfigStore()
  const runtime = api.buildRuntimeModeData(winner(store), 'pc', 'ember')
  assert.deepEqual(runtime.issues, [])
  const vehicles = Object.values(runtime.map.deploy).flatMap((s) => [...s.attack, ...s.defense])
  const fallback = [1, 2]
  const placed = vehicles.flatMap((v) => Array.from({ length: v.num }, (_, i) => vehicleDeployPosition(v, fallback, i)))
  assert.deepEqual(placed, positions)
  assert.equal(entries(ember(store))[0].clientSpawner.positionStatus, 'pc-level-verified')
  assert.notDeepEqual([ember(store).spawns.find((s) => s.deployVehicles.length).lat, ember(store).spawns.find((s) => s.deployVehicles.length).lng], positions[0])
  assert.deepEqual(vehicleDeployPosition({}, fallback, 1), [3.4, 2])
  assert.deepEqual(vehicleDeployPosition(vehicles[0], fallback, 2), [5.8, 2])
})

test('v58 migration only fills existing PC Ember deployments; counts, custom coordinates and deleted entries are preserved', () => {
  const old = structuredClone(api.loadModeConfigStore())
  old.version = 58
  for (const v of entries(ember(old))) {
    delete v.deployPositions
    v.clientSpawner.positionStatus = 'existing-unverified'
  }
  const atv = entries(ember(old))[0]
  atv.num = 3; atv.cd = 37; atv.deployCount = 5
  ember(old).spawns.find((s) => s.deployVehicles.some((v) => v.icon === 'm1a4zztk')).deployVehicles = []
  const tank = entries(ember(old)).find((v) => v.icon === 'qxtk')
  tank.deployPositions = [[9, 8]]
  const before = structuredClone(old)
  const baseline = api.normalizeModeConfigStore({ ...structuredClone(old), version: 59 })
  const migrated = api.normalizeModeConfigStore(old)
  assert.deepEqual(old, before)
  const result = entries(ember(migrated))
  assert.deepEqual(result[0].deployPositions, positions.slice(0, 2))
  assert.deepEqual([result[0].num, result[0].cd, result[0].deployCount], [3, 37, 5])
  assert.deepEqual(result.find((v) => v.icon === 'qxtk').deployPositions, [[9, 8]])
  assert.equal(result.some((v) => v.icon === 'm1a4zztk'), false)
  const expected = entries(ember(baseline))[0]
  expected.deployPositions = positions.slice(0, 2)
  expected.clientSpawner.positionStatus = 'pc-level-verified'
  assert.deepEqual(stable(migrated), stable(baseline))
  delete result[0].deployPositions
  assert.equal(entries(ember(api.normalizeModeConfigStore(migrated)))[0].deployPositions, undefined)
})

test('positions survive official export/import, reject malformed coordinates and do not alias built-in data', () => {
  const store = api.loadModeConfigStore()
  const exported = api.buildOfficialModeData(winner(store), 'pc', 'ember')
  exported.maps.ember.deploy.S1.attack[0].deployPositions = [[5, 6], [7, 8]]
  const imported = api.importModeConfigData(store, structuredClone(exported), 'mobile')
  const reloaded = api.normalizeModeConfigStore(JSON.parse(JSON.stringify(imported.store)))
  assert.deepEqual(api.buildOfficialModeData(winner(reloaded), 'pc', 'ember').maps.ember, exported.maps.ember)
  const baseline = api.normalizeModeConfigStore(structuredClone(store))
  assert.deepEqual(stable(winner(reloaded).platformMaps.mobile), stable(winner(baseline).platformMaps.mobile))
  assert.deepEqual(official.maps.ember.deploy.S1.attack[0].deployPositions, legacyPositions.slice(0, 2))
  for (const value of [[[1, null]], [[1, 2, 3]], [[1, Infinity]], [['1', 2]], [[1, 2], [3, NaN]]]) {
    const edited = structuredClone(store)
    entries(ember(edited))[0].deployPositions = value
    assert.equal(entries(ember(api.normalizeModeConfigStore(edited)))[0].deployPositions, undefined)
  }
})
