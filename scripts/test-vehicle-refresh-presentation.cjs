// 载具说明只走用户备注；来源元数据不再生成单独的技术说明区。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { createConfigLoader } = require('./lib/load-config-module.cjs')

const load = createConfigLoader()
const read = (file) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8')
function component(file, dependencies) {
  const module = { exports: {} }
  const code = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: (name) => dependencies[name] ?? require(name),
  }, { filename: file })
  return module.exports.default
}

const passChildren = ({ children }) => children
const platform = { kind: 'web' }
const VehicleRefreshLayer = component('src/components/VehicleRefreshLayer.tsx', {
  'react-leaflet': { Marker: passChildren, Popup: passChildren, Tooltip: passChildren },
  leaflet: { divIcon: (options) => options },
  '../platform': { platform },
  '../utils/vehicleRefreshRules': load('src/utils/vehicleRefreshRules.ts'),
  '../utils/vehicleRefreshRuntime': load('src/utils/vehicleRefreshRuntime.ts'),
})
const DeployBar = component('src/components/DeployBar.tsx', {
  '../config/deployVehicles': load('src/config/deployVehicles.ts'),
  '../utils/deployVehicleCounts': load('src/utils/deployVehicleCounts.ts'),
})
const MapPropsLayer = component('src/components/MapPropsLayer.tsx', {
  'react-leaflet': { Marker: ({ children, icon }) => React.createElement('i', { 'data-map-prop': true, 'data-icon': icon.html }, children), Tooltip: passChildren,
    Polyline: () => React.createElement('b', { 'data-zipline-connection': true }) },
  leaflet: { divIcon: (options) => options },
  '../config/pointsStages': { MAP_PROPS: {} },
  '../config/points': { POINT_ICON_BASE: '/icons/map-props' },
  '../config/mapPropTheme': load('src/config/mapPropTheme.ts'),
  '../utils/mapZiplines': load('src/utils/mapZiplines.ts'),
  '../utils/airSupply': load('src/utils/airSupply.ts'),
  '../platform': { platform },
})
test('Post-event facilities appear only in S4 while shared facilities remain visible in every phase', () => {
  const propsOverride = load('src/config/skyportPcHotfixData.json').attackDefense.props.filter((prop) => prop.name === '滑索')
  const render = (stageId) => renderToStaticMarkup(React.createElement(MapPropsLayer, {
    mapId: 'skyport', visible: true, propVis: {}, interactive: true, propsOverride, stageId,
  }))
  // Each of the two span ziplines also has a central icon in addition to its endpoints.
  assert.equal((render('S3').match(/data-map-prop=/g) ?? []).length, 19)
  assert.equal((render('S4').match(/data-map-prop=/g) ?? []).length, 25)
  assert.equal((render('S1').match(/data-map-prop=/g) ?? []).length, 19)
  assert.equal((render('S3').match(/data-zipline-connection=/g) ?? []).length, 2)
  assert.equal((render('S4').match(/⊥/g) ?? []).length, 19)
  assert.doesNotMatch(render('S3'), /滑索 · S4/)
})
const ember = load('src/config/winnerTakesAllOfficial.json').maps.ember
const noop = () => {}
const rule = { ...structuredClone(ember.vehicleRefreshRules[0]), note: '' }
const base = {
  points: structuredClone(ember.vehicleRefreshPoints), rules: [rule],
  stages: [{ id: 'S1', points: [{ name: 'A' }] }, { id: 'S2', points: [{ name: 'B1' }] }],
  currentStageIndex: 0, usedRuleIds: [], deployedRuleIds: [], visible: true, interactive: true,
  context: { tickets: { attack: null, defense: null }, matchTimeSeconds: null, objectiveStates: {}, objectiveCountdowns: {}, mapEvents: [] },
  onDeploy: noop, onRestore: noop, onLocateVehicle: noop,
}
const renderRefresh = (props = {}) => renderToStaticMarkup(React.createElement(VehicleRefreshLayer, { ...base, ...props }))
const assertNoTechnicalBlock = (html) => {
  assert.doesNotMatch(html, /<details|<summary|vehicle-spawner-details|本配置(?:非)?单次使用|总次数待核实|SelfInfo|Template4|Template5/)
}

