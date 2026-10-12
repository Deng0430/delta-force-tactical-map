// 路线快捷入口、直接选队及浮层边界：node --test scripts/test-route-quick-actions.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')
const { renderToStaticMarkup } = require('react-dom/server')

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
function run(source, globals = {}, dependencies = {}) {
  const module = { exports: {} }
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: (name) => dependencies[name] ?? require(name),
    ...globals,
  })
  return module.exports
}
const { floatingPanelPosition } = run(read('src/utils/floatingPanelPosition.ts'))
const bounds = { left: 4, top: 4, right: 1276, bottom: 716 }
const plain = (value) => JSON.parse(JSON.stringify(value))

test('选队面板按真实尺寸优先在入口下方展开', () => {
  assert.deepEqual(plain(floatingPanelPosition({ left: 561, top: 376, right: 615, bottom: 402 }, 238, 215, bounds)), { left: 561, top: 408 })
})
test('靠右/靠下入口的面板翻到上方并保留四边外距', () => {
  assert.deepEqual(plain(floatingPanelPosition({ left: 1230, top: 650, right: 1270, bottom: 676 }, 238, 215, bounds)), { left: 1038, top: 429 })
})
test('横屏窄视口和安全区约束不因入口出屏而失效', () => {
  const safeBounds = { left: 24, top: 4, right: 812, bottom: 356 }
  const position = floatingPanelPosition({ left: -60, top: 20, right: -6, bottom: 46 }, 238, 270, safeBounds)
  assert.equal(position.left, 24)
  assert.equal(position.top, 52)
  const tall = floatingPanelPosition({ left: 780, top: 100, right: 834, bottom: 126 }, 238, 352, safeBounds)
  assert.equal(tall.left, 574)
  assert.equal(tall.top, 4)
})

function button() {
  const listeners = new Map()
  return {
    listeners,
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name) },
  }
}
function pickerFixture(interactive = true) {
  const buttons = [button(), button()]
  const effects = []
  const { useUnitTeamPicker } = run(read('src/components/useUnitTeamPicker.ts'), {}, {
    react: { useRef: (current) => ({ current }), useEffect: (callback) => effects.push(callback) },
  })
  let opened = 0
  const markerRef = { current: { getElement: () => ({ querySelectorAll: () => buttons }) } }
  useUnitTeamPicker(markerRef, {}, interactive, () => { opened++ })
  const cleanup = effects[0]()
  return { buttons, cleanup, opened: () => opened }
}
test('队标和新队名按钮均直接打开同一菜单，点击不会穿透地图', () => {
  const f = pickerFixture()
  let stopped = 0
  let prevented = 0
  const event = { stopPropagation: () => stopped++, preventDefault: () => prevented++ }
  f.buttons.forEach((item) => item.listeners.get('click')(event))
  assert.equal(f.opened(), 2)
  assert.equal(stopped, 2)
  assert.equal(prevented, 2)
  f.cleanup()
  assert.ok(f.buttons.every((item) => item.listeners.size === 0))
})
test('入口按下阻止兵棋拖动但保留按钮焦点；绘制模式不注册监听', () => {
  const f = pickerFixture()
  let stopped = 0
  f.buttons[0].listeners.get('pointerdown')({ stopPropagation: () => stopped++ })
  f.buttons[0].listeners.get('mousedown')({ stopPropagation: () => stopped++ })
  assert.equal(stopped, 2)
  assert.equal(f.opened(), 0)
  const disabled = pickerFixture(false)
  assert.ok(disabled.buttons.every((item) => item.listeners.size === 0))
})

