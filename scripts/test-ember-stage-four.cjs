const assert = require('node:assert/strict')
const test = require('node:test')
const { createConfigLoader } = require('./lib/load-config-module.cjs')
const load = createConfigLoader()
const { loadModeConfigStore, normalizeModeConfigStore, buildRuntimeModeData, validateModeMapConfig } = load('src/utils/modeConfigStorage.ts')
const { stagesForPlatform, propsForPlatform } = load('src/config/gameDataPlatform.ts')
const { withEmberStageFourStages, withEmberStageFourDeploy } = load('src/config/emberStageFour.ts')
const modes = ['attack-defense', 'winner-takes-all']
const platforms = ['pc', 'mobile']
const originalStorage = globalThis.localStorage
globalThis.localStorage = { getItem: () => null }
test.after(() => {
  if (originalStorage === undefined) delete globalThis.localStorage
  else globalThis.localStorage = originalStorage
})
const profile = (store, mode) => store.profiles.find((p) => p.id === mode)
const mapOf = (store, mode, platform) => profile(store, mode).platformMaps[platform].ember
const stageEntities = (map, field, stageId) => map[field].filter((item) => item.stageId === stageId)
const shape = ({ uid, stageId, name, objectiveUid, captureZoneUid, ...data }) => data

function assertStageCopy(store, mode, platform) {
  const map = mapOf(store, mode, platform)
  assert.deepEqual(validateModeMapConfig('ember', map), [])
  const runtime = buildRuntimeModeData(profile(store, mode), platform, 'ember').map
  const a = runtime.stages.find((s) => s.id === 'S3')
  const b = runtime.stages.find((s) => s.id === 'S4')
  for (const field of ['attackBaseZone', 'defenseBaseZone', 'defenseSpawns']) assert.deepEqual(b[field], a[field], field)
  assert.deepEqual(b.zone.latlngs, a.zone.latlngs)
  assert.deepEqual(b.points, a.points.filter((p) => p.name === '据点C2'))
  assert.equal(b.spawns.filter((s) => s.side === 'attack').length, 2)
  assert.equal(b.spawns.filter((s) => s.side === 'defense').length, 2)
  for (const field of ['zones', 'objectives', 'props']) {
    const excluded = map.objectives.find((p) => p.stageId === 'S3' && p.name === '据点C1')
    const source = stageEntities(map, field, 'S3').filter((item) => item.uid !== excluded.uid && item.uid !== excluded.captureZoneUid)
    const target = stageEntities(map, field, 'S4')
    assert.deepEqual(target.map(shape), source.map(shape), field)
    for (let i = 0; i < source.length; i++) assert.notEqual(source[i].uid, target[i].uid)
  }
  assert.notEqual(a.points, b.points)
  assert.notEqual(a.points[1].capturable, b.points[0].capturable)
}

test('all four builtin maps copy S3 into S4 except the two original attack spawn identities and positions', () => {
  const store = loadModeConfigStore()
  assert.equal(store.version, 72)
  for (const mode of modes) for (const platform of platforms) {
    assertStageCopy(store, mode, platform)
    const original = load(`src/config/${mode === 'attack-defense'
      ? platform === 'pc' ? 'pcAttackDefenseOfficial' : 'mobileAttackDefenseOfficial'
      : platform === 'pc' ? 'winnerTakesAllOfficial' : 'mobileWinnerTakesAllOfficial'}.json`)
      .maps.ember.stages.find((s) => s.id === 'S4').spawns.filter((s) => s.side === 'attack')
    const attack = stageEntities(mapOf(store, mode, platform), 'spawns', 'S4').filter((s) => s.side === 'attack')
    assert.deepEqual(attack.map(({ uid, name, lat, lng }) => ({ uid, name, lat, lng })), original.map(({ uid, name, lat, lng }) => ({ uid, name, lat, lng })))
  }
  for (const platform of platforms) {
    const stages = stagesForPlatform(platform).ember
    assert.deepEqual(stages[3].points, stages[2].points.filter((p) => p.name === '据点C2'))
    assert.deepEqual(propsForPlatform(platform).ember.filter((p) => p.stage === 'S4').map(({ stage, ...p }) => p),
      propsForPlatform(platform).ember.filter((p) => p.stage === 'S3').map(({ stage, ...p }) => p))
  }
})

