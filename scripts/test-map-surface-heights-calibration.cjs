const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const zlib = require('node:zlib')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const sourceNote = 'PC原始静态模型参考高度；未独立核验手游几何。'
const specs = {
  trench: { scale: 4.6875, columns: 1200, width: 1200, pack: 'trench-surfaces-v4' },
  ember: { scale: 4.6875, columns: 1200, width: 1200, pack: 'ember-surfaces-v1' },
  ascent: { scale: 7.8125, columns: 2000, width: 2000, pack: 'ascent-surfaces-v3' },
  flashpoint: { scale: 4.9339678955078125, columns: 1264, width: 1263.09578125, pack: 'flashpoint-surfaces-v3' },
  stormeye: { scale: 6.8157037353515625, columns: 1745, width: 1744.82015625, pack: 'stormeye-surfaces-v3' },
}
const productionCalibration = JSON.parse(fs.readFileSync(path.join(root, 'src/config/mapMetricCalibration.json'), 'utf8'))
const fixtureCalibration = { maps: {} }
for (const [id, spec] of Object.entries(specs)) {
  fixtureCalibration.maps[id] = {
    tileUrl: '/maps/' + id + '-q80/{z}_{x}_{y}.webp',
    surfaceReferenceTileUrl: '/maps/' + id + '-reference/{z}_{x}_{y}.webp',
    worldExtentXYcm: [spec.width * 50, spec.width * 50],
    mapUnitsXY: [256, 256],
  }
}
function transpile(relative) {
  return ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
}
const configCode = transpile('src/config/mapSurfaceModels.ts')
const loaderCode = transpile('src/utils/mapSurfaceHeights.ts')
function configFor(calibration) {
  const module = { exports: {} }
  vm.runInNewContext(configCode, { module, exports: module.exports,
    require: () => ({ __esModule: true, default: calibration }) })
  return module.exports
}
const fixtureConfig = configFor(fixtureCalibration)
// Synthetic slope verifies interpolation and scale independently of generation
// scripts or source-game terrain. Only requested tiles are ever decompressed.
const binaryTiles = new Map()
function encodedTile(width, height) {
  const key = width + ':' + height
  if (binaryTiles.has(key)) return binaryTiles.get(key)
  const count = (width + 1) * (height + 1)
  const raw = Buffer.alloc(16 + (count + width * height + 1) * 4)
  raw.write('MSF1')
  raw.writeUInt16LE(width, 4)
  raw.writeUInt16LE(height, 6)
  raw.writeUInt32LE(0, 8)
  raw.writeUInt32LE(count, 12)
  for (let y = 0; y <= height; y++) for (let x = 0; x <= width; x++) {
    raw.writeFloatLE(100 + x + 10 * y, 16 + (y * (width + 1) + x) * 4)
  }
  const result = {
    rawBytes: raw.length,
    rawSha256: crypto.createHash('sha256').update(raw).digest('hex'),
    envelope: { format: 'deltaforce-map-surface-tile', version: 1, encoding: 'gzip-base64',
      data: zlib.gzipSync(raw).toString('base64') },
  }
  binaryTiles.set(key, result)
  return result
}
function manifestFor(id) {
  const spec = specs[id]
  const tiles = []
  for (let y = 0; y < Math.ceil(spec.columns / 64); y++) for (let x = 0; x < Math.ceil(spec.columns / 64); x++) {
    const encoded = encodedTile(Math.min(64, spec.columns - x * 64), Math.min(64, spec.columns - y * 64))
    tiles.push({ x, y, file: x + '_' + y + '.json', rawBytes: encoded.rawBytes, rawSha256: encoded.rawSha256 })
  }
  return {
    format: 'deltaforce-map-surfaces', version: 2, tileEncoding: 'gzip-base64', mapId: id,
    tileUrl: fixtureCalibration.maps[id].tileUrl, columns: spec.columns, rows: spec.columns,
    tileSize: 64, stepMeters: 1, metersPerMapUnit: spec.scale,
    mapBounds: { west: 0, east: 256, north: 0, south: -256 }, tiles,
    ...(id === 'trench' || id === 'ember' ? {} : { sourceNote }),
  }
}
function fixture(id, transform = value => value) {
  const spec = specs[id]
  const url = '/maps/' + spec.pack + '/manifest.json'
  const requests = []
  const module = { exports: {} }
  vm.runInNewContext(loaderCode, {
    module, exports: module.exports, Response, DecompressionStream, atob, crypto: crypto.webcrypto,
    require: name => { assert.equal(name, '../config/mapSurfaceModels'); return fixtureConfig },
    fetch: async (requested, options) => {
      requests.push(requested)
      assert.equal(options.headers.Accept, 'application/json')
      assert.ok(requested.startsWith('/maps/' + spec.pack + '/'))
      let value
      if (requested === url) value = transform(manifestFor(id))
      else {
        const match = requested.match(/\/(\d+)_(\d+)\.json$/)
        assert.ok(match, 'Only registered JSON height tiles may be requested')
        value = encodedTile(Math.min(64, spec.columns - Number(match[1]) * 64),
          Math.min(64, spec.columns - Number(match[2]) * 64)).envelope
      }
      return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
    },
  })
  return { sample: (lat, lng) => module.exports.sampleMapSurfaces(url, lat, lng),
    unknown: input => module.exports.sampleMapSurfaces(input, -1, 1), requests, url }
}

