const assert = require('node:assert/strict')
const test = require('node:test')
const { createConfigLoader } = require('./lib/load-config-module.cjs')
const load = createConfigLoader()
const { normalizeAirSupplyInfo, airSupplyHeightLabel, AIR_SUPPLY_BADGE_HTML } = load('src/utils/airSupply.ts')
const { withPcAirSupplyStations, PC_AIR_SUPPLY_STATIONS } = load('src/config/airSupplyStations.ts')
const { propsForPlatform } = load('src/config/gameDataPlatform.ts')
const { loadModeConfigStore, normalizeModeConfigStore, buildRuntimeModeData, buildOfficialModeData, importModeConfigData, MODE_CONFIG_STORAGE_KEY } = load('src/utils/modeConfigStorage.ts')
const previousStorage = globalThis.localStorage
globalThis.localStorage = { getItem: () => null }
test.after(() => { if (previousStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = previousStorage })
const profile = (store, mode = 'winner-takes-all') => store.profiles.find((p) => p.id === mode)
const map = (store, mode, id, platform = 'pc') => profile(store, mode).platformMaps[platform][id]
const air = (map) => map.props.filter((p) => p.name === '空中载具补给站')
const stable = (value) => JSON.parse(JSON.stringify(value, (key, val) => key === 'updatedAt' ? undefined : val))
function oldStore() {
  const store = structuredClone(loadModeConfigStore())
  store.version = 54
  for (const mode of ['attack-defense', 'winner-takes-all']) for (const id of ['ascent', 'stormeye']) {
    const target = map(store, mode, id)
    target.props = target.props.filter((p) => !p.uid.startsWith('pc_air_supply_') && !(id === 'stormeye' && p.name === '空中载具补给站')).map((p) => {
      if (p.name !== '空中载具补给站') return p
      const { airSupply, ...other } = p
      return { ...other, name: '载具补给站' }
    })
  }
  return store
}

test('both PC modes have two badged air stations per map, independent of mobile/ground stations', () => {
  const store = loadModeConfigStore()
  assert.equal(store.version, 72)
  for (const mode of ['attack-defense', 'winner-takes-all']) for (const id of ['ascent', 'stormeye', 'skyport']) {
    const target = map(store, mode, id)
    assert.equal(air(target).length, 2)
    assert.deepEqual(air(target).map((p) => p.airSupply.elevationMeters), PC_AIR_SUPPLY_STATIONS[id].map((s) => s.worldZcm / 100))
    assert.equal(air(target).every((p) => p.airSupply.reference === 'pc-world-z'), true)
    assert.equal(target.props.filter((p) => p.name === '载具补给站').length, { ascent: 7, stormeye: 4, skyport: 7 }[id])
    assert.equal(air(map(store, mode, id, 'mobile')).length, 0)
    assert.equal(buildRuntimeModeData(profile(store, mode), 'pc', id).issues.length, 0)
  }
  for (const id of ['ascent', 'stormeye', 'skyport']) {
    assert.equal(propsForPlatform('pc')[id].filter((p) => p.airSupply).length, 2)
    assert.equal(propsForPlatform('mobile')[id].some((p) => p.airSupply), false)
  }
})

test('v54 migration preserves position edits, missing ascent nodes, ground stations and custom/mobile data', () => {
  const store = oldStore()
  const target = map(store, 'winner-takes-all', 'ascent')
  const point = target.props.find((p) => p.uid === 'builtin_wta_ascent_prop-33')
  point.lat -= 1
  target.props = target.props.filter((p) => p.uid !== 'builtin_wta_ascent_prop-37')
  store.profiles.push({ ...structuredClone(profile(store)), id: 'my-mode' })
  const saved = structuredClone(store)
  const baseline = normalizeModeConfigStore({ ...structuredClone(store), version: 55 })
  const updated = normalizeModeConfigStore(store)
  assert.deepEqual(store, saved)
  const nextPoint = map(updated, 'winner-takes-all', 'ascent').props.find((p) => p.uid === point.uid)
  assert.equal(nextPoint.lat, point.lat)
  assert.equal(nextPoint.name, '空中载具补给站')
  assert.equal(air(map(updated, 'winner-takes-all', 'ascent')).length, 1)
  for (const mode of ['attack-defense', 'winner-takes-all']) {
    assert.deepEqual(stable(profile(updated, mode).platformMaps.mobile), stable(profile(baseline, mode).platformMaps.mobile))
    for (const id of Object.keys(profile(updated, mode).platformMaps.pc).filter((id) => !['ascent', 'stormeye'].includes(id))) {
      assert.deepEqual(stable(map(updated, mode, id)), stable(map(baseline, mode, id)))
    }
    const ground = (m) => m.props.filter((p) => p.name === '载具补给站')
    assert.deepEqual(ground(map(updated, mode, 'stormeye')), ground(map(baseline, mode, 'stormeye')))
  }
  assert.deepEqual(stable(profile(updated, 'my-mode')), stable(profile(baseline, 'my-mode')))
  assert.deepEqual(normalizeModeConfigStore(updated), updated)
  assert.equal(withPcAirSupplyStations(map(updated, 'winner-takes-all', 'stormeye')), map(updated, 'winner-takes-all', 'stormeye'))
})

test('official and backup roundtrips preserve negative heights and source reference; malformed values are rejected', () => {
  for (const value of [null, {}, { elevationMeters: Infinity, reference: 'pc-world-z' }, { elevationMeters: '100', reference: 'pc-world-z' }, { elevationMeters: 100, reference: 'sea-level' }]) assert.equal(normalizeAirSupplyInfo(value), undefined)
  const info = { elevationMeters: -163.270986328125, reference: 'pc-world-z' }
  assert.deepEqual(normalizeAirSupplyInfo(info), info)
  assert.equal(airSupplyHeightLabel(info), '高度：-163.3 米（PC 世界坐标）')
  assert.equal(airSupplyHeightLabel(), '高度：未设置')
  assert.match(AIR_SUPPLY_BADGE_HTML, /<svg/)
  assert.doesNotMatch(AIR_SUPPLY_BADGE_HTML, /https?:|script/i)
  const store = loadModeConfigStore()
  for (const id of ['ascent', 'stormeye', 'skyport']) {
    const exported = buildOfficialModeData(profile(store), 'pc', id)
    const imported = importModeConfigData(store, structuredClone(exported), 'mobile')
    assert.equal(imported.gameDataPlatform, 'pc')
    const next = normalizeModeConfigStore(JSON.parse(JSON.stringify(imported.store)))
    assert.deepEqual(buildOfficialModeData(profile(next), 'pc', id).maps[id], exported.maps[id])
  }
})

test('current-version edits/deletion stay intact, migration is persisted only once', () => {
  const data = new Map([[MODE_CONFIG_STORAGE_KEY, JSON.stringify(oldStore())]])
  let writes = 0
  globalThis.localStorage = { getItem: (key) => data.get(key), setItem: (key, value) => { writes++; data.set(key, value) } }
  try {
    const store = loadModeConfigStore()
    assert.equal(writes, 1)
    assert.equal(air(map(store, 'winner-takes-all', 'stormeye')).length, 2)
    loadModeConfigStore()
    assert.equal(writes, 1)
    const target = map(store, 'winner-takes-all', 'stormeye')
    target.props = target.props.filter((p) => p.name !== '空中载具补给站')
    assert.equal(air(map(normalizeModeConfigStore(store), 'winner-takes-all', 'stormeye')).length, 0)
  } finally { globalThis.localStorage = { getItem: () => null } }
})

test('v56 adds only skyport PC air stations, preserving ground, zipline, custom and mobile edits', () => {
  const store = normalizeModeConfigStore(structuredClone(loadModeConfigStore()))
  store.version = 56
  for (const mode of ['attack-defense', 'winner-takes-all']) {
    const target = map(store, mode, 'skyport')
    target.props = target.props.filter((p) => p.name !== '空中载具补给站')
    target.props.find((p) => p.name === '载具补给站').lat -= 1
    target.props.find((p) => p.zipline).lng += 1
    target.props.push({ uid: 'custom-prop', stageId: '*', name: '我的标记', icon: 'q_zjbjz', lat: -50, lng: 50, verification: 'draft' })
  }
  store.profiles.push({ ...structuredClone(profile(store)), id: 'my-mode' })
  const before = structuredClone(store)
  const updated = normalizeModeConfigStore(store)
  assert.equal(updated.version, 72)
  assert.deepEqual(store, before)
  for (const mode of ['attack-defense', 'winner-takes-all']) {
    const target = map(updated, mode, 'skyport')
    assert.deepEqual(air(target).map((p) => [p.lat, p.lng, p.airSupply.elevationMeters, p.stageId]), [
      [-71.7376, 77.9776, 138.3, '*'], [-112.672, 181.8688, 72.7, '*'],
    ])
    assert.deepEqual(target.props.filter((p) => p.name !== '空中载具补给站'), map(before, mode, 'skyport').props)
    assert.deepEqual(stable(profile(updated, mode).platformMaps.mobile), stable(profile(before, mode).platformMaps.mobile))
    for (const id of Object.keys(profile(updated, mode).platformMaps.pc).filter((id) => id !== 'skyport')) {
      assert.deepEqual(stable(map(updated, mode, id)), stable(map(before, mode, id)))
    }
  }
  assert.deepEqual(stable(profile(updated, 'my-mode')), stable(profile(before, 'my-mode')))
  assert.deepEqual(normalizeModeConfigStore(updated), updated)
  const target = map(updated, 'winner-takes-all', 'skyport')
  const points = air(target)
  target.props = target.props.filter((p) => p.uid !== points[0].uid)
  points[1].lat += 2
  points[1].airSupply.elevationMeters = 90
  const reloaded = normalizeModeConfigStore(updated)
  assert.deepEqual(air(map(reloaded, 'winner-takes-all', 'skyport')), [points[1]])
})
