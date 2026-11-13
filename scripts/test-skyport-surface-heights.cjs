const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const zlib = require('node:zlib')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const url = '/maps/skyport-surfaces-v1/manifest.json'
const bounds = { west: 3.328, east: 256, north: 0, south: -209.152 }
const scale = 7.8125
const sourceNote = 'PC原始静态模型参考高度；未独立核验手游几何。 仅覆盖原生地形有效范围，边缘保留水平测距。'
const calibration = JSON.parse(fs.readFileSync(path.join(root, 'src/config/mapMetricCalibration.json'), 'utf8'))
const transpile = relative => ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const configCode = transpile('src/config/mapSurfaceModels.ts')
const loaderCode = transpile('src/utils/mapSurfaceHeights.ts')
function configFor(value = calibration) {
  const module = { exports: {} }
  vm.runInNewContext(configCode, { module, exports: module.exports,
    require: () => ({ __esModule: true, default: value }) })
  return module.exports
}
const registered = configFor()
const encodedTiles = new Map()
function encodedTile(w, h) {
  const key = w + ':' + h
  if (encodedTiles.has(key)) return encodedTiles.get(key)
  const nodes = (w+1)*(h+1)
  const raw = Buffer.alloc(16+(nodes+w*h+1)*4)
  raw.write('MSF1'); raw.writeUInt16LE(w, 4); raw.writeUInt16LE(h, 6); raw.writeUInt32LE(nodes, 12)
  for (let y = 0; y <= h; y++) for (let x = 0; x <= w; x++) raw.writeFloatLE(100+x+10*y, 16+(y*(w+1)+x)*4)
  const compressed = zlib.gzipSync(raw)
  const value = { rawBytes: raw.length, rawSha256: crypto.createHash('sha256').update(raw).digest('hex'),
    data: { format: 'deltaforce-map-surface-tile', version: 1, encoding: 'gzip-base64', data: compressed.toString('base64') } }
  encodedTiles.set(key, value)
  return value
}
function syntheticManifest() {
  const tiles = []
  for (let y = 0; y < 26; y++) for (let x = 0; x < 31; x++) {
    const encoded = encodedTile(Math.min(64, 1974-x*64), Math.min(64, 1634-y*64))
    tiles.push({ x, y, file: x+'_'+y+'.json', rawBytes: encoded.rawBytes, rawSha256: encoded.rawSha256 })
  }
  return { format: 'deltaforce-map-surfaces', version: 2, tileEncoding: 'gzip-base64', mapId: 'skyport',
    tileUrl: calibration.maps.skyport.tileUrl, columns: 1974, rows: 1634, tileSize: 64, stepMeters: 1,
    metersPerMapUnit: scale, sourceNote, mapBounds: bounds, tiles }
}
function loader(transform = value => value, actual = false) {
  const requests = []
  const module = { exports: {} }
  vm.runInNewContext(loaderCode, { module, exports: module.exports, Response, DecompressionStream, atob,
    crypto: crypto.webcrypto, require: () => registered,
    fetch: async (requested, options) => {
      requests.push(requested)
      assert.ok(requested.startsWith('/maps/skyport-surfaces-v1/'))
      assert.equal(options.headers.Accept, 'application/json')
      let value
      if (actual) value = fs.readFileSync(path.join(root, 'public', requested))
      else if (requested === url) value = JSON.stringify(transform(syntheticManifest()))
      else {
        const match = requested.match(/\/(\d+)_(\d+)\.json$/)
        assert.ok(match)
        value = JSON.stringify(encodedTile(Math.min(64, 1974-Number(match[1])*64), Math.min(64, 1634-Number(match[2])*64)).data)
      }
      return new Response(value, { headers: { 'Content-Type': 'application/json' } })
    } })
  return { requests, sample: (lat, lng) => module.exports.sampleMapSurfaces(url, lat, lng) }
}

test('Skyport retains full-map metric scale but registers only the exact finite source window', () => {
  const value = registered.surfaceModelForManifest(url)
  assert.equal(value.columns, 1974); assert.equal(value.rows, 1634); assert.equal(value.metersPerMapUnit, scale)
  for (const [key, number] of Object.entries(bounds)) assert.equal(value.mapBounds[key] || 0, number)
  assert.equal(value.sourceNote, sourceNote)
  assert.equal(registered.surfaceModelManifestForBasemap('skyport', calibration.maps.skyport.tileUrl), url)
  assert.equal(registered.surfaceModelManifestForBasemap('skyport', '/wrong-basemap'), undefined)
})

