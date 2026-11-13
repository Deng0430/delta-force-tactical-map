const assert = require('node:assert/strict')
const test = require('node:test')
const { createConfigLoader } = require('./lib/load-config-module.cjs')
const load = createConfigLoader()
const { buildMapPropZiplineDisplay, normalizeZiplineEndpoint } = load('src/utils/mapZiplines.ts')
const snapshot = load('src/config/skyportPcHotfixData.json')
const ascent = load('src/config/ascentPcZiplines.json')
globalThis.localStorage = { getItem: () => null, setItem: () => {} }
const { loadModeConfigStore, normalizeModeConfigStore, buildOfficialModeData, buildRuntimeModeData, importModeConfigData } = load('src/utils/modeConfigStorage.ts')
const clone = (value) => JSON.parse(JSON.stringify(value))
const profile = (store, mode) => store.profiles.find((p) => p.id === mode)

test('Vertical ropes collapse to one badged position; only paired span endpoints make connections', () => {
  const props = snapshot.attackDefense.props.filter((p) => p.name === '滑索')
  const result = buildMapPropZiplineDisplay(props)
  assert.equal(result.markers.length, 19)
  assert.equal(result.endpoints.length, 4)
  assert.equal(result.midpoints.length, 2)
  assert.equal(result.markers.filter((p) => p.zipline.orientation === 'vertical').length, 19)
  assert.equal(result.connections.length, 2)
  for (const line of result.connections) {
    assert.equal(line.latlngs.length, 2)
    const endpoints = props.filter((p) => p.zipline.orientation === 'span'
      && JSON.stringify([p.stage, p.zipline.lineId]) === line.id)
    assert.deepEqual(line.latlngs, endpoints.map((p) => [p.lat, p.lng]))
  }
  assert.equal(buildMapPropZiplineDisplay(props, false).markers.length, 36)
  const span = props.find((p) => p.zipline.orientation === 'span')
  const missing = props.filter((p) => p !== span)
  assert.equal(buildMapPropZiplineDisplay(missing).connections.length, 1)
  const changed = clone(props)
  const moved = changed.find((p) => p.zipline.lineId === span.zipline.lineId && p.zipline.endpoint === 'red')
  moved.lat = -99
  assert.ok(buildMapPropZiplineDisplay(changed).connections.some((line) => line.latlngs.some(([lat]) => lat === -99)))
})

test('Legacy unpaired markers stay unchanged; malformed metadata and cross-stage pairs are not connected', () => {
  assert.equal(normalizeZiplineEndpoint({ lineId: 'bad', orientation: 'vertical', endpoint: 'red', elevationMeters: Infinity }), undefined)
  const prop = { name: '滑索', icon: 'q_hs', lat: -100, lng: 50, stage: '' }
  assert.deepEqual(buildMapPropZiplineDisplay([prop]), { markers: [prop], connections: [], endpoints: [], midpoints: [] })
  const span = snapshot.sharedZiplineProps.find((p) => p.zipline.orientation === 'span')
  const pair = clone(snapshot.sharedZiplineProps.filter((p) => p.zipline.lineId === span.zipline.lineId))
  pair[1].stage = 'S4'
  assert.equal(buildMapPropZiplineDisplay(pair).connections.length, 0)
})

test('Span midpoint is derived without mutating endpoint data; standalone HTML helper matches runtime', () => {
  const a = { uid: 'a', name: '滑索', icon: 'q_hs', lat: -40, lng: 10, stageId: 'S1', zipline: { lineId: 'pair', orientation: 'span', endpoint: 'green', elevationMeters: 10 } }
  const b = { ...clone(a), uid: 'b', lat: -20, lng: 50, zipline: { ...a.zipline, endpoint: 'red', elevationMeters: 30 } }
  const input = [a, b]
  const before = clone(input)
  const result = buildMapPropZiplineDisplay(input)
  assert.equal(result.markers.length, 0)
  assert.deepEqual(result.endpoints, input)
  assert.equal(result.endpoints[0], a)
  assert.deepEqual([result.midpoints[0].prop.lat, result.midpoints[0].prop.lng], [-30, 30])
  assert.deepEqual(input, before)
  const embedded = new Function(`return (${buildMapPropZiplineDisplay.toString()})`)()
  assert.deepEqual(embedded(input), result)
  b.lat = -10
  assert.equal(buildMapPropZiplineDisplay(input).midpoints[0].prop.lat, -25)
  b.lat = a.lat; b.lng = a.lng
  assert.equal(buildMapPropZiplineDisplay(input).markers.length, 2)
  assert.equal(buildMapPropZiplineDisplay(input).midpoints.length, 0)
  assert.equal(buildMapPropZiplineDisplay([a]).markers[0], a)
  assert.equal(buildMapPropZiplineDisplay([a]).endpoints.length, 0)
})