test('队伍兵棋使用相同的左侧队名按钮，不影响 Android 操作环和 PC 删除行为', () => {
  const source = ts.createSourceFile('TeamLayer.tsx', read('src/components/TeamLayer.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declarations = source.statements.filter((node) =>
    (ts.isFunctionDeclaration(node) && ['buildTeamIcon', 'darken'].includes(node.name?.text))
    || (ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => item.name.getText(source) === 'SIDE_COLOR')),
  ).map((node) => node.getText(source)).join('\n')
  for (const kind of ['web', 'android']) {
    const { buildTeamIcon } = run(`${declarations}\nmodule.exports = { buildTeamIcon }`, {
      platform: { kind }, L: { divIcon: (options) => options },
      teamOf: (id) => ({ id, name: `${id}队`, color: '#e0453a' }),
    })
    const marker = { uid: 'tm-a', team: 'A', name: '突击队', side: 'attack' }
    const html = buildTeamIcon(marker, 'attack', undefined, false, true).html
    assert.equal(html.includes('class="unit-team-trigger"'), kind === 'web')
    if (kind === 'web') {
      assert.ok(html.includes('aria-label="选择队伍兵棋所属小队"'))
      assert.ok(html.includes('aria-controls="unit-team-menu-team-tm-a"'))
      assert.ok(html.includes('<span>A队</span>'))
      assert.ok(!html.includes('class="tm-delete"'))
      assert.ok(!buildTeamIcon(marker, 'attack', undefined, false, false).html.includes('class="unit-team-trigger"'))
    } else {
      assert.ok(html.includes('class="tm-delete"'))
      assert.ok(html.includes('class="tm-rotate-control unit-rotate-drag"'))
    }
  }
  const css = read('src/index.css')
  for (const selector of ['.tm-marker .unit-team-trigger', '.tm-marker:hover .unit-team-trigger', '.tm-marker.expanded .unit-team-trigger']) assert.ok(css.includes(selector))
  assert.ok(read('src/components/MapView.tsx').includes('onChangeTeam={onChangeTeamMarkerTeam}'))
  assert.ok(read('src/App.tsx').includes('onChangeTeamMarkerTeam={handleTeamMarkerTeamChange}'))
})

test('队伍兵棋菜单仅含 A–E 五个选项；载具/建筑保留无队伍选项', () => {
  const { default: Menu } = run(read('src/components/UnitTeamMenu.tsx'), { document: { body: {} } }, {
    react: { useRef: (current) => ({ current }), useEffect: () => {} },
    'react-dom': { createPortal: (content) => content },
    'react-leaflet': { useMap: () => ({}) },
    '../config/operators': { TEAMS: ['A', 'B', 'C', 'D', 'E'].map((id) => ({ id, name: `${id}队`, color: '#e0453a' })) },
    '../platform': { platform: { kind: 'web' } },
    '../utils/floatingPanelPosition': { floatingPanelPosition },
  })
  const props = { owner: 'team-tm-a', name: '突击队', team: 'A', getAnchor: () => null, onClose: () => {}, onSelect: () => {} }
  const teamMenu = renderToStaticMarkup(Menu({ ...props, allowNoTeam: false }))
  assert.equal((teamMenu.match(/role="menuitemradio"/g) ?? []).length, 5)
  assert.ok(!teamMenu.includes('无队伍'))
  for (const id of ['A', 'B', 'C', 'D', 'E']) assert.ok(teamMenu.includes(`<span>${id}队</span>`))
  const ordinaryMenu = renderToStaticMarkup(Menu(props))
  assert.equal((ordinaryMenu.match(/role="menuitemradio"/g) ?? []).length, 6)
  assert.ok(ordinaryMenu.includes('无队伍'))
})

