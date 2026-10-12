// 隔离执行 App 中的真实换队回调及分支级联：node scripts/test-vehicle-route-team.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

function parse(relativePath) {
  const filePath = path.join(__dirname, '..', relativePath)
  return ts.createSourceFile(filePath, fs.readFileSync(filePath, 'utf8'), ts.ScriptTarget.Latest, true)
}

function findVariable(source, name) {
  let result
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) result = node
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(result, `未找到 ${name}`)
  return result
}

function runModule(source, globals = {}) {
  const module = { exports: {} }
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(compiled, { module, exports: module.exports, ...globals })
  return module.exports
}

const appSource = parse('src/App.tsx')
const callbacks = Object.fromEntries(['handleVehicleTeamChange', 'handleBuildingTeamChange', 'handleTeamMarkerTeamChange', 'handleUpdateRoute'].map((name) =>
  [name, findVariable(appSource, name).initializer.arguments[0].getText(appSource)],
))
const operatorsSource = parse('src/config/operators.ts')
const teamDeclarations = operatorsSource.statements.filter((node) =>
  (ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => item.name.getText(operatorsSource) === 'TEAMS'))
  || (ts.isFunctionDeclaration(node) && node.name?.text === 'teamOf'),
).map((node) => node.getText(operatorsSource)).join('\n')
const { TEAMS, teamOf } = runModule(teamDeclarations)
const { routeVisual } = runModule(parse('src/config/routes.ts').text)
const { syncRouteTeamCascade } = runModule(parse('src/utils/routeTeamCascade.ts').text, {
  require: (name) => {
    assert.equal(name, '../config/operators')
    return { teamOf }
  },
})
const originHelpers = appSource.statements.filter((node) => ts.isFunctionDeclaration(node)
  && ['syncBranchRouteOrigins', 'syncRouteTargetPosition'].includes(node.name?.text),
).map((node) => node.getText(appSource)).join('\n')
const { syncBranchRouteOrigins, syncRouteTargetPosition } = runModule(`${originHelpers}\nmodule.exports = { syncBranchRouteOrigins, syncRouteTargetPosition }`)

function makeRoute(uid, patch = {}) {
  return {
    uid, side: 'attack', team: 'A', teamMarkerUid: '', anchorMode: 'vehicle', anchorVehicleUid: 'veh-tank',
    name: '机动路线', orderType: 'move', status: 'planned', color: teamOf('A').color,
    lineStyle: 'dashed', geometryType: 'straight', opacity: 0.9, strokeWidth: 4,
    waypoints: [[10, 20], [30, 40], [50, 60]], operatorIds: [], vehicleIds: ['veh-tank'],
    createdAt: 1, ...patch,
  }
}

function fixture(view = 'attack', callbackName = 'handleVehicleTeamChange') {
  const otherView = view === 'attack' ? 'defense' : 'attack'
  const initial = {
    vehicles: {
      [view]: [{ uid: 'veh-tank', side: view, team: 'A' }, { uid: 'veh-other', side: view, team: 'D' }],
      [otherView]: [{ uid: 'veh-tank', side: otherView, team: 'E' }],
    },
    buildings: {
      [view]: [{ uid: 'building-1', side: view, team: 'A' }, { uid: 'building-other', side: view, team: 'D' }],
      [otherView]: [{ uid: 'building-1', side: otherView, team: 'E' }],
    },
    teams: { attack: [], defense: [] },
    operators: { attack: [], defense: [] },
    routes: {
      [view]: [
        makeRoute('straight', { side: view }),
        makeRoute('curve', { side: view, color: '#17aa22', geometryType: 'curve', target: { type: 'point', id: 'A' } }),
        makeRoute('other-vehicle', { side: view, team: 'D', anchorVehicleUid: 'veh-other', color: teamOf('D').color }),
        makeRoute('free', { side: view, anchorMode: 'free' }),
        makeRoute('operator', { side: view, anchorMode: 'operator', anchorOperatorUid: 'op-1' }),
      ],
      [otherView]: [makeRoute('other-view', { side: otherView, team: 'E', color: teamOf('E').color })],
    },
  }
  let state = initial
  const entries = []
  const mapsRef = { current: { context: state } }
  const handler = runModule(`module.exports = ${callbacks[callbackName]}`, {
    mapsRef, activeTacticalContextKeyRef: { current: 'context' }, mapId: 'climb', view, teamOf,
    syncRouteTeamCascade, syncBranchRouteOrigins, syncRouteTargetPosition,
    createEmptyMapState: () => { throw new Error('不应使用空状态') },
    cloneState: (value) => JSON.parse(JSON.stringify(value)),
    vehiclesBucketOf: (value) => value.vehicles,
    buildingsBucketOf: (value) => value.buildings,
    teamsBucketOf: (value) => value.teams,
    operatorsBucketOf: (value) => value.operators,
    routesBucketOf: (value) => value.routes,
    updateMap: (mapId, update) => {
      assert.equal(mapId, 'climb')
      state = update(state)
      mapsRef.current.context = state
    },
    pushEntry: (before, after) => entries.push({ before, after }),
  })
  return { initial, handler, entries, view, otherView, state: () => state }
}