test('v53 zipline migration retains edited positions, missing nodes, mobile, other maps and custom profiles', () => {
  const old = clone(loadModeConfigStore())
  old.version = 53
  for (const mode of ['attack-defense', 'winner-takes-all']) {
    const map = profile(old, mode).platformMaps.pc.skyport
    map.props.forEach((p) => { delete p.zipline })
    map.props.find((p) => p.name === '滑索').lat = -222
    const remove = map.props.find((p) => p.name === '滑索' && p.stageId === 'S4')
    map.props = map.props.filter((p) => p.uid !== remove.uid)
    map.props.push({ ...clone(map.props[0]), uid: 'user_prop', name: '自定义标注' })
  }
  old.profiles.push({ ...clone(profile(old, 'attack-defense')), id: 'custom-mode' })
  const saved = clone(old)
  const before = normalizeModeConfigStore({ ...clone(old), version: loadModeConfigStore().version })
  const migrated = normalizeModeConfigStore(old)
  for (const mode of ['attack-defense', 'winner-takes-all']) {
    const map = profile(migrated, mode).platformMaps.pc.skyport
    const prior = profile(before, mode).platformMaps.pc.skyport
    // 后续迁移也会补元数据；两侧都只比较原有位置/身份，仍要求本次不移动或恢复节点。
    assert.deepEqual(clone(map.props.map(({ zipline, ...p }) => p)), clone(prior.props.map(({ zipline, ...p }) => p)))
    assert.ok(map.props.find((p) => p.name === '滑索').zipline)
    assert.equal(map.props.find((p) => p.uid === 'user_prop').zipline, undefined)
    assert.deepEqual(clone(profile(migrated, mode).platformMaps.mobile), clone(profile(before, mode).platformMaps.mobile))
    assert.deepEqual(clone(profile(migrated, mode).platformMaps.pc.ascent), clone(profile(before, mode).platformMaps.pc.ascent))
  }
  assert.deepEqual(clone(profile(migrated, 'custom-mode')), clone(profile(before, 'custom-mode')))
  assert.deepEqual(clone(normalizeModeConfigStore(migrated)), clone(migrated))
  assert.deepEqual(clone(old), saved)
})

test('Ascent recovers four long-rope pairs and five native vertical ropes in both PC modes', () => {
  const store = loadModeConfigStore()
  assert.equal(ascent.props.length, 18)
  assert.match(ascent.source.verticalFlag, /bIsVerticalZipline=true/)
  assert.ok(Object.values(ascent.legacyByMode).flat().every((p) => p.markerDifferenceMeters < 2))
  for (const mode of ['attack-defense', 'winner-takes-all']) {
    const runtime = buildRuntimeModeData(profile(store, mode), 'pc', 'ascent')
    const ropes = runtime.map.props.filter((p) => p.name === '滑索')
    assert.equal(ropes.length, 18)
    const display = buildMapPropZiplineDisplay(ropes)
    assert.equal(display.markers.length, 5)
    assert.equal(display.endpoints.length, 8)
    assert.equal(display.midpoints.length, 4)
    assert.equal(display.connections.length, 4)
    assert.equal(display.markers.filter((p) => p.zipline.orientation === 'vertical').length, 5)
    const mobile = buildRuntimeModeData(profile(store, mode), 'mobile', 'ascent').map.props.filter((p) => p.name === '滑索')
    assert.equal(new Set(mobile.map((p) => `${p.lat}:${p.lng}`)).size, 4)
    assert.ok(mobile.every((p) => !p.zipline))
  }
})

