const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { createConfigLoader } = require('./lib/load-config-module.cjs')

const root = path.resolve(__dirname, '..')
const load = createConfigLoader(root)
const snapshot = load('src/config/emberClientRegions.json')
const { EMBER_CLIENT_REGION_NOTE, EMBER_PC_WINNER_REGION_NOTE, withEmberClientRegions } = load('src/config/emberClientRegions.ts')
const pcWinnerS1 = load('src/config/emberPcWinnerS1.json')
const pcAttackDefense = load('src/config/pcOrdinaryAttackDefenseData.json').maps.ember.official
const pcCommander = load('src/config/emberPcCommanderData.json').maps.ember.official
const { stagesForPlatform } = load('src/config/gameDataPlatform.ts')
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
const clone = (v) => structuredClone(v)
const profileOf = (store, mode) => store.profiles.find((p) => p.id === mode)
const mapOf = (store, mode, platform) => profileOf(store, mode).platformMaps[platform].ember
const oldSources = {
  'attack-defense': {
    pc: load('src/config/pcAttackDefenseOfficial.json').maps.ember,
    mobile: load('src/config/mobileAttackDefenseOfficial.json').maps.ember,
  },
  'winner-takes-all': {
    pc: load('src/config/winnerTakesAllOfficial.json').maps.ember,
    mobile: load('src/config/mobileWinnerTakesAllOfficial.json').maps.ember,
  },
}
function freshStore() {
  storage.clear()
  return loadModeConfigStore()
}
function legacyStore() {
  const store = freshStore()
  store.version = 41
  for (const mode of modes) for (const platform of platforms) {
    const map = mapOf(store, mode, platform)
    map.notes = '已有备注'
    for (const zone of map.zones) {
      const stage = oldSources[mode][platform].stages.find((s) => s.id === zone.stageId)
      let points
      if (zone.role === 'frontline') points = stage.zone?.latlngs
      if (zone.role === 'attack-base') points = stage.attackBaseZone
      if (zone.role === 'defense-base') points = stage.defenseBaseZone
      if (zone.role === 'capture') {
        const objective = map.objectives.find((p) => p.captureZoneUid === zone.uid)
        points = stage.points.find((p) => p.name === objective?.name)?.capturable
      }
      if (points) zone.points = clone(points)
    }
  }
  return store
}
function assertSourceRegions(stages, pcWinner = false, pcOrdinary = false) {
  if (pcOrdinary || pcWinner) {
    for (const expected of (pcWinner ? pcCommander : pcAttackDefense).stages.filter((stage) => stage.id !== 'S4')) {
      const actual = stages.find((stage) => stage.id === expected.id)
      assert.deepEqual(actual.zone.latlngs, expected.zone.latlngs)
      assert.deepEqual(actual.attackBaseZone, expected.attackBaseZone)
      assert.deepEqual(actual.defenseBaseZone, expected.defenseBaseZone)
      for (const point of expected.points) assert.deepEqual(actual.points.find((p) => p.name === point.name).capturable, point.capturable)
    }
    return
  }
  for (const source of snapshot.stages) {
    const stage = stages.find((s) => s.id === source.id)
    assert.deepEqual(stage.zone.latlngs, pcWinner && stage.id === 'S1' ? pcWinnerS1.frontline : source.frontline)
    assert.deepEqual(stage.attackBaseZone, source.attackBaseZone)
    assert.deepEqual(stage.defenseBaseZone, source.defenseBaseZone)
    for (const [name, area] of Object.entries(source.captureAreas)) {
      assert.deepEqual(stage.points.find((p) => p.name === name).capturable, area)
    }
  }
}

test('source provenance stays explicit; application snapshot reproduces extracted coordinates', () => {
  assert.equal(snapshot.source.pcWinnerMappingVerified, false)
  assert.equal(snapshot.source.independentS4Recovered, false)
  assert.deepEqual(snapshot.stages.map((s) => s.frontline.length), [40, 38, 9])
  assert.deepEqual(snapshot.stages.map((s) => s.attackBaseZone.length), [21, 36, 32])
  assert.deepEqual(snapshot.stages.map((s) => s.defenseBaseZone.length), [34, 9, 4])
  assert.equal(snapshot.stages[0].geometryDiagnostics.find((r) => r.role === 'sector_activity').validInXY, false)
  // This source is intentionally not a runtime dependency or required checkout fixture.
  if (fs.existsSync(path.join(root, snapshot.source.sourceFile))) {
    const { buildSnapshot } = require('./sync-ember-client-regions.cjs')
    assert.deepEqual(snapshot, buildSnapshot())
  }
})