function addBranches(f) {
  const branch = (uid, parent, index = 1) => makeRoute(uid, {
    side: f.view, anchorMode: 'branch', anchorVehicleUid: undefined,
    branchFromRouteUid: parent, branchFromWaypointIndex: index, team: 'E', color: '#17aa22',
    vehicleIds: [], operatorIds: ['op-assigned'],
  })
  // 子路线故意排在父路线前，验证遍历不依赖存储顺序。
  f.initial.routes[f.view].unshift(
    branch('great-grandchild', 'grandchild'),
    branch('grandchild', 'child'),
    branch('child', 'straight'),
    branch('sibling', 'straight', 2),
    branch('curve-child', 'curve'),
    branch('unrelated-child', 'other-vehicle'),
    branch('orphan', 'missing-parent'),
    makeRoute('detached', { anchorMode: 'free', branchFromRouteUid: 'straight' }),
    branch('detached-child', 'detached'),
  )
  return new Set(['straight', 'curve', 'child', 'sibling', 'grandchild', 'great-grandchild', 'curve-child'])
}

function teamFixture(view = 'attack') {
  const f = fixture(view, 'handleTeamMarkerTeamChange')
  f.initial.teams[view] = [
    { uid: 'tm-main', side: view, team: 'A', name: 'A队', role: 'infantry', lat: 10, lng: 20, rotation: 75, fireLineEnabled: true, fireLineLength: 72 },
    { uid: 'tm-other', side: view, team: 'B', name: '预备队', role: 'infantry', lat: 35, lng: 45 },
    { uid: 'tm-enemy', side: f.otherView, team: 'A', name: '敌方队标', role: 'infantry', lat: 50, lng: 60 },
  ]
  f.initial.teams[f.otherView] = [{ uid: 'tm-main', side: f.otherView, team: 'E', name: '其他视角队标', lat: 1, lng: 2 }]
  for (const route of f.initial.routes[view].slice(0, 2)) {
    route.anchorMode = 'team'
    route.anchorVehicleUid = undefined
    route.teamMarkerUid = 'tm-main'
    route.operatorIds = ['op-existing']
    route.vehicleIds = ['veh-existing']
  }
  f.initial.routes[view].push(
    makeRoute('other-team', { side: view, anchorMode: 'team', teamMarkerUid: 'tm-other', team: 'B', color: teamOf('B').color }),
    makeRoute('detached-team', { side: view, anchorMode: 'free', teamMarkerUid: 'tm-main' }),
  )
  return f
}

test('队伍兵棋直接切换 A–E，同步绑定路线与全部分支的队伍和颜色', () => {
  for (const view of ['attack', 'defense']) {
    for (const { id: team, color } of TEAMS) {
      const f = teamFixture(view)
      if (team === 'A') {
        f.initial.teams[view][0].team = 'E'
        f.initial.teams[view][0].name = 'E队'
      }
      const affected = addBranches(f)
      f.handler('tm-main', team)
      assert.equal(f.state().teams[view][0].team, team)
      assert.equal(f.state().teams[view][0].name, `${team}队`)
      for (let index = 0; index < f.state().routes[view].length; index++) {
        const original = f.initial.routes[view][index]
        const route = f.state().routes[view][index]
        if (!affected.has(route.uid)) {
          assert.equal(route, original, route.uid)
          continue
        }
        assert.equal(route.team, team, route.uid)
        assert.equal(route.color, color, route.uid)
        for (const key of Object.keys(original).filter((key) => key !== 'team' && key !== 'color')) {
          assert.equal(route[key], original[key], `${route.uid}.${key}`)
        }
      }
      assert.equal(f.entries.length, 1)
    }
  }
})