test('五项队伍菜单的键盘纵向选择保持同列，跳过末行空格', () => {
  const document = { body: {}, activeElement: null }
  const options = Array.from({ length: 5 }, () => ({ focus() { document.activeElement = this } }))
  const { default: Menu } = run(read('src/components/UnitTeamMenu.tsx'), { document }, {
    react: { useRef: (current) => ({ current: current ?? { querySelectorAll: () => options } }), useEffect: () => {} },
    'react-dom': { createPortal: (content) => content },
    'react-leaflet': { useMap: () => ({}) },
    '../config/operators': { TEAMS: ['A', 'B', 'C', 'D', 'E'].map((id) => ({ id, name: `${id}队`, color: '#e0453a' })) },
    '../platform': { platform: { kind: 'web' } },
    '../utils/floatingPanelPosition': { floatingPanelPosition },
  })
  const menu = Menu({ owner: 'team-tm-a', name: '突击队', team: 'A', allowNoTeam: false })
  for (const [index, key, expected] of [[4, 'ArrowDown', 0], [0, 'ArrowUp', 4], [3, 'ArrowDown', 1], [1, 'ArrowUp', 3]]) {
    document.activeElement = options[index]
    let prevented = false
    menu.props.onKeyDown({ key, stopPropagation() {}, preventDefault() { prevented = true } })
    assert.equal(document.activeElement, options[expected])
    assert.ok(prevented)
  }
})

test('路线快捷入口为四个具名原生按钮，双端使用对应尺寸', () => {
  const source = ts.createSourceFile('MapView.tsx', read('src/components/MapView.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const trigger = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'RouteEditorTrigger')
  assert.ok(trigger)
  for (const kind of ['web', 'android']) {
    const { RouteEditorTrigger } = run(`${trigger.getText(source)}\nmodule.exports = { RouteEditorTrigger }`, {
      Marker: 'marker', platform: { kind }, useMap: () => ({}),
      useRef: (current) => ({ current }), useMemo: (callback) => callback(), useEffect: () => {},
      useState: (value) => [value, () => {}],
      L: { latLng: (lat, lng) => ({ lat, lng }), latLngBounds: () => ({ getNorthEast: () => [0, 0] }), divIcon: (options) => options },
    })
    const result = RouteEditorTrigger({ route: { waypoints: [[0, 0], [1, 1]], name: '测试' }, activeSection: null, branchPicking: false })
    const html = result.props.icon.html
    assert.equal((html.match(/<button /g) ?? []).length, 4)
    for (const label of ['编辑行动指令', '编辑线条样式', '创建分支', '删除路线']) assert.ok(html.includes(`aria-label="${label}"`))
    assert.equal(result.props.icon.iconSize[0], (kind === 'android' ? 36 : 30) * 4 + 18)
  }
})

test('样式模式直接展开既有控件；行动指令模式保留复制/反转/解绑/成员', () => {
  const { default: Panel } = run(read('src/components/RouteEditorPanel.tsx'), {}, {
    react: { useRef: (current) => ({ current }), useEffect: () => {}, useState: (value) => [value, () => {}] },
    '../config/routes': run(read('src/config/routes.ts')),
    '../config/operators': { teamOf: () => ({ color: '#e0453a' }) },
    '../platform': { platform: { kind: 'web' } },
    '../utils/rangeStyle': { rangeProgressStyle: () => ({}) },
  })
  const props = {
    route: { uid: 'route', name: '推进', side: 'attack', team: 'A', anchorMode: 'vehicle', opacity: 0.9, color: '#e0453a', orderType: 'move', status: 'planned', lineStyle: 'dashed', waypoints: [[0, 0], [1, 1]], operatorIds: [], vehicleIds: ['vehicle'] },
    view: 'attack', availableOperators: [], branchPicking: false,
  }
  const style = renderToStaticMarkup(Panel({ ...props, section: 'style' }))
  assert.ok(style.includes('style-only'))
  assert.ok(style.includes('route-editor-appearance" open=""'))
  assert.ok(style.includes('aria-label="线条颜色"'))
  assert.ok(style.includes('曲线'))
  assert.ok(style.includes('粗细'))
  assert.ok(!style.includes('行动指令名称'))
  assert.ok(!style.includes('route-editor-members'))
  const order = renderToStaticMarkup(Panel({ ...props, section: 'order' }))
  for (const action of ['行动指令名称', '执行干员', '复制', '反转', '解绑']) assert.ok(order.includes(action), action)
})
