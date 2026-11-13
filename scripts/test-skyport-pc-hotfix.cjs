const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const test = require('node:test')
const { createConfigLoader } = require('./lib/load-config-module.cjs')
const root = path.resolve(__dirname, '..')
const load = createConfigLoader(root)
const previousStorage = globalThis.localStorage
const storage = new Map()
let writes = 0
globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); writes++ } }
test.after(() => { if (previousStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = previousStorage })
const { loadModeConfigStore, normalizeModeConfigStore, buildRuntimeModeData, buildOfficialModeData,
  importModeConfigData, syncModeMapFromAttackDefense, MODE_CONFIG_STORAGE_KEY } = load('src/utils/modeConfigStorage.ts')
const { evaluateVehicleRefreshRule } = load('src/utils/vehicleRefreshRuntime.ts')
const legacy = load('src/config/skyportOfficial.json')
const snapshot = load('src/config/skyportPcHotfixData.json')
const { SKYPORT_PC_STAGE_FOUR_NOTE } = load('src/config/skyportPcHotfix.ts')
const clone = (value) => JSON.parse(JSON.stringify(value))
const profile = (store, id) => store.profiles.find((p) => p.id === id)
const map = (store, id = 'attack-defense', platform = 'pc') => profile(store, id).platformMaps[platform].skyport
const fresh = () => { storage.clear(); return loadModeConfigStore() }
const runtime = (store, id = 'attack-defense', platform = 'pc') => buildRuntimeModeData(profile(store, id), platform, 'skyport')
function oldStore() {
  const store = clone(fresh())
  store.version = 47
  for (const id of ['attack-defense', 'winner-takes-all']) {
    const before = syncModeMapFromAttackDefense('skyport', clone(legacy.pc.stages), { skyport: clone(legacy.pc.props) }, { skyport: clone(legacy.pc.deploy) })
    profile(store, id).platformMaps.pc.skyport = before
    profile(store, id).maps = profile(store, id).platformMaps.pc
  }
  return store
}

test('PC ordinary attack/defense shows patch-565 positions and separates post-event C3 into S4', () => {
  const store = fresh(), result = runtime(store)
  assert.equal(store.version, 72)
  assert.deepEqual(result.issues, [])
  assert.deepEqual(result.map.stages.map((s) => s.spawns.length), [4, 5, 6, 4])
  assert.deepEqual(result.map.stages[2].points.map((p) => p.name), ['据点C1', '据点C2'])
  const b = result.map.stages[1]
  assert.deepEqual(b.attackSpawns, [[-131.01196, 141.21781], [-116.64527, 140.25375], [-124.58957, 140.25375]])
  const boats = result.map.deploy.S2.defense.find((v) => v.icon === 'mtt')
  assert.equal(boats.num, 3)
  assert.equal(boats.spawnUid, 'spawn_ad_pc_skyport_s2_defense_179bujk')
  assert.equal(result.map.deploy.S2.attack.find((v) => v.icon === 'sxzjc').spawnUid, 'spawn_ad_pc_skyport_s2_attack_i8ti2y')
  const g1 = result.map.deploy.S3.defense.find((v) => v.icon === 'g1bzc')
  assert.ok(g1)
  assert.equal(g1.cooldownKnown, false)
  assert.ok(!result.map.deploy.S3.defense.some((v) => v.icon === 'zztk'))
  const rule = result.map.vehicleRefreshRules.find((r) => r.objective === 'S2')
  const point = result.map.vehicleRefreshPoints.find((p) => p.uid === rule.refreshPointUid)
  assert.equal(rule.vehicle.icon, 'lstjp')
  assert.deepEqual([point.lat, point.lng], [-112.02618, 165.11853])
  assert.match(String(rule.trigger.value), /剩余兵力低于80%/)
  assert.equal(rule.note, '')
  assert.equal(rule.trigger.type, 'map-event')
})

test('Zipline facilities use the original mobile sprite and limit ruin facilities to S4', () => {
  const result = runtime(fresh()).map
  const props = result.props.filter((p) => p.name === '滑索')
  assert.equal(props.length, 40)
  assert.equal(props.filter((p) => !p.stage).length, 30)
  assert.equal(props.filter((p) => p.stage === 'S4').length, 10)
  assert.ok(props.every((p) => p.icon === 'q_hs'))
  assert.equal(snapshot.sharedZiplineProps.length, 30)
  const icon = fs.readFileSync(path.join(root, 'public/icons/map-props/q_hs.png'))
  assert.equal(icon.readUInt32BE(16), 34)
  assert.equal(icon.readUInt32BE(20), 34)
  assert.equal(crypto.createHash('sha256').update(icon).digest('hex'),
    snapshot.source.ziplineIcon.sha256)
})

test('Commander uses shared replacements with its own verified table and distinct template/reference cooldowns', () => {
  const store = fresh(), ordinary = runtime(store).map, commander = runtime(store, 'winner-takes-all').map
  assert.deepEqual(commander.stages.map((s) => s.spawns), ordinary.stages.map((s) => s.spawns))
  assert.equal(commander.vehicleRefreshRules.length, 3)
  assert.equal(commander.deploy.S3.defense[0].icon, 'g1bzc')
  assert.equal(commander.deploy.S2.defense.find((v) => v.icon === 'mtt').num, 3)
  const tank = commander.deploy.S2.defense.find((v) => v.icon === 'qxtk')
  assert.equal(tank.cd, 150)
  assert.equal(tank.cooldownKnown, false)
  assert.equal(ordinary.deploy.S2.defense.find((v) => v.icon === 'qxtk').cd, 90)
  assert.match(map(store, 'winner-takes-all').notes, /MapID=616/)
  assert.ok(commander.vehicleRefreshRules.every((r) => r.uid.startsWith('skyport_pc_commander_')))
  assert.ok(commander.vehicleRefreshRules.every((r) => !ordinary.vehicleRefreshRules.some((o) => o.trigger.value === r.trigger.value)))
  ordinary.stages[1].spawns[0].lat = -999
  assert.notEqual(commander.stages[1].spawns[0].lat, -999)
})

test('S4 restores only C3 and exact event-hub membership, without inventing activity or refresh rules', () => {
  const evidencePath = path.join(root, snapshot.source.postEventPhase.file)
  const evidence = fs.existsSync(evidencePath) ? JSON.parse(fs.readFileSync(evidencePath, 'utf8')) : null
  const expectedBases = snapshot.attackDefense.stages.find((stage) => stage.id === 'S4').spawns
  const store = fresh()
  for (const mode of ['attack-defense', 'winner-takes-all']) {
    const config = map(store, mode), result = runtime(store, mode)
    const s4 = result.map.stages.find((stage) => stage.id === 'S4')
    assert.deepEqual(s4.points.map((point) => point.name), ['据点C3'])
    assert.deepEqual([s4.points[0].lat, s4.points[0].lng], [-82.77532, 102.83321])
    assert.equal(s4.points[0].capturable.length, 4)
    assert.equal(s4.attackSpawns.length, 2)
    assert.equal(s4.defenseSpawns.length, 2)
    for (const base of expectedBases) {
      const match = s4.spawns.find((spawn) => spawn.uid === base.uid)
      assert.ok(match)
      assert.equal(match.side, base.side) // Both defender hubs serialize raw OwnerCamp=0.
      assert.ok(!config.spawns.some((spawn) => spawn.stageId === 'S3' && spawn.uid === match.uid))
    }
    const objective = config.objectives.find((point) => point.stageId === 'S4')
    const capture = config.zones.find((zone) => zone.uid === objective.captureZoneUid)
    assert.equal(capture.stageId, 'S4')
    assert.equal(capture.objectiveUid, objective.uid)
    assert.equal(capture.verification, 'confirmed')
    assert.equal(config.zones.find((zone) => zone.stageId === 'S4' && zone.role === 'frontline').verification, 'draft')
    assert.deepEqual(s4.attackBaseZone, [])
    assert.deepEqual(s4.defenseBaseZone, [])
    assert.deepEqual(result.map.deploy.S4.attack.map((vehicle) => vehicle.icon), ['sxzjc'])
    assert.deepEqual(result.map.deploy.S4.defense.map((vehicle) => vehicle.icon), ['g1bzc'])
    assert.ok([...result.map.deploy.S4.attack, ...result.map.deploy.S4.defense].every((vehicle) => vehicle.cooldownKnown === false))
    assert.equal(result.map.vehicleRefreshRules.filter((rule) => rule.objective === 'S4').length, 0)
    assert.deepEqual(result.issues, [])
  }
  assert.equal(runtime(store).map.deploy.S4.attack[0].cd, 90)
  assert.equal(runtime(store, 'winner-takes-all').map.deploy.S4.attack[0].cd, 90)
  assert.equal(runtime(store).map.deploy.S4.defense[0].cd, 90)
  assert.equal(runtime(store, 'winner-takes-all').map.deploy.S4.defense[0].cd, 150)
  assert.equal(snapshot.source.postEventPhase.activityBoundariesVerified, false)
  if (evidence) {
    assert.equal(evidence.activity.post_event_boundaries_verified, false)
    for (const base of evidence.bases) assert.ok(expectedBases.some((item) => item.uid.endsWith(base.actor.toLowerCase()) && item.side === base.side))
  }
})

test('v49 adds S4 once while preserving earlier edits, deleted facilities, mobile and custom profiles', () => {
  const old = clone(fresh())
  old.version = 49
  for (const mode of ['attack-defense', 'winner-takes-all']) {
    const current = map(old, mode)
    for (const field of ['stages', 'zones', 'objectives', 'spawns', 'props']) {
      current[field] = current[field].filter((item) => (item.stageId ?? item.id) !== 'S4')
    }
    current.notes = current.notes.split('\n').filter((line) => line !== SKYPORT_PC_STAGE_FOUR_NOTE).join('\n')
    current.spawns[0].lat = -222
    current.zones[0].points[0] = [-73, 99]
    current.props = current.props.filter((prop) => prop.name !== '滑索')
    current.spawns.push({ ...clone(current.spawns[0]), uid: 'custom_s4_regression', name: '自定义基地' })
  }
  const custom = { ...clone(profile(old, 'attack-defense')), id: 'custom-mode', name: '自定义模式' }
  old.profiles.push(custom)
  const saved = clone(old)
  const migrated = normalizeModeConfigStore(old)
  for (const mode of ['attack-defense', 'winner-takes-all']) {
    const updated = map(migrated, mode), before = map(saved, mode)
    for (const field of ['stages', 'zones', 'objectives', 'spawns', 'props']) {
      assert.deepEqual(clone(updated[field].filter((item) => (item.stageId ?? item.id) !== 'S4')), before[field])
    }
    assert.deepEqual(clone(map(migrated, mode, 'mobile')), map(saved, mode, 'mobile'))
    assert.equal(updated.stages.filter((stage) => stage.id === 'S4').length, 1)
    assert.equal(updated.props.filter((prop) => prop.stageId === 'S4').length, 10)
    updated.spawns.find((spawn) => spawn.stageId === 'S4').lat = -234
    updated.props = updated.props.filter((prop) => prop.stageId !== 'S4')
    updated.objectives = updated.objectives.filter((point) => point.stageId !== 'S4')
  }
  assert.deepEqual(clone(profile(migrated, 'custom-mode')), custom)
  assert.deepEqual(clone(normalizeModeConfigStore(migrated)), clone(migrated))
  assert.deepEqual(clone(old), saved)
})

test('v47 migration updates known UIDs, preserves custom entities, user names, mobile and unrelated maps', () => {
  const store = oldStore(), current = map(store)
  const attackName = '按计划重命名的基地'
  current.spawns.find((s) => s.uid === 'spawn_ad_pc_skyport_s2_attack_104zqqq').name = attackName
  current.spawns[0].lat = -177
  current.zones.find((z) => z.role === 'frontline').points[0] = [-50, 80]
  current.spawns.push({ ...clone(current.spawns[0]), uid: 'custom_same_name', name: 'GTI3号阵地', lat: -88, lng: 200 })
  current.props.push({ uid: 'custom_prop', stageId: '*', name: '固定机枪', icon: 'q_gdjq', lat: -70, lng: 199, verification: 'draft' })
  store.profiles.push({ ...clone(profile(store, 'attack-defense')), id: 'custom-mode', name: '自定义' })
  const saved = clone(store), mobile = clone(profile(store, 'attack-defense').platformMaps.mobile)
  const migrated = normalizeModeConfigStore(store)
  assert.deepEqual(clone(store), saved)
  assert.equal(map(migrated).spawns.find((s) => s.uid === 'spawn_ad_pc_skyport_s2_attack_104zqqq').name, attackName)
  assert.equal(map(migrated).spawns[0].lat, -177)
  assert.deepEqual(map(migrated).zones.find((z) => z.role === 'frontline').points[0], [-50, 80])
  assert.deepEqual(map(migrated).spawns.find((s) => s.uid === 'custom_same_name'), current.spawns.find((s) => s.uid === 'custom_same_name'))
  assert.ok(map(migrated).props.some((p) => p.uid === 'custom_prop'))
  assert.deepEqual(clone(profile(migrated, 'attack-defense').platformMaps.mobile), mobile)
  assert.deepEqual(clone(profile(migrated, 'custom-mode')), saved.profiles.find((p) => p.id === 'custom-mode'))
  assert.deepEqual(clone(profile(migrated, 'attack-defense').platformMaps.pc.ascent), profile(saved, 'attack-defense').platformMaps.pc.ascent)
  assert.deepEqual(runtime(migrated).issues, [])
  assert.deepEqual(normalizeModeConfigStore(migrated), migrated)
})

test('Migration is persisted once and current-version edits are not re-applied on subsequent loads', () => {
  storage.set(MODE_CONFIG_STORAGE_KEY, JSON.stringify(oldStore()))
  const before = writes
  const migrated = loadModeConfigStore()
  assert.equal(writes, before + 1)
  const spawn = map(migrated).spawns.find((s) => s.uid === 'spawn_ad_pc_skyport_s2_attack_104zqqq')
  spawn.lat = -123
  const g1 = map(migrated).spawns.flatMap((s) => s.deployVehicles).find((v) => v.icon === 'g1bzc')
  Object.assign(g1, { cd: 75, cooldownKnown: true })
  storage.set(MODE_CONFIG_STORAGE_KEY, JSON.stringify(migrated))
  const loaded = loadModeConfigStore()
  assert.equal(writes, before + 1)
  assert.equal(map(loaded).spawns.find((s) => s.uid === spawn.uid).lat, -123)
  assert.equal(map(loaded).spawns.flatMap((s) => s.deployVehicles).find((v) => v.icon === 'g1bzc').cd, 75)
})

test('v48 -> v49 updates commander records without moving edited bases, restoring props or changing ordinary mode', () => {
  const old = clone(fresh())
  old.version = 48
  const commander = map(old, 'winner-takes-all')
  const moved = commander.spawns.find((s) => s.uid === 'spawn_ad_pc_skyport_s2_attack_104zqqq')
  moved.lat = -222
  commander.props = commander.props.filter((p) => p.name !== '滑索')
  commander.vehicleRefreshPoints = []
  commander.vehicleRefreshRules = []
  commander.spawns.find((s) => s.uid === 'spawn_ad_pc_skyport_s2_defense_179bujk').deployVehicles = []
  const down = commander.spawns.find((s) => s.uid === 'spawn_ad_pc_skyport_s2_defense_1hf3ly1')
  down.deployVehicles = [clone(snapshot.attackDefense.deploy.S2.defense.find((v) => v.icon === 'mtt'))]
  down.deployVehicles[0].num = 1
  const beforeAttack = clone(map(old))
  const result = normalizeModeConfigStore(old)
  const updated = map(result, 'winner-takes-all')
  assert.equal(updated.spawns.find((s) => s.uid === moved.uid).lat, -222)
  assert.equal(updated.props.filter((p) => p.name === '滑索' && p.stageId === '*').length, 0)
  assert.equal(updated.props.filter((p) => p.name === '滑索' && p.stageId === 'S4').length, 10)
  assert.equal(updated.vehicleRefreshRules.length, 3)
  assert.equal(runtime(result, 'winner-takes-all').map.deploy.S2.defense.find((v) => v.icon === 'mtt').num, 3)
  assert.deepEqual(clone(map(result)), beforeAttack)
  assert.deepEqual(normalizeModeConfigStore(result), result)
})

test('Export/import retains unknown cooldown semantics and all new refresh point associations', () => {
  const store = fresh(), exported = buildOfficialModeData(profile(store, 'attack-defense'), 'pc', 'skyport')
  const imported = importModeConfigData(store, clone(exported), 'pc')
  const after = buildOfficialModeData(profile(imported.store, 'attack-defense'), 'pc', 'skyport')
  assert.deepEqual(after.maps.skyport, exported.maps.skyport)
  assert.equal(after.maps.skyport.deploy.S3.defense[0].cooldownKnown, false)
})

test('Inherited 80% threshold remains a stage-specific percentage confirmation, not 80 absolute tickets', () => {
  const result = runtime(fresh()).map
  const rule = result.vehicleRefreshRules.find((r) => r.objective === 'S2')
  const context = { tickets: { attack: 0, defense: null }, matchTimeSeconds: null, objectiveCountdowns: {}, objectiveStates: {}, mapEvents: [] }
  const evaluation = evaluateVehicleRefreshRule(rule, context, { stages: result.stages, currentStageIndex: 1 })
  assert.equal(evaluation.eligible, false)
  assert.match(evaluation.reason, /80%/)
  const first = result.vehicleRefreshRules.find((r) => r.objective === 'S1')
  const third = result.vehicleRefreshRules.find((r) => r.objective === 'S3')
  context.mapEvents.push(first.trigger.value)
  assert.equal(evaluateVehicleRefreshRule(third, context, { stages: result.stages, currentStageIndex: 2 }).eligible, false)
  assert.equal(evaluateVehicleRefreshRule(rule, context, { stages: result.stages, currentStageIndex: 1 }).eligible, false)
  context.mapEvents.push(rule.trigger.value)
  assert.equal(evaluateVehicleRefreshRule(rule, context, { stages: result.stages, currentStageIndex: 1 }).eligible, true)
})

test('v50 adopts 80% for both PC S2 FSV rules while preserving coordinates, notes, custom rules and mobile', () => {
  const old = clone(fresh())
  old.version = 50
  for (const mode of ['attack-defense', 'winner-takes-all']) {
    const current = map(old, mode)
    const rule = current.vehicleRefreshRules.find((item) => item.objective === 'S2')
    rule.trigger.value = `${mode} · S2 · 低兵力刷新（阈值待核实）`
    rule.note = '我的备注\n按用户要求，沿用原 S2 ORV 的80%兵力条件。'
    current.vehicleRefreshPoints.find((point) => point.uid === rule.refreshPointUid).lat = -222
    current.vehicleRefreshRules.push({ ...clone(rule), uid: 'custom_s2_fsv' })
  }
  old.profiles.push({ ...clone(profile(old, 'attack-defense')), id: 'custom-mode', name: '自定义' })
  const before = clone(old)
  const migrated = normalizeModeConfigStore(old)
  assert.equal(migrated.version, 72)
  for (const mode of ['attack-defense', 'winner-takes-all']) {
    const updated = map(migrated, mode)
    const rule = updated.vehicleRefreshRules.find((item) => item.objective === 'S2' && item.uid !== 'custom_s2_fsv')
    assert.match(rule.trigger.value, /S2 · 进攻方剩余兵力低于80%/)
    assert.equal(rule.note, '我的备注')
    const prior = clone(map(before, mode))
    const savedRule = prior.vehicleRefreshRules.find((item) => item.uid === rule.uid)
    savedRule.trigger = clone(rule.trigger)
    savedRule.note = rule.note
    prior.updatedAt = updated.updatedAt
    assert.deepEqual(clone(updated), prior)
    assert.deepEqual(clone(map(migrated, mode, 'mobile')), map(before, mode, 'mobile'))
    rule.trigger.value = '我之后修改的条件'
  }
  assert.deepEqual(clone(profile(migrated, 'custom-mode')), profile(before, 'custom-mode'))
  assert.deepEqual(clone(normalizeModeConfigStore(migrated)), clone(migrated))
  assert.deepEqual(clone(old), before)
})

test('v51 does not recreate deleted S2 rules or repurpose a changed vehicle identity', () => {
  const old = clone(fresh())
  old.version = 50
  map(old).vehicleRefreshRules = map(old).vehicleRefreshRules.filter((rule) => rule.objective !== 'S2')
  const repurposed = map(old, 'winner-takes-all').vehicleRefreshRules.find((rule) => rule.objective === 'S2')
  repurposed.vehicle = clone(map(old, 'winner-takes-all').vehicleRefreshRules.find((rule) => rule.objective === 'S3').vehicle)
  repurposed.trigger.value = '我改成了另一辆车的规则'
  const before = clone(old)
  const migrated = normalizeModeConfigStore(old)
  for (const mode of ['attack-defense', 'winner-takes-all']) assert.deepEqual(clone(map(migrated, mode)), map(before, mode))
})
