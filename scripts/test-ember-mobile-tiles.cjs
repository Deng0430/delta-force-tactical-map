const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')
const vm = require('node:vm')
const http = require('node:http')
const { createConfigLoader } = require('./lib/load-config-module.cjs')
const root = path.resolve(__dirname, '..')
const load = createConfigLoader(root)
const { MAPS, MAP_BY_ID } = load('src/config/maps.ts')
const config = MAP_BY_ID.ember
const { localMapTileUrls } = load('src/utils/mapTiles.ts')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/maps/ember-mobile-q80-v1/manifest.json'), 'utf8'))
const exportSource = fs.readFileSync(path.join(root, 'src/utils/exportTactical.ts'), 'utf8')

test('Ember changes only basemap identity/native resolution, not map coordinates or zoom range', () => {
  assert.equal(config.tileUrl, '/maps/ember-mobile-q80-v1/{z}_{x}_{y}.webp')
  assert.deepEqual(config.southWest, [0,-80])
  assert.deepEqual(config.northEast, [-230,300])
  assert.deepEqual(config.initCenter, [-130,100])
  assert.equal(config.minZoom, 3)
  assert.equal(config.initZoom, 3)
  assert.equal(config.maxZoom, 8)
  assert.equal(config.maxNativeZoom, 4)
  const localizedMaps = new Set(['ember', 'trench', 'ascent', 'flashpoint', 'stormeye'])
  for (const other of MAPS.filter((map) => !localizedMaps.has(map.id))) {
    assert.match(other.tileUrl, /^https:\/\/game\.gtimg\.cn\//)
    assert.deepEqual(localMapTileUrls(other), [])
  }
})

test('every tile within bounds exists, including negative-X pan margins', () => {
  const urls = localMapTileUrls(config)
  assert.equal(urls.length, 464)
  assert.equal(manifest.compression.quality, 80)
  assert.equal(manifest.compression.resampled, false)
  assert.deepEqual(urls.map((url) => path.basename(url)).sort(), manifest.tiles.map((tile) => tile.file).sort())
  assert.ok(urls.includes('/maps/ember-mobile-q80-v1/3_-3_0.webp'))
  assert.ok(urls.includes('/maps/ember-mobile-q80-v1/4_18_14.webp'))
  for (const url of urls) {
    const bytes = fs.readFileSync(path.join(root, 'public', url))
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF')
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP')
    const tile = manifest.tiles.find((item) => item.file === path.basename(url))
    assert.equal(bytes.toString('ascii', 12, 16), tile.encoding === 'lossless' ? 'VP8L' : 'VP8 ', 'declared tile codec')
    assert.equal(bytes.length, tile.bytes)
  }
})

function isolatedCollector(failingUrl) {
  const source = ts.createSourceFile('exportTactical.ts', exportSource, ts.ScriptTarget.Latest, true)
  const fn = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'collectImages')
  const js = ts.transpileModule(`${fn.getText(source)}\nmodule.exports = collectImages`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const stats = { active: 0, max: 0, urls: [] }
  const sandbox = {
    module: { exports: {} }, localMapTileUrls,
    fetch: async (url) => {
      stats.urls.push(url)
      stats.active++
      stats.max = Math.max(stats.max, stats.active)
      await new Promise(setImmediate)
      stats.active--
      return { ok: url !== failingUrl, blob: async () => ({ url }) }
    },
    FileReader: class {
      readAsDataURL() { this.result = 'data:image/webp;base64,test'; this.onload() }
    },
  }
  vm.runInNewContext(js, sandbox)
  return { collect: sandbox.module.exports, stats }
}
const params = () => ({ config, vehicles: [], operators: [], buildings: [], stages: [], capturedStageIndex: 0, showProps: false })

test('shared HTML embeds all local basemap tiles with bounded fetch concurrency', async () => {
  const { collect, stats } = isolatedCollector()
  const images = await collect(params())
  assert.equal(Object.keys(images).length, 464)
  assert.equal(stats.urls.length, 464)
  assert.ok(stats.max <= 8)
  assert.match(images['/maps/ember-mobile-q80-v1/4_6_7.webp'], /^data:image\/webp/)
})

test('missing local tiles fail export explicitly rather than silently sharing a blank basemap', async () => {
  const { collect } = isolatedCollector('/maps/ember-mobile-q80-v1/3_-3_0.webp')
  await assert.rejects(collect(params()), /底图瓦片读取失败/)
})

test('exported HTML tile layer resolves embedded assets before original paths', () => {
  const start = exportSource.indexOf('const cfg = D.config;')
  const end = exportSource.indexOf('/* ---------- 绘制箭头', start)
  assert.ok(start > 0 && end > start)
  const coords = { z:4, x:6, y:7 }
  const url = '/maps/ember-mobile-q80-v1/4_6_7.webp'
  const state = { D: { config, imgs: { [url]: 'data:image/webp;base64,embedded' } }, L: {
    map: () => ({ fitBounds() {}, setMaxBounds() {} }),
    CRS: { Simple: {} }, latLngBounds: () => ({}),
    tileLayer: (template, options) => ({
      options,
      getTileUrl: ({z,x,y}) => template.replace('{z}',z).replace('{x}',x).replace('{y}',y),
      addTo() {},
    }),
  } }
  vm.runInNewContext(`${exportSource.slice(start,end)}\nglobalThis.layer = basemap`, state)
  assert.equal(state.layer.getTileUrl(coords), 'data:image/webp;base64,embedded')
  assert.equal(state.layer.options.minNativeZoom, 3)
  assert.equal(state.layer.options.maxNativeZoom, 4)
})

test('packaged Electron server serves the new tiles with the correct WebP MIME type', async () => {
  const main = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8')
  const start = main.indexOf('function startServer(')
  const end = main.indexOf('\napp.whenReady()', start)
  assert.ok(start >= 0 && end > start)
  const context = { http, fs, path, URL, PORT: 0, server: null }
  vm.runInNewContext(`${main.slice(start,end)}\nglobalThis.start = startServer`, context)
  const server = await context.start(path.join(root, 'public'))
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/maps/ember-mobile-q80-v1/4_6_7.webp`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'image/webp')
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), fs.readFileSync(path.join(root, 'public/maps/ember-mobile-q80-v1/4_6_7.webp')))
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
