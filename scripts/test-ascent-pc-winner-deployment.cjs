const assert = require('node:assert/strict')
const test = require('node:test')
const { createConfigLoader } = require('./lib/load-config-module.cjs')
const load = createConfigLoader()
const api = load('src/utils/modeConfigStorage.ts')
const { withAscentPcWinnerDeployment } = load('src/config/ascentPcWinnerDeployment.ts')
const { deploymentCountLabel } = load('src/utils/deployVehicleCounts.ts')
const source = load('src/config/ascentPcWinnerDeployData.json')
const previousStorage = globalThis.localStorage
globalThis.localStorage = { getItem: () => null }
test.after(() => {
  if (previousStorage === undefined) delete globalThis.localStorage
  else globalThis.localStorage = previousStorage
})
const winner = (store) => store.profiles.find((p) => p.id === 'winner-takes-all')
const map = (store) => winner(store).platformMaps.pc.ascent
const spawnFor = (store, entry) => map(store).spawns.find((s) => s.uid === entry.spawnUid)
const vehicleFor = (store, entry) => spawnFor(store, entry)?.deployVehicles.find((v) => v.icon === entry.vehicle.icon)
const stable = (v) => JSON.parse(JSON.stringify(v, (key, value) => key === 'updatedAt' ? undefined : value))
const legacyStore = () => {
  const store = structuredClone(api.loadModeConfigStore())
  store.version = 65
  for (const entry of source.deployments) {
    const spawn = spawnFor(store, entry)
    spawn.deployVehicles = spawn.deployVehicles.filter((v) => v.icon !== entry.vehicle.icon)
    if (entry.legacyVehicle) spawn.deployVehicles.push(structuredClone(entry.legacyVehicle))
  }
  for (const entry of source.removedLegacy) spawnFor(store, entry).deployVehicles.push(structuredClone(entry.vehicle))
  return store
}

test('all 14 bound PC commander entries use source slots, template CD, counts and 15 coordinates', () => {
  const store = api.loadModeConfigStore()
  const runtime = api.buildRuntimeModeData(winner(store), 'pc', 'ascent')
  assert.deepEqual(runtime.issues, [])
  assert.equal(source.deployments.length, 14)
  assert.equal(source.deployments.reduce((n, entry) => n + entry.vehicle.num, 0), 15)
  const runtimeVehicles = Object.values(runtime.map.deploy).flatMap((s) => [...s.attack, ...s.defense])
  assert.equal(runtimeVehicles.length, 14)
  for (const entry of source.deployments) {
    const v = vehicleFor(store, entry)
    assert.ok(v, `${entry.stageId}/${entry.hub}/${entry.vehicle.icon}`)
    for (const key of ['num', 'cd', 'deployCount', 'deployCountKnown', 'deployPositions', 'clientSpawner']) {
      assert.deepEqual(v[key], entry.vehicle[key], `${entry.hub}/${v.icon}/${key}`)
    }
    assert.equal(v.num, v.deployPositions.length)
    assert.equal(v.clientSpawner.positionStatus, 'pc-level-verified')
    assert.equal(v.clientSpawner.cooldownStatus, 'pc-template-verified')
    assert.equal(v.cd, v.clientSpawner.templateVehicleCd)
  }
  assert.equal(source.unbound.length, 4)
  assert.deepEqual(source.unbound.map((e) => [e.stageId, e.side, e.VehicleID]), [
    ['S1', 'attack', 1103012], ['S1', 'attack', 1103007],
    ['S2', 'defense', 1101002], ['S2', 'defense', 1103012],
  ])
  assert.ok(source.rawStandardRows.length)
  for (const entry of source.removedLegacy) assert.equal(vehicleFor(store, entry), undefined)
  const once = withAscentPcWinnerDeployment(map(store))
  assert.strictEqual(withAscentPcWinnerDeployment(once), once)
})

