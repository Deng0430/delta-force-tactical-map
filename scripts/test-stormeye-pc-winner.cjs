const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { createConfigLoader } = require('./lib/load-config-module.cjs')

const load = createConfigLoader()
const source = load('src/config/stormeyePcWinnerData.json')
const api = load('src/utils/modeConfigStorage.ts')
const { withStormeyePcWinnerData } = load('src/config/stormeyePcWinnerData.ts')
const { normalizeVehicleSpawnerInfo } = load('src/utils/vehicleSpawnerInfo.ts')
const { evaluateVehicleRefreshRule, isVehicleRefreshRuleInStage } = load('src/utils/vehicleRefreshRuntime.ts')
const priorStorage = global.localStorage
const storage = new Map()
let writes = 0
global.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => { writes++; storage.set(key, value) },
}
test.after(() => {
  if (priorStorage === undefined) delete global.localStorage
  else global.localStorage = priorStorage
})

const winner = (store) => store.profiles.find((profile) => profile.id === 'winner-takes-all')
const mapOf = (store) => winner(store).platformMaps.pc.stormeye
const stable = (value) => JSON.parse(JSON.stringify(value, (key, item) => key === 'updatedAt' ? undefined : item))
function fresh() { storage.clear(); return api.loadModeConfigStore() }
function legacy() {
  const official = load('src/config/winnerTakesAllOfficial.json')
  const imported = api.importModeConfigData(fresh(), {
    ...official, gameDataPlatform: 'pc', maps: { stormeye: official.maps.stormeye },
  })
  assert.ok(imported)
  imported.store.version = 64
  return imported.store
}
function assertOtherContextsUnchanged(actual, baseline) {
  for (const profile of actual.profiles) {
    const prior = baseline.profiles.find((entry) => entry.id === profile.id)
    if (profile.id !== 'winner-takes-all') assert.deepEqual(stable(profile), stable(prior))
    else {
      assert.deepEqual(stable(profile.platformMaps.mobile), stable(prior.platformMaps.mobile))
      for (const [id, config] of Object.entries(profile.platformMaps.pc)) {
        if (id !== 'stormeye') assert.deepEqual(stable(config), stable(prior.platformMaps.pc[id]))
      }
    }
  }
}
function assertNativeGeometry(store) {
  const runtime = api.buildRuntimeModeData(winner(store), 'pc', 'stormeye')
  assert.deepEqual(runtime.issues, [])
  assert.equal(runtime.map.stages.length, 5)
  for (const sourceStage of source.stages) {
    const stage = runtime.map.stages.find((item) => item.id === sourceStage.id)
    assert.ok(stage, sourceStage.id)
    assert.deepEqual(stage.zone.latlngs, sourceStage.frontline)
    assert.deepEqual(stage.attackBaseZone, sourceStage.attackBaseZone)
    assert.deepEqual(stage.defenseBaseZone, sourceStage.defenseBaseZone)
    for (const sourcePoint of sourceStage.objectives) {
      const point = stage.points.find((item) => item.name === sourcePoint.name)
      assert.ok(point, `${stage.id} ${sourcePoint.name}`)
      assert.deepEqual([point.lat, point.lng], [sourcePoint.lat, sourcePoint.lng])
      assert.deepEqual(point.capturable, sourcePoint.captureArea)
    }
  }
  return runtime.map
}

test('PC winner Stormeye snapshot contains the physical five-stage map, not display-only borders or other mode data', () => {
  assert.equal(source.source.mapId, 608)
  assert.equal(source.source.platform, 'pc')
  assert.equal(source.stages.length, 5)
  assert.equal(source.stages.flatMap((stage) => stage.objectives).length, 7)
  assert.equal(source.stages.reduce((sum, stage) => sum + 3 + stage.objectives.length, 0), 22)
  assert.equal(source.stages.flatMap((stage) => stage.spawns).length, 26)
  assert.equal(source.deployments.length, 29)
  assert.equal(source.refreshUpdates.length, 9)
  assert.equal(new Set(source.refreshUpdates.map((entry) => entry.uid)).size, 9)
  assert.deepEqual(source.unconditionalCamp, [{ spawnerId: 'bird_S1_Attack2', vehicleId: 1301005 }])
  assert.deepEqual(source.unresolvedDeployments.map((entry) => [entry.stageId, entry.vehicleId, entry.spawnerId]), [
    ['S1', 1201003, 'ship_S1_attack2'], ['S2', 1201003, 'ship_S1_attack2'],
  ])
  // The tracked snapshot is sufficient for app use; extraction provenance is optional for installed users.
  const root = path.resolve(__dirname, '..')
  if (source.source.files.every((file) => fs.existsSync(path.join(root, file.path)))) {
    assert.deepEqual(require('./sync-stormeye-pc-winner.cjs').buildSnapshot(), source)
  }
})