test('队伍兵棋换队保留 UID、阵营、坐标、朝向、枪线和自定义名称', () => {
  const f = teamFixture()
  f.initial.teams.attack[0].name = '桥头突击组'
  f.handler('tm-main', 'D')
  const original = f.initial.teams.attack[0]
  const marker = f.state().teams.attack[0]
  for (const key of Object.keys(original).filter((key) => key !== 'team')) assert.equal(marker[key], original[key], key)
  assert.equal(marker.team, 'D')
  assert.equal(original.team, 'A')
  assert.equal(original.name, '桥头突击组')
})

test('目标小队已有兵棋时不会删除或移动它；双方其他兵棋和视角均不受影响', () => {
  for (const view of ['attack', 'defense']) {
    const f = teamFixture(view)
    f.handler('tm-main', 'B')
    assert.equal(f.state().teams[view].length, f.initial.teams[view].length)
    assert.equal(f.state().teams[view][1], f.initial.teams[view][1])
    assert.equal(f.state().teams[view][2], f.initial.teams[view][2])
    assert.equal(f.state().teams[f.otherView], f.initial.teams[f.otherView])
    assert.equal(f.state().routes[f.otherView], f.initial.routes[f.otherView])
    assert.equal(f.state().vehicles, f.initial.vehicles)
    assert.equal(f.state().operators, f.initial.operators)
  }
})

test('队伍兵棋和所有绑定路线作为同一次撤销记录；连续换队使用最新状态', () => {
  const f = teamFixture()
  const affected = addBranches(f)
  f.handler('tm-main', 'B')
  f.handler('tm-main', 'E')
  assert.equal(f.entries.length, 2)
  assert.equal(f.entries[0].before.teams.attack[0].team, 'A')
  assert.equal(f.entries[0].after.teams.attack[0].team, 'B')
  assert.equal(f.entries[1].before.teams.attack[0].team, 'B')
  assert.equal(f.entries[1].after.teams.attack[0].team, 'E')
  for (const uid of affected) {
    assert.equal(f.entries[0].after.routes.attack.find((route) => route.uid === uid).color, teamOf('B').color)
    assert.equal(f.entries[1].before.routes.attack.find((route) => route.uid === uid).color, teamOf('B').color)
    assert.equal(f.entries[1].after.routes.attack.find((route) => route.uid === uid).color, teamOf('E').color)
    const original = f.initial.routes.attack.find((route) => route.uid === uid)
    assert.equal(f.entries[0].before.routes.attack.find((route) => route.uid === uid).color, original.color)
  }
})

test('队伍兵棋默认队名更新终点自动标签，但不更改终点路线归属或自定义标签', () => {
  const f = teamFixture()
  f.initial.routes.attack.push(
    makeRoute('target-auto', { target: { kind: 'team', uid: 'tm-main', label: 'A队' } }),
    makeRoute('target-custom', { target: { kind: 'team', uid: 'tm-main', label: '集合位置' } }),
  )
  f.handler('tm-main', 'C')
  const route = f.state().routes.attack.find((item) => item.uid === 'target-auto')
  assert.equal(route.target.label, 'C队')
  assert.equal(route.target.uid, 'tm-main')
  assert.equal(route.team, 'A')
  assert.equal(route.color, teamOf('A').color)
  assert.equal(f.state().routes.attack.find((item) => item.uid === 'target-custom').target.label, '集合位置')
})

test('缺失队伍兵棋或重复选择当前队伍不修改状态和撤销记录', () => {
  const f = teamFixture()
  f.handler('missing', 'D')
  f.handler('tm-main', 'A')
  assert.equal(f.state(), f.initial)
  assert.equal(f.entries.length, 0)
})

test('载具切换 A–E 小队，所有直接绑定路线的线条/箭头颜色与队色一致', () => {
  for (const view of ['attack', 'defense']) {
    for (const { id: team, color } of TEAMS) {
      const f = fixture(view)
      f.handler('veh-tank', team)
      assert.equal(f.state().vehicles[view][0].team, team)
      for (const route of f.state().routes[view].slice(0, 2)) {
        assert.equal(route.team, team)
        assert.equal(route.color, color)
        // RouteLayer 的选中/未选中线条和箭头共用此视觉颜色。
        assert.equal(routeVisual(route, false).color, color)
        assert.equal(routeVisual(route, true).color, color)
      }
      assert.equal(f.entries.length, 1)
    }
  }
})

test('更换颜色不改动路线形状、起终点绑定、执行成员和线条样式', () => {
  const f = fixture()
  f.handler('veh-tank', 'B')
  for (let index = 0; index < 2; index++) {
    const original = f.initial.routes.attack[index]
    const updated = f.state().routes.attack[index]
    for (const key of Object.keys(original).filter((key) => key !== 'team' && key !== 'color')) {
      assert.equal(updated[key], original[key], key)
    }
    assert.equal(original.team, 'A')
  }
  assert.equal(f.initial.routes.attack[1].color, '#17aa22')
})