test('v42 saved maps copy the current S3, retain S4 C2 UID/attack positions and leave other stages/maps/profiles intact', () => {
  const old = loadModeConfigStore()
  old.version = 42
  old.activeModeId = 'my-mode'
  old.profiles.push({ ...structuredClone(profile(old, 'winner-takes-all')), id: 'my-mode', name: '我的模式' })
  for (const mode of modes) for (const platform of platforms) {
    const map = mapOf(old, mode, platform)
    const point = map.objectives.find((p) => p.stageId === 'S3' && p.name === '据点C2')
    point.lat -= 0.125
    map.zones.find((z) => z.uid === point.captureZoneUid).points[0][0] -= 0.25
    map.spawns.find((s) => s.stageId === 'S3' && s.side === 'defense').lat -= 0.5
    const c1 = map.objectives.find((p) => p.stageId === 'S4' && p.name === '据点C1')
    map.zones = map.zones.filter((z) => z.uid !== c1?.captureZoneUid)
    map.objectives = map.objectives.filter((p) => p.uid !== c1?.uid)
    map.spawns = map.spawns.filter((s) => s.stageId !== 'S4' || s.side === 'attack')
    map.zones.find((z) => z.stageId === 'S4' && z.role === 'frontline').points = [[0, 0], [1, 0], [1, 1]]
    map.props.push({ uid: `custom-${mode}-${platform}`, stageId: 'S3', name: 'S3 道具', icon: 'q_gdjq', lat: -100, lng: 100, verification: 'confirmed' })
  }
  const original = structuredClone(old)
  const baseline = normalizeModeConfigStore({ ...structuredClone(old), version: 44 })
  const migrated = normalizeModeConfigStore(old)
  assert.equal(migrated.version, 72)
  assert.equal(migrated.activeModeId, 'my-mode')
  assert.deepEqual(old, original)
  assert.deepEqual(profile(migrated, 'my-mode'), profile(baseline, 'my-mode'))
  for (const mode of modes) for (const platform of platforms) {
    assertStageCopy(migrated, mode, platform)
    const before = mapOf(baseline, mode, platform)
    const after = mapOf(migrated, mode, platform)
    for (const field of ['zones', 'objectives', 'spawns', 'props']) {
      assert.deepEqual(after[field].filter((item) => item.stageId !== 'S4'), before[field].filter((item) => item.stageId !== 'S4'))
    }
    const pose = (map) => stageEntities(map, 'spawns', 'S4').filter((s) => s.side === 'attack').map(({ uid, name, lat, lng }) => ({ uid, name, lat, lng }))
    assert.deepEqual(pose(after), pose(before))
    const c2uid = (map) => map.objectives.find((p) => p.stageId === 'S4' && p.name === '据点C2').uid
    assert.equal(c2uid(after), c2uid(before))
    assert.deepEqual(after.vehicleRefreshRules, before.vehicleRefreshRules)
    for (const id of Object.keys(profile(baseline, mode).platformMaps[platform]).filter((id) => id !== 'ember')) {
      assert.deepEqual(profile(migrated, mode).platformMaps[platform][id], profile(baseline, mode).platformMaps[platform][id])
    }
  }
  assert.deepEqual(normalizeModeConfigStore(migrated), migrated)
})

test('post-migration S3/S4 edits are independent, with no live following on reload', () => {
  const store = loadModeConfigStore()
  const map = mapOf(store, 'winner-takes-all', 'pc')
  const s4 = structuredClone(stageEntities(map, 'zones', 'S4'))
  map.zones.find((z) => z.stageId === 'S3' && z.role === 'frontline').points[0][0] -= 3
  const reloaded = normalizeModeConfigStore(store)
  assert.deepEqual(stageEntities(mapOf(reloaded, 'winner-takes-all', 'pc'), 'zones', 'S4'), s4)
})

test('v43 correction removes the erroneous S4 C1 marker and capture area in all four maps', () => {
  const old = loadModeConfigStore()
  old.version = 43
  for (const mode of modes) for (const platform of platforms) {
    const map = mapOf(old, mode, platform)
    const c1 = map.objectives.find((p) => p.stageId === 'S3' && p.name === '据点C1')
    const area = map.zones.find((z) => z.uid === c1.captureZoneUid)
    map.objectives.push({ ...structuredClone(c1), uid: 'incorrect-S4-C1', stageId: 'S4', captureZoneUid: 'incorrect-S4-C1-area' })
    map.zones.push({ ...structuredClone(area), uid: 'incorrect-S4-C1-area', stageId: 'S4', objectiveUid: 'incorrect-S4-C1' })
  }
  const corrected = normalizeModeConfigStore(old)
  assert.equal(corrected.version, 72)
  for (const mode of modes) for (const platform of platforms) {
    const map = mapOf(corrected, mode, platform)
    assertStageCopy(corrected, mode, platform)
    assert.deepEqual(stageEntities(map, 'objectives', 'S4').map((p) => p.name), ['据点C2'])
    assert.equal(map.zones.some((z) => z.uid === 'incorrect-S4-C1-area'), false)
    assert.equal(stageEntities(map, 'spawns', 'S4').some((p) => p.name === 'C1大仓' && p.side === 'attack'), true)
    assert.equal(stageEntities(map, 'objectives', 'S3').some((p) => p.name === '据点C1'), true)
  }
})

test('copied deployment entries bind to S4 spawn UIDs, including the retained attack coordinates', () => {
  const stages = structuredClone(stagesForPlatform('pc').ember)
  const source = stages.find((s) => s.id === 'S3')
  const patched = withEmberStageFourStages(stages)
  const target = patched.find((s) => s.id === 'S4')
  const deploy = { S3: Object.fromEntries(['attack', 'defense'].map((side) => [side, source.spawns.filter((s) => s.side === side).map((spawn) => ({ name: '测试载具', spawnUid: spawn.uid, note: spawn.name }))])) }
  const copied = withEmberStageFourDeploy(patched, deploy)
  for (const side of ['attack', 'defense']) {
    assert.deepEqual(copied.S4[side].map((v) => v.spawnUid), target.spawns.filter((s) => s.side === side).map((s) => s.uid))
    assert.notEqual(copied.S4[side], copied.S3[side])
  }
})
