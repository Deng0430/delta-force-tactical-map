const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { createConfigLoader } = require('./lib/load-config-module.cjs')
const load = createConfigLoader()
const snapshot = load('src/config/pcOrdinaryAttackDefenseData.json')
const { withPcOrdinaryAttackDefense, pcOrdinaryAttackDefenseDefaults } = load('src/config/pcOrdinaryAttackDefense.ts')
const api = load('src/utils/modeConfigStorage.ts')
const platformApi = load('src/config/gameDataPlatform.ts')
const { evaluateVehicleRefreshRule, isVehicleRefreshRuleInStage } = load('src/utils/vehicleRefreshRuntime.ts')
const priorStorage = globalThis.localStorage
globalThis.localStorage = { getItem: () => null }
test.after(() => { if (priorStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = priorStorage })
const stable = (value) => JSON.parse(JSON.stringify(value, (key, value) => key === 'updatedAt' ? undefined : value))
// A field-level migration preserves the user's display order, unlike a fresh native snapshot.
function entities(value) {
  if (Array.isArray(value)) {
    const result = value.map(entities)
    return result.every((v) => v && typeof v === 'object' && (v.uid || v.icon))
      ? result.sort((a, b) => String(a.uid ?? a.icon).localeCompare(String(b.uid ?? b.icon))) : result
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === 'vehicleCategories' ? [...v].sort() : entities(v)]))
  return value
}
const profile = (store, id = 'attack-defense') => store.profiles.find((p) => p.id === id)
const map = (store, id, platform = 'pc', mode = 'attack-defense') => profile(store, mode).platformMaps[platform][id]
function legacy() {
  const store = api.normalizeModeConfigStore(api.loadModeConfigStore())
  store.version = 67
  for (const [id, data] of Object.entries(snapshot.maps)) profile(store).platformMaps.pc[id] = structuredClone(data.previousMap)
  profile(store).maps = profile(store).platformMaps.pc
  return store
}

test('fresh defaults and all PC ordinary data entry points use only MapIDs 75/33/302/107', () => {
  const store = api.loadModeConfigStore()
  assert.equal(store.version, 72)
  assert.deepEqual(Object.values(snapshot.maps).map((x) => x.source.mapId), [75, 33, 302, 107])
  for (const [id, data] of Object.entries(snapshot.maps)) {
    const target = map(store, id)
    assert.deepEqual(stable(target), stable(data.map))
    const runtime = api.buildRuntimeModeData(profile(store), 'pc', id)
    assert.deepEqual(runtime.issues, [])
    assert.deepEqual(runtime.map, data.official)
    assert.deepEqual(platformApi.stagesForPlatform('pc')[id], data.official.stages)
    assert.deepEqual(platformApi.propsForPlatform('pc')[id], data.official.props)
    assert.deepEqual(platformApi.deployForPlatform('pc')[id], data.official.deploy)
    for (const spawn of target.spawns) for (const vehicle of spawn.deployVehicles) {
      assert.equal(vehicle.clientSpawner.mapId, data.source.mapId)
      assert.equal(vehicle.clientSpawner.platform, 'pc')
      assert.equal(vehicle.cd, vehicle.clientSpawner.templateVehicleCd)
      if (vehicle.clientSpawner.positionStatus === 'pc-level-verified') {
        assert.ok(vehicle.deployPositions.length)
        for (const position of vehicle.deployPositions) assert.ok(data.evidence.deployments.some((d) => d.spawnUid === spawn.uid
          && d.vehicleId === vehicle.clientSpawner.vehicleId && JSON.stringify(d.position) === JSON.stringify(position)))
      } else assert.equal(vehicle.deployPositions, undefined)
      assert.equal(vehicle.deployCountKnown, false) // Single-use limits are disabled in all these PC ordinary rows.
    }
    assert.notEqual(target, pcOrdinaryAttackDefenseDefaults(id))
    assert.notEqual(target.spawns, map(store, id, 'mobile').spawns)
  }
})

