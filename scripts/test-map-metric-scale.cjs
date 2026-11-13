const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')
const { createConfigLoader } = require('./lib/load-config-module.cjs')
const load = createConfigLoader()
const { metricScaleReading } = load('src/utils/mapMetricScale.ts')
const { metersPerMapUnitForBasemap } = load('src/config/mapMetricCalibration.ts')
const { MAPS, MAP_BY_ID } = load('src/config/maps.ts')
const calibration = load('src/config/mapMetricCalibration.json')
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`)

test('each verified basemap independently resolves its real extent and bound URL, not the full 3D terrain extent', () => {
  const expected = {
    ascent: { meters: 2000, tileUrl: '/maps/ascent-pc-q80-v1/{z}_{x}_{y}.webp' },
    ember: { meters: 1200, tileUrl: '/maps/ember-mobile-q80-v1/{z}_{x}_{y}.webp' },
    flashpoint: { meters: 1263.09578125, tileUrl: '/maps/flashpoint-pc-q80-v1/{z}_{x}_{y}.webp' },
    stormeye: { meters: 1744.82015625, tileUrl: '/maps/stormeye-pc-q80-v1/{z}_{x}_{y}.webp' },
    skyport: { meters: 2000, tileUrl: 'https://game.gtimg.cn/images/dfm/cp/a20240729directory/img/map_tjg/{z}_{x}_{y}.jpg' },
    trench: { meters: 1200, tileUrl: '/maps/trench-pc-q80-v1/{z}_{x}_{y}.webp' },
  }
  assert.deepEqual(MAPS.filter((map) => map.metersPerMapUnit !== undefined).map((map) => map.id).sort(), Object.keys(expected).sort())
  for (const [id, spec] of Object.entries(expected)) {
    const source = calibration.maps[id]
    assert.equal(MAP_BY_ID[id].tileUrl, spec.tileUrl)
    assert.equal(source.tileUrl, spec.tileUrl)
    close(source.worldExtentXYcm[0] * 2 / 100, spec.meters)
    close(source.worldExtentXYcm[1] * 2 / 100, spec.meters)
    close(MAP_BY_ID[id].metersPerMapUnit, spec.meters / 256)
    close(metersPerMapUnitForBasemap(id, spec.tileUrl), spec.meters / 256)
    assert.equal(metersPerMapUnitForBasemap(id, '/different-basemap/{z}_{x}_{y}.png'), undefined)
  }
  // Preserve the two legacy maps' independent, fixed 1200m calibration checks.
  for (const id of ['ember', 'trench']) {
    const source = calibration.maps[id]
    close(source.worldExtentXYcm[0] * 2 / 100, 1200)
    close(MAP_BY_ID[id].metersPerMapUnit, 1200 / 256)
    close(metersPerMapUnitForBasemap(id, MAP_BY_ID[id].tileUrl), 4.6875)
    assert.equal(metersPerMapUnitForBasemap(id, '/different-basemap/{z}_{x}_{y}.png'), undefined)
  }
  assert.equal(metersPerMapUnitForBasemap('unknown-map', MAP_BY_ID.ember.tileUrl), undefined)
  assert.equal(metersPerMapUnitForBasemap('ember', MAP_BY_ID.trench.tileUrl), undefined)
  assert.notDeepEqual(calibration.maps.ember.worldCenterXYcm, calibration.maps.trench.worldCenterXYcm)
})

test('zoom 0.5 through 8, including fractional levels, uses CSS pixels and never native tile resolution', () => {
  for (const zoom of [0.5, 1, 2, 2.5, 3, 3.585, 4, 4.5, 5, 6, 7, 8]) {
    const reading = metricScaleReading(4.6875, zoom)
    assert.ok(reading.widthPx > 0 && reading.widthPx <= 120)
    close(reading.widthPx * 4.6875 / 2 ** zoom, reading.distanceMeters)
  }
  const reading = metricScaleReading(4.6875, 4)
  assert.equal(reading.label, '20 米')
  close(reading.widthPx, 20 / (4.6875 / 16))
  close(100 * 4.6875 / 16, 29.296875)
  assert.equal(metricScaleReading(4.6875, -3).label, '2 千米')
})

test('missing/invalid calibration hides the scale; narrow viewports select a shorter accurate ruler', () => {
  for (const value of [undefined, 0, -1, NaN, Infinity]) assert.equal(metricScaleReading(value, 4), null)
  assert.equal(metricScaleReading(4.6875, NaN), null)
  assert.equal(metricScaleReading(4.6875, 4, 0), null)
  const narrow = metricScaleReading(4.6875, 4, 60)
  assert.ok(narrow.widthPx <= 60)
  close(narrow.widthPx * 4.6875 / 16, narrow.distanceMeters)
})

function mountedScale(metersPerMapUnit) {
  const elements = []
  const listeners = new Map()
  let zoom = 3
  let width = 1280
  let setup
  let control
  let removed = false
  const map = {
    getZoom: () => zoom,
    getSize: () => ({ x: width }),
    on: (names, fn) => { for (const name of names.split(' ')) listeners.set(name, fn) },
    off: (names, fn) => { for (const name of names.split(' ')) if (listeners.get(name) === fn) listeners.delete(name) },
  }
  const dependencies = {
    react: { useEffect: (callback) => { setup = callback } },
    'react-leaflet': { useMap: () => map },
    leaflet: {
      Control: class {
        constructor(options) { this.options = options; control = this }
        addTo() { this.container = this.onAdd(); return this }
        remove() { removed = true }
      },
      DomUtil: { create: (tag, className) => {
        const element = { tag, className, style: {}, dataset: {}, attributes: {}, setAttribute(name, value) { this.attributes[name] = value } }
        elements.push(element)
        return element
      } },
    },
    '../utils/mapMetricScale': { metricScaleReading },
  }
  const module = { exports: {} }
  const file = path.resolve(__dirname, '../src/components/MapMetricScale.tsx')
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(code, {
    module, exports: module.exports, require: (name) => dependencies[name],
  })
  module.exports.default({ metersPerMapUnit })
  const cleanup = setup()
  return {
    elements, listeners, cleanup, control, removed: () => removed,
    element: (className) => elements.find((element) => element.className === className),
    zoom: (value) => { zoom = value; listeners.get('zoom')?.() },
    resize: (value) => { width = value; listeners.get('resize')?.() },
    finish: (value) => { zoom = value; listeners.get('zoomend')() },
  }
}

test('the control updates its own DOM only at zoom end or resize and cleans up completely', () => {
  const fixture = mountedScale(4.6875)
  const label = fixture.element('map-metric-scale-value')
  const ruler = fixture.element('map-metric-scale-ruler')
  const bar = fixture.element('map-metric-scale-bar')
  assert.equal(fixture.control.options.position, 'bottomright')
  assert.equal(label.textContent, '50 米')
  fixture.zoom(4)
  assert.equal(label.textContent, '50 米', 'zoom events alone must not update the scale')
  assert.equal(fixture.listeners.has('zoomanim'), false)
  assert.equal(fixture.listeners.has('zoom'), false)
  fixture.finish(4)
  assert.equal(label.textContent, '20 米')
  fixture.finish(5)
  assert.equal(label.textContent, '10 米')
  // 4->5 层级的漂亮刻度可以宽度相同，但实际米数必须同步更新。
  assert.equal(bar.dataset.meters, '10')
  fixture.resize(240)
  assert.ok(parseFloat(ruler.style.width) <= 60)
  fixture.cleanup()
  assert.equal(fixture.listeners.size, 0)
  assert.equal(fixture.removed(), true)
})

test('unverified maps mount no control or listeners', () => {
  const fixture = mountedScale(undefined)
  assert.equal(fixture.control, undefined)
  assert.equal(fixture.listeners.size, 0)
  assert.equal(fixture.cleanup, undefined)
})

test('the same calibrated basemaps are wired into both the application and the mode editor', () => {
  for (const filename of ['MapView.tsx', 'ModeConfigWorkbench.tsx']) {
    const source = fs.readFileSync(path.resolve(__dirname, '../src/components', filename), 'utf8')
    assert.match(source, /<MapMetricScale metersPerMapUnit=\{config\.metersPerMapUnit\}/)
  }
  const style = fs.readFileSync(path.resolve(__dirname, '../src/index.css'), 'utf8')
  assert.match(style, /\.leaflet-control\.map-metric-scale\s*\{[^}]*pointer-events: none/s)
})