test('all four default/runtime/export contexts use extracted regions and S3-based S4, preserving S4 attack positions', () => {
  const store = freshStore()
  assert.equal(store.version, 72)
  for (const platform of platforms) assertSourceRegions(stagesForPlatform(platform).ember, false, platform === 'pc')
  for (const mode of modes) for (const platform of platforms) {
    const profile = profileOf(store, mode)
    const runtime = buildRuntimeModeData(profile, platform, 'ember')
    assert.deepEqual(runtime.issues, [])
    assertSourceRegions(runtime.map.stages, mode === 'winner-takes-all' && platform === 'pc', mode === 'attack-defense' && platform === 'pc')
    assertSourceRegions(buildOfficialModeData(profile, platform, 'ember').maps.ember.stages, mode === 'winner-takes-all' && platform === 'pc', mode === 'attack-defense' && platform === 'pc')
    const s4 = runtime.map.stages.find((s) => s.id === 'S4')
    const s3 = runtime.map.stages.find((s) => s.id === 'S3')
    const old = oldSources[mode][platform].stages.find((s) => s.id === 'S4')
    assert.deepEqual(s4.zone.latlngs, s3.zone.latlngs)
    assert.deepEqual(s4.attackBaseZone, s3.attackBaseZone)
    assert.deepEqual(s4.defenseBaseZone, s3.defenseBaseZone)
    assert.deepEqual(s4.points, s3.points.filter((p) => p.name === '据点C2'))
    assert.deepEqual(s4.attackSpawns, old.attackSpawns)
    assert.deepEqual(s4.defenseSpawns, s3.defenseSpawns)
    assert.equal(runtime.map.stages.length, oldSources[mode][platform].stages.length)
    for (const stage of runtime.map.stages) {
      const source = platform === 'pc' ? mode === 'attack-defense' ? pcAttackDefense : pcCommander : oldSources[mode][platform]
      const original = source.stages.find((s) => s.id === (stage.id === 'S4' ? 'S3' : stage.id))
      const markers = (points) => points.map(({ capturable, ...point }) => point)
      assert.deepEqual(markers(stage.points), markers(stage.id === 'S4' ? original.points.filter((p) => p.name === '据点C2') : original.points))
    }
    assert.deepEqual(runtime.map.vehicleRefreshRules, buildOfficialModeData(profile, platform, 'ember').maps.ember.vehicleRefreshRules)
  }
})