test('其他载具、自由/干员路线与另一视角场景不受影响', () => {
  const f = fixture()
  f.handler('veh-tank', 'B')
  assert.equal(f.state().vehicles.attack[1], f.initial.vehicles.attack[1])
  for (let index = 2; index < f.initial.routes.attack.length; index++) {
    assert.equal(f.state().routes.attack[index], f.initial.routes.attack[index])
  }
  assert.equal(f.state().routes[f.otherView], f.initial.routes[f.otherView])
  assert.equal(f.state().vehicles[f.otherView], f.initial.vehicles[f.otherView])
})

test('撤销历史同时保留载具队伍和每条路线的旧/新颜色', () => {
  const f = fixture()
  f.handler('veh-tank', 'B')
  const { before, after } = f.entries[0]
  assert.equal(before.vehicles.attack[0].team, 'A')
  assert.equal(before.routes.attack[0].color, teamOf('A').color)
  assert.equal(before.routes.attack[1].color, '#17aa22')
  assert.equal(after.vehicles.attack[0].team, 'B')
  for (const route of after.routes.attack.slice(0, 2)) {
    assert.equal(route.team, 'B')
    assert.equal(route.color, teamOf('B').color)
  }
})

test('连续换队记录最新队色；取消小队保留既有路线归属规则', () => {
  const f = fixture()
  f.handler('veh-tank', 'B')
  f.handler('veh-tank', 'E')
  assert.equal(f.entries[1].before.routes.attack[0].color, teamOf('B').color)
  const routes = f.state().routes.attack
  f.handler('veh-tank', undefined)
  assert.equal(f.state().vehicles.attack[0].team, undefined)
  for (let index = 0; index < routes.length; index++) assert.equal(f.state().routes.attack[index], routes[index])
  assert.equal(f.state().routes.attack[0].color, teamOf('E').color)
})

test('完成/取消路线继续保留状态灰色，重新执行时使用新队色', () => {
  for (const [status, color] of [['completed', '#7f888f'], ['cancelled', '#656b70']]) {
    const f = fixture()
    f.initial.routes.attack[0].status = status
    f.handler('veh-tank', 'B')
    const route = f.state().routes.attack[0]
    assert.equal(route.status, status)
    assert.equal(route.color, teamOf('B').color)
    assert.equal(routeVisual(route).color, color)
    assert.equal(routeVisual({ ...route, status: 'executing' }).color, teamOf('B').color)
  }
})

test('载具换队递归修改多层/多节点分支，不改动已解绑或其他路线树', () => {
  for (const view of ['attack', 'defense']) {
    for (const { id: team, color } of TEAMS) {
      const f = fixture(view)
      const affected = addBranches(f)
      f.handler('veh-tank', team)
      for (let index = 0; index < f.state().routes[view].length; index++) {
        const route = f.state().routes[view][index]
        const original = f.initial.routes[view][index]
        if (affected.has(route.uid)) {
          assert.equal(route.team, team, route.uid)
          assert.equal(route.color, color, route.uid)
          for (const key of Object.keys(original).filter((key) => key !== 'team' && key !== 'color')) {
            assert.equal(route[key], original[key], `${route.uid}.${key}`)
          }
        } else {
          assert.equal(route, original, route.uid)
        }
      }
      assert.equal(f.state().routes[f.otherView], f.initial.routes[f.otherView])
      assert.equal(f.entries.length, 1)
    }
  }
})

test('多级分支的队伍/颜色作为同一次修改完整记录到撤销历史', () => {
  const f = fixture()
  const affected = addBranches(f)
  f.handler('veh-tank', 'B')
  const { before, after } = f.entries[0]
  for (const uid of affected) {
    const oldRoute = before.routes.attack.find((route) => route.uid === uid)
    const newRoute = after.routes.attack.find((route) => route.uid === uid)
    assert.equal(oldRoute.team, f.initial.routes.attack.find((route) => route.uid === uid).team)
    assert.equal(oldRoute.color, f.initial.routes.attack.find((route) => route.uid === uid).color)
    assert.equal(newRoute.team, 'B')
    assert.equal(newRoute.color, teamOf('B').color)
  }
  f.handler('veh-tank', 'D')
  for (const uid of affected) {
    assert.equal(f.entries[1].before.routes.attack.find((route) => route.uid === uid).color, teamOf('B').color)
    assert.equal(f.state().routes.attack.find((route) => route.uid === uid).color, teamOf('D').color)
  }
})