test('v65 migration replaces previous defaults, adds S2 attacking tank and removes unsupported ATV', () => {
  const old = legacyStore()
  const original = structuredClone(old)
  const migrated = api.normalizeModeConfigStore(old)
  assert.deepEqual(old, original)
  for (const entry of source.deployments) {
    const v = vehicleFor(migrated, entry)
    for (const key of ['num', 'cd', 'deployCount', 'deployCountKnown', 'deployPositions', 'clientSpawner']) {
      assert.deepEqual(v[key], entry.vehicle[key], `${entry.hub}/${v.icon}/${key}`)
    }
  }
  for (const entry of source.removedLegacy) assert.equal(vehicleFor(migrated, entry), undefined)
  const baseline = api.normalizeModeConfigStore({ ...original, version: 66 })
  assert.deepEqual(stable(winner(migrated).platformMaps.mobile), stable(winner(baseline).platformMaps.mobile))
  assert.deepEqual(stable(migrated.profiles.find((p) => p.id === 'attack-defense')), stable(baseline.profiles.find((p) => p.id === 'attack-defense')))
  for (const [id, other] of Object.entries(winner(baseline).platformMaps.pc)) {
    if (id !== 'ascent') assert.deepEqual(stable(winner(migrated).platformMaps.pc[id]), stable(other))
  }
  for (const [key, value] of Object.entries(map(baseline))) {
    if (!['spawns', 'notes', 'updatedAt'].includes(key)) assert.deepEqual(stable(map(migrated)[key]), stable(value), key)
  }
  assert.deepEqual(api.normalizeModeConfigStore(migrated), migrated)
})

test('migration preserves custom values, coordinates and deleted entries; does not reapply', () => {
  const old = legacyStore()
  const heliEntry = source.deployments.find((e) => e.vehicle.icon === 'tjzsj')
  const heli = vehicleFor(old, heliEntry)
  Object.assign(heli, { cd: 37, deployCount: 5, num: 3, deployPositions: [[7, 8]] })
  const deleted = source.deployments.find((e) => e.vehicle.icon === 'g1bzc')
  spawnFor(old, deleted).deployVehicles = []
  const unsupported = vehicleFor(old, source.removedLegacy[0])
  unsupported.cd = 22
  const migrated = api.normalizeModeConfigStore(old)
  const result = vehicleFor(migrated, heliEntry)
  assert.deepEqual([result.cd, result.deployCount, result.num, result.deployPositions], [37, 5, 3, [[7, 8]]])
  assert.equal(vehicleFor(migrated, deleted), undefined)
  assert.equal(vehicleFor(migrated, source.removedLegacy[0]).cd, 22)
  result.cd = 150; result.deployCount = 1; delete result.deployPositions
  const newTank = source.deployments.find((e) => !e.legacyVehicle)
  spawnFor(migrated, newTank).deployVehicles = spawnFor(migrated, newTank).deployVehicles.filter((v) => v.icon !== newTank.vehicle.icon)
  const reloaded = api.normalizeModeConfigStore(migrated)
  assert.deepEqual([vehicleFor(reloaded, heliEntry).cd, vehicleFor(reloaded, heliEntry).deployCount, vehicleFor(reloaded, heliEntry).deployPositions], [150, 1, undefined])
  assert.equal(vehicleFor(reloaded, newTank), undefined)
  const missingHub = legacyStore()
  map(missingHub).spawns = map(missingHub).spawns.filter((s) => s.uid !== newTank.spawnUid)
  assert.equal(vehicleFor(api.normalizeModeConfigStore(missingHub), newTank), undefined)
})

test('disabled count switch displays unknown through normalization, runtime and import/export', () => {
  const entry = source.deployments.find((e) => e.vehicle.deployCountKnown === false)
  assert.equal(entry.vehicle.clientSpawner.singleUse, false)
  assert.equal(entry.vehicle.clientSpawner.singleUseLimit, undefined)
  const store = api.loadModeConfigStore()
  const exported = api.buildOfficialModeData(winner(store), 'pc', 'ascent')
  const v = exported.maps.ascent.deploy.S1.defense.find((v) => v.icon === entry.vehicle.icon)
  assert.equal(deploymentCountLabel(v), '待确认')
  const imported = api.importModeConfigData(store, structuredClone(exported))
  const normalized = api.normalizeModeConfigStore(JSON.parse(JSON.stringify(imported.store)))
  assert.equal(vehicleFor(normalized, entry).deployCountKnown, false)
  assert.equal(deploymentCountLabel(vehicleFor(normalized, entry)), '待确认')
  assert.deepEqual(api.buildOfficialModeData(winner(normalized), 'pc', 'ascent').maps.ascent, exported.maps.ascent)
  const runtime = api.buildRuntimeModeData(winner(normalized), 'pc', 'ascent')
  assert.equal(deploymentCountLabel(runtime.map.deploy.S1.defense.find((v) => v.icon === entry.vehicle.icon)), '待确认')
  v.deployPositions[0][0] = 999
  assert.notEqual(vehicleFor(store, entry).deployPositions[0][0], 999)
  assert.notEqual(vehicleFor(normalized, entry).deployPositions[0][0], 999)
})
