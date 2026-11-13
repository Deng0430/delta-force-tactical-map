const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const test = require('node:test')
const { createConfigLoader } = require('./lib/load-config-module.cjs')
const load = createConfigLoader()
const source = load('src/config/flashpointPcWinnerData.json')
const api = load('src/utils/modeConfigStorage.ts')
const { withFlashpointPcWinnerData, withFlashpointPcWinnerDeploymentLimits } = load('src/config/flashpointPcWinnerData.ts')
const { normalizeVehicleSpawnerInfo, vehicleSpawnerDetails } = load('src/utils/vehicleSpawnerInfo.ts')
const { buildMapPropZiplineDisplay } = load('src/utils/mapZiplines.ts')
const { MAP_BY_ID } = load('src/config/maps.ts')
const prior = global.localStorage
const storage = new Map()
let writes = 0
global.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => { writes++; storage.set(k, v) } }
test.after(() => { if (prior === undefined) delete global.localStorage; else global.localStorage = prior })
const profile = (s) => s.profiles.find((p) => p.id === 'winner-takes-all')
const map = (s) => profile(s).platformMaps.pc.flashpoint
const stable = (value) => JSON.parse(JSON.stringify(value, (k, v) => k === 'updatedAt' ? undefined : v))
function fresh() { storage.clear(); return api.loadModeConfigStore() }
function oldStore() {
  const official = load('src/config/winnerTakesAllOfficial.json')
  const store = api.importModeConfigData(fresh(), { ...official, gameDataPlatform: 'pc', maps: { flashpoint: official.maps.flashpoint } }).store
  store.version = 62
  return store
}
function assertSource(store) {
  const runtime = api.buildRuntimeModeData(profile(store), 'pc', 'flashpoint')
  assert.deepEqual(runtime.issues, [])
  assert.equal(runtime.map.stages.length, 3)
  for (const s of source.stages) {
    const stage = runtime.map.stages.find((p) => p.id === s.id)
    assert.deepEqual(stage.zone.latlngs, s.frontline)
    assert.deepEqual(stage.attackBaseZone, s.attackBaseZone)
    assert.deepEqual(stage.defenseBaseZone, s.defenseBaseZone)
    for (const point of s.objectives) {
      const actual = stage.points.find((p) => p.name === point.name)
      assert.deepEqual(actual.capturable, point.captureArea)
      assert.equal(actual.lat, point.lat); assert.equal(actual.lng, point.lng)
    }
  }
}
test('PC Q80 basemap already routes to the local resource tiles; all 403 files and both native mip hashes verify', () => {
  assert.equal(MAP_BY_ID.flashpoint.tileUrl, '/maps/flashpoint-pc-q80-v1/{z}_{x}_{y}.webp')
  assert.equal(MAP_BY_ID.flashpoint.maxNativeZoom, 4)
  const root = path.resolve(__dirname, '..')
  const manifest = load(source.source.basemapManifest)
  assert.equal(manifest.compression.quality, 80)
  assert.equal(manifest.compression.resampled, false)
  assert.equal(manifest.tiles.length, 403)
  assert.deepEqual(manifest.sources.map((s) => s.size), [4096, 2048])
  const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
  for (const tile of manifest.tiles) {
    const bytes = fs.readFileSync(path.join(root, 'public/maps/flashpoint-pc-q80-v1', tile.file))
    assert.equal(bytes.length, tile.bytes)
    assert.equal(sha(bytes), tile.sha256)
  }
  for (const item of manifest.sources) {
    const raw = path.join(root, `source/PC提取资源/临界点/底图/临界点_PC原始底图_${item.size}.png`)
    if (fs.existsSync(raw)) assert.equal(sha(fs.readFileSync(raw)), item.sourceSha256)
  }
})
test('snapshot matches current PC source with 14 physical regions, 13 bound deployment entries, and no fabricated refresh conditions', () => {
  assert.equal(source.source.mapId, 603)
  assert.equal(source.stages.reduce((n, s) => n + 3 + s.objectives.length, 0), 14)
  assert.equal(source.stages.flatMap((s) => s.spawns).length, 11)
  assert.equal(source.deployments.length, 13)
  assert.equal(source.deployments.flatMap((d) => d.vehicle.deployPositions).length, 18)
  assert.equal(source.unresolved.length, 2)
  assert.deepEqual(source.unresolved.map((d) => d.spawnerId), ['ORV_S2_Attack', 'ORV_S3_Attack'])
  assert.equal(source.campRules.length, 4)
  assert.ok(source.campRules.every((r) => r.triggerMap.length === 0))
  if (fs.existsSync(path.resolve(__dirname, '..', source.source.files[0].path))) {
    assert.deepEqual(require('./sync-flashpoint-pc-winner.cjs').buildSnapshot(), source)
  }
})
test('fresh runtime uses PC activity/capture geometry, source spawn IDs, precise vehicle positions and native weapon types', () => {
  const store = fresh(), target = map(store)
  assert.equal(store.version, 72)
  assertSource(store)
  for (const stage of source.stages) for (const spawn of stage.spawns) {
    const actual = target.spawns.find((p) => p.uid === spawn.uid)
    assert.equal(actual.lat, spawn.lat); assert.equal(actual.lng, spawn.lng)
    assert.equal(actual.name, spawn.name)
  }
  for (const d of source.deployments) {
    const entry = target.spawns.find((p) => p.uid === d.spawnUid).deployVehicles.find((v) => v.icon === d.vehicle.icon)
    assert.deepEqual(entry.deployPositions, d.vehicle.deployPositions)
    assert.equal(entry.cd, d.legacyVehicle.cd)
    assert.equal(entry.num, d.legacyVehicle.num)
    assert.notEqual(entry.cooldownKnown, false)
    assert.equal(entry.clientSpawner.cooldownStatus, 'pc-template-verified')
    // Only bound vehicles with an enabled Standard quota get updated; disabled defaults are unchanged.
    assert.equal(entry.deployCount ?? 1, d.vehicle.deployCount)
    assert.deepEqual(normalizeVehicleSpawnerInfo(entry.clientSpawner), entry.clientSpawner)
  }
  assert.equal(target.props.filter((p) => p.name === '火神炮').length, 2)
  assert.equal(target.props.filter((p) => p.name === '固定机枪').length, 16)
  assert.equal(target.props.filter((p) => p.name === '固定弹药箱').length, 6)
  assert.equal(target.props.filter((p) => p.name === '密集阵').length, 0)
  assert.equal(target.props.filter((p) => p.zipline).length, 22)
  const display = buildMapPropZiplineDisplay(target.props)
  assert.equal(display.connections.length, 2)
  assert.equal(new Set(target.props.map((p) => p.uid)).size, target.props.length)
  assert.equal(target.vehicleRefreshRules.length, 0)
  assert.equal(target.vehicleRefreshPoints.length, 0)
  assert.equal(withFlashpointPcWinnerData(target), target)
})
test('v62 migration touches only PC winner Flashpoint; keeps custom entities, positions, deleted entries, CD/count edits and existing refresh rules', () => {
  const old = oldStore(), target = map(old)
  target.spawns[0].lat -= 1
  target.spawns[0].name = '自定义基地名'
  const modified = target.spawns.flatMap((p) => p.deployVehicles).find((v) => v.icon === 'lstjp')
  modified.cd = 37; modified.num = 7; modified.deployCount = 4; modified.deployPositions = [[-1, 2]]
  const deleted = target.spawns.find((p) => p.stageId === 'S3' && p.side === 'defense')
  deleted.deployVehicles = deleted.deployVehicles.filter((v) => v.icon !== 'lstjp')
  target.zones[0].color = '#123456'
  target.zones.push({ ...structuredClone(target.zones[0]), uid: 'custom-zone', points: [[-1, 2], [-2, 3], [-3, 1]] })
  target.props.push({ uid: 'custom-prop', stageId: '*', name: '自定义设施', icon: 'q_mjz', lat: -1, lng: 2, verification: 'draft' })
  const point = target.props.find((p) => p.uid === 'builtin_wta_flashpoint_prop-2')
  point.lat -= 1; point.name = '手动修改的弹药箱'
  target.props = target.props.filter((p) => p.uid !== 'builtin_wta_flashpoint_prop-10')
  // 非空规则覆盖：共享刷新点、多阶段、兵力/时间条件及备注都不能被同步覆盖。
  const refreshTemplate = load('src/config/winnerTakesAllOfficial.json').maps.ember.vehicleRefreshRules[0]
  target.vehicleRefreshPoints = [{ uid: 'custom-refresh-point', name: '已有刷新位置', lat: -101, lng: 99, verification: 'confirmed' }]
  target.vehicleRefreshRules = ['A', 'B1', 'C1'].map((objective, index) => ({
    ...structuredClone(refreshTemplate), uid: `custom-rule-${index}`, objective,
    trigger: index === 1 ? { type: 'match-time', value: 180 } : { type: 'tickets', value: 100 + index },
    refreshPointUid: 'custom-refresh-point', note: `保留原条件与备注 ${index}`,
    verification: 'confirmed',
  }))
  old.profiles.push({ ...structuredClone(profile(old)), id: 'my-mode' })
  const saved = structuredClone(old)
  const baseline = api.normalizeModeConfigStore({ ...structuredClone(old), version: 64 })
  const next = api.normalizeModeConfigStore(old), result = map(next)
  assert.deepEqual(old, saved)
  assert.deepEqual(stable(result.spawns[0]), stable(withFlashpointPcWinnerData(target).spawns[0]))
  const preserved = result.spawns.flatMap((p) => p.deployVehicles).find((v) => v.icon === 'lstjp')
  assert.deepEqual([preserved.cd, preserved.num, preserved.deployCount, preserved.deployPositions], [37, 7, 4, [[-1, 2]]])
  assert.equal(result.spawns.find((s) => s.uid === deleted.uid).deployVehicles.some((v) => v.icon === 'lstjp'), false)
  assert.equal(result.zones[0].color, '#123456')
  for (const key of ['custom-zone', 'custom-prop']) {
    const array = key === 'custom-zone' ? 'zones' : 'props'
    assert.deepEqual(result[array].find((p) => p.uid === key), target[array].find((p) => p.uid === key))
  }
  assert.deepEqual(result.props.find((p) => p.uid === point.uid), point)
  assert.equal(result.props.some((p) => p.uid === 'builtin_wta_flashpoint_prop-10'), false)
  assert.deepEqual(result.vehicleRefreshRules, map(baseline).vehicleRefreshRules)
  assert.deepEqual(result.vehicleRefreshPoints, map(baseline).vehicleRefreshPoints)
  const runtime = api.buildRuntimeModeData(profile(next), 'pc', 'flashpoint')
  assert.equal(runtime.map.vehicleRefreshRules.length, 3)
  assert.equal(runtime.map.vehicleRefreshPoints.length, 1)
  assert.equal(runtime.issues.length, 0)
  const exported = api.buildOfficialModeData(profile(next), 'pc', 'flashpoint')
  assert.equal(exported.maps.flashpoint.vehicleRefreshRules.length, 3)
  const roundTrip = api.importModeConfigData(fresh(), exported).store
  assert.deepEqual(api.buildOfficialModeData(profile(roundTrip), 'pc', 'flashpoint').maps.flashpoint.vehicleRefreshRules,
    exported.maps.flashpoint.vehicleRefreshRules)
  assert.deepEqual(api.buildOfficialModeData(profile(roundTrip), 'pc', 'flashpoint').maps.flashpoint.vehicleRefreshPoints,
    exported.maps.flashpoint.vehicleRefreshPoints)
  for (const p of next.profiles) {
    const prior = baseline.profiles.find((old) => old.id === p.id)
    if (p.id !== 'winner-takes-all') assert.deepEqual(stable(p), stable(prior))
    else {
      assert.deepEqual(stable(p.platformMaps.mobile), stable(prior.platformMaps.mobile))
      for (const [id, config] of Object.entries(p.platformMaps.pc)) if (id !== 'flashpoint') assert.deepEqual(stable(config), stable(prior.platformMaps.pc[id]))
    }
  }
})