test('fresh installation really loads native activity/capture regions, objective positions and base Hub coordinates', () => {
  const store = fresh(), map = mapOf(store)
  assert.equal(store.version, 72)
  assertNativeGeometry(store)
  for (const stage of source.stages) for (const expected of stage.spawns) {
    const spawn = map.spawns.find((item) => item.uid === expected.uid)
    assert.ok(spawn, expected.uid)
    assert.equal(spawn.stageId, stage.id)
    assert.equal(spawn.side, expected.side)
    assert.equal(spawn.name, expected.name)
    assert.deepEqual([spawn.lat, spawn.lng], [expected.lat, expected.lng])
  }
  for (const deployment of source.deployments) {
    const spawn = map.spawns.find((item) => item.uid === deployment.spawnUid)
    assert.ok(spawn, deployment.spawnUid)
    const vehicle = spawn.deployVehicles.find((item) => item.icon === deployment.vehicle.icon)
    assert.ok(vehicle, `${spawn.stageId} ${spawn.name} ${deployment.vehicle.name}`)
    assert.deepEqual(vehicle.deployPositions, deployment.vehicle.deployPositions)
    assert.equal(vehicle.cd, deployment.vehicle.cd)
    assert.equal(vehicle.num, deployment.vehicle.num)
    assert.equal(vehicle.deployCount ?? 1, deployment.vehicle.deployCount ?? 1)
    assert.notEqual(vehicle.cooldownKnown, false)
    if (vehicle.clientSpawner) assert.deepEqual(normalizeVehicleSpawnerInfo(vehicle.clientSpawner), vehicle.clientSpawner)
  }
  assert.equal(withStormeyePcWinnerData(map), map)
})

test('runtime initialization does not read ignored extraction directories or depend on raw source files', () => {
  const readFileSync = fs.readFileSync
  const root = path.resolve(__dirname, '..')
  const forbidden = ['source', 'tmp'].map((folder) => `${path.join(root, folder).toLowerCase()}${path.sep}`)
  let attempts = 0
  fs.readFileSync = function (filename, ...args) {
    if (typeof filename === 'string' && forbidden.some((prefix) => path.resolve(filename).toLowerCase().startsWith(prefix))) {
      attempts++
      const error = new Error('Raw extraction data is not installed')
      error.code = 'ENOENT'
      throw error
    }
    return readFileSync.call(this, filename, ...args)
  }
  try {
    const isolated = createConfigLoader()('src/utils/modeConfigStorage.ts')
    storage.clear()
    const store = isolated.loadModeConfigStore()
    const runtime = isolated.buildRuntimeModeData(winner(store), 'pc', 'stormeye')
    assert.deepEqual(runtime.issues, [])
    assert.equal(runtime.map.vehicleRefreshRules.length, 9)
    assert.equal(mapOf(store).spawns.length, 26)
    assert.equal(attempts, 0)
  } finally {
    fs.readFileSync = readFileSync
  }
})

