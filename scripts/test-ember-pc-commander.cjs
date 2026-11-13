const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { createConfigLoader } = require('./lib/load-config-module.cjs')
const load = createConfigLoader()
const data = load('src/config/emberPcCommanderData.json').maps.ember
const api = load('src/utils/modeConfigStorage.ts')
const { withEmberPcCommanderData } = load('src/config/emberPcCommanderData.ts')
const { evaluateVehicleRefreshRule, isVehicleRefreshRuleInStage } = load('src/utils/vehicleRefreshRuntime.ts')
const { vehicleDeployPosition } = load('src/utils/vehicleDeployPositions.ts')
const originalStorage = globalThis.localStorage
globalThis.localStorage = { getItem: () => null }
test.after(() => { if (originalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = originalStorage })
const stable = (value) => JSON.parse(JSON.stringify(value, (key, value) => key === 'updatedAt' ? undefined : value))
const winner = (store) => store.profiles.find((p) => p.id === 'winner-takes-all')
const ember = (store) => winner(store).platformMaps.pc.ember
const runtime = (store) => api.buildRuntimeModeData(winner(store), 'pc', 'ember')
const deployments = (map) => map.spawns.flatMap((spawn) => spawn.deployVehicles)
function legacy() {
  const store = api.normalizeModeConfigStore(api.loadModeConfigStore())
  store.version = 68
  winner(store).platformMaps.pc.ember = structuredClone(data.previousMap)
  winner(store).maps = winner(store).platformMaps.pc
  return store
}
function sortedMap(map) {
  const result = stable(map)
  for (const field of ['zones', 'spawns', 'objectives', 'props', 'vehicleRefreshPoints', 'vehicleRefreshRules']) result[field].sort((a, b) => a.uid.localeCompare(b.uid))
  for (const spawn of result.spawns) {
    spawn.vehicleCategories.sort()
    spawn.deployVehicles.sort((a, b) => a.icon.localeCompare(b.icon))
  }
  return result
}

test('fresh PC Ember commander loads frozen MapID602 geometry, 18 bases, 27 props and three independent refresh positions', () => {
  const store = api.loadModeConfigStore()
  assert.equal(store.version, 72)
  assert.equal(data.source.mapId, 602)
  assert.equal(data.source.mode, 'winner-takes-all')
  assert.equal(data.source.installedPaksVerified, 255)
  assert.deepEqual(data.evidence.unresolved, [])
  assert.deepEqual(stable(ember(store)), stable(data.map))
  assert.deepEqual(runtime(store).issues, [])
  assert.deepEqual(stable(runtime(store).map), stable(data.official))
  assert.equal(ember(store).spawns.length, 18)
  assert.equal(ember(store).zones.length, 18)
  assert.equal(ember(store).props.length, 27)
  assert.equal(ember(store).props.filter((prop) => prop.icon === 'q_gddyx').length, 13)
  assert.equal(ember(store).vehicleRefreshPoints.length, 3)
  assert.equal(new Set(ember(store).vehicleRefreshRules.map((rule) => rule.refreshPointUid)).size, 3)
})

test('base deployments have four physical positions; use Template5 15/150/150 CD rather than ordinary AD 15/120/90', () => {
  const store = api.loadModeConfigStore(), target = ember(store)
  const entries = deployments(target)
  assert.deepEqual(entries.map((v) => [v.icon, v.num, v.cd]), [['atvqdxc', 2, 15], ['m1a4zztk', 1, 150], ['qxtk', 1, 150]])
  assert.deepEqual(entries.map((v) => v.clientSpawner.templateVehicleCd), [15, 150, 150])
  assert.deepEqual(entries.map((v) => v.deployCountKnown), [false, undefined, undefined])
  const positions = entries.flatMap((v) => Array.from({ length: v.num }, (_, index) => vehicleDeployPosition(v, [0, 0], index)))
  assert.equal(positions.length, 4)
  for (const position of positions) assert.ok(data.evidence.deployments.some((d) => JSON.stringify(d.position) === JSON.stringify(position)))
  for (const v of entries) {
    assert.equal(v.clientSpawner.mapId, 602)
    assert.match(v.clientSpawner.template, /Template5$/)
    assert.equal(v.clientSpawner.positionStatus, 'pc-level-verified')
  }
  const ordinary = store.profiles.find((p) => p.id === 'attack-defense').platformMaps.pc.ember
  assert.deepEqual(deployments(ordinary).map((v) => v.cd), [15, 120, 90])
})

test('v69/v70 restore only seven omitted official ammo markers; preserve edits, other modes and mobile', () => {
  const retained = new Set(data.evidence.retainedOfficialProps.map((prop) => prop.uid))
  assert.equal(retained.size, 7)
  assert.ok(data.evidence.retainedOfficialProps.every((prop) => prop.pcCommanderStaticStatus === 'not-found-in-installed-static-extraction'))
  for (const version of [69, 70]) {
    const old = api.normalizeModeConfigStore(api.loadModeConfigStore())
    old.version = version
    ember(old).props = ember(old).props.filter((prop) => !retained.has(prop.uid))
    ember(old).spawns[0].name = '保留自定义基地'
    ember(old).props[0].lat = -42
    const before = structuredClone(old)
    const next = api.normalizeModeConfigStore(old)
    assert.deepEqual(old, before)
    assert.equal(next.version, 72)
    assert.equal(ember(next).props.filter((prop) => prop.icon === 'q_gddyx').length, 13)
    assert.deepEqual(stable({ ...ember(next), props: ember(next).props.filter((prop) => !retained.has(prop.uid)) }), stable(ember(before)))
    assert.deepEqual(ember(next).props.filter((prop) => retained.has(prop.uid)), data.map.props.filter((prop) => retained.has(prop.uid)))
    for (const profile of before.profiles) for (const platform of ['pc', 'mobile']) for (const [id, map] of Object.entries(profile.platformMaps?.[platform] ?? {})) {
      if (profile.id === 'winner-takes-all' && platform === 'pc' && id === 'ember') continue
      assert.deepEqual(stable(next.profiles.find((p) => p.id === profile.id).platformMaps[platform][id]), stable(map))
    }
    const again = api.normalizeModeConfigStore(next)
    assert.deepEqual(stable(again), stable(next))
    ember(next).props = ember(next).props.filter((prop) => !retained.has(prop.uid))
    assert.equal(ember(api.normalizeModeConfigStore(next)).props.some((prop) => retained.has(prop.uid)), false)
  }
})

test('repair does not duplicate a moved marker or an equivalent custom marker', () => {
  const old = api.loadModeConfigStore()
  old.version = 70
  const retained = new Set(data.evidence.retainedOfficialProps.map((prop) => prop.uid))
  const markers = ember(old).props.filter((prop) => retained.has(prop.uid))
  markers[0].lat = -42
  markers[1].uid = 'custom-same-ammo-position'
  const next = api.normalizeModeConfigStore(old)
  assert.equal(ember(next).props.length, 27)
  assert.equal(ember(next).props.find((prop) => prop.uid === markers[0].uid).lat, -42)
  assert.ok(ember(next).props.some((prop) => prop.uid === 'custom-same-ammo-position'))
  assert.ok(!ember(next).props.some((prop) => prop.uid === data.evidence.retainedOfficialProps[1].uid))
})

test('refresh conditions deduplicate 9 table records into A130 ORV, A100 AAV, B120 ORV at native points', () => {
  const store = api.loadModeConfigStore(), target = runtime(store).map
  const rules = target.vehicleRefreshRules
  assert.deepEqual([...rules].sort((a, b) => a.uid.localeCompare(b.uid)).map((r) => [r.objective, r.trigger.value, r.vehicle.icon, r.vehicle.cd]),
    [['A', 130, 'orvtjc', 80], ['A', 100, 'sxzjc', 90], ['B', 120, 'orvtjc', 80]])
  for (const rule of rules) {
    const source = data.evidence.refresh.find((entry) => entry.ruleUid === rule.uid)
    const point = target.vehicleRefreshPoints.find((point) => point.uid === rule.refreshPointUid)
    assert.deepEqual([point.lat, point.lng], source.position)
    assert.equal(rule.clientSpawner.mapId, 602)
    assert.match(rule.clientSpawner.template, /Template4$/)
    assert.equal(rule.vehicle.deployCountKnown, false)
    const stageIndex = target.stages.findIndex((stage) => stage.id === source.stageId)
    for (let index = 0; index < target.stages.length; index++) assert.equal(isVehicleRefreshRuleInStage(rule, { stages: target.stages, currentStageIndex: index }), index === stageIndex)
    const context = { tickets: { attack: rule.trigger.value + 1, defense: null }, matchTimeSeconds: null, objectiveStates: {}, objectiveCountdowns: {}, mapEvents: [] }
    assert.equal(evaluateVehicleRefreshRule(rule, context, { stages: target.stages, currentStageIndex: stageIndex }).eligible, false)
    context.tickets.attack = rule.trigger.value
    assert.equal(evaluateVehicleRefreshRule(rule, context, { stages: target.stages, currentStageIndex: stageIndex }).eligible, true)
  }
  const amphibious = rules.find((r) => r.vehicle.icon === 'sxzjc')
  assert.equal(amphibious.clientSpawner.vehicleId, 1101006)
  assert.equal(amphibious.clientSpawner.vehicleNameConflict, true)
  assert.match(amphibious.note, /主战坦克.*两栖装甲运输车/)
})

test('v68 migration touches only PC winner Ember; ordinary, mobile, other maps and custom modes stay unchanged', () => {
  const old = legacy()
  old.profiles.push({ ...structuredClone(winner(old)), id: 'my-mode', name: '自定义' })
  const before = structuredClone(old)
  const next = api.normalizeModeConfigStore(old)
  assert.deepEqual(old, before)
  assert.deepEqual(sortedMap(ember(next)), sortedMap(data.map))
  for (const profile of before.profiles) {
    const updated = next.profiles.find((p) => p.id === profile.id)
    for (const platform of ['pc', 'mobile']) for (const [id, map] of Object.entries(profile.platformMaps[platform])) {
      if (profile.id === 'winner-takes-all' && platform === 'pc' && id === 'ember') continue
      assert.deepEqual(stable(updated.platformMaps[platform][id]), stable(map), `${profile.id}/${platform}/${id}`)
    }
  }
  assert.deepEqual(stable(api.normalizeModeConfigStore(next)), stable(next))
})

test('migration retains custom base/zone values, deleted entities and user-moved shared refresh positions', () => {
  const current = structuredClone(data.previousMap)
  const zone = current.zones[0]
  zone.points = [[1, 2], [3, 4], [5, 6]]; zone.color = '#123456'
  const base = current.spawns.find((s) => s.deployVehicles.length)
  base.lat = -42; base.name = '自定义基地'; base.deployVehicles[0].cd = 777; base.deployVehicles[0].deployCount = 9
  const oldPoint = current.vehicleRefreshPoints[0]
  oldPoint.lat = -88; oldPoint.lng = 99
  const original = structuredClone(current)
  const next = withEmberPcCommanderData(current, 'winner-takes-all', 'pc')
  assert.deepEqual(current, original)
  assert.deepEqual(next.zones.find((z) => z.uid === zone.uid), zone)
  const updated = next.spawns.find((s) => s.uid === base.uid)
  assert.equal(updated.lat, -42); assert.equal(updated.name, '自定义基地')
  assert.equal(updated.deployVehicles[0].cd, 777); assert.equal(updated.deployVehicles[0].deployCount, 9)
  assert.equal(next.vehicleRefreshRules.every((r) => r.refreshPointUid === oldPoint.uid), true)
  assert.deepEqual(next.vehicleRefreshPoints, [oldPoint])
  const deleted = structuredClone(data.previousMap)
  const removed = deleted.props.find((p) => data.map.props.some((source) => source.uid === p.uid))
  deleted.props = deleted.props.filter((p) => p.uid !== removed.uid)
  deleted.vehicleRefreshRules = []
  const retained = withEmberPcCommanderData(deleted, 'winner-takes-all', 'pc')
  assert.ok(!retained.props.some((p) => p.uid === removed.uid))
  assert.equal(retained.vehicleRefreshRules.length, 0)
  assert.equal(withEmberPcCommanderData(current, 'attack-defense', 'pc'), current)
  assert.equal(withEmberPcCommanderData(current, 'winner-takes-all', 'mobile'), current)
})

test('deleting S2 does not introduce orphan native actors/rules; custom relinks do not gain unused new points', () => {
  const current = structuredClone(data.previousMap)
  current.stages = current.stages.filter((s) => s.id !== 'S2')
  for (const field of ['zones', 'spawns', 'objectives', 'props']) current[field] = current[field].filter((item) => item.stageId !== 'S2')
  current.vehicleRefreshRules = current.vehicleRefreshRules.filter((rule) => rule.objective !== 'B')
  const next = withEmberPcCommanderData(current, 'winner-takes-all', 'pc')
  for (const field of ['zones', 'spawns', 'objectives', 'props']) assert.ok(!next[field].some((item) => item.stageId === 'S2'))
  assert.ok(!next.vehicleRefreshRules.some((rule) => rule.objective === 'B'))
  const relinked = structuredClone(data.previousMap)
  relinked.vehicleRefreshPoints.push({ ...relinked.vehicleRefreshPoints[0], uid: 'custom-point', lat: 1, lng: 2 })
  relinked.vehicleRefreshRules.find((rule) => rule.vehicle.icon === 'orvtjc' && rule.objective === 'A').refreshPointUid = 'custom-point'
  const linked = withEmberPcCommanderData(relinked, 'winner-takes-all', 'pc')
  assert.equal(linked.vehicleRefreshRules.find((rule) => rule.objective === 'A' && rule.vehicle.icon === 'orvtjc').refreshPointUid, 'custom-point')
  assert.equal(linked.vehicleRefreshPoints.filter((point) => !relinked.vehicleRefreshPoints.some((old) => old.uid === point.uid)
    && !linked.vehicleRefreshRules.some((rule) => rule.refreshPointUid === point.uid)).length, 0)
})

test('one-time persistence, subsequent edits, official export/import, and independent S4 remain correct', () => {
  const storage = new Map([[api.MODE_CONFIG_STORAGE_KEY, JSON.stringify(legacy())]])
  let writes = 0
  globalThis.localStorage = { getItem: (key) => storage.get(key), setItem: (key, value) => { writes++; storage.set(key, value) } }
  try {
    const store = api.loadModeConfigStore()
    assert.equal(writes, 1)
    api.loadModeConfigStore(); assert.equal(writes, 1)
    const exported = api.buildOfficialModeData(winner(store), 'pc', 'ember')
    const imported = api.importModeConfigData(store, structuredClone(exported), 'mobile')
    assert.equal(imported.gameDataPlatform, 'pc')
    assert.deepEqual(stable(api.buildOfficialModeData(winner(api.normalizeModeConfigStore(imported.store)), 'pc', 'ember')), stable(exported))
    const s3 = runtime(store).map.stages.find((s) => s.id === 'S3'), s4 = runtime(store).map.stages.find((s) => s.id === 'S4')
    assert.deepEqual(s4.points, s3.points.filter((point) => point.name === '据点C2'))
    assert.deepEqual(s4.zone.latlngs, s3.zone.latlngs)
    assert.deepEqual(s4.attackSpawns, data.previousMap.spawns.filter((s) => s.stageId === 'S4' && s.side === 'attack').map((s) => [s.lat, s.lng]))
    ember(store).vehicleRefreshRules = []; ember(store).props = []; deployments(ember(store))[0].cd = 333
    const reloaded = api.normalizeModeConfigStore(store)
    assert.equal(ember(reloaded).vehicleRefreshRules.length, 0)
    assert.equal(ember(reloaded).props.length, 0)
    assert.equal(deployments(ember(reloaded))[0].cd, 333)
  } finally { globalThis.localStorage = { getItem: () => null } }
})

test('optional local pre-update capture proves every non-target map and mode stayed intact', { skip: !fs.existsSync(path.join(__dirname, '../source/PC提取资源/烬区/PC指挥官同步_2026-11-13/before.json')) }, () => {
  const captured = JSON.parse(fs.readFileSync(path.join(__dirname, '../source/PC提取资源/烬区/PC指挥官同步_2026-11-13/before.json')))
  const before = api.normalizeModeConfigStore({ ...captured, version: 69 })
  const now = api.normalizeModeConfigStore(api.loadModeConfigStore())
  for (const profile of before.profiles) for (const platform of ['pc', 'mobile']) for (const [id, map] of Object.entries(profile.platformMaps[platform])) {
    // Trench has its own later v72 source update, outside this historical capture's unchanged scope.
    if (profile.id === 'winner-takes-all' && platform === 'pc' && ['ember', 'trench'].includes(id)) continue
    assert.deepEqual(stable(now.profiles.find((p) => p.id === profile.id).platformMaps[platform][id]), stable(map))
  }
})