test('建筑换队也递归同步直接绑定路线及分支，取消小队不重写路线', () => {
  for (const view of ['attack', 'defense']) {
    const f = fixture(view, 'handleBuildingTeamChange')
    const affected = addBranches(f)
    for (const route of f.initial.routes[view]) {
      if (route.uid === 'straight' || route.uid === 'curve') {
        route.anchorMode = 'building'
        route.anchorVehicleUid = undefined
        route.anchorBuildingUid = 'building-1'
      }
    }
    f.handler('building-1', 'D')
    assert.equal(f.state().buildings[view][0].team, 'D')
    assert.equal(f.state().buildings[view][1], f.initial.buildings[view][1])
    for (const route of f.state().routes[view]) {
      if (!affected.has(route.uid)) continue
      assert.equal(route.team, 'D')
      assert.equal(route.color, teamOf('D').color)
      assert.equal(f.entries[0].after.routes[view].find((item) => item.uid === route.uid).color, route.color)
    }
    assert.equal(f.entries[0].before.buildings[view][0].team, 'A')
    assert.equal(f.state().buildings[f.otherView], f.initial.buildings[f.otherView])
    const routes = f.state().routes[view]
    f.handler('building-1', undefined)
    assert.equal(f.state().routes[view], routes)
  }
})

test('路线起点改绑其他小队时下级分支同步，不反向影响上级/兄弟路线', () => {
  const f = fixture('attack', 'handleUpdateRoute')
  addBranches(f)
  const originals = new Map(f.initial.routes.attack.map((route) => [route.uid, route]))
  // 模拟将分支的首点吸附到新小队兵棋，但不移动其他节点。
  f.handler('child', { team: 'C', anchorMode: 'vehicle', anchorVehicleUid: 'veh-other', branchFromRouteUid: undefined, branchFromWaypointIndex: undefined })
  const affected = new Set(['child', 'grandchild', 'great-grandchild'])
  for (const route of f.state().routes.attack) {
    if (affected.has(route.uid)) {
      assert.equal(route.team, 'C', route.uid)
      assert.equal(route.color, teamOf('C').color, route.uid)
    } else {
      assert.equal(route.team, originals.get(route.uid).team, route.uid)
      assert.equal(route.color, originals.get(route.uid).color, route.uid)
    }
  }
  assert.equal(f.entries.length, 1)
})

test('手动修改线条颜色或指令状态仍为单条路线操作，不覆盖分支自定义样式', () => {
  const f = fixture('attack', 'handleUpdateRoute')
  addBranches(f)
  f.handler('straight', { color: '#123456', status: 'executing' })
  assert.equal(f.state().routes.attack.find((route) => route.uid === 'straight').color, '#123456')
  const child = f.state().routes.attack.find((route) => route.uid === 'child')
  assert.equal(child.color, '#17aa22')
  assert.equal(child.status, 'planned')
})

test('循环绑定安全停止；缺失根路线不沿悬空父 ID 修改路线', () => {
  const a = makeRoute('a', { anchorMode: 'branch', branchFromRouteUid: 'b' })
  const b = makeRoute('b', { anchorMode: 'branch', branchFromRouteUid: 'a' })
  const child = makeRoute('child', { anchorMode: 'branch', branchFromRouteUid: 'b' })
  const unrelated = makeRoute('other')
  const routes = [child, b, unrelated, a]
  const updated = syncRouteTeamCascade(routes, ['a', 'a'], 'E')
  for (const route of updated) {
    if (route.uid === 'other') assert.equal(route, unrelated)
    else {
      assert.equal(route.team, 'E')
      assert.equal(route.color, teamOf('E').color)
    }
  }
  assert.equal(syncRouteTeamCascade(routes, ['missing'], 'B'), routes)
})

test('超深分支链无需函数递归，所有后代均换队且不栈溢出', () => {
  const routes = [makeRoute('root')]
  for (let index = 0; index < 12000; index++) {
    routes.push(makeRoute(`branch-${index}`, {
      anchorMode: 'branch', branchFromRouteUid: index === 0 ? 'root' : `branch-${index - 1}`,
    }))
  }
  const updated = syncRouteTeamCascade(routes, ['root'], 'D')
  assert.equal(updated.length, routes.length)
  for (const route of updated) {
    assert.equal(route.team, 'D')
    assert.equal(route.color, teamOf('D').color)
  }
  assert.equal(routes.at(-1).team, 'A')
})
