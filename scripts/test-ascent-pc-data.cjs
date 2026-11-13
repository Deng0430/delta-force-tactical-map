const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { createConfigLoader } = require('./lib/load-config-module.cjs')
const load = createConfigLoader()
const snapshot = load('src/config/ascentPcData.json')
const { withAscentPcData } = load('src/config/ascentPcData.ts')
const { withAscentPcZiplines } = load('src/config/ascentPcZiplines.ts')
const { withPcAirSupplyStations } = load('src/config/airSupplyStations.ts')
const api = load('src/utils/modeConfigStorage.ts')
const prior = global.localStorage
const storage = new Map()
let writes = 0
global.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => { writes++; storage.set(key, value) } }
test.after(() => { if (prior === undefined) delete global.localStorage; else global.localStorage = prior })
const modes = ['attack-defense', 'winner-takes-all']
const profile = (store, mode) => store.profiles.find((p) => p.id === mode)
const map = (store, mode, platform = 'pc') => profile(store, mode).platformMaps[platform].ascent
const stable = (value) => JSON.parse(JSON.stringify(value, (key, value) => key === 'updatedAt' ? undefined : value))
function fresh() { storage.clear(); return api.loadModeConfigStore() }
function legacy() {
  let store = fresh()
  const official = load('src/config/winnerTakesAllOfficial.json')
  store = api.importModeConfigData(store, { ...official, gameDataPlatform: 'pc', maps: { ascent: official.maps.ascent } }).store
  const { STAGES_BY_MAP } = load('src/config/points.ts')
  const { MAP_PROPS } = load('src/config/pointsStages.ts')
  const { DEPLOY_BY_MAP } = load('src/config/deployVehicles.ts')
  const { normalizeAttackDefenseData } = load('src/config/attackDefenseSpawns.ts')
  const baseline = normalizeAttackDefenseData('pc', { ascent: STAGES_BY_MAP.ascent }, { ascent: DEPLOY_BY_MAP.ascent })
  const attack = profile(store, 'attack-defense')
  attack.platformMaps.pc.ascent = api.syncModeMapFromAttackDefense('ascent', baseline.stages.ascent, MAP_PROPS, baseline.deploy)
  for (const mode of modes) {
    const p = profile(store, mode)
    p.platformMaps.pc.ascent = withPcAirSupplyStations(withAscentPcZiplines(p.platformMaps.pc.ascent, mode))
    p.maps = p.platformMaps.pc
  }
  store.version = 57
  return store
}
function assertRegions(store, mode) {
  const runtime = api.buildRuntimeModeData(profile(store, mode), 'pc', 'ascent')
  assert.deepEqual(runtime.issues, [])
  assert.deepEqual(runtime.map.stages.map((s) => s.id), ['S1', 'S2', 'S3', 'S4', 'S5'])
  for (const source of snapshot.stages) {
    const stage = runtime.map.stages.find((s) => s.id === source.id)
    assert.deepEqual(stage.zone.latlngs, source.frontline)
    assert.deepEqual(stage.attackBaseZone, source.attackBaseZone)
    assert.deepEqual(stage.defenseBaseZone, source.defenseBaseZone)
    for (const point of stage.points) {
      const name = stage.id === 'S4' && point.name === '据点D' ? '据点D1' : point.name
      const expected = source.objectives.find((p) => p.name === name)
      assert.ok(expected)
      assert.deepEqual(point.capturable, expected.captureArea)
      assert.equal(point.lat, expected.lat)
      assert.equal(point.lng, expected.lng)
    }
  }
  assert.equal(new Set(map(store, mode).props.map((p) => p.uid)).size, map(store, mode).props.length)
}
test('snapshot retains current PC provenance, original geometry and explicit S4 event linkage', () => {
  assert.equal(snapshot.source.gameVersion, '1.101.37119.18.19')
  assert.equal(snapshot.source.attackDefenseMapId, 54)
  assert.equal(snapshot.source.winnerMapId, 601)
  assert.equal(snapshot.stages.reduce((sum, s) => sum + 3 + s.objectives.length, 0), 22)
  assert.equal(snapshot.stages[0].containedSeaSpawnZone.length, 4)
  assert.equal(snapshot.stages[2].objectives.find((p) => p.name === '据点C2').captureArea.length, 23)
  assert.equal(snapshot.stages[4].objectives[0].captureArea.length, 21)
  assert.match(snapshot.event.coorAnchor, /Objective_PointF_0$/)
  assert.match(snapshot.event.backupSector, /Sector_S5$/)
  assert.deepEqual(snapshot.event.unloadSubWorlds, ['Iceland_Tower', 'Iceland_TowerB'])
  if (fs.existsSync(path.join(__dirname, '..', snapshot.source.files[0].path))) {
    assert.deepEqual(require('./sync-ascent-pc-data.cjs').buildSnapshot(), snapshot)
  }
})
test('fresh PC defaults in both modes expose source boundaries, props and post-event geometry', () => {
  const store = fresh()
  assert.equal(store.version, 72)
  for (const mode of modes) {
    assertRegions(store, mode)
    const config = map(store, mode)
    assert.equal(withAscentPcData(config), config)
    assert.equal(config.props.filter((p) => p.zipline).length, 18)
    assert.equal(config.props.filter((p) => p.airSupply).length, 2)
    assert.equal(config.props.filter((p) => p.name === '密集阵').length, 0)
    assert.equal(config.props.filter((p) => p.name === '火神炮' && p.icon === 'q_hsp').length, 2)
    for (const source of snapshot.props) {
      const uid = source.legacyIndex === undefined ? source.uid : `${mode === 'attack-defense' ? 'sync' : 'builtin_wta'}_ascent_prop-${source.legacyIndex}`
      const prop = config.props.find((p) => p.uid === uid)
      assert.ok(prop, source.actor)
      assert.equal(prop.lat, source.lat)
      assert.equal(prop.lng, source.lng)
    }
    const tower = snapshot.props.find((p) => p.stages)
    const towerMarkers = api.buildRuntimeModeData(profile(store, mode), 'pc', 'ascent').map.props.filter((p) => p.lat === tower.lat && p.lng === tower.lng)
    assert.deepEqual(towerMarkers.map((p) => p.stage).sort(), ['S1', 'S2', 'S3', 'S4'])
    assert.ok(!towerMarkers.some((p) => p.stage === 'S5' || p.stage === ''))
  }
})
test('tactical HTML export callback uses the active mode geometry/props and the requested event stage', async () => {
  const ts = require('typescript')
  const vm = require('node:vm')
  const app = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8')
  const source = ts.createSourceFile('App.tsx', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let declaration
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'handleExportTactical') declaration = node
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(declaration)
  assert.match(declaration.initializer.arguments[1].getText(source), /activeOfficialModeMap/)
  const arrow = declaration.initializer.arguments[0].getText(source)
  const code = ts.transpileModule(`const invoke = ${arrow};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const active = api.buildRuntimeModeData(profile(fresh(), 'winner-takes-all'), 'pc', 'ascent').map
  const rawProps = [{ name: '旧道具', icon: 'q_afp', lat: -1, lng: 1, stage: '' }]
  let exported
  const bucket = { key: 'S5-R2', stageId: 'S5', round: 2, drawings: {}, vehicles: {}, buildings: {}, operators: {}, connections: {}, teams: {}, routes: {}, skillActions: [] }
  const cur = { tacticalBuckets: { buckets: { 'S5-R2': bucket } }, drawings: {}, skillActions: [] }
  const context = {
    activeOfficialModeMap: active, stages: active.stages.slice(0, 4), activeModeStageId: 'S1', capturedStageIndex: 0,
    mapsRef: { current: { context: cur } }, activeTacticalContextKeyRef: { current: 'context' },
    createEmptyMapState: () => cur, snapshotTacticalBucket: () => ({ ...bucket, key: 'S1-R1', stageId: 'S1', round: 1 }),
    tacticalBucketKey: (id, round) => `${id}-R${round}`, applyTacticalBucket: (state) => state,
    wargameOf: () => ({ round: 1 }), emptyGeoJson: () => '{}',
    vehiclesBucketOf: () => ({}), buildingsBucketOf: () => ({}), operatorsBucketOf: () => ({}),
    connectionsBucketOf: () => ({}), teamsBucketOf: () => ({}), routesBucketOf: () => ({}), fieldSupportsBucketOf: () => ({}),
    mapId: 'ascent', platformProps: { ascent: rawProps }, config: { name: '攀升' }, view: 'attack',
    ui: { layers: { props: true }, propVis: {} }, isBeginnerDemo: true,
    buildTacticalHtml: async (params) => { exported = params; return 'HTML' }, downloadText: () => assert.fail('Demo probe must not download'),
  }
  const invoke = vm.runInNewContext(`${code}\ninvoke`, context)
  await invoke('all', 'S5', 2)
  assert.equal(exported.stages, active.stages)
  assert.equal(exported.propsList, active.props)
  assert.equal(exported.capturedStageIndex, 4)
  assert.equal(exported.snapshots.find((s) => s.stageId === 'S5').capturedStageIndex, 4)
  assert.equal(exported.stages[4].points[0].capturable.length, 21)
})
test('v57 migrates only Ascent PC official data, preserving custom entities, styles, vehicle rules, mobile and other maps', () => {
  const store = legacy()
  const target = map(store, 'winner-takes-all')
  const capture = target.zones.find((z) => z.role === 'capture')
  capture.color = '#123456'
  target.zones.push({ ...structuredClone(capture), uid: 'custom-zone', points: [[-1, 1], [-2, 2], [-3, 1]] })
  target.props.push({ uid: 'custom-prop', stageId: '*', name: '自建道具', icon: 'q_afp', lat: -1, lng: 2, verification: 'draft' })
  const retired = target.props.find((p) => p.uid === 'builtin_wta_ascent_prop-1')
  retired.lat -= 2 // Edited obsolete marker is not deleted.
  const moved = target.props.find((p) => p.uid === 'builtin_wta_ascent_prop-3')
  moved.lat -= 1
  store.profiles.push({ ...structuredClone(profile(store, 'winner-takes-all')), id: 'my-mode' })
  const saved = structuredClone(store)
  // Existing generic normalization deduplicates some legacy props in other maps;
  // compare against the same normalization with this migration disabled.
  const baseline = api.normalizeModeConfigStore({ ...structuredClone(store), version: 58 })
  const next = api.normalizeModeConfigStore(store)
  assert.deepEqual(store, saved)
  assertRegions(next, 'attack-defense')
  for (const mode of modes) {
    const oldMap = map(saved, mode), newMap = map(next, mode)
    if (mode === 'winner-takes-all') {
      assert.deepEqual(stable(newMap.spawns.filter((s) => oldMap.spawns.some((old) => old.uid === s.uid))), stable(oldMap.spawns))
      assert.deepEqual(newMap.vehicleRefreshPoints, oldMap.vehicleRefreshPoints)
      assert.deepEqual(newMap.vehicleRefreshRules, oldMap.vehicleRefreshRules)
    } else {
      // v67 separately upgrades the ordinary PC attack/defense deployment and refresh baseline.
      assert.equal(newMap.vehicleRefreshRules.length, 5)
      assert.ok(newMap.spawns.flatMap((spawn) => spawn.deployVehicles).every((vehicle) => vehicle.clientSpawner?.mapId === 54))
      assert.ok(!newMap.spawns.some((spawn) => spawn.stageId === 'S5' && spawn.side === 'defense'))
    }
    assert.deepEqual(newMap.props.filter((p) => p.zipline), oldMap.props.filter((p) => p.zipline))
    assert.deepEqual(stable(profile(next, mode).platformMaps.mobile), stable(profile(baseline, mode).platformMaps.mobile))
    for (const id of Object.keys(profile(saved, mode).platformMaps.pc).filter((id) => id !== 'ascent')) {
      assert.deepEqual(stable(profile(next, mode).platformMaps.pc[id]), stable(profile(baseline, mode).platformMaps.pc[id]))
    }
  }
  const updated = map(next, 'winner-takes-all')
  assert.equal(updated.zones.find((z) => z.uid === capture.uid).color, '#123456')
  assert.deepEqual(updated.zones.find((z) => z.uid === 'custom-zone'), target.zones.find((z) => z.uid === 'custom-zone'))
  for (const uid of ['custom-prop', retired.uid, moved.uid]) assert.deepEqual(updated.props.find((p) => p.uid === uid), target.props.find((p) => p.uid === uid))
  assert.deepEqual(stable(profile(next, 'my-mode')), stable(profile(baseline, 'my-mode')))
  assert.deepEqual(stable(api.normalizeModeConfigStore(next)), stable(next))
})
test('source update is one-time; editor changes and official/backup roundtrips survive', () => {
  const store = api.normalizeModeConfigStore(legacy())
  for (const mode of modes) {
    const p = profile(store, mode)
    const config = map(store, mode)
    config.zones.find((z) => z.role === 'attack-base').points[0] = [-1, 2]
    config.props = config.props.filter((prop) => prop.uid !== snapshot.props.find((p) => p.legacyIndex === undefined).uid)
    const preserved = structuredClone(config)
    assert.deepEqual(stable(map(api.normalizeModeConfigStore(store), mode)), stable(preserved))
    const official = api.buildOfficialModeData(p, 'pc', 'ascent')
    const roundtrip = api.importModeConfigData(fresh(), official).store
    assert.deepEqual(api.buildOfficialModeData(profile(roundtrip, mode), 'pc', 'ascent').maps, official.maps)
  }
  storage.set(api.MODE_CONFIG_STORAGE_KEY, JSON.stringify(legacy()))
  writes = 0
  const loaded = api.loadModeConfigStore()
  assert.equal(loaded.version, 72)
  assert.equal(writes, 1)
  api.loadModeConfigStore()
  assert.equal(writes, 1)
})
