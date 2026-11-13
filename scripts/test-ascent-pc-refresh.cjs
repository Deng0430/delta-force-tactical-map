const assert = require('node:assert/strict')
const test = require('node:test')
const { createConfigLoader } = require('./lib/load-config-module.cjs')
const load = createConfigLoader()
const api = load('src/utils/modeConfigStorage.ts')
const snapshot = load('src/config/ascentPcRefreshData.json')
const { evaluateVehicleRefreshRule, isVehicleRefreshRuleInStage } = load('src/utils/vehicleRefreshRuntime.ts')
const oldStorage = globalThis.localStorage
globalThis.localStorage = { getItem: () => null }
test.after(() => {
  if (oldStorage === undefined) delete globalThis.localStorage
  else globalThis.localStorage = oldStorage
})
const winner = (s) => s.profiles.find((p) => p.id === 'winner-takes-all')
const ascent = (s) => winner(s).platformMaps.pc.ascent
const stable = (v) => JSON.parse(JSON.stringify(v, (k, value) => k === 'updatedAt' ? undefined : value))
function legacy() {
  const store = structuredClone(api.loadModeConfigStore()); store.version = 61
  const map = ascent(store)
  map.vehicleRefreshRules = map.vehicleRefreshRules.filter((r) => r.uid !== snapshot.newRule.uid)
  map.vehicleRefreshPoints = map.vehicleRefreshPoints.filter((p) => p.uid !== snapshot.newPoint.uid && !p.uid.startsWith('vehicle_refresh_point_pc_ascent_s1_fsv'))
  for (const row of snapshot.updates) {
    const rule = map.vehicleRefreshRules.find((r) => r.uid === row.ruleUid)
    rule.refreshPointUid = row.legacyPoint.uid
    const index = map.vehicleRefreshPoints.findIndex((p) => p.uid === row.legacyPoint.uid)
    if (index >= 0) map.vehicleRefreshPoints[index] = { ...row.legacyPoint, verification: 'confirmed' }
  }
  return store
}

test('fresh PC winner has five separate ticket refresh points and eight GuideVehicle boat positions', () => {
  const store = api.loadModeConfigStore()
  const runtime = api.buildRuntimeModeData(winner(store), 'pc', 'ascent')
  assert.deepEqual(runtime.issues, [])
  const map = runtime.map
  assert.equal(map.vehicleRefreshRules.length, 13)
  assert.equal(map.vehicleRefreshPoints.length, 13)
  const tickets = map.vehicleRefreshRules.filter((r) => r.trigger.type === 'tickets')
  assert.deepEqual(tickets.map((r) => [r.objective, r.trigger.value, r.vehicle.icon]),
    [['A', 135, 'orvtjc'], ['A', 50, 'lstjp'], ['B', 115, 'orvtjc'], ['C', 115, 'orvtjc'], ['D', 100, 'orvtjc']])
  assert.equal(new Set(tickets.map((r) => r.refreshPointUid)).size, 5)
  assert.deepEqual(tickets.slice(0, 4).map((r) => r.vehicle.cd), [60, 90, 60, 60])
  for (const row of snapshot.updates) {
    const rule = map.vehicleRefreshRules.find((r) => r.uid === row.ruleUid)
    const point = map.vehicleRefreshPoints.find((p) => p.uid === rule.refreshPointUid)
    assert.deepEqual([point.lat, point.lng], [row.point.lat, row.point.lng])
    if (row.icon === 'cfz') assert.match(row.sourceActor, /^BP_AutoVehicleSpawnerWithSpline/)
  }
  const d = tickets.at(-1)
  const context = { tickets: { attack: 100, defense: null }, matchTimeSeconds: null, objectiveStates: {}, objectiveCountdowns: {}, mapEvents: [] }
  assert.equal(evaluateVehicleRefreshRule(d, context, { stages: map.stages, currentStageIndex: 3 }).eligible, true)
  context.tickets.attack = 101
  assert.equal(evaluateVehicleRefreshRule(d, context, { stages: map.stages, currentStageIndex: 3 }).eligible, false)
  assert.equal(isVehicleRefreshRuleInStage(d, { stages: map.stages, currentStageIndex: 4 }), false)
})

