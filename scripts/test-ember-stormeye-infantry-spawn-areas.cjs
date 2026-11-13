const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const { createConfigLoader } = require('./lib/load-config-module.cjs')
const load = createConfigLoader()
const { infantrySpawnAreasForObjective: objective, infantrySpawnAreasForBase: base, visibleInfantrySpawnGroups: visible } = load('src/config/infantrySpawnAreas.ts')
const api = load('src/utils/modeConfigStorage.ts')
const stable = (value) => JSON.parse(JSON.stringify(value))
const originalStorage = globalThis.localStorage
let store
try {
  globalThis.localStorage = { getItem: () => null }
  store = api.normalizeModeConfigStore(api.loadModeConfigStore())
} finally {
  if (originalStorage === undefined) delete globalThis.localStorage
  else globalThis.localStorage = originalStorage
}
const winner = store.profiles.find((p) => p.id === 'winner-takes-all')
const runtime = (id) => api.buildRuntimeModeData(winner, 'pc', id).map

for (const [id, mapId, objectiveCount, baseCount, areaCount] of [
  ['ember', 602, 6, 18, 152], ['stormeye', 608, 7, 26, 137],
]) {
  const data = load(`src/config/${id}PcInfantrySpawnAreas.json`)
  const stages = runtime(id).stages

  test(`${id}: current PC winner binds every objective and base, without moving their markers`, () => {
    assert.equal(data.logicalMapId, mapId)
    assert.equal(data.mapBindingVerified, true)
    assert.equal(data.stateMappingVerified, false)
    assert.deepEqual(data.modeIds, ['winner-takes-all'])
    assert.equal(data.objectives.length, objectiveCount)
    assert.equal(data.bases.length, baseCount)
    assert.equal(data.areas.length, areaCount)
    for (const stage of stages) {
      for (const point of stage.points) {
        const candidate = objective(id, 'pc', 'winner-takes-all', stage.id, point)
        assert.ok(candidate, `${stage.id}/${point.name}`)
        assert.equal(candidate.groups.length, 4)
      }
      for (const spawn of stage.spawns) {
        const candidate = base(id, 'pc', 'winner-takes-all', stage.id, spawn)
        assert.ok(candidate, `${stage.id}/${spawn.name}`)
        assert.equal(candidate.side, spawn.side)
        assert.ok(candidate.areas.length || candidate.footSoldierDisabled || candidate.unresolvedCount)
      }
    }
  })

  test(`${id}: phase, base UID, side, marker and objective icon guard all bindings`, () => {
    const stage = stages[0], spawn = stage.spawns[0], point = stage.points[0]
    assert.equal(base(id, 'pc', 'winner-takes-all', 'S2', spawn), null)
    assert.equal(base(id, 'pc', 'winner-takes-all', 'S1', { ...spawn, uid: 'copied-base' }), null)
    assert.equal(base(id, 'pc', 'winner-takes-all', 'S1', { ...spawn, side: spawn.side === 'attack' ? 'defense' : 'attack' }), null)
    assert.equal(base(id, 'pc', 'winner-takes-all', 'S1', { ...spawn, lat: spawn.lat + 1 }), null)
    assert.equal(objective(id, 'pc', 'winner-takes-all', 'S2', point), null)
    assert.equal(objective(id, 'pc', 'winner-takes-all', 'S1', { ...point, lng: point.lng + 1 }), null)
  })

  test(`${id}: no leakage into ordinary AD, mobile or custom modes; side/inner/outer remain selectable`, () => {
    const stage = stages[0], point = stage.points[0], spawn = stage.spawns[0]
    for (const [platform, mode] of [['mobile', 'winner-takes-all'], ['pc', 'attack-defense'], ['pc', 'custom']]) {
      assert.equal(objective(id, platform, mode, 'S1', point), null)
      assert.equal(base(id, platform, mode, 'S1', spawn), null)
    }
    const candidate = objective(id, 'pc', 'winner-takes-all', 'S1', point)
    const inspection = { expanded: false, side: 'attack', inner: true, outer: true }
    assert.deepEqual(visible(candidate, inspection), [])
    assert.ok(visible(candidate, { ...inspection, expanded: true }).every((g) => g.side === 'attack'))
    const defense = visible(candidate, { ...inspection, expanded: true, side: 'defense', inner: false })
    assert.equal(defense.length, 1)
    assert.equal(defense[0].kind, 'outer')
    assert.equal(defense[0].side, 'defense')
  })

  test(`${id}: every displayed region is finite and every reference resolves to the frozen geometry`, () => {
    const areas = new Map(data.areas.map((a) => [a.id, a]))
    assert.equal(areas.size, data.areas.length)
    for (const area of data.areas) {
      assert.ok(area.points.length >= 3)
      assert.ok(area.points.every((p) => p.length === 2 && p.every(Number.isFinite)))
    }
    for (const item of [...data.objectives.flatMap((o) => o.groups), ...data.bases]) {
      assert.ok(item.areaIds.every((key) => areas.has(key)))
      assert.ok(item.unresolvedAreaIds.every((key) => !item.areaIds.includes(key)))
    }
  })

  const evidenceFile = `source/PC提取资源/${id === 'ember' ? '烬区' : '风暴眼'}/人员部署与复活_2026-11-13/人员候选区与入口证据.json`
  test(`${id}: frozen geometry reproduces verified source XY (optional ignored evidence)`, { skip: !fs.existsSync(evidenceFile) }, () => {
    const evidence = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'))
    assert.equal(evidence.logicalMapId, mapId)
    assert.deepEqual(evidence.geometryErrors, [])
    const source = new Map(evidence.areas.map((a) => [a.id, a]))
    const project = id === 'ember'
      ? ([x, y]) => [-(y + 156320) * 256 / 120000, (x - 45280) * 256 / 120000]
      : ([x, y]) => [-(y + 174954.578125) * 256 / 174482.015625, (x - 16739.625) * 256 / 174482.015625]
    for (const area of data.areas) {
      const original = source.get(area.id)
      assert.equal(original.available, true)
      assert.deepEqual(area.points, original.world_xyz_ue_cm.map((p) => project(p).map((v) => Number(v.toFixed(6)))))
    }
  })
}