test('v63 repair restores legacy CD numbers only for automatically marked entries, preserving custom CD, refresh data and later edits', () => {
  const old = fresh(), target = map(old)
  old.version = 63
  for (const d of source.deployments) {
    const entry = target.spawns.find((s) => s.uid === d.spawnUid).deployVehicles.find((v) => v.icon === d.vehicle.icon)
    entry.cd = d.vehicle.clientSpawner.templateVehicleCd
    entry.cooldownKnown = false
  }
  const edited = target.spawns[0].deployVehicles[0]
  edited.cd = 37
  const explicit = target.spawns[0].deployVehicles[1]
  explicit.cd = 42; delete explicit.cooldownKnown
  target.zones[0].points[0] = [-1, 2]
  target.props = target.props.filter((p) => p.name !== '固定机枪')
  const before = structuredClone(old)
  const baseline = api.normalizeModeConfigStore({ ...structuredClone(old), version: 64 })
  const next = api.normalizeModeConfigStore(old), result = map(next)
  assert.deepEqual(old, before)
  for (const d of source.deployments) {
    const entry = result.spawns.find((s) => s.uid === d.spawnUid).deployVehicles.find((v) => v.icon === d.vehicle.icon)
    assert.equal(entry.cd, entry.icon === edited.icon && d.spawnUid === target.spawns[0].uid ? 37
      : entry.icon === explicit.icon && d.spawnUid === target.spawns[0].uid ? 42 : d.legacyVehicle.cd)
    assert.notEqual(entry.cooldownKnown, false)
  }
  assert.deepEqual(result.zones, target.zones)
  assert.deepEqual(result.props, target.props)
  assert.deepEqual(result.vehicleRefreshRules, target.vehicleRefreshRules)
  assert.deepEqual(result.vehicleRefreshPoints, target.vehicleRefreshPoints)
  for (const p of next.profiles) {
    const prior = baseline.profiles.find((x) => x.id === p.id)
    if (p.id !== 'winner-takes-all') assert.deepEqual(stable(p), stable(prior))
    else {
      assert.deepEqual(stable(p.platformMaps.mobile), stable(prior.platformMaps.mobile))
      for (const [id, config] of Object.entries(p.platformMaps.pc)) if (id !== 'flashpoint') assert.deepEqual(stable(config), stable(prior.platformMaps.pc[id]))
    }
  }
  assert.deepEqual(stable(map(api.normalizeModeConfigStore(next))), stable(result))
})
test('template provenance survives validation/export/import; incomplete verified-template claims are rejected', () => {
  const info = source.deployments[0].vehicle.clientSpawner
  assert.ok(vehicleSpawnerDetails(info, 150).some((line) => line.includes('静态模板已解析') && line.includes('150s')))
  assert.equal(normalizeVehicleSpawnerInfo({ ...info, templateVehicleCd: undefined }), undefined)
  assert.equal(normalizeVehicleSpawnerInfo({ ...info, templateSelfVehicleCd: Infinity }), undefined)
  const store = fresh(), exported = api.buildOfficialModeData(profile(store), 'pc', 'flashpoint')
  const imported = api.importModeConfigData(fresh(), exported, 'mobile').store
  assert.deepEqual(api.buildOfficialModeData(profile(api.normalizeModeConfigStore(imported)), 'pc', 'flashpoint').maps, exported.maps)
})
test('migration is persisted once; subsequent user edits to geometry and deletion of newly recovered props survive', () => {
  storage.set(api.MODE_CONFIG_STORAGE_KEY, JSON.stringify(oldStore())); writes = 0
  const store = api.loadModeConfigStore()
  assert.equal(writes, 1); api.loadModeConfigStore(); assert.equal(writes, 1)
  const target = map(store)
  target.zones[0].points[0] = [-1, 2]
  target.props = target.props.filter((p) => p.name !== '固定机枪')
  const next = api.normalizeModeConfigStore(store)
  assert.deepEqual(stable(map(next)), stable(target))
})

