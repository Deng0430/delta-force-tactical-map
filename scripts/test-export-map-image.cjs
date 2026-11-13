const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

const source = fs.readFileSync('src/utils/exportMapImage.ts', 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function fixture({ decode = async () => {}, connected = true, blob = new Blob(['png'], { type: 'image/png' }) } = {}) {
  const calls = []
  const bounds = { left: 0, top: 58, right: 1440, bottom: 900, width: 1440, height: 842 }
  const image = { decode, getBoundingClientRect: () => bounds }
  const output = { width: 0, height: 0, getContext: () => ({ drawImage: (...args) => calls.push(['crop', ...args]) }), toBlob: (cb) => cb(blob) }
  const platform = { downloadBlob: async (...args) => calls.push(['save', ...args]) }
  const element = {
    isConnected: connected, getBoundingClientRect: () => bounds, querySelectorAll: () => [image],
    closest: () => ({ querySelector: (selector) => ({ getBoundingClientRect: () => selector.includes('left-panel')
      ? { left: 0, right: 300, top: 58, bottom: 900 } : { left: 1190, right: 1440, top: 58, bottom: 900 } }) }),
  }
  class Element { matches(selector) { return selector.split(',').some((item) => item.trim() === this.selector) } }
  const context = {
    module: { exports: {} }, Blob, Element, Date, AbortSignal, setTimeout, clearTimeout,
    window: { devicePixelRatio: 3 }, document: { fonts: { ready: Promise.resolve() }, createElement: () => output },
    getComputedStyle: () => ({ visibility: 'visible', backgroundColor: '#111' }),
    requestAnimationFrame: (cb) => { cb(); return 1 },
    require: (name) => {
      if (name === '../platform') return { platform }
      assert.equal(name, 'html-to-image')
      return { toCanvas: async (root, options) => {
        assert.equal(root, element)
        calls.push(['capture', options])
        return { width: options.width * options.pixelRatio, height: options.height * options.pixelRatio }
      } }
    },
  }
  context.exports = context.module.exports
  vm.runInNewContext(code, context)
  return { ...context.module.exports, element, calls, output, Element }
}

test('PNG filename identifies the live stage and round and is safe on Windows', () => {
  const { mapImageFilename } = fixture()
  const filename = mapImageFilename('测试/地图:一', 'S3', 2, new Date('2026-11-13T01:02:03.000Z'))
  assert.match(filename, /^测试_地图_一_S3_回合2_/)
  assert.ok(filename.endsWith('.png'))
  assert.doesNotMatch(filename, /[<>:"/\\|?*\x00-\x1f]/)
})

test('only actual visible map pixels are exported; closed or CSS-hidden panels do not crop', () => {
  const { mapImageViewport } = fixture()
  const rect = { left: 0, right: 1440, top: 58, bottom: 900 }
  const left = { left: 0, right: 300, top: 58, bottom: 900 }
  const right = { left: 1190, right: 1440, top: 58, bottom: 900 }
  assert.deepEqual({ ...mapImageViewport(rect, left, right) }, { x: 300, y: 0, width: 890, height: 842 })
  assert.equal(mapImageViewport(rect).width, 1440)
  assert.equal(mapImageViewport(rect, left).width, 1140)
  assert.equal(mapImageViewport(rect, undefined, { left: 0, right: 0, top: 0, bottom: 0 }).width, 1440)
})

test('capture omits UI and edit controls but retains map content, scale and unit identity badges', () => {
  const { includeInMapImage, Element } = fixture()
  for (const selector of ['.leaflet-popup-pane', '.edit-handle-wrap', '.route-editor-trigger-wrap', '.op-action-fan']) {
    const el = new Element(); el.selector = selector
    assert.equal(includeInMapImage(el), false)
  }
  for (const selector of ['.map-metric-scale', '.prop-glyph', '.veh-team-letter', '.op-team-letter']) {
    const el = new Element(); el.selector = selector
    assert.equal(includeInMapImage(el), true)
  }
  assert.equal(includeInMapImage({}), true)
})

test('live DOM capture crops without recentering, caps DPI and writes a binary PNG', async () => {
  const f = fixture()
  await f.exportMapImage(f.element, 'live.png')
  const options = f.calls.find(([type]) => type === 'capture')[1]
  assert.equal(options.pixelRatio, 2)
  assert.equal(options.width, 1440)
  assert.equal(options.height, 842)
  assert.equal(f.output.width, 1780)
  assert.equal(f.output.height, 1684)
  const save = f.calls.find(([type]) => type === 'save')
  assert.equal(save[1], 'live.png')
  assert.equal(save[2].type, 'image/png')
})

test('failed image loading and detached maps fail explicitly rather than downloading incomplete images', async () => {
  for (const f of [fixture({ decode: async () => { throw new Error('broken tile') } }), fixture({ connected: false })]) {
    await assert.rejects(f.exportMapImage(f.element, 'failed.png'))
    assert.ok(!f.calls.some(([type]) => type === 'save'))
  }
  const empty = fixture({ blob: null })
  await assert.rejects(empty.exportMapImage(empty.element, 'empty.png'), /图片生成失败/)
})

test('image export is bound to the live map, not HTML export selection or stored tactical buckets', () => {
  const app = fs.readFileSync('src/App.tsx', 'utf8')
  const handler = app.slice(app.indexOf('const handleExportMapImage'), app.indexOf('/** 导出战术板 HTML'))
  assert.match(handler, /map\.getContainer\(\)/)
  assert.match(handler, /wargame\.round/)
  assert.doesNotMatch(handler, /applyTacticalBucket|exportStageId|exportRound|setView/)
  const adapter = fs.readFileSync('src/platform/index.ts', 'utf8')
  const downloadBlob = adapter.slice(adapter.indexOf('async function downloadBlob'), adapter.indexOf('export const platform'))
  assert.match(downloadBlob, /data: base64/)
  assert.doesNotMatch(downloadBlob, /encoding: Encoding\.UTF8/)
})

test('Android PNG writes exact binary bytes without UTF8 encoding, then opens the system share sheet', async () => {
  const input = new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255])], { type: 'image/png' })
  const writes = [], shares = []
  const platformSource = fs.readFileSync('src/platform/index.ts', 'utf8').replaceAll('import.meta.env.DEV', 'false')
  const platformCode = ts.transpileModule(platformSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const context = {
    module: { exports: {} }, URLSearchParams, Blob, Date, console,
    window: { location: { search: '' } }, navigator: { userAgent: 'Android test' },
    Capacitor: { getPlatform: () => 'android', isNativePlatform: () => true },
    FileReader: class {
      readAsDataURL(blob) { void blob.arrayBuffer().then(data => { this.result = `data:${blob.type};base64,${Buffer.from(data).toString('base64')}`; this.onload() }) }
    },
    require: (name) => {
      if (name === '@capacitor/filesystem') return { Directory: { Cache: 'CACHE' }, Filesystem: { writeFile: async (options) => { writes.push(options); return { uri: 'file:///cache/exports/test.png' } } } }
      assert.equal(name, '@capacitor/share')
      return { Share: { share: async (options) => shares.push(options) } }
    },
  }
  context.exports = context.module.exports
  vm.runInNewContext(platformCode, context)
  await context.module.exports.platform.downloadBlob('test.png', input)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].encoding, undefined)
  assert.deepEqual(Buffer.from(writes[0].data, 'base64'), Buffer.from(await input.arrayBuffer()))
  assert.equal(shares[0].url, 'file:///cache/exports/test.png')
})