test('Ember S4 C1 warehouse displays both outer groups as 14 user-selected candidates, replacing guaranteed areas', () => {
  const stages = runtime('ember').stages
  const s3 = stages.find((s) => s.id === 'S3'), s4 = stages.find((s) => s.id === 'S4')
  const c2 = (stage) => stage.points.find((p) => p.icon === 'q_jd_c2')
  assert.deepEqual(stable(objective('ember', 'pc', 'winner-takes-all', 'S4', c2(s4))), stable(objective('ember', 'pc', 'winner-takes-all', 'S3', c2(s3))))
  const manual = base('ember', 'pc', 'winner-takes-all', 'S4', s4.spawns.find((s) => s.name === 'C1大仓'))
  assert.equal(manual.sourceHubActor, '')
  assert.equal(manual.unresolvedCount, 0)
  assert.equal(manual.side, 'attack')
  assert.equal(manual.areas.length, 14)
  assert.equal(new Set(manual.areas.map((area) => area.id)).size, 14)
  assert.ok(manual.areas.every((area) => /_Out\d+$/.test(area.id)))
  assert.ok(!manual.areas.some((area) => area.id.includes('_Edge')))
  const snapshot = load('src/config/emberPcInfantrySpawnAreas.json')
  const binding = snapshot.bases.find((b) => b.spawnUid === 'spawn_wta_pc_ember_s4_attack_11nyjhx')
  assert.equal(binding.sourceAnchorActor, 'Objective_PointC1')
  assert.deepEqual(binding.sourceFields, ['Camp0OuterSpawnAreas', 'Camp1OuterSpawnAreas'])
  assert.equal(binding.mappingSelection.selectedBy, 'user')
  assert.equal(binding.mappingSelection.effectiveSpawnSelectionVerified, false)
  const c1 = objective('ember', 'pc', 'winner-takes-all', 'S3', s3.points.find((p) => p.icon === 'q_jd_c1'))
  assert.deepEqual(manual.areas, c1.groups.filter((group) => group.kind === 'outer').flatMap((group) => group.areas))
  assert.ok(c1.groups.filter((group) => group.kind === 'inner').every((g) => g.areas.every((a) => !manual.areas.some((eventArea) => eventArea.id === a.id))))
  for (const spawn of s4.spawns.filter((s) => s.name !== 'C1大仓')) {
    assert.equal(base('ember', 'pc', 'winner-takes-all', 'S4', spawn).unresolvedCount, 0)
    assert.equal(base('ember', 'pc', 'winner-takes-all', 'S3', spawn), null)
  }
})

test('Stormeye vehicle-only hubs stay infantry-disabled and two dangling outer references remain unresolved', () => {
  const stages = runtime('stormeye').stages
  let disabled = 0
  for (const stage of stages) for (const spawn of stage.spawns) {
    const entry = base('stormeye', 'pc', 'winner-takes-all', stage.id, spawn)
    if (entry.footSoldierDisabled) { disabled++; assert.deepEqual(entry.areas, []) }
    assert.equal(entry.unresolvedCount, 0)
  }
  assert.equal(disabled, 2)
  const data = load('src/config/stormeyePcInfantrySpawnAreas.json')
  assert.deepEqual(data.objectives.flatMap((o) => o.groups.flatMap((g) => g.unresolvedAreaIds)), ['Spawn_S4D1_Defend_Out3', 'Spawn_S5E1_Defend_Out6'])
})