test('native map props use current types, projected positions and shared air-station identities without duplicate markers', () => {
  const target = mapOf(fresh())
  for (const prop of source.props) {
    const uid = prop.legacyIndex !== undefined ? `builtin_wta_stormeye_prop-${prop.legacyIndex}` : prop.uid
    const actual = target.props.find((entry) => entry.uid === uid)
    assert.ok(actual, `${prop.name} ${uid}`)
    assert.equal(actual.name, prop.name)
    assert.equal(actual.icon, prop.icon)
    assert.deepEqual([actual.lat, actual.lng], [prop.lat, prop.lng])
    if (prop.zipline) assert.deepEqual(actual.zipline, prop.zipline)
    if (prop.airSupply) assert.deepEqual(actual.airSupply, prop.airSupply)
  }
  assert.equal(target.props.filter((prop) => prop.airSupply).length, 2)
  assert.equal(target.props.filter((prop) => prop.name === '火神炮').length, 2)
  assert.equal(target.props.filter((prop) => prop.zipline).length, 18)
  assert.equal(new Set(target.props.map((prop) => prop.uid)).size, target.props.length)
})

test('S2 and S5 deployment menus follow native Hub links and corrected vehicle identity rather than previous card names', () => {
  const target = mapOf(fresh())
  const nativeSpawn = (actor) => source.stages.flatMap((stage) => stage.spawns).find((spawn) => spawn.actor === actor)
  const icons = (actor) => target.spawns.find((spawn) => spawn.uid === nativeSpawn(actor).uid).deployVehicles.map((vehicle) => vehicle.icon).sort()
  assert.deepEqual(icons('S2_Defend_Hub_Down3'), ['mtt'])
  assert.deepEqual(icons('S2_Defend_Hub_UP'), ['qxtk', 'ucb9597'])
  assert.deepEqual(icons('S5_Defend_Hub'), ['mtt'])
  assert.deepEqual(icons('S5_Defend_Hub2'), ['lstjp', 'ucb9597'])
  assert.deepEqual(icons('S5_Defend_Hub3'), [])
  assert.deepEqual(icons('S5_Attack_DOWN'), ['mtt', 'sxzjc'])
  assert.deepEqual(icons('S5_Attack_ship'), ['sxzjc'])
  const aavSource = source.deployments.find((entry) => entry.stageId === 'S5'
    && entry.spawnUid === nativeSpawn('S5_Attack_ship').uid && entry.vehicle.icon === 'sxzjc')
  const actual = target.spawns.find((spawn) => spawn.uid === aavSource.spawnUid).deployVehicles.find((vehicle) => vehicle.icon === 'sxzjc')
  assert.equal(actual.clientSpawner.vehicleId, 1101006)
  assert.deepEqual(actual.deployPositions, aavSource.vehicle.deployPositions)
})

test('condition refresh retains nine rules, native ticket thresholds and distinct A180/A140 locations without duplicated stage-array references', () => {
  const store = fresh(), runtime = assertNativeGeometry(store)
  assert.equal(runtime.vehicleRefreshRules.length, 9)
  const rules = runtime.vehicleRefreshRules
  assert.deepEqual(rules.map((rule) => [rule.objective, rule.trigger.type, rule.trigger.value]), [
    ['A', 'tickets', 180], ['A', 'tickets', 160], ['A', 'tickets', 140],
    ['B', 'tickets', 140], ['B', 'tickets', 125], ['C', 'tickets', 140],
    ['C', 'tickets', 125], ['D', 'tickets', 95], ['E', 'tickets', 75],
  ])
  for (const [objective, threshold] of [['A', 160], ['B', 125], ['E', 75]]) {
    const rule = rules.find((item) => item.objective === objective && item.trigger.value === threshold)
    assert.match(rule.vehicle.name, /山猫/)
    assert.notEqual(rule.vehicle.category, 'water')
    assert.notEqual(rule.vehicle.icon, 'ucb9597')
    assert.notEqual(rule.vehicle.icon, 'sxzjc')
    assert.equal(rule.vehicle.iconUrl, '/icons/vehicles/pc-hud/HUD_Screen_Icon_0118.png')
    assert.ok(fs.existsSync(path.resolve(__dirname, '..', 'public', rule.vehicle.iconUrl.slice(1))))
  }
  const a180 = rules.find((rule) => rule.objective === 'A' && rule.trigger.value === 180)
  const a140 = rules.find((rule) => rule.objective === 'A' && rule.trigger.value === 140)
  assert.notEqual(a180.refreshPointUid, a140.refreshPointUid)
  assert.notDeepEqual(runtime.vehicleRefreshPoints.find((point) => point.uid === a180.refreshPointUid),
    runtime.vehicleRefreshPoints.find((point) => point.uid === a140.refreshPointUid))
  const context = { tickets: { attack: 140, defense: null }, matchTimeSeconds: null, objectiveStates: {}, objectiveCountdowns: {}, mapEvents: [] }
  assert.equal(evaluateVehicleRefreshRule(a140, context, { stages: runtime.stages, currentStageIndex: 0 }).eligible, true)
  assert.equal(evaluateVehicleRefreshRule(a140, { ...context, tickets: { attack: 141, defense: null } },
    { stages: runtime.stages, currentStageIndex: 0 }).eligible, false)
  assert.equal(isVehicleRefreshRuleInStage(a140, { stages: runtime.stages, currentStageIndex: 1 }), false)
  for (const rule of rules) assert.ok(runtime.vehicleRefreshPoints.some((point) => point.uid === rule.refreshPointUid), rule.uid)
  for (const update of source.refreshUpdates) {
    const rule = rules.find((entry) => entry.uid === update.uid)
    const point = runtime.vehicleRefreshPoints.find((entry) => entry.uid === rule.refreshPointUid)
    assert.deepEqual([point.lat, point.lng], [update.point.lat, update.point.lng])
    assert.deepEqual(normalizeVehicleSpawnerInfo(rule.clientSpawner), rule.clientSpawner)
    if (update.positionKnown) assert.equal(rule.clientSpawner.positionStatus, 'pc-level-verified')
    else {
      assert.equal(update.spawnerId, 'ORV_S2_pingheng')
      assert.equal(rule.clientSpawner.positionStatus, 'existing-unverified')
      assert.deepEqual([point.lat, point.lng], [update.legacyPoint.lat, update.legacyPoint.lng])
    }
  }
})