test('registered packs derive all five scales and ceil dimensions from calibration', () => {
  const select = fixtureConfig.surfaceModelManifestForBasemap
  for (const [id, spec] of Object.entries(specs)) {
    const url = '/maps/' + spec.pack + '/manifest.json'
    assert.equal(select(id, fixtureCalibration.maps[id].tileUrl), url)
    assert.equal(select(id, fixtureCalibration.maps[id].surfaceReferenceTileUrl), undefined)
    const expected = fixtureConfig.surfaceModelForManifest(url)
    assert.equal(expected.columns, spec.columns)
    assert.equal(expected.rows, spec.columns)
    assert.equal(expected.metersPerMapUnit, spec.scale)
  }
  assert.equal(select('__proto__', 'anything'), undefined)
  assert.equal(select('unknown', 'anything'), undefined)
})

test('current application calibrations agree with fixed independent meter references', () => {
  const config = configFor(productionCalibration)
  for (const [id, spec] of Object.entries(specs)) {
    assert.ok(productionCalibration.maps[id], 'Missing production calibration: ' + id)
    const expected = config.surfaceModelForManifest('/maps/' + spec.pack + '/manifest.json')
    assert.ok(expected, 'Unregistered production pack: ' + id)
    assert.equal(expected.metersPerMapUnit, spec.scale)
    assert.equal(expected.columns, spec.columns)
    assert.equal(expected.rows, spec.columns)
  }
})

for (const id of ['ascent', 'flashpoint', 'stormeye']) {
  test(id + ' uses its own scale and carries the PC-only provenance note', async () => {
    const { sample, requests } = fixture(id)
    assert.equal(requests.length, 0, 'Importing/selecting a map must not fetch any height data')
    const result = await sample(-.5 / specs[id].scale, .5 / specs[id].scale)
    assert.ok(Math.abs(result.groundMeters - 105.5) < 1e-6)
    assert.equal(result.sampleSpacingMeters, 1)
    assert.equal(result.candidates.length, 1)
    assert.equal(result.sourceNote, sourceNote)
    assert.equal(requests.length, 2, 'Only the manifest and selected endpoint tile should load')
  })
  test(id + ' samples the exact southeast edge without stretching padded dimensions', async () => {
    const { sample, requests } = fixture(id)
    const spec = specs[id]
    const localMeters = spec.width - Math.floor((spec.columns - 1) / 64) * 64
    const result = await sample(-256, 256)
    assert.ok(Math.abs(result.groundMeters - (100 + 11 * localMeters)) < 1e-6)
    assert.equal(requests.length, 2)
    assert.equal(await sample(-256.00001, 256), null)
    assert.equal(await sample(-256, 256.00001), null)
    assert.equal(requests.length, 2, 'Out-of-range points must not fetch a tile')
  })
}

for (const id of ['trench', 'ember']) {
  test(id + ' accepts its legacy manifest without sourceNote and retains 1200m bounds', async () => {
    const { sample } = fixture(id)
    const result = await sample(-256, 256)
    assert.equal(result.sourceNote, undefined)
    assert.equal(result.groundMeters, 100 + 11 * 48)
    const broken = fixture(id, value => ({ ...value, metersPerMapUnit: specs.ascent.scale }))
    await assert.rejects(broken.sample(-1, 1), /高度索引格式不匹配/)
  })
}

test('malformed or mismatched manifests fail before any tile fetch', async t => {
  const cases = {
    stale_version: value => ({ ...value, version: 1 }),
    wrong_map: value => ({ ...value, mapId: 'trench' }),
    wrong_basemap: value => ({ ...value, tileUrl: '/unregistered/{z}_{x}_{y}.png' }),
    wrong_scale: value => ({ ...value, metersPerMapUnit: 4.6875 }),
    floor_instead_of_ceil: value => ({ ...value, columns: 1263 }),
    stretched_height: value => ({ ...value, rows: 1265 }),
    wrong_step: value => ({ ...value, stepMeters: 2 }),
    wrong_tile_size: value => ({ ...value, tileSize: 128 }),
    wrong_bounds: value => ({ ...value, mapBounds: { ...value.mapBounds, east: 255 } }),
    missing_provenance: value => ({ ...value, sourceNote: undefined }),
    misleading_provenance: value => ({ ...value, sourceNote: 'verified mobile geometry' }),
    missing_tile: value => ({ ...value, tiles: value.tiles.slice(1) }),
    duplicate_tile: value => ({ ...value, tiles: [value.tiles[1], ...value.tiles.slice(1)] }),
    unsafe_file: value => ({ ...value, tiles: [{ ...value.tiles[0], file: '../0_0.json' }, ...value.tiles.slice(1)] }),
    invalid_hash: value => ({ ...value, tiles: [{ ...value.tiles[0], rawSha256: 'bad' }, ...value.tiles.slice(1)] }),
    invalid_length: value => ({ ...value, tiles: [{ ...value.tiles[0], rawBytes: 1 }, ...value.tiles.slice(1)] }),
  }
  for (const [name, transform] of Object.entries(cases)) await t.test(name, async () => {
    const { sample, requests, url } = fixture('flashpoint', transform)
    await assert.rejects(sample(-1, 1), /高度索引.*不匹配/)
    assert.deepEqual(requests, [url])
  })
})

