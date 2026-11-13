const assert = require('node:assert/strict')
const test = require('node:test')
const { createConfigLoader } = require('./lib/load-config-module.cjs')
const load = createConfigLoader()
const api = load('src/utils/modeConfigStorage.ts')
const { vehicleDeployPosition } = load('src/utils/vehicleDeployPositions.ts')
const official = load('src/config/winnerTakesAllOfficial.json')
const oldStorage = globalThis.localStorage
globalThis.localStorage = { getItem: () => null }
test.after(() => {
  if (oldStorage === undefined) delete globalThis.localStorage
  else globalThis.localStorage = oldStorage
})
const winner = (store) => store.profiles.find((p) => p.id === 'winner-takes-all')
const ascent = (store) => winner(store).platformMaps.pc.ascent
const vehicles = (map) => map.spawns.flatMap((s) => s.deployVehicles)
const stable = (v) => JSON.parse(JSON.stringify(v, (key, val) => key === 'updatedAt' ? undefined : val))
const position = (x, y) => [-(x - 98908.15625) * 256 / 200000, (-90243.71875 - y) * 256 / 200000]

test('PC Ascent runtime uses unique stage/hub spawners, not same-named actors in other phases or branches', () => {
  const store = api.loadModeConfigStore()
  const runtime = api.buildRuntimeModeData(winner(store), 'pc', 'ascent')
  assert.deepEqual(runtime.issues, [])
  const deploy = runtime.map.deploy
  const mapped = Object.values(deploy).flatMap((s) => [...s.attack, ...s.defense]).filter((v) => v.deployPositions)
  assert.equal(mapped.length, 14)
  assert.equal(mapped.flatMap((v) => v.deployPositions).length, 15)
  for (const v of mapped) assert.equal(v.num, v.deployPositions.length)
  assert.deepEqual(vehicleDeployPosition(deploy.S1.attack.find((v) => v.icon === 'm1a4zztk'), [0, 0], 0), position(170760.6875, -142953.390625))
  assert.deepEqual(deploy.S1.attack.find((v) => v.icon === 'sxzjc').deployPositions, [position(199773.265625, -105973.7109375)])
  assert.deepEqual(deploy.S2.attack.find((v) => v.icon === 'losvjpc').deployPositions, [position(209941.15625, -160887)])
  assert.deepEqual(deploy.S2.defense[0].deployPositions, [position(225831.40625, -191122.90625)])
  assert.deepEqual(deploy.S4.attack[0].deployPositions, [position(219460, -252420), position(211577.671875, -246326.625)])
  const unresolved = deploy.S2.attack.find((v) => v.icon === 'atvqdxc' && v.spawnUid.endsWith('18b63a2'))
  assert.equal(unresolved, undefined)
  assert.deepEqual(deploy.S2.attack.find((v) => v.icon === 'qxtk').deployPositions, [position(186707.484375, -151833.234375)])
})

test('v59 migration fills existing PC winner slots once and changes only the two legacy ATV quantities', () => {
  const old = structuredClone(api.loadModeConfigStore()); old.version = 59
  for (const v of vehicles(ascent(old))) {
    delete v.deployPositions
    if (v.icon === 'atvqdxc') v.num = 2
  }
  const map = ascent(old)
  const heli = vehicles(map).find((v) => v.icon === 'tjzsj')
  heli.cd = 37; heli.deployCount = 5
  const tank = vehicles(map).find((v) => v.icon === 'm1a4zztk')
  tank.deployPositions = [[7, 8]]; tank.num = 3
  const deleted = map.spawns.find((s) => s.stageId === 'S3' && s.deployVehicles.length)
  deleted.deployVehicles = []
  const baseline = api.normalizeModeConfigStore({ ...structuredClone(old), version: 60 })
  const original = structuredClone(old)
  const migrated = api.normalizeModeConfigStore(old)
  assert.deepEqual(old, original)
  const result = vehicles(ascent(migrated))
  assert.deepEqual(result.find((v) => v.icon === 'm1a4zztk').deployPositions, [[7, 8]])
  assert.deepEqual([result.find((v) => v.icon === 'tjzsj').cd, result.find((v) => v.icon === 'tjzsj').deployCount], [37, 5])
  assert.equal(result.some((v) => v.icon === 'g1bzc'), false)
  for (const spawn of ascent(baseline).spawns) {
    const source = official.maps.ascent.deploy[spawn.stageId]?.[spawn.side] ?? []
    for (const v of spawn.deployVehicles) {
      const match = source.find((item) => item.spawnUid === spawn.uid && item.icon === v.icon)
      if (!match?.deployPositions) continue
      if (!v.deployPositions) v.deployPositions = structuredClone(match.deployPositions)
      if (spawn.stageId === 'S2' && v.icon === 'atvqdxc' && v.num === 2 && match.num === 1) v.num = 1
    }
  }
  assert.deepEqual(stable(migrated), stable(baseline))
  delete result.find((v) => v.icon === 'tjzsj').deployPositions
  assert.equal(vehicles(ascent(api.normalizeModeConfigStore(migrated))).find((v) => v.icon === 'tjzsj').deployPositions, undefined)
})

test('official export/import retains coordinates without leaking into mobile, attack-defense or other maps', () => {
  const store = api.loadModeConfigStore()
  const exported = api.buildOfficialModeData(winner(store), 'pc', 'ascent')
  exported.maps.ascent.deploy.S1.attack[0].deployPositions[0] = [3, 4]
  const imported = api.importModeConfigData(store, structuredClone(exported), 'mobile')
  const roundtrip = api.normalizeModeConfigStore(imported.store)
  assert.deepEqual(api.buildOfficialModeData(winner(roundtrip), 'pc', 'ascent').maps.ascent, exported.maps.ascent)
  const baseline = api.normalizeModeConfigStore(store)
  assert.deepEqual(stable(winner(roundtrip).platformMaps.mobile), stable(winner(baseline).platformMaps.mobile))
  assert.deepEqual(stable(roundtrip.profiles.find((p) => p.id === 'attack-defense')), stable(baseline.profiles.find((p) => p.id === 'attack-defense')))
  assert.deepEqual(ascent(store).spawns.find((s) => s.deployVehicles.length).deployVehicles[0].deployPositions[0], position(170760.6875, -142953.390625))
})
