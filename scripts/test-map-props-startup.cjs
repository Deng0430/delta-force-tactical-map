const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')
const app = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8')
const source = ts.createSourceFile('App.tsx', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const declarations = new Map()
function visit(node) {
  if (ts.isVariableDeclaration(node)) declarations.set(node.name.getText(source), node)
  ts.forEachChild(node, visit)
}
visit(source)
const uiDeclaration = declarations.get('[ui, setUi]')
const initialize = uiDeclaration.initializer.arguments[0]
assert.ok(ts.isArrowFunction(initialize), 'UI remains lazily initialized, not reset by an effect')
const initialObject = initialize.body.expression
const selection = initialObject.properties.filter((node) => ['layers', 'propVis', 'sections'].includes(node.name?.getText(source)))
const defaults = declarations.get('DEFAULT_PROP_VIS').initializer.getText(source)
const code = ts.transpileModule(`const DEFAULT_PROP_VIS = ${defaults}; const initial = ({${selection.map((node) => node.getText(source)).join(',')}}); initial;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText
const plain = (value) => JSON.parse(JSON.stringify(value))
const saved = { ui: {
  layers: { props: false, zones: false, spawns: false, vehicleRefresh: false },
  propVis: { 固定防空炮: false, 火神炮: false, 滑索: false, 自定义类型: false },
  sections: { layers: false, props: false, points: false, vehicles: false, wargame: true, vehGroups: { 地面载具: false } },
} }
function startup(persisted = saved, overrides = {}) {
  return vm.runInNewContext(code, {
    persisted, cinematicLayoutPreset: null, isCinematicDemoFrame: false, isCinematicMobileFrame: false,
    isCinematicObjectiveStates: false, isCinematicRefreshSidebar: false, ...overrides,
  })
}
test('normal startup shows map props and every type even when last session turned them off', () => {
  const before = structuredClone(saved)
  const ui = startup()
  assert.equal(ui.layers.props, true)
  for (const name of ['载具补给站', '空中载具补给站', '固定防空炮', '火神炮', '滑索', '自定义类型']) {
    assert.equal(ui.propVis[name] ?? true, true)
  }
  assert.deepEqual(saved, before)
  assert.equal(startup(null).layers.props, true)
})
test('other layer choices and sidebar folding still follow saved preferences', () => {
  const ui = startup()
  for (const key of ['zones', 'spawns', 'vehicleRefresh']) assert.equal(ui.layers[key], false)
  assert.deepEqual(plain(ui.sections), saved.ui.sections)
})
test('demo layout overrides and saved demo type preferences remain unchanged', () => {
  assert.equal(startup(saved, { isCinematicDemoFrame: true }).layers.props, false)
  assert.equal(startup(null, { isCinematicDemoFrame: true }).layers.props, true)
  assert.equal(startup(saved, { isCinematicDemoFrame: true, cinematicLayoutPreset: 'backdrop' }).layers.props, false)
  assert.equal(startup(saved, { isCinematicDemoFrame: true, isCinematicMobileFrame: true }).layers.props, false)
  assert.equal(startup(saved, { isCinematicDemoFrame: true }).propVis.固定防空炮, false)
})
test('user can still turn map props off after startup; only a new startup turns them on again', () => {
  let ui = startup()
  const handler = declarations.get('handleLayerChange').initializer.arguments[0].getText(source)
  const handlerCode = ts.transpileModule(`const DEFAULT_PROP_VIS = ${defaults}; const handle = ${handler}; handle;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  const handle = vm.runInNewContext(handlerCode, { setUi: (update) => { ui = update(ui) } })
  handle('props', false)
  assert.equal(ui.layers.props, false)
  assert.ok(Object.values(ui.propVis).every((value) => value === false))
  assert.equal(startup({ ui }).layers.props, true)
  assert.equal(startup({ ui }).propVis.固定防空炮, true)
})
