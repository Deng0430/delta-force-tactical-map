const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')
const { createConfigLoader } = require('./lib/load-config-module.cjs')

const load = createConfigLoader()
const { objectiveStateKey } = load('src/utils/objectiveStates.ts')
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
const flights = []
const moduleUnderTest = { exports: {} }
const dependencies = {
  'react-leaflet': {
    Marker: 'marker', Polygon: 'polygon', useMap: () => ({ flyTo: (...args) => flights.push(args) }),
  },
  leaflet: { divIcon: (options) => options },
  '../config/points': { POINT_ICON_BASE: '/icons/map-props' },
  '../utils/objectiveStates': load('src/utils/objectiveStates.ts'),
}
const code = ts.transpileModule(read('src/components/PointMarkers.tsx'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText
vm.runInThisContext(`(function(module, exports, require) {\n${code}\n})`, { filename: 'PointMarkers.tsx' })(
  moduleUnderTest, moduleUnderTest.exports, (name) => dependencies[name] ?? require(name),
)
const PointMarkers = moduleUnderTest.exports.default
const point = (name, lat, lng) => ({ name, lat, lng, note: '', icon: 'q_jd_a', capturable: [[lat, lng], [lat + 1, lng], [lat, lng + 1]] })
const stages = ['S1', 'S2', 'S3', 'S4'].map((id, index) => ({
  id, label: id, points: [point(index < 2 ? ['据点A', '据点B'][index] : '据点C2', -100 - Math.min(index, 2), 80)],
  zone: { name: id, latlngs: [[-100, 80], [-101, 80], [-100, 81]] },
}))
function render(overrides = {}) {
  const selected = []
  const tree = PointMarkers({
    stages, capturedStageIndex: 1, view: 'attack', selectedName: null, selectedStageId: null,
    visible: true, labelsVisible: true, annotationsVisible: true, captureVisible: true, frontlineVisible: true,
    interactive: true, objectiveStates: {}, onSelect: (...args) => selected.push(args), ...overrides,
  })
  const nodes = []
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit)
    if (!node || typeof node !== 'object') return
    nodes.push(node)
    visit(node.props?.children)
  }
  visit(tree)
  return { markers: nodes.filter((node) => node.type === 'marker'), polygons: nodes.filter((node) => node.type === 'polygon'), selected }
}

test('all stages show markers, while capture/frontline polygons remain current-stage only', () => {
  const { markers, polygons } = render()
  assert.equal(markers.length, 4)
  assert.match(markers[0].props.icon.html, /cap-marker captured/)
  assert.match(markers[1].props.icon.html, /cap-marker active/)
  assert.match(markers[2].props.icon.html, /cap-marker locked/)
  assert.equal(polygons.length, 2)
  assert.deepEqual(polygons[1].props.positions, stages[1].points[0].capturable)
  assert.match(markers[0].props.title, /S1.*点击切换阶段/)
  // Reuse the production opacity distinction, rather than introduce a separate look.
  assert.match(read('src/index.css'), /\.cap-marker\.captured,\s*\.cap-marker\.locked\s*\{\s*opacity:\s*\.45;/)
})

test('clicking past or future points selects its own stage and focuses its position', () => {
  const { markers, selected } = render()
  flights.length = 0
  markers[0].props.eventHandlers.click()
  markers[3].props.eventHandlers.click()
  assert.deepEqual(selected, [[stages[0].points[0], 'S1'], [stages[3].points[0], 'S4']])
  assert.deepEqual(flights.map((args) => args[0]), [[-100, 80], [-102, 80]])
  const next = render({ capturedStageIndex: 3 })
  assert.match(next.markers[3].props.icon.html, /cap-marker active/)
  assert.match(next.markers[1].props.icon.html, /cap-marker captured/)
})

test('drawing mode disables all marker interaction; layer/label/annotation toggles still work', () => {
  const disabled = render({ interactive: false })
  flights.length = 0
  for (const node of disabled.markers) {
    assert.equal(node.props.interactive, false)
    node.props.eventHandlers.click()
  }
  assert.equal(disabled.selected.length, 0)
  assert.equal(flights.length, 0)
  assert.equal(render({ visible: false }).markers.length, 0)
  const hidden = render({ labelsVisible: false })
  assert.equal(hidden.markers.length, 0)
  assert.equal(hidden.polygons.length, 2)
  assert.equal(render({ annotationsVisible: false }).markers.some((node) => node.props.icon.html.includes('cap-tag')), false)
  assert.equal(render({ capturedStageIndex: 99 }).markers.length, 0)
})

test('overlapping stage objectives prioritize the current marker, without inheriting stale selection or progress', () => {
  const own = { owner: 'attack', capturingSide: 'defense', progress: 67 }
  const { markers } = render({
    capturedStageIndex: 2, selectedStageId: 'S4', selectedName: '据点C2',
    objectiveStates: { [objectiveStateKey('S3', '据点C2')]: own, [objectiveStateKey('S4', '据点C2')]: own },
  })
  assert.deepEqual(markers[2].props.position, markers[3].props.position)
  assert.ok(markers[2].props.zIndexOffset > markers[3].props.zIndexOffset)
  assert.match(markers[2].props.icon.html, /--c:#01ff84/)
  assert.match(markers[2].props.icon.html, /cap-progress-frame/)
  assert.match(markers[3].props.icon.html, /--c:#e0453a/)
  assert.doesNotMatch(markers[3].props.icon.html, /selected|cap-progress-frame/)
})

test('PC/mobile attack-defense and winner data expose stage-qualified clickable markers', () => {
  const previousStorage = globalThis.localStorage
  try {
    globalThis.localStorage = { getItem: () => null }
    const { loadModeConfigStore, buildRuntimeModeData } = load('src/utils/modeConfigStorage.ts')
    const store = loadModeConfigStore()
    for (const mode of ['attack-defense', 'winner-takes-all']) for (const platform of ['pc', 'mobile']) {
      const profile = store.profiles.find((item) => item.id === mode)
      for (const mapId of Object.keys(profile.platformMaps[platform])) {
        const runtime = buildRuntimeModeData(profile, platform, mapId).map
        if (!runtime?.stages.length) continue
        const { markers, selected } = render({ stages: runtime.stages, capturedStageIndex: 0 })
        assert.equal(markers.length, runtime.stages.reduce((sum, stage) => sum + stage.points.length, 0))
        const expected = runtime.stages.flatMap((stage) => stage.points.map((point) => [point, stage.id]))
        markers.forEach((marker) => marker.props.eventHandlers.click())
        assert.deepEqual(selected, expected)
      }
    }
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage
    else globalThis.localStorage = previousStorage
  }
})
