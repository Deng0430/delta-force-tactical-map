const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')
const { createConfigLoader } = require('./lib/load-config-module.cjs')
const root = path.resolve(__dirname, '..')
const load = createConfigLoader(root)
const assets = load('src/config/vehicleLegendAssets.ts')
const { DEPLOY_VEHICLE_CATALOG } = load('src/config/deployVehicles.ts')
const { CUSTOM_VEHICLES } = load('src/config/customVehicles.ts')
const file = (url) => fs.readFileSync(path.join(root, 'public', url))

test('all confirmed vehicle types use packaged transparent HUD PNGs', () => {
  assert.equal(Object.keys(assets.MOBILE_VEHICLE_HUD_SPRITES).length, 15)
  for (const entry of DEPLOY_VEHICLE_CATALOG) {
    if (entry.icon === 'ucb9597') continue // No confirmed attack-boat sprite in the dump.
    assert.match(entry.iconUrl, entry.icon === 'csvp' ? /^\/icons\/vehicles\/pc-hud\// : /^\/icons\/vehicles\/mobile-hud\//, entry.name)
    const png = file(entry.iconUrl)
    assert.equal(png.subarray(1, 4).toString(), 'PNG')
    assert.equal(png[25], 6, 'RGBA channel must be preserved')
    const deployAlias = `/icons/vehicles/deploy/deploy_${entry.icon}.png`
    if (fs.existsSync(path.join(root, 'public', deployAlias))) assert.deepEqual(file(deployAlias), png)
  }
  for (const template of CUSTOM_VEHICLES) {
    if (template.iconKey === 'ucb9597') continue
    assert.match(template.iconUrl, template.iconKey === 'csvp' ? /^\/icons\/vehicles\/pc-hud\// : /^\/icons\/vehicles\/mobile-hud\//, template.name)
  }
})

test('legacy nav/q aliases retain vehicle identity', () => {
  for (const [alias, key] of [['nav_fkc', 'aakfc'], ['nav_zczsj', 'xnzsj'], ['q_cfz', 'cfz'], ['deploy_qxtk', 'qxtk']]) {
    assert.equal(assets.vehicleLegendAssetUrl(alias), assets.vehicleLegendAssetUrl(key))
  }
  assert.notEqual(assets.vehicleLegendAssetUrl('qxtk'), assets.vehicleLegendAssetUrl('m1a4zztk'))
  assert.equal(assets.vehicleLegendAssetUrl('unknown'), undefined)
  assert.deepEqual(file('/icons/vehicles/legend/主战坦克.png'), file(assets.vehicleLegendAssetUrl('m1a4zztk')))
  for (const key of ['cfz', 'orvtjc', 'sxzjc', 'tjzsj', 'zczsj']) {
    assert.deepEqual(file(`/icons/map-props/q_${key}.png`), file(assets.vehicleLegendAssetUrl(`q_${key}`)))
  }
})

test('user-confirmed scout helicopter and tactical car use 0111 and 0109', () => {
  assert.equal(assets.MOBILE_VEHICLE_HUD_SPRITES.xnzsj, '0111')
  assert.equal(assets.MOBILE_VEHICLE_HUD_SPRITES.losvjpc, '0109')
  assert.equal(assets.vehicleLegendAssetUrl('nav_zczsj'), '/icons/vehicles/mobile-hud/HUD_Screen_Icon_0111.png')
  assert.equal(assets.vehicleLegendAssetUrl('losvjpc'), '/icons/vehicles/mobile-hud/HUD_Screen_Icon_0109.png')
  assert.deepEqual(file('/icons/vehicles/deploy/deploy_losvjpc.png'), file(assets.vehicleLegendAssetUrl('losvjpc')))
  assert.deepEqual(file('/icons/vehicles/legend/nav_zczsj.png'), file(assets.vehicleLegendAssetUrl('xnzsj')))
  assert.equal(assets.MOBILE_VEHICLE_HUD_SPRITES.ymfg, '0117')
})

test('user-selected CSVP icon uses native PC 0118 bytes and is available in the ground-vehicle library', () => {
  const url = '/icons/vehicles/pc-hud/HUD_Screen_Icon_0118.png'
  assert.equal(assets.PC_VEHICLE_HUD_SPRITES.csvp, '0118')
  for (const alias of ['csvp', 'nav_csvp', 'q_csvp', 'deploy_csvp']) assert.equal(assets.vehicleLegendAssetUrl(alias), url)
  const template = CUSTOM_VEHICLES.find((vehicle) => vehicle.iconKey === 'csvp')
  assert.equal(template.name, '山猫全地形车')
  assert.equal(template.group, '地面载具')
  assert.equal(template.iconUrl, url)
  const { vehiclesForMap } = load('src/config/customVehicles.ts')
  for (const map of load('src/config/maps.ts').MAPS) assert.ok(vehiclesForMap(map.id).some((vehicle) => vehicle.iconKey === 'csvp'), map.id)
  const source = path.join(root, 'source/PC提取资源/山猫图标核对_2026-11-13/HUD_Screen_Icon_0118.png')
  if (fs.existsSync(source)) assert.deepEqual(file(url), fs.readFileSync(source), 'package original transparent pixels without resizing')
})

test('existing Stormeye refresh configurations replace the placeholder without changing positions or conditions', () => {
  const oldStorage = globalThis.localStorage
  globalThis.localStorage = { getItem: () => null, setItem: () => {} }
  try {
    const api = load('src/utils/modeConfigStorage.ts')
    const store = api.loadModeConfigStore()
    const map = store.profiles.find((profile) => profile.id === 'winner-takes-all').platformMaps.pc.stormeye
    const rules = map.vehicleRefreshRules.filter((rule) => rule.vehicle.icon === 'csvp')
    assert.equal(rules.length, 3)
    for (const rule of rules) rule.vehicle.iconUrl = '/icons/vehicles/legend/generic-ground-vehicle.svg'
    const before = JSON.parse(JSON.stringify(map))
    const result = api.normalizeModeConfigStore(store).profiles.find((profile) => profile.id === 'winner-takes-all').platformMaps.pc.stormeye
    for (const rule of result.vehicleRefreshRules.filter((rule) => rule.vehicle.icon === 'csvp')) {
      assert.equal(rule.vehicle.iconUrl, assets.vehicleLegendAssetUrl('csvp'))
      const prior = before.vehicleRefreshRules.find((entry) => entry.uid === rule.uid)
      assert.deepEqual(JSON.parse(JSON.stringify({ ...rule, vehicle: { ...rule.vehicle, iconUrl: prior.vehicle.iconUrl } })), prior)
    }
    assert.deepEqual(result.vehicleRefreshPoints, before.vehicleRefreshPoints)
  } finally {
    if (oldStorage === undefined) delete globalThis.localStorage
    else globalThis.localStorage = oldStorage
  }
})

test('both modes and game-data platforms resolve current deployment/refresh icons', () => {
  const previousStorage = globalThis.localStorage
  globalThis.localStorage = { getItem: () => null, setItem: () => {} }
  try {
    const storage = load('src/utils/modeConfigStorage.ts')
    const store = storage.loadModeConfigStore()
    const { MAPS } = load('src/config/maps.ts')
    let checked = 0
    for (const profile of store.profiles.filter((profile) => ['attack-defense', 'winner-takes-all'].includes(profile.id))) {
      for (const platform of ['pc', 'mobile']) {
        for (const map of MAPS) {
          const result = storage.buildRuntimeModeData(profile, platform, map.id)
          assert.deepEqual(result.issues, [])
          for (const stage of Object.values(result.map.deploy)) {
            for (const vehicle of [...stage.attack, ...stage.defense]) {
              const icon = assets.vehicleLegendAssetUrl(vehicle.icon)
              if (icon) assert.equal(vehicle.iconUrl, icon, `${platform}/${map.id}/${vehicle.name}`)
            }
          }
          for (const rule of result.map.vehicleRefreshRules) {
            const icon = assets.vehicleLegendAssetUrl(rule.vehicle.icon)
            if (icon) assert.equal(rule.vehicle.iconUrl, icon)
          }
          checked++
        }
      }
    }
    assert.equal(checked, MAPS.length * 4)
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage
    else globalThis.localStorage = previousStorage
  }
})

test('old placed vehicles reload with current icons without changing tactical fields', () => {
  // Execute the actual normalizer in isolation; storage's unrelated geo import needs a browser.
  const source = ts.createSourceFile('storage.ts', fs.readFileSync(path.join(root, 'src/utils/storage.ts'), 'utf8'), ts.ScriptTarget.Latest, true)
  const normalizer = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'normalizeVehicles')
  assert.ok(normalizer)
  const compiled = ts.transpileModule(`${normalizer.getText(source)}\nmodule.exports = normalizeVehicles`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const sandbox = { module: { exports: {} }, DEPLOY_VEHICLE_CATALOG, CUSTOM_VEHICLES }
  vm.runInNewContext(compiled, sandbox)
  const normalizeVehicles = sandbox.module.exports
  const original = ['LAV-AA防空车', 'LAV-G1步战车', '主战坦克', '轻型坦克', 'CSV-35运输直升机', '山猫全地形车'].map((name, i) => ({
    uid: `old-${i}`, name, category: 'tank', side: 'attack', team: 'B', badge: '车',
    iconUrl: 'data:image/png;base64,old', lat: -100, lng: 80, stageId: 'S2', rotation: 45,
  }))
  // CSV-35 is the historical custom-library name for the existing Osprey vehicle.
  const keys = ['aakfc', 'g1bzc', 'm1a4zztk', 'qxtk', 'ymfg', 'csvp']
  const result = normalizeVehicles({ attack: original, defense: [] }).attack
  for (let i = 0; i < result.length; i++) {
    assert.equal(result[i].iconUrl, assets.vehicleLegendAssetUrl(keys[i]), original[i].name)
    assert.deepEqual({ ...result[i], iconUrl: original[i].iconUrl }, original[i])
  }
})