test('a user-relinked custom refresh point stays shared and keeps its UID while native vehicle corrections and uncertainty notes still apply', () => {
  const old = legacy(), map = mapOf(old)
  const mountain = source.refreshUpdates.find((entry) => entry.rule.objective === 'A' && entry.rule.trigger.value === 160)
  const target = map.vehicleRefreshRules.find((entry) => entry.uid === mountain.uid)
  const customPoint = { ...mountain.legacyPoint, uid: 'custom-shared-refresh-point', name: '用户自建共享点', lat: -30, lng: 40, verification: 'draft' }
  map.vehicleRefreshPoints.push(customPoint)
  target.refreshPointUid = customPoint.uid
  map.vehicleRefreshRules.push({ ...structuredClone(target), uid: 'custom-sharing-rule' })
  const b140 = source.refreshUpdates.find((entry) => entry.rule.objective === 'B' && entry.rule.trigger.value === 140)
  const fallback = map.vehicleRefreshRules.find((entry) => entry.uid === b140.uid)
  fallback.refreshPointUid = customPoint.uid
  const result = mapOf(api.normalizeModeConfigStore(old))
  const corrected = result.vehicleRefreshRules.find((entry) => entry.uid === target.uid)
  assert.equal(corrected.refreshPointUid, customPoint.uid)
  assert.match(corrected.vehicle.name, /山猫/)
  assert.equal(result.vehicleRefreshRules.find((entry) => entry.uid === 'custom-sharing-rule').refreshPointUid, customPoint.uid)
  assert.deepEqual(result.vehicleRefreshPoints.find((entry) => entry.uid === customPoint.uid), customPoint)
  const fallbackAfter = result.vehicleRefreshRules.find((entry) => entry.uid === fallback.uid)
  assert.equal(fallbackAfter.refreshPointUid, customPoint.uid)
  assert.match(fallbackAfter.note, /未找到对应生成器/)
  assert.match(fallbackAfter.note, new RegExp(b140.legacyRule.note))
  assert.equal(result.vehicleRefreshPoints.some((entry) => entry.uid.startsWith(mountain.point.uid)), false)
})