for (const kind of ['web', 'android']) {
  test(`${kind}: refresh card preserves notes and conditions without exposing source metadata`, () => {
    platform.kind = kind
    const rules = [{ ...rule, note: '桥边刷新\n等待队友 <集合>' }]
    const original = structuredClone(rules)
    const html = renderRefresh({ rules })
    assertNoTechnicalBlock(html)
    assert.match(html, /<p class="note">桥边刷新\n等待队友 &lt;集合&gt;<\/p>/)
    assert.match(html, /130 兵力/)
    assert.match(html, /尚未设置进攻方兵力/)
    assert.match(html, /忽略条件部署/)
    assert.deepEqual(rules, original)
  })
}

test('empty notes leave no extra note block; source details are not copied into notes', () => {
  const html = renderRefresh()
  assertNoTechnicalBlock(html)
  assert.doesNotMatch(html, /class="note"/)
  assert.equal(rule.note, '')
  assert.ok(rule.clientSpawner)
})

test('deployment availability, restore actions and stage filtering remain unchanged', () => {
  const eligible = renderRefresh({ context: { ...base.context, tickets: { attack: 100, defense: null } } })
  assert.match(eligible, /部署为载具兵棋/)
  assert.doesNotMatch(eligible, /忽略条件部署/)
  const used = renderRefresh({ usedRuleIds: [rule.uid], deployedRuleIds: [rule.uid] })
  assert.match(used, /本轮已部署/)
  assert.match(used, /定位兵棋/)
  assert.match(used, /复原刷新规则/)
  assert.equal(renderRefresh({ currentStageIndex: 1 }), '')
  assert.equal(renderRefresh({ visible: false }), '')
})

test('respawn deployment cards also remove the technical block without hiding CD uncertainty or notes', () => {
  const vehicle = { ...structuredClone(ember.deploy.S1.attack[0]), spawnUid: 'test-spawn', note: '可由队友部署' }
  const html = renderToStaticMarkup(React.createElement(DeployBar, {
    mapId: 'ember', view: 'attack',
    target: { uid: 'test-spawn', stageId: 'S1', side: 'attack', pos: [0, 0], baseName: '测试复活点' },
    deployByStage: { S1: { attack: [vehicle], defense: [] } },
    onClose: noop, onDeploy: noop,
  }))
  assertNoTechnicalBlock(html)
  assert.doesNotMatch(html, /has-spawner-info/)
  assert.match(html, /CD待核实/)
  assert.match(html, /可由队友部署/)
  assert.match(html, new RegExp(`>可部署:${vehicle.num}<`))
  assert.doesNotMatch(html, /同时可部署/)
  assert.match(html, /class="deploy-card-btn"/)
})

test('all 13 Flashpoint deployment cards show existing numeric CD despite verified-template provenance', () => {
  const snapshot = load('src/config/flashpointPcWinnerData.json')
  for (const d of snapshot.deployments) {
    const vehicle = { ...structuredClone(d.vehicle), note: '保留部署说明' }
    const render = (v) => renderToStaticMarkup(React.createElement(DeployBar, {
      mapId: 'flashpoint', view: 'attack',
      target: { uid: d.spawnUid, stageId: d.stageId, side: d.side, pos: [0, 0], baseName: '测试复活点' },
      deployByStage: { [d.stageId]: { attack: d.side === 'attack' ? [v] : [], defense: d.side === 'defense' ? [v] : [] } },
      onClose: noop, onDeploy: noop,
    }))
    const html = render(vehicle)
    assert.match(html, new RegExp(`>${d.legacyVehicle.cd}s<`))
    assert.doesNotMatch(html, /CD待核实|公共模板尚未解析/)
    assert.match(html, /保留部署说明/)
    assertNoTechnicalBlock(html)
    assert.match(render({ ...vehicle, cooldownKnown: false }), /CD待核实/)
  }
})

test('editor retains the existing note field and note display, without a second source summary', () => {
  const editor = read('src/components/ModeConfigEditor.tsx')
  assert.doesNotMatch(editor, /VehicleSpawnerDetails|vehicleSpawnerSummary|vehicleSpawnerDetails/)
  assert.match(editor, /singleVehicleRule\.note/)
  assert.match(editor, /rule\.note \?/)
  assert.match(read('src/index.css'), /section > p\.note \{[^}]*white-space: pre-wrap;[^}]*overflow-wrap: anywhere;/)
})
