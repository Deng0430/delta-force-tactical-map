const assert = require('node:assert/strict')
const test = require('node:test')
const { createConfigLoader } = require('./lib/load-config-module.cjs')
const load = createConfigLoader()
const {
  objectiveStateKey: key, parseObjectiveStateKey, readStageObjectiveValue: read,
  writeStageObjectiveValue: write, scopeLegacyObjectiveValues, objectiveStatesForStageChange,
} = load('src/utils/objectiveStates.ts')
const { evaluateVehicleRefreshRule } = load('src/utils/vehicleRefreshRuntime.ts')
const emptyContext = () => ({ tickets: { attack: null, defense: null }, matchTimeSeconds: null,
  objectiveStates: {}, objectiveCountdowns: {}, mapEvents: [] })
const point = (name) => ({ name, note: '', icon: '', lat: 0, lng: 0, capturable: [] })
const stages = [
  { id: 'S1', points: [point('据点A')] },
  { id: 'S2', points: [point('据点B1'), point('据点B2')] },
  { id: 'S3', points: [point('据点C1'), point('据点C2')] },
  { id: 'S4', points: [point('据点C2')] },
]
const own = { owner: 'attack', capturingSide: null, progress: 100 }
const enemy = { owner: 'defense', capturingSide: 'attack', progress: 34 }

test('same-name C2 states are independent; keys escape arbitrary stage and objective names', () => {
  const source = write({}, 'S3', '据点C2', own)
  const both = write(source, 'S4', '据点C2', enemy)
  assert.equal(read(both, 'S3', '据点C2'), own)
  assert.equal(read(both, 'S4', '据点C2'), enemy)
  assert.equal(read(source, 'S4', '据点C2'), undefined)
  assert.notEqual(key('S3:C2', 'A'), key('S3', 'C2:A'))
  assert.deepEqual(parseObjectiveStateKey(key('阶段:4', 'C2["副本"]')), ['阶段:4', 'C2["副本"]'])
})

test('stage defaults do not let the locked S4 C2 overwrite the active S3 C2', () => {
  const result = objectiveStatesForStageChange({}, stages, 0, 2)
  assert.deepEqual(read(result, 'S3', '据点C2'), { owner: 'neutral', capturingSide: null, progress: 0 })
  assert.deepEqual(read(result, 'S4', '据点C2'), { owner: 'defense', capturingSide: null, progress: 100 })
  assert.equal(read(result, 'S1', '据点A').owner, 'attack')
})

test('S3 -> S4 preserves the completed C2 identity while the new C2 can be edited independently', () => {
  const source = write({}, 'S3', '据点C2', enemy)
  const original = structuredClone(source)
  const advanced = objectiveStatesForStageChange(source, stages, 2, 3)
  assert.deepEqual(read(advanced, 'S3', '据点C2'), own)
  assert.deepEqual(read(advanced, 'S4', '据点C2'), { owner: 'neutral', capturingSide: null, progress: 0 })
  const edited = write(advanced, 'S4', '据点C2', enemy)
  assert.deepEqual(read(edited, 'S3', '据点C2'), own)
  assert.deepEqual(read(edited, 'S4', '据点C2'), enemy)
  assert.deepEqual(source, original)
})

test('legacy name-only states/countdowns belong to one stage and cannot leak into another', () => {
  const legacy = { 据点C2: enemy }
  assert.equal(read(legacy, 'S3', '据点C2', 'S3'), enemy)
  assert.equal(read(legacy, 'S4', '据点C2', 'S3'), undefined)
  const scoped = scopeLegacyObjectiveValues(legacy, 'S3')
  assert.deepEqual(scoped, { [key('S3', '据点C2')]: enemy })
  assert.deepEqual(scopeLegacyObjectiveValues(scoped, 'S4'), scoped)
  const edited = write(legacy, 'S4', '据点C2', own)
  assert.equal(edited.据点C2, undefined)
  assert.equal(read(edited, 'S3', '据点C2', 'S3'), undefined)
  const countdowns = scopeLegacyObjectiveValues({ C2: 20 }, 'S3')
  assert.equal(read(countdowns, 'S3', 'C2'), 20)
  assert.equal(read(countdowns, 'S4', 'C2', 'S4'), undefined)
  const uniqueTimers = scopeLegacyObjectiveValues({ B2: 40, 据点A: 15 }, 'S3', stages)
  assert.equal(read(uniqueTimers, 'S2', 'B2'), 40)
  assert.equal(read(uniqueTimers, 'S1', '据点A'), 15)
  assert.equal(read(uniqueTimers, 'S3', 'B2'), undefined)
})

const rule = (objective, type, value) => ({
  uid: 'test-rule', objective, side: 'attack', action: 'refresh',
  trigger: { type, value }, vehicle: {}, quantity: 1, refreshPointUid: '', note: '',
})
test('capture refresh conditions use the matching stage even when trigger names omit 据点', () => {
  const context = emptyContext()
  context.objectiveStates = { [key('S3', '据点C2')]: enemy, [key('S4', '据点C2')]: own }
  assert.equal(evaluateVehicleRefreshRule(rule('S3', 'objective-captured', 'C2'), context, { stages, currentStageIndex: 2 }).eligible, false)
  assert.equal(evaluateVehicleRefreshRule(rule('S4', 'objective-captured', 'C2'), context, { stages, currentStageIndex: 3 }).eligible, true)
  // Without stage context, scoped states are intentionally not guessed from the name.
  assert.equal(evaluateVehicleRefreshRule(rule('C2', 'objective-captured', 'C2'), context).eligible, false)
})

test('countdown refresh cannot consume the other C2 stage value or an unset value', () => {
  const context = emptyContext()
  context.objectiveCountdowns = { [key('S3', 'C2')]: 90, [key('S4', 'C2')]: 15 }
  const r = rule('C2', 'objective-countdown', '00:30')
  assert.equal(evaluateVehicleRefreshRule(r, context, { stages, currentStageIndex: 2 }).eligible, false)
  delete context.objectiveCountdowns[key('S3', 'C2')]
  assert.equal(evaluateVehicleRefreshRule(r, context, { stages, currentStageIndex: 2 }).eligible, false)
})

test('four Ember mode maps have distinct S3/S4 C2 objective and capture-region UIDs', () => {
  const { loadModeConfigStore } = load('src/utils/modeConfigStorage.ts')
  const originalStorage = globalThis.localStorage
  try {
    globalThis.localStorage = { getItem: () => null }
    const store = loadModeConfigStore()
    for (const mode of ['attack-defense', 'winner-takes-all']) for (const platform of ['pc', 'mobile']) {
      const map = store.profiles.find((p) => p.id === mode).platformMaps[platform].ember
      const a = map.objectives.find((p) => p.stageId === 'S3' && p.name === '据点C2')
      const b = map.objectives.find((p) => p.stageId === 'S4' && p.name === '据点C2')
      assert.notEqual(a.uid, b.uid)
      const cap = (p) => map.zones.find((z) => z.uid === p.captureZoneUid)
      assert.equal(cap(a).points.length, 36)
      if (b.captureZoneUid) {
        assert.notEqual(a.captureZoneUid, b.captureZoneUid)
        assert.notEqual(cap(a).points, cap(b).points)
        assert.equal(cap(b).points.length, 36)
      }
    }
  } finally {
    if (originalStorage === undefined) delete globalThis.localStorage
    else globalThis.localStorage = originalStorage
  }
})