test('v41 migration updates native-stage builtins plus S4 while preserving styles, UIDs and other profiles', () => {
  const old = legacyStore()
  old.activeModeId = 'my-mode'
  old.profiles.push({ ...clone(profileOf(old, 'winner-takes-all')), id: 'my-mode', name: '自定义模式' })
  for (const mode of modes) for (const platform of platforms) {
    const map = mapOf(old, mode, platform)
    map.zones[0].name = '保留我的区域名'
    map.zones[0].color = '#abcdef'
    map.zones.push({ uid: `user-${mode}-${platform}`, stageId: 'S1', name: '我的区域', role: 'custom',
      kind: 'neutral', color: '#ffffff', points: [[-100, 100], [-101, 100], [-101, 101]], verification: 'draft' })
    // Recreate a missing built-in capture and its lost link.
    const point = map.objectives.find((p) => p.stageId === 'S2' && p.name === '据点B1')
    map.zones = map.zones.filter((z) => z.uid !== point.captureZoneUid)
    point.captureZoneUid = ''
  }
  const original = clone(old)
  const baseline = normalizeModeConfigStore({ ...clone(old), version: 44 })
  const migrated = normalizeModeConfigStore(old)
  assert.equal(migrated.version, 72)
  assert.equal(migrated.activeModeId, 'my-mode')
  assert.deepEqual(old, original, 'migration must not mutate caller data')
  assert.deepEqual(profileOf(migrated, 'my-mode'), profileOf(baseline, 'my-mode'))
  for (const mode of modes) for (const platform of platforms) {
    const before = mapOf(baseline, mode, platform)
    const after = mapOf(migrated, mode, platform)
    assertSourceRegions(buildRuntimeModeData(profileOf(migrated, mode), platform, 'ember').map.stages, mode === 'winner-takes-all' && platform === 'pc', mode === 'attack-defense' && platform === 'pc')
    for (const key of ['stages', 'spawns', 'props', 'vehicleRefreshPoints', 'vehicleRefreshRules']) {
      assert.deepEqual(after[key], before[key], `${mode}/${platform}/${key}`)
    }
    assert.deepEqual(after.zones.filter((z) => z.stageId !== 'S4' && z.role === 'custom'), before.zones.filter((z) => z.stageId !== 'S4' && z.role === 'custom'))
    assert.equal(after.zones[0].uid, before.zones[0].uid)
    assert.equal(after.zones[0].color, '#abcdef')
    assert.equal(after.zones[0].name, '保留我的区域名')
    const expectedNote = mode === 'winner-takes-all' && platform === 'pc' ? EMBER_PC_WINNER_REGION_NOTE : EMBER_CLIENT_REGION_NOTE
    assert.ok(after.notes.includes('已有备注') && after.notes.includes(expectedNote))
    const mapsBefore = profileOf(baseline, mode).platformMaps[platform]
    const mapsAfter = profileOf(migrated, mode).platformMaps[platform]
    for (const id of Object.keys(mapsBefore).filter((id) => id !== 'ember')) assert.deepEqual(mapsAfter[id], mapsBefore[id])
  }
  assert.deepEqual(normalizeModeConfigStore(migrated), migrated)
})

test('platform/mode coordinates are independent and later edits are not reapplied on reload', () => {
  const store = freshStore()
  const maps = modes.flatMap((mode) => platforms.map((p) => mapOf(store, mode, p)))
  const areas = maps.map((m) => m.zones.find((z) => z.stageId === 'S1' && z.role === 'frontline').points)
  for (let i = 0; i < areas.length; i++) for (let j = i + 1; j < areas.length; j++) {
    assert.notEqual(areas[i], areas[j])
    assert.notEqual(areas[i][0], areas[j][0])
  }
  const saved = clone(areas[1])
  areas[0][0][0] = -123
  assert.deepEqual(areas[1], saved)
  assert.deepEqual(snapshot.stages[0].frontline, saved)
  const normalized = normalizeModeConfigStore(store)
  assert.equal(mapOf(normalized, modes[0], platforms[0]).zones.find((z) => z.stageId === 'S1' && z.role === 'frontline').points[0][0], -123)
  const untouched = oldSources['winner-takes-all'].pc.stages
  const original = clone(untouched)
  withEmberClientRegions('ember', untouched)
  assert.deepEqual(untouched, original)
  assert.equal(withEmberClientRegions('ascent', untouched), untouched)
})

test('official-format user imports keep their custom Ember coordinates after the one-time migration', () => {
  const store = freshStore()
  const exported = clone(buildOfficialModeData(profileOf(store, 'winner-takes-all'), 'mobile', 'ember'))
  exported.maps.ember.stages[0].zone.latlngs[0][0] = -111.234
  exported.maps.ember.stages[0].points[0].capturable[0][0] = -112.345
  const imported = importModeConfigData(store, exported)
  assert.equal(imported.kind, 'official')
  const runtime = buildRuntimeModeData(profileOf(imported.store, 'winner-takes-all'), 'mobile', 'ember')
  assert.equal(runtime.map.stages[0].zone.latlngs[0][0], -111.234)
  assert.equal(runtime.map.stages[0].points[0].capturable[0][0], -112.345)
})

test('loading an existing v41 store persists the current version once and retains migrated regions on subsequent loads', () => {
  const old = legacyStore()
  storage.set(MODE_CONFIG_STORAGE_KEY, JSON.stringify(old))
  writes = 0
  const migrated = loadModeConfigStore()
  assert.equal(writes, 1)
  assert.equal(JSON.parse(storage.get(MODE_CONFIG_STORAGE_KEY)).version, 72)
  assertSourceRegions(buildRuntimeModeData(profileOf(migrated, 'winner-takes-all'), 'pc', 'ember').map.stages, true)
  assert.deepEqual(loadModeConfigStore(), migrated)
  assert.equal(writes, 1)
})