test('unknown packs are rejected without a request, and concurrent endpoints share requests', async () => {
  const { sample, unknown, requests, url } = fixture('ascent')
  await assert.rejects(unknown('/maps/unregistered/manifest.json'), /未绑定已标定地图/)
  assert.equal(requests.length, 0)
  const values = await Promise.all(Array.from({ length: 20 }, () => sample(-1, 1)))
  assert.ok(values.every(value => value.groundMeters === values[0].groundMeters))
  assert.deepEqual(requests, [url, '/maps/ascent-surfaces-v3/0_0.json'])
})

test('tile caching retains exactly the 32 most recently used endpoint tiles', async () => {
  const { sample, requests } = fixture('ascent')
  const at = (x, y) => sample(-(y * 64 + .5) / specs.ascent.scale, (x * 64 + .5) / specs.ascent.scale)
  for (let x = 0; x < 32; x++) await at(x, 0)
  await at(0, 0)
  await at(0, 1)
  await at(0, 0)
  assert.equal(requests.filter(url => url.endsWith('/0_0.json')).length, 1, 'Recently used tile should stay')
  await at(1, 0)
  assert.equal(requests.filter(url => url.endsWith('/1_0.json')).length, 2, 'Least recently used tile should reload')
})

test('a rejected manifest is evicted so the next measurement can retry', async () => {
  let first = true
  const { sample, requests, url } = fixture('ascent', value => {
    if (first) { first = false; return { ...value, columns: 1200 } }
    return value
  })
  await assert.rejects(sample(-1, 1), /高度索引格式不匹配/)
  assert.ok(await sample(-1, 1))
  assert.equal(requests.filter(value => value === url).length, 2)
})

test('legacy map calibration guards reject changed or non-isotropic extents', () => {
  for (const id of ['trench', 'ember']) {
    const calibration = structuredClone(fixtureCalibration)
    calibration.maps[id].worldExtentXYcm = [100000, 100000]
    assert.equal(configFor(calibration).surfaceModelForManifest('/maps/' + specs[id].pack + '/manifest.json'), undefined)
  }
  const calibration = structuredClone(fixtureCalibration)
  calibration.maps.flashpoint.worldExtentXYcm[1] += 1
  assert.equal(configFor(calibration).surfaceModelForManifest('/maps/flashpoint-surfaces-v3/manifest.json'), undefined)
})

for (const id of ['ascent', 'flashpoint', 'stormeye']) {
  test(id + ' production v3 JSON loads through the real sampler, including repaired B1 roofs', async () => {
    const module = { exports: {} }
    const productionConfig = configFor(productionCalibration)
    vm.runInNewContext(loaderCode, {
      module, exports: module.exports, Response, DecompressionStream, atob, crypto: crypto.webcrypto,
      require: () => productionConfig,
      fetch: async url => {
        assert.ok(url.startsWith('/maps/' + specs[id].pack + '/'))
        assert.match(url, /\/(manifest|\d+_\d+)\.json$/)
        return new Response(fs.readFileSync(path.join(root, 'public', url)), {
          headers: { 'Content-Type': 'application/json' },
        })
      },
    })
    const url = '/maps/' + specs[id].pack + '/manifest.json'
    const edge = await module.exports.sampleMapSurfaces(url, -256, 256)
    assert.ok(Number.isFinite(edge.groundMeters))
    assert.equal(edge.sourceNote, sourceNote)
    if (id === 'ascent') {
      // Fixed references from independent source-triangle rays, not generated
      // from the current pack. Both warehouse shells were missing in v1.
      for (const [row, col, roof] of [[978, 817, -213.32], [955, 845, -213.28]]) {
        const sample = await module.exports.sampleMapSurfaces(url, -(row + .5) / specs[id].scale, (col + .5) / specs[id].scale)
        assert.ok(sample.candidates.some(candidate => Math.abs(candidate.heightMeters - roof) < 1e-6))
      }
    } else {
      assert.ok(await module.exports.sampleMapSurfaces(url, -128, 128))
    }
  })
}