test('a new native Hub UID collision resolves once and the source synchronizer remains idempotent', () => {
  const map = mapOf(legacy())
  const addition = source.stages.flatMap((stage) => stage.spawns).find((spawn) => !spawn.legacyPosition)
  assert.ok(addition)
  const collision = { uid: addition.uid, stageId: 'S1', side: 'attack', name: '与源ID冲突的自建点', lat: -1, lng: 2,
    vehicleDeploy: false, vehicleCategories: [], deployVehicles: [], verification: 'draft' }
  map.spawns.push(collision)
  const once = withStormeyePcWinnerData(map)
  assert.deepEqual(once.spawns.find((entry) => entry.uid === collision.uid), collision)
  const recovered = once.spawns.filter((entry) => entry.uid.startsWith(`${addition.uid}_`) && entry.stageId === 'S5')
  assert.equal(recovered.length, 1)
  assert.deepEqual([recovered[0].lat, recovered[0].lng], [addition.lat, addition.lng])
  assert.equal(withStormeyePcWinnerData(once), once)
})

test('a user-deleted S5 stage does not gain an orphan native Hub during migration', () => {
  const old = legacy(), map = mapOf(old)
  map.stages = map.stages.filter((stage) => stage.id !== 'S5')
  for (const key of ['spawns', 'objectives', 'zones']) map[key] = map[key].filter((entry) => entry.stageId !== 'S5')
  map.vehicleRefreshRules = map.vehicleRefreshRules.filter((rule) => rule.objective !== 'E')
  const after = mapOf(api.normalizeModeConfigStore(old))
  assert.equal(after.stages.some((stage) => stage.id === 'S5'), false)
  assert.equal(after.spawns.some((spawn) => spawn.stageId === 'S5'), false)
})

test('retirement only removes untouched old deployment cards, preserving edits to permission, category, badge and name', () => {
  const retired = source.legacyDeployments.find((prior) => !source.deployments.some((entry) =>
    entry.stageId === prior.stageId && entry.side === prior.side && entry.spawnUid === prior.spawnUid && entry.vehicle.icon === prior.vehicle.icon))
  assert.ok(retired)
  for (const [field, value] of [['allowTeammate', !retired.vehicle.allowTeammate], ['category', 'recon'], ['badge', '自'], ['name', '用户自定义载具名称']]) {
    const map = mapOf(legacy())
    const spawn = map.spawns.find((entry) => entry.uid === retired.spawnUid)
    const vehicle = spawn.deployVehicles.find((entry) => entry.icon === retired.vehicle.icon)
    vehicle[field] = value
    const after = withStormeyePcWinnerData(map).spawns.find((entry) => entry.uid === spawn.uid).deployVehicles.find((entry) => entry.icon === vehicle.icon)
    assert.ok(after, field)
    assert.equal(after[field], value, field)
  }
})