test('v45 PC winner S1 migrates once, retaining zone identity and every other region', () => {
  const old = freshStore()
  old.version = 45
  const beforeMap = mapOf(old, 'winner-takes-all', 'pc')
  const zone = beforeMap.zones.find((z) => z.stageId === 'S1' && z.role === 'frontline')
  zone.points = clone(snapshot.stages[0].frontline)
  zone.name = '我的 S1 防线'
  zone.color = '#123456'
  beforeMap.notes = '保留备注\n' + EMBER_CLIENT_REGION_NOTE
  const original = clone(old)
  const next = normalizeModeConfigStore(old)
  const afterMap = mapOf(next, 'winner-takes-all', 'pc')
  const migratedZone = afterMap.zones.find((z) => z.uid === zone.uid)
  assert.deepEqual(old, original)
  assert.deepEqual(JSON.parse(JSON.stringify(migratedZone)), JSON.parse(JSON.stringify({ ...zone, points: pcCommander.stages[0].zone.latlngs })))
  assert.deepEqual(afterMap.zones.filter((z) => z.uid !== zone.uid), beforeMap.zones.filter((z) => z.uid !== zone.uid))
  for (const key of ['stages', 'objectives', 'spawns', 'props', 'vehicleRefreshPoints', 'vehicleRefreshRules']) {
    assert.deepEqual(afterMap[key], beforeMap[key], key)
  }
  for (const mode of modes) for (const platform of platforms) {
    if (mode === 'winner-takes-all' && platform === 'pc') continue
    assert.deepEqual(JSON.parse(JSON.stringify(mapOf(next, mode, platform))), JSON.parse(JSON.stringify(mapOf(old, mode, platform))))
  }
  assert.ok(afterMap.notes.includes('保留备注') && afterMap.notes.includes(EMBER_PC_WINNER_REGION_NOTE))
  migratedZone.points[0][0] += 1
  assert.deepEqual(mapOf(normalizeModeConfigStore(next), 'winner-takes-all', 'pc').zones, afterMap.zones)
  const exported = buildOfficialModeData(profileOf(next, 'winner-takes-all'), 'pc', 'ember')
  const imported = importModeConfigData(next, exported)
  assert.deepEqual(buildRuntimeModeData(profileOf(imported.store, 'winner-takes-all'), 'pc', 'ember').map.stages[0].zone.latlngs, migratedZone.points)
})

test('PC winner S1 snapshot preserves current PC provenance and its 35 source vertices', () => {
  assert.equal(pcWinnerS1.source.platform, 'pc')
  assert.equal(pcWinnerS1.source.mapId, 602)
  assert.equal(pcWinnerS1.source.modeBindingVerified, true)
  assert.equal(pcWinnerS1.frontline.length, 35)
  assert.equal(pcWinnerS1.worldXYZcm.length, 35)
  const pcSource = path.resolve(root, pcWinnerS1.source.sourceDataFile)
  if (fs.existsSync(pcSource)) {
    const { buildPcWinnerSnapshot } = require('./sync-ember-client-regions.cjs')
    assert.deepEqual(pcWinnerS1, buildPcWinnerSnapshot())
  }
})

test('v46 restores a missing S1 frontline with a distinct UID when its old UID is used by a custom area', () => {
  const store = freshStore()
  store.version = 45
  const map = mapOf(store, 'winner-takes-all', 'pc')
  const original = map.zones.find((z) => z.stageId === 'S1' && z.role === 'frontline')
  original.role = 'custom'
  original.name = '我的区域'
  const migrated = normalizeModeConfigStore(store)
  const next = mapOf(migrated, 'winner-takes-all', 'pc')
  assert.deepEqual(next.zones.find((z) => z.uid === original.uid), original)
  const restored = next.zones.find((z) => z.stageId === 'S1' && z.role === 'frontline')
  assert.notEqual(restored.uid, original.uid)
  assert.deepEqual(restored.points, pcWinnerS1.frontline)
  assert.deepEqual(buildRuntimeModeData(profileOf(migrated, 'winner-takes-all'), 'pc', 'ember').issues, [])
})