test('v61 migration changes only target coordinates/link and adds S4 once; other data remains intact', () => {
  const old = legacy()
  const rule = ascent(old).vehicleRefreshRules.find((r) => r.uid === snapshot.updates[0].ruleUid)
  rule.note = '保留备注'; rule.vehicle.cd = 37
  const original = structuredClone(old)
  const baseline = api.normalizeModeConfigStore({ ...structuredClone(old), version: 62 })
  const next = api.normalizeModeConfigStore(old)
  assert.deepEqual(old, original)
  const after = ascent(next)
  assert.equal(after.vehicleRefreshRules.length, 13)
  assert.equal(after.vehicleRefreshRules.find((r) => r.uid === rule.uid).vehicle.cd, 37)
  assert.equal(after.vehicleRefreshRules.find((r) => r.uid === rule.uid).note, '保留备注')
  for (const key of ['vehicleRefreshRules', 'vehicleRefreshPoints']) ascent(baseline)[key] = after[key]
  assert.deepEqual(stable(next), stable(baseline))
  assert.deepEqual(stable(api.normalizeModeConfigStore(next)), stable(next))
})

test('moved points, deleted rules, changed identities and user UID collisions are preserved', () => {
  const old = legacy(); const map = ascent(old)
  const fsv = snapshot.updates.find((u) => u.icon === 'lstjp')
  const shared = map.vehicleRefreshPoints.find((p) => p.uid === fsv.legacyPoint.uid)
  shared.lat += 5
  const deleted = snapshot.updates.find((u) => u.objective === 'B')
  map.vehicleRefreshRules = map.vehicleRefreshRules.filter((r) => r.uid !== deleted.ruleUid)
  const changed = snapshot.updates.find((u) => u.objective === 'C')
  map.vehicleRefreshRules.find((r) => r.uid === changed.ruleUid).trigger.value = 99
  const collision = { ...snapshot.newPoint, name: '用户自己的标点', lat: 7, lng: 8, verification: 'draft' }
  map.vehicleRefreshPoints.push(collision)
  const next = ascent(api.normalizeModeConfigStore(old))
  assert.equal(next.vehicleRefreshRules.some((r) => r.uid === deleted.ruleUid), false)
  assert.equal(next.vehicleRefreshRules.find((r) => r.uid === changed.ruleUid).trigger.value, 99)
  assert.equal(next.vehicleRefreshRules.find((r) => r.uid === fsv.ruleUid).refreshPointUid, shared.uid)
  assert.equal(next.vehicleRefreshPoints.find((p) => p.uid === shared.uid).lat, shared.lat)
  assert.deepEqual(next.vehicleRefreshPoints.find((p) => p.uid === collision.uid), collision)
  const added = next.vehicleRefreshRules.find((r) => r.uid === snapshot.newRule.uid)
  assert.notEqual(added.refreshPointUid, collision.uid)
})

test('existing equivalent S4 custom rule is not duplicated; current-version deletion and export/import remain independent', () => {
  const old = legacy(); const map = ascent(old)
  map.vehicleRefreshPoints.push({ ...snapshot.newPoint, uid: 'custom-point', verification: 'draft' })
  map.vehicleRefreshRules.push({ ...structuredClone(snapshot.newRule), uid: 'custom-rule', refreshPointUid: 'custom-point', verification: 'draft' })
  assert.equal(ascent(api.normalizeModeConfigStore(old)).vehicleRefreshRules.filter((r) => r.objective === 'D').length, 1)
  const store = api.loadModeConfigStore()
  ascent(store).vehicleRefreshRules = ascent(store).vehicleRefreshRules.filter((r) => r.uid !== snapshot.newRule.uid)
  assert.equal(ascent(api.normalizeModeConfigStore(store)).vehicleRefreshRules.some((r) => r.uid === snapshot.newRule.uid), false)
  const exported = api.buildOfficialModeData(winner(store), 'pc', 'ascent')
  const imported = api.importModeConfigData(store, structuredClone(exported), 'mobile')
  const roundTrip = api.buildOfficialModeData(winner(api.normalizeModeConfigStore(imported.store)), 'pc', 'ascent')
  assert.deepEqual(roundTrip.maps.ascent, exported.maps.ascent)
})
