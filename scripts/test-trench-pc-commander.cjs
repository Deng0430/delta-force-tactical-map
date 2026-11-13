const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const { createConfigLoader } = require('./lib/load-config-module.cjs')
const load = createConfigLoader()
const api = load('src/utils/modeConfigStorage.ts')
const { withTrenchPcCommanderData: sync } = load('src/config/trenchPcCommanderData.ts')
const infantry = load('src/config/infantrySpawnAreas.ts')
const source = load('src/config/trenchPcCommanderData.json').maps.trench
const candidates = load('src/config/trenchPcInfantrySpawnAreas.json')
const previousStorage = globalThis.localStorage
globalThis.localStorage = { getItem: () => null }
test.after(() => { if (previousStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = previousStorage })
const winner = (s) => s.profiles.find((p) => p.id === 'winner-takes-all')
const map = (s) => winner(s).platformMaps.pc.trench
const stable = (value) => JSON.parse(JSON.stringify(value, (key, v) => key === 'updatedAt' ? undefined : v))
const fresh = () => api.normalizeModeConfigStore(api.loadModeConfigStore())
const legacy = () => {
  const s = fresh(); s.version = 71
  winner(s).platformMaps.pc.trench = structuredClone(source.previousMap)
  winner(s).maps = winner(s).platformMaps.pc
  return s
}

test('MapID605 snapshot routes five phases, seven objectives, sixteen active bases and 22 physical regions', () => {
  assert.equal(source.source.mapId, 605)
  assert.equal(source.source.mode, 'winner-takes-all')
  assert.equal(source.source.installedPaksVerified, 255)
  const store = fresh(), m = map(store), runtime = api.buildRuntimeModeData(winner(store), 'pc', 'trench')
  assert.equal(store.version, 72)
  assert.deepEqual(runtime.issues, [])
  assert.equal(m.stages.length, 5); assert.equal(m.objectives.length, 7)
  assert.equal(m.spawns.length, 16); assert.equal(m.zones.length, 22)
  for (const field of ['zones', 'spawns', 'objectives', 'vehicleRefreshPoints', 'vehicleRefreshRules']) {
    assert.deepEqual(stable(m[field]), stable(source.map[field]))
    assert.equal(new Set(m[field].map((p) => p.uid)).size, m[field].length)
  }
  assert.deepEqual(source.evidence.unresolved, [])
  assert.equal(sync(m, 'winner-takes-all', 'pc'), m)
  assert.equal(load('src/config/trenchPcWinnerData.ts').withTrenchPcWinnerData(m), m)
})

test('six deployment cards carry seven exact native generator positions; all bound source quotas and templates survive runtime', () => {
  const store = fresh(), m = map(store)
  const cards = m.spawns.flatMap((s) => s.deployVehicles)
  assert.equal(cards.length, 6)
  assert.equal(cards.reduce((n, v) => n + v.deployPositions.length, 0), 7)
  assert.equal(source.evidence.deployments.length, 7)
  for (const row of source.evidence.deployments) {
    const vehicle = m.spawns.find((s) => s.uid === row.spawnUid).deployVehicles.find((v) => v.clientSpawner.vehicleId === row.vehicleId)
    assert.ok(vehicle.deployPositions.some((p) => JSON.stringify(p) === JSON.stringify(row.position)))
    assert.ok(vehicle.clientSpawner.spawnerIds.includes(row.spawnerId))
    assert.equal(vehicle.clientSpawner.mapId, 605)
    assert.equal(vehicle.clientSpawner.positionStatus, 'pc-level-verified')
    if (vehicle.clientSpawner.singleUse) assert.equal(vehicle.deployCount, vehicle.clientSpawner.singleUseLimit)
    else assert.equal(vehicle.deployCountKnown, false)
  }
  const tank = (stage, side) => m.spawns.filter((s) => s.stageId === stage && s.side === side).flatMap((s) => s.deployVehicles).find((v) => v.icon === 'm1a4zztk')
  assert.equal(tank('S1', 'attack').deployCount, 3)
  assert.equal(tank('S2', 'attack').deployCount, 2)
  assert.equal(tank('S5', 'defense').deployCount, 1)
})

test('seven ticket refresh rules use six source points; shared FSV location is not duplicated and stages are not inferred from source array membership', () => {
  const store = fresh(), m = map(store), runtime = api.buildRuntimeModeData(winner(store), 'pc', 'trench').map
  assert.equal(m.vehicleRefreshRules.length, 7)
  assert.equal(m.vehicleRefreshPoints.length, 6)
  assert.deepEqual(source.evidence.refresh.map((r) => [r.stageId, r.vehicleId, r.sourceValue]), [
    ['S1', 1102001, 145], ['S2', 1102001, 125], ['S3', 1102001, 125], ['S4', 1102001, 95],
    ['S1', 1101004, 100], ['S2', 1101004, 50], ['S5', 1101006, 75],
  ])
  const fsv = m.vehicleRefreshRules.filter((r) => r.vehicle.icon === 'lstjp')
  assert.equal(fsv.length, 2); assert.equal(fsv[0].refreshPointUid, fsv[1].refreshPointUid)
  for (const row of source.evidence.refresh) {
    const rule = m.vehicleRefreshRules.find((r) => r.uid === row.ruleUid)
    const point = m.vehicleRefreshPoints.find((p) => p.uid === rule.refreshPointUid)
    assert.equal(rule.trigger.type, 'tickets'); assert.equal(rule.trigger.value, row.sourceValue)
    assert.deepEqual([point.lat, point.lng], row.position)
    assert.ok(runtime.stages.find((s) => s.id === row.stageId).attackVehicles.some((v) => v.icon === rule.vehicle.icon && v.trigger === `${row.sourceValue} 兵力`))
  }
})

test('all seven objectives and sixteen bases expose verified PC infantry candidate polygons only for the matching mode/platform/location', () => {
  const runtime = api.buildRuntimeModeData(winner(fresh()), 'pc', 'trench').map
  assert.equal(candidates.logicalMapId, 605); assert.equal(candidates.stateMappingVerified, false)
  assert.equal(candidates.areas.length, 202)
  assert.equal(candidates.objectives.length, 7); assert.equal(candidates.bases.length, 16)
  for (const stage of runtime.stages) {
    for (const point of stage.points) {
      const match = infantry.infantrySpawnAreasForObjective('trench', 'pc', 'winner-takes-all', stage.id, point)
      assert.ok(match); assert.equal(match.groups.length, 4)
      assert.equal(match.groups.reduce((n, g) => n + g.unresolvedCount, 0), 0)
      assert.equal(infantry.infantrySpawnAreasForObjective('trench', 'mobile', 'winner-takes-all', stage.id, point), null)
      assert.equal(infantry.infantrySpawnAreasForObjective('trench', 'pc', 'attack-defense', stage.id, point), null)
    }
    for (const spawn of stage.spawns) {
      const match = infantry.infantrySpawnAreasForBase('trench', 'pc', 'winner-takes-all', stage.id, spawn)
      assert.ok(match); assert.equal(match.unresolvedCount, 0)
      assert.ok(match.areas.length || match.footSoldierDisabled)
      assert.equal(infantry.infantrySpawnAreasForBase('trench', 'pc', 'winner-takes-all', stage.id, { ...spawn, lat: spawn.lat + 1 }), null)
    }
  }
  assert.ok(candidates.areas.every((a) => a.points.length >= 3 && a.points.every((p) => p.length === 2 && p.every(Number.isFinite))))
})

test('v71 migration is PC winner Trench only; custom edits, moved shared refresh points and deletions survive', () => {
  const old = legacy(), m = map(old)
  m.zones[0].points[0] = [-1, 2]
  const vehicleSpawn = m.spawns.find((s) => s.deployVehicles.length)
  Object.assign(vehicleSpawn.deployVehicles[0], { deployCount: 9, cd: 37, num: 4 })
  vehicleSpawn.name = '自定义基地'
  const removed = m.objectives[0].uid
  m.objectives = m.objectives.filter((p) => p.uid !== removed)
  const moved = m.vehicleRefreshPoints.find((p) => m.vehicleRefreshRules.filter((r) => r.refreshPointUid === p.uid).length > 1)
  assert.ok(moved); moved.lat = -3; moved.lng = 4
  const bound = m.vehicleRefreshRules.filter((r) => r.refreshPointUid === moved.uid).map((r) => r.uid)
  const original = structuredClone(old)
  const baseline = api.normalizeModeConfigStore({ ...structuredClone(old), version: 72 })
  const next = api.normalizeModeConfigStore(old), result = map(next)
  assert.deepEqual(old, original)
  assert.deepEqual(result.zones[0].points[0], [-1, 2])
  assert.equal(result.objectives.some((p) => p.uid === removed), false)
  const v = result.spawns.find((s) => s.uid === vehicleSpawn.uid)
  assert.equal(v.name, '自定义基地')
  assert.deepEqual([v.deployVehicles[0].cd, v.deployVehicles[0].num, v.deployVehicles[0].deployCount], [37, 4, 9])
  assert.deepEqual(result.vehicleRefreshPoints.find((p) => p.uid === moved.uid), moved)
  assert.ok(result.vehicleRefreshRules.filter((r) => bound.includes(r.uid)).every((r) => r.refreshPointUid === moved.uid))
  for (const p of next.profiles) {
    const before = baseline.profiles.find((b) => b.id === p.id)
    if (p.id !== 'winner-takes-all') assert.deepEqual(stable(p), stable(before))
    else {
      assert.deepEqual(stable(p.platformMaps.mobile), stable(before.platformMaps.mobile))
      for (const id of Object.keys(p.platformMaps.pc)) if (id !== 'trench') assert.deepEqual(stable(p.platformMaps.pc[id]), stable(before.platformMaps.pc[id]))
    }
  }
  assert.equal(sync(result, 'attack-defense', 'pc'), result)
  assert.equal(sync(result, 'winner-takes-all', 'mobile'), result)
  result.spawns[0].name = '迁移后编辑'
  assert.deepEqual(stable(map(api.normalizeModeConfigStore(next))), stable(result))
})

test('official and backup roundtrips preserve Trench deployment, refresh and geometry without touching mobile', () => {
  const store = fresh(), profile = winner(store)
  const exported = api.buildOfficialModeData(profile, 'pc', 'trench')
  const imported = api.importModeConfigData(store, structuredClone(exported), 'mobile').store
  assert.deepEqual(api.buildOfficialModeData(winner(imported), 'pc', 'trench').maps, exported.maps)
  assert.deepEqual(stable(winner(imported).platformMaps.mobile), stable(profile.platformMaps.mobile))
  assert.deepEqual(stable(map(api.normalizeModeConfigStore(JSON.parse(JSON.stringify(store))))), stable(map(store)))
})

test('deleted deployment cards/stages remain deleted, and the v72 migration is saved only once', () => {
  const old = legacy(), m = map(old)
  const spawn = m.spawns.find((s) => s.stageId === 'S1' && s.deployVehicles.length)
  spawn.deployVehicles = []
  m.stages = m.stages.filter((s) => s.id !== 'S5')
  for (const key of ['zones', 'spawns', 'objectives', 'props']) m[key] = m[key].filter((p) => p.stageId !== 'S5')
  const s5 = source.evidence.refresh.filter((r) => r.stageId === 'S5').map((r) => r.ruleUid)
  m.vehicleRefreshRules = m.vehicleRefreshRules.filter((r) => !s5.includes(r.uid))
  let json = JSON.stringify(old), writes = 0
  const original = globalThis.localStorage
  try {
    globalThis.localStorage = { getItem: () => json, setItem: (_key, value) => { json = value; writes++ } }
    const first = api.loadModeConfigStore()
    assert.equal(first.version, 72); assert.equal(writes, 1)
    const result = map(first)
    assert.deepEqual(result.spawns.find((s) => s.uid === spawn.uid).deployVehicles, [])
    assert.equal(result.spawns.some((s) => s.stageId === 'S5'), false)
    assert.equal(result.vehicleRefreshRules.some((r) => s5.includes(r.uid)), false)
    api.loadModeConfigStore(); assert.equal(writes, 1)
  } finally { globalThis.localStorage = original }
})

test('snapshot is reproducible from ignored source evidence when it is available', () => {
  if (fs.existsSync('source/PC提取资源/堑壕战/PC胜者核对_2026-11-13/before.json')) {
    const { spawnSync } = require('node:child_process')
    const result = spawnSync(process.execPath, ['scripts/sync-trench-pc-commander.cjs', '--check'], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }
})