test('Standard quotas include empty-point scout rows, but never create unbound deployment entries', () => {
  const limited = source.deployments.filter((d) => d.deploymentLimit)
  assert.equal(limited.length, 7)
  assert.deepEqual(limited.map((d) => [d.stageId, d.side, d.vehicle.clientSpawner.vehicleId, d.deploymentLimit.value]), [
    ['S1', 'attack', 1101004, 3], ['S1', 'defense', 1101002, 3],
    ['S2', 'attack', 1101004, 1], ['S3', 'attack', 1101004, 1],
    ['S3', 'defense', 1101004, 1], ['S1', 'attack', 1301005, 2], ['S1', 'attack', 1102001, 3],
  ])
  const scout = limited.find((d) => d.vehicle.clientSpawner.vehicleId === 1301005)
  assert.equal(scout.branch, 'camp')
  assert.equal(scout.vehicle.clientSpawner.singleUse, false) // preserve point provenance, not overwrite it with quota metadata
  assert.equal(scout.deploymentLimit.section, 'standard')
  const store = fresh(), runtime = api.buildRuntimeModeData(profile(store), 'pc', 'flashpoint')
  const vehicles = Object.values(runtime.map.deploy).flatMap((phase) => [...phase.attack, ...phase.defense])
  assert.equal(vehicles.length, 13)
  for (const d of limited) {
    const v = runtime.map.deploy[d.stageId][d.side].find((v) => v.spawnUid === d.spawnUid && v.icon === d.vehicle.icon)
    assert.equal(v.deployCount, d.deploymentLimit.value)
    assert.notEqual(v.deployCountKnown, false)
  }
  const exported = api.buildOfficialModeData(profile(store), 'pc', 'flashpoint')
  const imported = api.importModeConfigData(fresh(), exported).store
  assert.deepEqual(api.buildOfficialModeData(profile(imported), 'pc', 'flashpoint').maps, exported.maps)
})