test('v67 migration affects only four PC ordinary maps; commander/mobile/custom/other maps stay byte-equivalent', () => {
  const old = legacy()
  const custom = { ...structuredClone(profile(old)), id: 'custom-mode', name: '我的自定义模式' }
  old.profiles.push(custom)
  const before = structuredClone(old)
  const updated = api.normalizeModeConfigStore(old)
  assert.deepEqual(old, before)
  assert.deepEqual(stable(profile(updated, 'winner-takes-all')), stable(profile(before, 'winner-takes-all')))
  assert.deepEqual(stable(profile(updated, 'custom-mode')), stable(custom))
  assert.deepEqual(stable(profile(updated).platformMaps.mobile), stable(profile(before).platformMaps.mobile))
  for (const id of Object.keys(profile(old).platformMaps.pc)) {
    if (!(id in snapshot.maps)) assert.deepEqual(stable(map(updated, id)), stable(map(before, id)))
    else {
      assert.deepEqual(entities(stable(map(updated, id))), entities(stable(snapshot.maps[id].map)))
      assert.deepEqual(api.buildRuntimeModeData(profile(updated, 'winner-takes-all'), 'pc', id),
        api.buildRuntimeModeData(profile(before, 'winner-takes-all'), 'pc', id))
    }
  }
  assert.deepEqual(stable(api.normalizeModeConfigStore(updated)), stable(updated))
})

test('migration retains user coordinates/styles/deletions/CD/notes and does not mutate its inputs', () => {
  for (const [id, source] of Object.entries(snapshot.maps)) {
    const current = structuredClone(source.previousMap)
    const zone = current.zones[0]
    zone.points = [[-1, 2], [-3, 4], [-5, 6]]
    zone.color = '#123456'
    const kept = current.spawns.find((s) => source.map.spawns.some((d) => d.uid === s.uid) && s.deployVehicles.length)
    assert.ok(kept, id)
    kept.lat -= 3
    kept.name = '用户自己的基地名称'
    kept.deployVehicles[0].cd = 777
    kept.deployVehicles[0].deployCount = 8
    const prop = current.props.find((p) => source.map.props.some((d) => d.uid === p.uid))
    assert.ok(prop)
    current.props = current.props.filter((p) => p.uid !== prop.uid)
    current.props.push({ ...structuredClone(prop), uid: 'custom-prop', name: '我的道具' })
    current.notes = '自己的备注'
    const before = structuredClone(current)
    const next = withPcOrdinaryAttackDefense(current, 'attack-defense', 'pc')
    assert.deepEqual(current, before)
    assert.deepEqual(next.zones.find((z) => z.uid === zone.uid), zone)
    const saved = next.spawns.find((s) => s.uid === kept.uid)
    assert.equal(saved.lat, kept.lat)
    assert.equal(saved.name, kept.name)
    assert.equal(saved.deployVehicles.find((v) => v.icon === kept.deployVehicles[0].icon).cd, 777)
    assert.equal(saved.deployVehicles.find((v) => v.icon === kept.deployVehicles[0].icon).deployCount, 8)
    assert.ok(!next.props.some((p) => p.uid === prop.uid))
    assert.ok(next.props.some((p) => p.uid === 'custom-prop'))
    assert.match(next.notes, /自己的备注/)
    assert.equal(withPcOrdinaryAttackDefense(current, 'winner-takes-all', 'pc'), current)
    assert.equal(withPcOrdinaryAttackDefense(current, 'attack-defense', 'mobile'), current)
  }
})

test('current-version edits/deletions remain intact; storage migration persists once', () => {
  const data = new Map([[api.MODE_CONFIG_STORAGE_KEY, JSON.stringify(legacy())]])
  let writes = 0
  globalThis.localStorage = { getItem: (key) => data.get(key), setItem: (key, value) => { writes++; data.set(key, value) } }
  try {
    const migrated = api.loadModeConfigStore()
    assert.equal(writes, 1)
    api.loadModeConfigStore()
    assert.equal(writes, 1)
    for (const id of Object.keys(snapshot.maps)) {
      map(migrated, id).vehicleRefreshRules = []
      map(migrated, id).props = []
      map(migrated, id).spawns[0].lat = -42
    }
    const reloaded = api.normalizeModeConfigStore(migrated)
    for (const id of Object.keys(snapshot.maps)) {
      assert.equal(map(reloaded, id).props.length, 0)
      assert.equal(map(reloaded, id).vehicleRefreshRules.length, 0)
      assert.equal(map(reloaded, id).spawns[0].lat, -42)
    }
  } finally { globalThis.localStorage = { getItem: () => null } }
})

test('deleted stages do not gain orphan native bases, props, objectives or refresh rules during migration', () => {
  for (const source of Object.values(snapshot.maps)) {
    const old = structuredClone(source.previousMap)
    old.stages = old.stages.filter((stage) => stage.id !== 'S2')
    for (const field of ['zones', 'spawns', 'objectives', 'props']) old[field] = old[field].filter((item) => item.stageId !== 'S2')
    const next = withPcOrdinaryAttackDefense(old, 'attack-defense', 'pc')
    assert.equal(next.stages.some((stage) => stage.id === 'S2'), false)
    for (const field of ['zones', 'spawns', 'objectives', 'props']) assert.equal(next[field].some((item) => item.stageId === 'S2'), false)
    assert.equal(next.vehicleRefreshRules.some((rule) => rule.objective === 'S2'), false)
    assert.ok(next.vehicleRefreshPoints.every((point) => next.vehicleRefreshRules.some((rule) => rule.refreshPointUid === point.uid)))
  }
})