test('refresh migration preserves custom note/CD/count, moved shared points, modified conditions, deleted rules and UID collisions', () => {
  const old = legacy(), map = mapOf(old)
  const update = source.refreshUpdates.find((entry) => entry.rule.objective === 'A' && entry.rule.trigger.value === 180)
  const shared = map.vehicleRefreshPoints.find((point) => point.uid === update.legacyPoint.uid)
  shared.lat += 3
  const collision = { ...update.point, name: '同UID的用户自建点', lat: -1, lng: 2, verification: 'draft' }
  map.vehicleRefreshPoints.push(collision)
  const carUpdate = source.refreshUpdates.find((entry) => entry.rule.objective === 'A' && entry.rule.trigger.value === 160)
  const carRule = map.vehicleRefreshRules.find((rule) => rule.uid === carUpdate.uid)
  carRule.note = '用户部署说明'
  Object.assign(carRule.vehicle, { cd: 37, num: 3, deployCount: 4 })
  carRule.quantity = 2
  const changedUpdate = source.refreshUpdates.find((entry) => entry.rule.objective === 'C' && entry.rule.trigger.value === 140)
  const changed = map.vehicleRefreshRules.find((rule) => rule.uid === changedUpdate.uid)
  changed.trigger.value = 99
  const deleted = source.refreshUpdates.find((entry) => entry.rule.objective === 'D')
  map.vehicleRefreshRules = map.vehicleRefreshRules.filter((rule) => rule.uid !== deleted.uid)
  map.vehicleRefreshPoints.push({ uid: 'custom-refresh-point', name: '自行定义位置', lat: -15, lng: 25, verification: 'confirmed' })
  map.vehicleRefreshRules.push({ ...structuredClone(carRule), uid: 'custom-refresh-rule', objective: 'E',
    trigger: { type: 'tickets', value: 120 }, refreshPointUid: 'custom-refresh-point', verification: 'confirmed' })
  const baseline = api.normalizeModeConfigStore({ ...structuredClone(old), version: 65 })
  const next = api.normalizeModeConfigStore(old), result = mapOf(next)
  const current = result.vehicleRefreshRules.find((rule) => rule.uid === update.uid)
  const point = result.vehicleRefreshPoints.find((entry) => entry.uid === current.refreshPointUid)
  assert.notEqual(point.uid, collision.uid)
  assert.equal(point.lat, shared.lat)
  assert.deepEqual(result.vehicleRefreshPoints.find((entry) => entry.uid === collision.uid), collision)
  const fsv = result.vehicleRefreshRules.find((rule) => rule.objective === 'A' && rule.trigger.value === 140)
  assert.notEqual(fsv.refreshPointUid, current.refreshPointUid)
  assert.equal(result.vehicleRefreshPoints.find((entry) => entry.uid === fsv.refreshPointUid).lat, shared.lat)
  const car = result.vehicleRefreshRules.find((rule) => rule.uid === carRule.uid)
  assert.match(car.vehicle.name, /山猫/)
  assert.deepEqual([car.vehicle.cd, car.vehicle.num, car.vehicle.deployCount, car.quantity, car.note], [37, 3, 4, 2, '用户部署说明'])
  assert.deepEqual(result.vehicleRefreshRules.find((rule) => rule.uid === changed.uid),
    mapOf(baseline).vehicleRefreshRules.find((rule) => rule.uid === changed.uid))
  assert.equal(result.vehicleRefreshRules.some((rule) => rule.uid === deleted.uid), false)
  assert.deepEqual(result.vehicleRefreshRules.find((rule) => rule.uid === 'custom-refresh-rule'),
    mapOf(baseline).vehicleRefreshRules.find((rule) => rule.uid === 'custom-refresh-rule'))
  assert.deepEqual(result.vehicleRefreshPoints.find((entry) => entry.uid === 'custom-refresh-point'),
    mapOf(baseline).vehicleRefreshPoints.find((entry) => entry.uid === 'custom-refresh-point'))
  assert.deepEqual(api.buildRuntimeModeData(winner(next), 'pc', 'stormeye').issues, [])
})

