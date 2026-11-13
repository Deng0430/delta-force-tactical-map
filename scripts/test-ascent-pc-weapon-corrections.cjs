const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const { createConfigLoader } = require('./lib/load-config-module.cjs')
const load = createConfigLoader()
const snapshot = load('src/config/ascentPcData.json')
const { withAscentPcWeaponCorrections } = load('src/config/ascentPcData.ts')
const api = load('src/utils/modeConfigStorage.ts')
const priorStorage = global.localStorage
const storage = new Map()
let writes = 0
global.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => { writes++; storage.set(key, value) } }
test.after(() => { if (priorStorage === undefined) delete global.localStorage; else global.localStorage = priorStorage })
const modes = ['attack-defense', 'winner-takes-all']
const profile = (s, id) => s.profiles.find((p) => p.id === id)
const map = (s, id) => profile(s, id).platformMaps.pc.ascent
const stable = (value) => JSON.parse(JSON.stringify(value, (k, v) => k === 'updatedAt' ? undefined : v))
const fireGod = snapshot.props.filter((p) => p.legacyIcon)
const excluded = snapshot.excludedProps[0]
function fresh() { storage.clear(); return api.loadModeConfigStore() }
function legacy() {
  const store = fresh()
  store.version = 60
  for (const mode of modes) {
    const target = map(store, mode)
    for (const source of fireGod) {
      const marker = target.props.find((p) => p.uid.endsWith(`_ascent_prop-${source.legacyIndex}`))
      marker.name = '固定防空炮'; marker.icon = 'q_gdaap'
    }
    target.props.push({ uid: excluded.uid, name: '密集阵', icon: 'q_mjz', stageId: '*',
      lat: excluded.lat, lng: excluded.lng, verification: 'confirmed' })
  }
  return store
}
test('native CDO separates old AA, manual FireGod and automatic base FireGod; names do not drive classification', () => {
  const byClass = (name) => snapshot.weaponTypes.find((row) => row.className === name).fields
  assert.equal(byClass('BP_SceneAAGun_C').PlayerMarkingType, 'ESceneWeaponMarkerType::FixedWeaponAAMarker')
  assert.equal(byClass('BP_SceneAAGun_LD3000_C').PlayerMarkingType, 'ESceneWeaponMarkerType::FixedWeaponFireGodMarker')
  assert.equal(byClass('BP_SceneAAGun_LD3000_C').WeaponRecId, 18990000023)
  assert.equal(byClass('BP_SceneAAGunAuto_LD3000_C').PlayerMarkingType, 'ESceneWeaponMarkerType::FixedWeaponAutoFireGodMarker')
  assert.equal(byClass('BP_FortificationProxyBase_SceneAutoAAGun_B_C').bCanBuild, false)
  assert.equal(fireGod.length, 2)
  assert.deepEqual(fireGod.map((p) => p.legacyIndex).sort((a, b) => a - b), [47, 55])
  assert.ok(!snapshot.props.some((p) => p.uid === excluded.uid))
})
test('v60 migration corrects both PC modes but only touches the two types and the incorrect automatic marker', () => {
  const store = legacy()
  for (const mode of modes) {
    const target = map(store, mode)
    target.zones[0].points[0] = [-10, 10]
    target.stages[4].label = '自定义事件阶段名称'
    target.spawns[0].lat = -12
    target.props.find((p) => p.uid.endsWith('_ascent_prop-47')).lat -= 1
    target.props.push({ uid: 'user-ciws', name: '密集阵', icon: 'q_mjz', stageId: '*', lat: excluded.lat, lng: excluded.lng, verification: 'draft' })
  }
  store.profiles.push({ ...structuredClone(profile(store, 'winner-takes-all')), id: 'my-mode' })
  const saved = structuredClone(store)
  const baseline = api.normalizeModeConfigStore({ ...structuredClone(store), version: 61 })
  const next = api.normalizeModeConfigStore(store)
  assert.deepEqual(store, saved)
  assert.equal(next.version, 72)
  for (const mode of modes) {
    const before = map(baseline, mode), after = map(next, mode)
    assert.deepEqual(after.zones, before.zones)
    assert.deepEqual(after.objectives, before.objectives)
    assert.deepEqual(after.stages, before.stages)
    assert.deepEqual(after.spawns, before.spawns)
    assert.deepEqual(after.vehicleRefreshRules, before.vehicleRefreshRules)
    assert.deepEqual(after.vehicleRefreshPoints, before.vehicleRefreshPoints)
    assert.ok(!after.props.some((p) => p.uid === excluded.uid))
    for (const original of before.props.filter((p) => p.uid !== excluded.uid)) {
      const marker = after.props.find((p) => p.uid === original.uid)
      const source = fireGod.find((p) => original.uid.endsWith(`_ascent_prop-${p.legacyIndex}`))
      assert.deepEqual(marker, source ? { ...original, name: '火神炮', icon: 'q_hsp' } : original)
    }
    assert.deepEqual(stable(profile(next, mode).platformMaps.mobile), stable(profile(baseline, mode).platformMaps.mobile))
    for (const [id, config] of Object.entries(profile(baseline, mode).platformMaps.pc)) if (id !== 'ascent') {
      assert.deepEqual(stable(profile(next, mode).platformMaps.pc[id]), stable(config))
    }
    assert.equal(withAscentPcWeaponCorrections(after), after)
  }
  assert.deepEqual(stable(profile(next, 'my-mode')), stable(profile(baseline, 'my-mode')))
  assert.deepEqual(stable(api.normalizeModeConfigStore(next)), stable(next))
})
test('renamed/moved user overrides of the automatic facility are not deleted as unchanged defaults', () => {
  for (const mutate of [(p) => { p.lat -= 1 }, (p) => { p.name = '自定义设施' }, (p) => { p.stageId = 'S2' }]) {
    const store = legacy(), target = map(store, 'winner-takes-all')
    const marker = target.props.find((p) => p.uid === excluded.uid)
    mutate(marker)
    const next = api.normalizeModeConfigStore(store)
    assert.deepEqual(map(next, 'winner-takes-all').props.find((p) => p.uid === marker.uid), marker)
  }
})
test('old installed config is corrected and persisted once; later editor changes and export roundtrips survive', () => {
  storage.set(api.MODE_CONFIG_STORAGE_KEY, JSON.stringify(legacy())); writes = 0
  const corrected = api.loadModeConfigStore()
  assert.equal(writes, 1)
  api.loadModeConfigStore(); assert.equal(writes, 1)
  for (const mode of modes) {
    const target = map(corrected, mode)
    const marker = target.props.find((p) => p.name === '火神炮')
    marker.name = '自定炮台'; marker.lat -= 2
    const normalized = api.normalizeModeConfigStore(corrected)
    assert.deepEqual(map(normalized, mode).props.find((p) => p.uid === marker.uid), marker)
    const official = api.buildOfficialModeData(profile(corrected, mode), 'pc', 'ascent')
    const imported = api.importModeConfigData(fresh(), official).store
    assert.deepEqual(api.buildOfficialModeData(profile(imported, mode), 'pc', 'ascent').maps, official.maps)
    assert.ok(!official.maps.ascent.props.some((p) => p.name === '密集阵'))
  }
  assert.ok(fs.existsSync(path.join(__dirname, '../public/icons/map-props/q_hsp.png')))
})