test('refreshes use condition phase keys, not repeated table arrays; percentages remain percentages', () => {
  const { maps } = snapshot
  assert.equal(maps.ember.map.vehicleRefreshRules.length, 3)
  assert.equal(maps.trench.map.vehicleRefreshRules.length, 6)
  assert.equal(maps.stormeye.map.vehicleRefreshRules.length, 8)
  assert.equal(maps.flashpoint.map.vehicleRefreshRules.length, 0)
  const store = api.loadModeConfigStore()
  for (const [id, data] of Object.entries(maps)) {
    const target = api.buildRuntimeModeData(profile(store), 'pc', id).map
    for (const rule of target.vehicleRefreshRules) {
      const source = data.evidence.refresh.find((r) => r.ruleUid === rule.uid)
      assert.ok(source)
      assert.equal(rule.objective, source.stageId)
      const index = target.stages.findIndex((stage) => stage.id === source.stageId)
      for (let i = 0; i < target.stages.length; i++) assert.equal(isVehicleRefreshRuleInStage(rule, { stages: target.stages, currentStageIndex: i }), i === index)
      const context = { tickets: { attack: 0, defense: null }, matchTimeSeconds: null, objectiveStates: {}, objectiveCountdowns: {}, mapEvents: [] }
      if (source.sourceEnum.endsWith('XPercent')) {
        assert.equal(rule.trigger.type, 'map-event')
        assert.match(String(rule.trigger.value), /%/)
        assert.equal(evaluateVehicleRefreshRule(rule, context, { stages: target.stages, currentStageIndex: index }).eligible, false)
        context.mapEvents.push(rule.trigger.value)
      } else assert.equal(rule.trigger.value, source.sourceValue)
      assert.equal(evaluateVehicleRefreshRule(rule, context, { stages: target.stages, currentStageIndex: index }).eligible, true)
    }
  }
  assert.ok(maps.stormeye.evidence.refresh.some((r) => r.spawnerId === 'ORV_S2_pingheng' && r.nameResolution.includes('FName')))
})

test('official export/import and backup preserve native XY, conditions and mode/platform boundaries', () => {
  const store = api.normalizeModeConfigStore(api.loadModeConfigStore())
  for (const id of Object.keys(snapshot.maps)) {
    const exported = api.buildOfficialModeData(profile(store), 'pc', id)
    assert.equal(exported.mode.id, 'attack-defense')
    assert.equal(exported.gameDataPlatform, 'pc')
    assert.deepEqual(Object.keys(exported.maps), [id])
    const imported = api.importModeConfigData(store, structuredClone(exported), 'mobile')
    assert.equal(imported.gameDataPlatform, 'pc')
    const saved = api.normalizeModeConfigStore(JSON.parse(JSON.stringify(imported.store)))
    assert.deepEqual(stable(api.buildOfficialModeData(profile(saved), 'pc', id)), stable(exported))
    assert.deepEqual(stable(profile(saved, 'winner-takes-all')), stable(profile(store, 'winner-takes-all')))
    assert.deepEqual(stable(profile(saved).platformMaps.mobile), stable(profile(store).platformMaps.mobile))
  }
})

test('captured pre-change commander/mobile exports stay identical (optional ignored local evidence)', { skip: !fs.existsSync(path.join(__dirname, '../source/PC提取资源/普通攻防四图同步_2026-11-13/before.json')) }, () => {
  const captured = JSON.parse(fs.readFileSync(path.join(__dirname, '../source/PC提取资源/普通攻防四图同步_2026-11-13/before.json')))
  // Resolve icon assets through the current catalog, which can be updated in another shared-workspace chat.
  const before = api.normalizeModeConfigStore({ ...captured, version: 69 })
  const updated = api.loadModeConfigStore()
  for (const mode of ['attack-defense', 'winner-takes-all']) for (const platform of ['pc', 'mobile']) {
    if (mode === 'attack-defense' && platform === 'pc') continue
    for (const id of Object.keys(snapshot.maps)) {
      // Ember v69 and Trench v72 have later independent commander updates, outside this capture's unchanged scope.
      if (mode === 'winner-takes-all' && platform === 'pc' && ['ember', 'trench'].includes(id)) continue
      assert.deepEqual(stable(map(updated, id, platform, mode)), stable(map(before, id, platform, mode)))
    }
  }
})
