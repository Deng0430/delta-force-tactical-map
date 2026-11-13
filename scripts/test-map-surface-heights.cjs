const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const zlib = require('node:zlib')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const manifestUrl = '/maps/trench-surfaces-v4/manifest.json'
const directory = path.join(root, 'public/maps/trench-surfaces-v4')
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'))
const tileUrl = '/maps/trench-surfaces-v4/4_8.json'
const originalEnvelope = JSON.parse(fs.readFileSync(path.join(directory, '4_8.json'), 'utf8'))
const originalRaw = zlib.gunzipSync(Buffer.from(originalEnvelope.data, 'base64'))
const code = ts.transpileModule(fs.readFileSync(path.join(root, 'src/utils/mapSurfaceHeights.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const calibration = JSON.parse(fs.readFileSync(path.join(root, 'src/config/mapMetricCalibration.json'), 'utf8'))
const configCode = ts.transpileModule(fs.readFileSync(path.join(root, 'src/config/mapSurfaceModels.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const configModule = { exports: {} }
vm.runInNewContext(configCode, { module: configModule, exports: configModule.exports,
  require: () => ({ __esModule: true, default: calibration }) })

function fixture(transform = (url, value) => value) {
  const requests = []
  const module = { exports: {} }
  vm.runInNewContext(code, {
    module, exports: module.exports, Response, DecompressionStream, atob,
    crypto: crypto.webcrypto,
    require: (name) => {
      assert.equal(name, '../config/mapSurfaceModels')
      return configModule.exports
    },
    fetch: async (url, options) => {
      requests.push(url)
      assert.ok(url.endsWith('.json'), `Runtime must not request an archive: ${url}`)
      assert.equal(options.headers.Accept, 'application/json')
      const value = JSON.parse(fs.readFileSync(path.join(root, 'public', url.slice(1)), 'utf8'))
      return new Response(JSON.stringify(transform(url, value)), { headers: { 'Content-Type': 'application/json' } })
    },
  })
  return { sample: module.exports.sampleMapSurfaces, requests }
}

// Use an original one-surface cell from the tile in the IDM report, independent
// of the runtime decoder, to check that the new transport preserves both heights.
const width = originalRaw.readUInt16LE(4)
const height = originalRaw.readUInt16LE(6)
const groundCount = originalRaw.readUInt32LE(12)
const offsetAt = 16 + groundCount * 4
const surfaceAt = offsetAt + (width * height + 1) * 4
let cell
for (let i = 0; i < width * height; i++) {
  const first = originalRaw.readUInt32LE(offsetAt + i * 4)
  const last = originalRaw.readUInt32LE(offsetAt + (i + 1) * 4)
  if (last - first !== 1) continue
  const x = i % width
  const y = Math.floor(i / width)
  const ground = [y * (width + 1) + x, y * (width + 1) + x + 1,
    (y + 1) * (width + 1) + x, (y + 1) * (width + 1) + x + 1]
    .map(index => originalRaw.readFloatLE(16 + index * 4)).reduce((a, b) => a + b) / 4
  const model = originalRaw.readInt32LE(surfaceAt + first * 4) / 100
  if (Math.abs(model - ground) < .12) continue
  cell = { ground, model, lat: -(8 * 64 + y + .5) / 4.6875, lng: (4 * 64 + x + .5) / 4.6875 }
  break
}
assert.ok(cell, 'The reported tile must retain a testable model surface')

test('all 361 current JSON tiles match their binary checksums and recovered source metadata', () => {
  assert.equal(manifest.version, 2)
  assert.equal(manifest.tileEncoding, 'gzip-base64')
  assert.equal(manifest.tiles.length, 361)
  let bytes = 0
  for (const tile of manifest.tiles) {
    assert.equal(tile.file, `${tile.x}_${tile.y}.json`)
    const body = fs.readFileSync(path.join(directory, tile.file))
    const envelope = JSON.parse(body)
    assert.equal(envelope.format, 'deltaforce-map-surface-tile')
    assert.equal(envelope.version, 1)
    assert.equal(envelope.encoding, 'gzip-base64')
    const packed = Buffer.from(envelope.data, 'base64')
    const raw = zlib.gunzipSync(packed)
    assert.equal(body.length, tile.bytes)
    assert.equal(packed.length, tile.compressedBytes)
    assert.equal(raw.length, tile.rawBytes)
    assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), tile.rawSha256)
    bytes += body.length
  }
  assert.equal(bytes, manifest.statistics.tileBytes)
  assert.equal(manifest.statistics.modelSurfaceSamples, 252934)
  assert.equal(manifest.sourceHashes.supplements.length, 1)
  assert.equal(manifest.sourceHashes.supplements[0].recoveredBuildings, 10)
})

test('the application selects calibrated Trench and Ember height packs', () => {
  const select = configModule.exports.surfaceModelManifestForBasemap
  assert.equal(select('trench', calibration.maps.trench.tileUrl), manifestUrl)
  assert.equal(select('trench', '/another-basemap/{z}_{x}_{y}.png'), undefined)
  assert.equal(select('ember', calibration.maps.ember.tileUrl), '/maps/ember-surfaces-v1/manifest.json')
  assert.equal(select('ember', calibration.maps.trench.tileUrl), undefined)
})

test('another map cannot be supplied in place of the calibrated Ember index', async () => {
  const emberUrl = '/maps/ember-surfaces-v1/manifest.json'
  const { sample, requests } = fixture((url, value) => url === emberUrl ? { ...value, mapId: 'trench' } : value)
  await assert.rejects(sample(emberUrl, -130, 100), /高度索引格式不匹配/)
  assert.deepEqual(requests, [emberUrl])
})

test('all Ember height tiles retain source metadata, layout and byte checksums', () => {
  const directory = path.join(root, 'public/maps/ember-surfaces-v1')
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'))
  assert.equal(manifest.mapId, 'ember')
  assert.equal(manifest.sourcePlatform, 'mobile')
  assert.equal(manifest.pcGeometryParity, 'user-confirmed')
  assert.equal(manifest.tileUrl, calibration.maps.ember.surfaceReferenceTileUrl)
  assert.equal(manifest.tiles.length, 361)
  let samples = 0
  let bytes = 0
  for (const tile of manifest.tiles) {
    assert.equal(tile.file, `${tile.x}_${tile.y}.json`)
    const body = fs.readFileSync(path.join(directory, tile.file))
    const envelope = JSON.parse(body)
    assert.equal(envelope.format, 'deltaforce-map-surface-tile')
    assert.equal(envelope.encoding, 'gzip-base64')
    const packed = Buffer.from(envelope.data, 'base64')
    const raw = zlib.gunzipSync(packed)
    assert.equal(body.length, tile.bytes)
    assert.equal(packed.length, tile.compressedBytes)
    assert.equal(raw.length, tile.rawBytes)
    assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), tile.rawSha256)
    assert.equal(raw.subarray(0, 4).toString(), 'MSF1')
    const width = raw.readUInt16LE(4)
    const height = raw.readUInt16LE(6)
    const count = raw.readUInt32LE(8)
    const groundCount = raw.readUInt32LE(12)
    assert.equal(groundCount, (width + 1) * (height + 1))
    assert.equal(raw.length, 16 + (groundCount + width * height + 1 + count) * 4)
    samples += count
    bytes += body.length
  }
  assert.equal(samples, 185594)
  assert.equal(samples, manifest.statistics.modelSurfaceSamples)
  assert.equal(bytes, manifest.statistics.tileBytes)
})

test('Ember A, B1/B2 and C1/C2 roofs resolve to independent source triangle samples', async () => {
  const { sample, requests } = fixture()
  const url = '/maps/ember-surfaces-v1/manifest.json'
  // Source face/instance evidence: source/手游提取资源/烬区/高度数据/高度数据核对.json.
  // Negative world Z is valid; these roofs remain above their local terrain.
  for (const [lat, lng, roof, ground] of [
    [-154.98666666666668, 75.62666666666665, -7.52, -12.877330303192139],
    [-133.01333333333332, 85.43999999999998, -3.72, -7.964840769767761],
    [-131.73333333333332, 108.47999999999999, -7.08, -11.951252937316895],
    [-112.74666666666667, 129.38666666666666, -.43, -11.026859283447266],
    [-132.58666666666667, 141.54666666666665, -6.4, -10.495670318603516],
  ]) {
    const result = await sample(url, lat, lng)
    assert.equal(result.candidates[0].kind, 'model')
    assert.ok(Math.abs(result.candidates[0].heightMeters - roof) < .005)
    assert.ok(Math.abs(result.groundMeters - ground) < 1e-6)
    assert.ok(result.candidates.some(value => value.kind === 'terrain'))
    assert.ok(result.candidates[0].heightMeters > result.groundMeters + 2)
  }
  assert.equal(requests.filter(value => value === url).length, 1)
  assert.ok(requests.every(value => value.startsWith('/maps/ember-surfaces-v1/')))
})

test('restored C building roofs resolve to independently recovered source triangle heights', async () => {
  const { sample } = fixture()
  // World centres (1214.5,1094.5) and (1220.5,1088.5) metres. Direct vertical
  // intersections of the blueprint's intact Village_04 mesh give these heights.
  for (const [lat, lng, roof] of [
    [-115.30666666666667, 168.42666666666668, 15.06],
    [-116.58666666666667, 169.70666666666668, 19.95],
  ]) {
    const result = await sample(manifestUrl, lat, lng)
    assert.equal(result.candidates[0].kind, 'model')
    assert.ok(Math.abs(result.candidates[0].heightMeters - roof) < .005)
    assert.ok(result.candidates.some(value => value.kind === 'terrain'))
  }
})

test('open ground beside the C building is not filled from its rectangular bounds', async () => {
  const { sample } = fixture()
  const result = await sample(manifestUrl, -115.20703333333333, 166.6926)
  assert.equal(result.candidates.length, 1)
  assert.equal(result.candidates[0].kind, 'terrain')
})

test('the production loader reads the reported point through JSON and caches its height tile', async () => {
  const { sample, requests } = fixture()
  const result = await sample(manifestUrl, cell.lat, cell.lng)
  assert.ok(Math.abs(result.groundMeters - cell.ground) < 1e-6)
  assert.equal(result.sampleSpacingMeters, 1)
  assert.equal(result.candidates.length, 2)
  assert.ok(result.candidates.some(value => value.kind === 'model' && value.heightMeters === cell.model))
  await sample(manifestUrl, cell.lat, cell.lng)
  assert.deepEqual(requests, [manifestUrl, tileUrl])
})

test('a stale v1 index is rejected before an archive can be requested', async () => {
  const { sample, requests } = fixture((url, value) => url === manifestUrl ? { ...value, version: 1 } : value)
  await assert.rejects(sample(manifestUrl, cell.lat, cell.lng), /高度索引格式不匹配/)
  assert.deepEqual(requests, [manifestUrl])
})

test('the JSON envelope still enforces the original SHA-256 integrity check', async () => {
  const corrupted = Buffer.from(originalRaw)
  corrupted[corrupted.length - 1] ^= 1
  const { sample } = fixture((url, value) => url === tileUrl
    ? { ...value, data: zlib.gzipSync(corrupted).toString('base64') } : value)
  await assert.rejects(sample(manifestUrl, cell.lat, cell.lng), /高度瓦片校验不匹配/)
})

test('a failed tile request can be retried on the next measurement', async () => {
  let failed = false
  const { sample, requests } = fixture((url, value) => {
    if (url === tileUrl && !failed) { failed = true; throw new TypeError('Failed to fetch') }
    return value
  })
  await assert.rejects(sample(manifestUrl, cell.lat, cell.lng), /Failed to fetch/)
  const result = await sample(manifestUrl, cell.lat, cell.lng)
  assert.ok(Math.abs(result.groundMeters - cell.ground) < 1e-6)
  assert.deepEqual(requests, [manifestUrl, tileUrl, tileUrl])
})