test('cropped northwest and southeast use the original 1m grid without shifting or stretching', async () => {
  const { sample, requests } = loader()
  assert.equal(requests.length, 0)
  const nw = await sample(-.5/scale, bounds.west+.5/scale)
  assert.ok(Math.abs(nw.groundMeters-105.5) < 1e-9)
  const se = await sample(bounds.south, bounds.east)
  assert.ok(Math.abs(se.groundMeters-494) < 1e-9)
  assert.deepEqual(requests, [url, '/maps/skyport-surfaces-v1/0_0.json', '/maps/skyport-surfaces-v1/30_25.json'])
})

test('unknown western/southern strips return no height and request no terrain tile', async () => {
  const { sample, requests } = loader()
  for (const [lat, lng] of [[-1, 0], [-1, bounds.west-.00001], [bounds.south-.00001, 128], [-256, 256]]) {
    assert.equal(await sample(lat, lng), null)
  }
  assert.deepEqual(requests, [url])
})

test('fake full-map bounds, dimensions, spacing and misleading provenance fail before tile fetch', async t => {
  const cases = {
    stretched_bounds: value => ({ ...value, mapBounds: { west: 0, east: 256, north: 0, south: -256 } }),
    stretched_columns: value => ({ ...value, columns: 2000 }),
    stretched_rows: value => ({ ...value, rows: 2000 }),
    guessed_scale: value => ({ ...value, metersPerMapUnit: 4.6875 }),
    missing_coverage_note: value => ({ ...value, sourceNote: 'PC原始静态模型参考高度；未独立核验手游几何。' }),
  }
  for (const [name, transform] of Object.entries(cases)) await t.test(name, async () => {
    const { sample, requests } = loader(transform)
    await assert.rejects(sample(-128, 128), /高度索引格式不匹配/)
    assert.deepEqual(requests, [url])
  })
})

test('invalid fractional, inverted or out-of-map windows are not registered', () => {
  for (const patch of [{ left: -1 }, { left: .5 }, { left: 2000 }, { right: 2001 }, { bottom: 0 }]) {
    const value = structuredClone(calibration)
    Object.assign(value.maps.skyport.surfaceSampleWindowGrid, patch)
    assert.equal(configFor(value).surfaceModelForManifest(url), undefined)
  }
})

test('shipped Skyport pack matches partial registration and every transmitted raw tile hash', () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'public', url), 'utf8'))
  assert.equal(m.mapId, 'skyport'); assert.equal(m.partialTerrainCoverage, true)
  assert.deepEqual(m.sourceSampleWindowGrid, { left: 26, top: 0, right: 2000, bottom: 1634 })
  assert.equal(m.tiles.length, 806); assert.deepEqual(m.mapBounds, bounds)
  assert.equal(m.statistics.overflowCells, 0)
  for (const item of m.tiles) {
    const bytes = fs.readFileSync(path.join(root, 'public/maps/skyport-surfaces-v1', item.file))
    const raw = zlib.gunzipSync(Buffer.from(JSON.parse(bytes).data, 'base64'))
    assert.equal(raw.length, item.rawBytes)
    assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), item.rawSha256)
  }
})

test('all seven actual objective locations expose finite terrain and model candidates through production loader', async () => {
  const official = JSON.parse(fs.readFileSync(path.join(root, 'src/config/skyportOfficial.json'), 'utf8'))
  const points = new Map(official.pc.stages.flatMap(stage => stage.points).map(point => [point.lat+':'+point.lng, point]))
  assert.equal(points.size, 7)
  const { sample, requests } = loader(undefined, true)
  assert.equal(requests.length, 0)
  for (const point of points.values()) {
    const value = await sample(point.lat, point.lng)
    assert.ok(value && Number.isFinite(value.groundMeters), point.name)
    assert.ok(value.candidates.every(candidate => Number.isFinite(candidate.heightMeters)))
    assert.equal(value.sourceNote, sourceNote)
  }
  assert.equal(await sample(-256, 256), null)
})