test('v69 quota migration only updates bound legacy counts; preserves edits/deletions and all other modes/platforms', () => {
  const old = fresh(); old.version = 69
  const target = map(old)
  const limited = source.deployments.filter((d) => d.deploymentLimit)
  const find = (m, d) => m.spawns.find((s) => s.uid === d.spawnUid)?.deployVehicles.find((v) => v.icon === d.vehicle.icon)
  for (const d of limited) { const v = find(target, d); v.deployCount = 1; v.deployCountKnown = false }
  const edited = limited[0], removed = limited[1]
  Object.assign(find(target, edited), { deployCount: 5, cd: 37, num: 4, deployPositions: [[1, 2]] })
  const spawn = target.spawns.find((s) => s.uid === removed.spawnUid)
  spawn.deployVehicles = spawn.deployVehicles.filter((v) => v.icon !== removed.vehicle.icon)
  target.zones[0].points[0] = [-1, 2]
  const before = structuredClone(old)
  const baseline = api.normalizeModeConfigStore({ ...structuredClone(old), version: 70 })
  const next = api.normalizeModeConfigStore(old), result = map(next)
  assert.deepEqual(old, before)
  assert.equal(next.version, 72)
  assert.deepEqual(find(result, edited), find(target, edited))
  assert.equal(find(result, removed), undefined)
  for (const d of limited.filter((d) => d !== edited && d !== removed)) {
    assert.equal(find(result, d).deployCount, d.deploymentLimit.value)
    assert.notEqual(find(result, d).deployCountKnown, false)
  }
  for (const d of source.deployments.filter((d) => !d.deploymentLimit)) assert.deepEqual(find(result, d), find(target, d))
  for (const [key, value] of Object.entries(target)) if (!['spawns', 'notes', 'updatedAt'].includes(key)) assert.deepEqual(result[key], value)
  for (const p of next.profiles) {
    const prior = baseline.profiles.find((b) => b.id === p.id)
    if (p.id !== 'winner-takes-all') assert.deepEqual(stable(p), stable(prior))
    else {
      assert.deepEqual(stable(p.platformMaps.mobile), stable(prior.platformMaps.mobile))
      for (const id of Object.keys(p.platformMaps.pc)) if (id !== 'flashpoint') assert.deepEqual(stable(p.platformMaps.pc[id]), stable(prior.platformMaps.pc[id]))
    }
  }
  assert.equal(withFlashpointPcWinnerDeploymentLimits(result), result)
  const changed = limited.find((d) => d.vehicle.clientSpawner.vehicleId === 1301005)
  find(result, changed).deployCount = 1
  assert.equal(find(map(api.normalizeModeConfigStore(next)), changed).deployCount, 1)
})