test('v64 migration touches only PC winner Stormeye, preserving custom entities, CD/count values, moved Hub and deletion', () => {
  const old = legacy(), map = mapOf(old)
  const deployment = source.deployments.find((entry) => entry.legacyVehicle
    && map.spawns.find((spawn) => spawn.uid === entry.spawnUid)?.deployVehicles.some((vehicle) => vehicle.icon === entry.vehicle.icon))
  assert.ok(deployment)
  const spawn = map.spawns.find((entry) => entry.uid === deployment.spawnUid)
  spawn.lat += 1; spawn.name = '用户自定义基地'
  const vehicle = spawn.deployVehicles.find((entry) => entry.icon === deployment.vehicle.icon)
  Object.assign(vehicle, { cd: 37, num: 7, deployCount: 4, deployPositions: [[-1, 2]] })
  const removed = source.deployments.find((entry) => entry.legacyVehicle && entry.spawnUid !== deployment.spawnUid
    && map.spawns.find((spawn) => spawn.uid === entry.spawnUid)?.deployVehicles.some((vehicle) => vehicle.icon === entry.vehicle.icon))
  assert.ok(removed)
  const removedSpawn = map.spawns.find((entry) => entry.uid === removed.spawnUid)
  removedSpawn.deployVehicles = removedSpawn.deployVehicles.filter((entry) => entry.icon !== removed.vehicle.icon)
  map.zones[0].color = '#123456'
  map.zones.push({ ...structuredClone(map.zones[0]), uid: 'custom-stormeye-zone', points: [[-1, 2], [-2, 3], [-3, 1]] })
  map.props.push({ uid: 'custom-stormeye-prop', stageId: '*', name: '自定义设施', icon: 'q_gddyx', lat: -1, lng: 2, verification: 'draft' })
  const mappedProps = source.props.filter((prop) => prop.legacyIndex !== undefined)
  const moved = map.props.find((prop) => prop.uid === `builtin_wta_stormeye_prop-${mappedProps[0].legacyIndex}`)
  moved.lat += 2; moved.name = '用户调整过的设施'
  const removedPropUid = `builtin_wta_stormeye_prop-${mappedProps[1].legacyIndex}`
  map.props = map.props.filter((prop) => prop.uid !== removedPropUid)
  old.profiles.push({ ...structuredClone(winner(old)), id: 'my-mode' })
  const original = structuredClone(old)
  const baseline = api.normalizeModeConfigStore({ ...structuredClone(old), version: 65 })
  const next = api.normalizeModeConfigStore(old), result = mapOf(next)
  assert.deepEqual(old, original)
  const actualSpawn = result.spawns.find((entry) => entry.uid === spawn.uid)
  assert.equal(actualSpawn.lat, spawn.lat)
  assert.equal(actualSpawn.name, spawn.name)
  const actualVehicle = actualSpawn.deployVehicles.find((entry) => entry.icon === vehicle.icon)
  assert.deepEqual([actualVehicle.cd, actualVehicle.num, actualVehicle.deployCount, actualVehicle.deployPositions], [37, 7, 4, [[-1, 2]]])
  assert.equal(result.spawns.find((entry) => entry.uid === removed.spawnUid).deployVehicles.some((entry) => entry.icon === removed.vehicle.icon), false)
  assert.equal(result.zones[0].color, '#123456')
  assert.deepEqual(result.zones.find((entry) => entry.uid === 'custom-stormeye-zone'), map.zones.at(-1))
  assert.deepEqual(result.props.find((entry) => entry.uid === 'custom-stormeye-prop'), map.props.find((entry) => entry.uid === 'custom-stormeye-prop'))
  const actualProp = result.props.find((entry) => entry.uid === moved.uid)
  assert.equal(actualProp.lat, moved.lat)
  assert.equal(actualProp.name, moved.name)
  assert.equal(result.props.some((entry) => entry.uid === removedPropUid), false)
  assertOtherContextsUnchanged(next, baseline)
})

test('official single-map export/import and backup roundtrips retain native geometry, refresh conditions and deployment positions', () => {
  const store = fresh()
  const exported = api.buildOfficialModeData(winner(store), 'pc', 'stormeye')
  assert.deepEqual(Object.keys(exported.maps), ['stormeye'])
  const imported = api.importModeConfigData(fresh(), structuredClone(exported), 'mobile')
  assert.ok(imported)
  assert.equal(imported.gameDataPlatform, 'pc')
  const normalized = api.normalizeModeConfigStore(imported.store)
  assert.deepEqual(stable(api.buildOfficialModeData(winner(normalized), 'pc', 'stormeye')), stable(exported))
  const backup = api.importModeConfigData(fresh(), JSON.parse(JSON.stringify(store)))
  assert.ok(backup)
  assert.deepEqual(stable(api.buildOfficialModeData(winner(backup.store), 'pc', 'stormeye')), stable(exported))
})

test('source migration persists once; current-version geometry edits and deletions survive every later load', () => {
  storage.set(api.MODE_CONFIG_STORAGE_KEY, JSON.stringify(legacy())); writes = 0
  const store = api.loadModeConfigStore()
  assert.equal(writes, 1)
  api.loadModeConfigStore(); assert.equal(writes, 1)
  const map = mapOf(store)
  map.zones[0].points[0] = [-1, 2]
  map.props = map.props.filter((prop) => prop.name !== '固定机枪')
  map.vehicleRefreshRules = map.vehicleRefreshRules.slice(1)
  map.spawns[0].deployVehicles = []
  const saved = stable(map)
  const next = api.normalizeModeConfigStore(store)
  assert.deepEqual(stable(mapOf(next)), saved)
  storage.set(api.MODE_CONFIG_STORAGE_KEY, JSON.stringify(next)); writes = 0
  assert.deepEqual(stable(mapOf(api.loadModeConfigStore())), saved)
  assert.equal(writes, 0)
})