test('v55 Ascent migration retains original lower identities, deleted/moved nodes and user markers', () => {
  const old = clone(loadModeConfigStore())
  old.version = 55
  for (const mode of ['attack-defense', 'winner-takes-all']) {
    const map = profile(old, mode).platformMaps.pc.ascent
    map.props = [...map.props.filter((p) => p.name !== '滑索'), ...ascent.legacyByMode[mode].map((p) => ({
      uid: p.uid, lat: p.lat, lng: p.lng, name: '滑索', icon: 'q_hs', stageId: '*', verification: 'confirmed',
    }))]
    map.props.find((p) => p.uid === ascent.legacyByMode[mode][0].uid).lat = -210
    map.props = map.props.filter((p) => p.uid !== ascent.legacyByMode[mode][1].uid)
    map.props.push({ uid: 'custom_zipline', stageId: '*', name: '滑索', icon: 'q_hs', lat: -100, lng: 100, verification: 'draft' })
  }
  const before = clone(old)
  const migrated = normalizeModeConfigStore(old)
  for (const mode of ['attack-defense', 'winner-takes-all']) {
    const map = profile(migrated, mode).platformMaps.pc.ascent
    assert.equal(map.props.find((p) => p.uid === ascent.legacyByMode[mode][0].uid).lat, -210)
    assert.ok(!map.props.some((p) => p.uid === ascent.legacyByMode[mode][1].uid))
    assert.equal(map.props.find((p) => p.uid === 'custom_zipline').zipline, undefined)
    assert.equal(buildMapPropZiplineDisplay(map.props).connections.length, 3)
    assert.deepEqual(clone(map.props.filter((p) => p.name !== '滑索')), profile(before, mode).platformMaps.pc.ascent.props.filter((p) => p.name !== '滑索'))
    assert.deepEqual(clone(profile(migrated, mode).platformMaps.mobile.ascent), profile(before, mode).platformMaps.mobile.ascent)
  }
  assert.deepEqual(clone(normalizeModeConfigStore(migrated)), clone(migrated))
  assert.deepEqual(clone(old), before)
})

test('v55 corrects only untouched Skyport inherited endpoint transforms', () => {
  const old = clone(loadModeConfigStore())
  old.version = 55
  const target = snapshot.sharedZiplineProps.find((p) => p.zipline.orientation === 'span' && p.zipline.endpoint === 'red')
  const companion = snapshot.sharedZiplineProps.find((p) => p.zipline.lineId === target.zipline.lineId && p.zipline.endpoint === 'green')
  const prior = snapshot.priorZiplinePositions.find((p) => p.uid === target.uid)
  for (const mode of ['attack-defense', 'winner-takes-all']) {
    const props = profile(old, mode).platformMaps.pc.skyport.props
    Object.assign(props.find((p) => p.uid === target.uid), { lat: prior.latlng[0], lng: prior.latlng[1] })
    props.find((p) => p.uid === companion.uid).lat = -201
  }
  const migrated = normalizeModeConfigStore(old)
  for (const mode of ['attack-defense', 'winner-takes-all']) {
    const props = profile(migrated, mode).platformMaps.pc.skyport.props
    assert.deepEqual([props.find((p) => p.uid === target.uid).lat, props.find((p) => p.uid === target.uid).lng], [target.lat, target.lng])
    assert.equal(props.find((p) => p.uid === companion.uid).lat, -201)
  }
})

test('Pairing and orientation survive runtime, backup normalization and official export/import', () => {
  const store = loadModeConfigStore()
  for (const mode of ['attack-defense', 'winner-takes-all']) {
    const p = profile(store, mode)
    const exported = buildOfficialModeData(p, 'pc', 'skyport')
    assert.equal(buildMapPropZiplineDisplay(exported.maps.skyport.props.filter((p) => p.name === '滑索')).connections.length, 2)
    const imported = importModeConfigData(store, clone(exported), 'pc')
    const runtime = buildRuntimeModeData(profile(imported.store, mode), 'pc', 'skyport')
    assert.deepEqual(runtime.issues, [])
    assert.deepEqual(runtime.map.props, exported.maps.skyport.props)
  }
})
