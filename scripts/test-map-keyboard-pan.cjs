// 无浏览器依赖的键盘控制回归测试：node scripts/test-map-keyboard-pan.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '../src/utils/mapKeyboardPan.ts'), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText

class Surface {
  listeners = new Map()
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type).add(listener)
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener) }
  emit(type, event = {}) { for (const listener of this.listeners.get(type) ?? []) listener(event) }
  on(types, listener) { for (const type of types.split(' ')) this.addEventListener(type, listener) }
  off(types, listener) { for (const type of types.split(' ')) this.removeEventListener(type, listener) }
  count() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0) }
}

class Element {
  isConnected = true
  isContentEditable = false
  editable = false
  visible = true
  closest() { return this.editable ? this : null }
  getClientRects() { return this.visible ? [{}] : [] }
}

function fixture() {
  const window = new Surface()
  const document = new Surface()
  const container = new Element()
  const map = new Surface()
  const frames = new Map()
  let frameId = 0
  let now = 0
  let dragging = true
  let keyboard = true
  document.activeElement = new Element()
  document.visibilityState = 'visible'
  document.modal = null
  document.querySelector = () => document.modal
  window.requestAnimationFrame = (callback) => { frames.set(++frameId, callback); return frameId }
  window.cancelAnimationFrame = (id) => frames.delete(id)
  map.getContainer = () => container
  map.options = {}
  map.dragging = { enabled: () => dragging }
  map.keyboard = { enabled: () => keyboard }
  map.calls = []
  map.stop = () => {}
  map.panBy = (offset, options) => {
    assert.equal(options.animate, false)
    map.calls.push(offset)
  }
  const module = { exports: {} }
  vm.runInNewContext(compiled, { module, exports: module.exports, window, document, HTMLElement: Element, performance: { now: () => now } })
  const detach = module.exports.attachMapKeyboardPan(map)
  const event = (code, patch = {}) => ({
    code, key: code.replace('Key', '').toLowerCase(),
    target: document.activeElement, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false,
    isComposing: false, repeat: false, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true },
    composedPath() { return [this.target] }, ...patch,
  })
  return {
    window, document, container, map, frames, detach, Element,
    keyDown(code, patch) { const e = event(code, patch); window.emit('keydown', e); return e },
    keyUp(code, patch) { window.emit('keyup', event(code, patch)) },
    tick(time) { now = time; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback(time)) },
    setDragging(value) { dragging = value },
    setKeyboard(value) { keyboard = value },
    total() { return map.calls.reduce(([x, y], [dx, dy]) => [x + dx, y + dy], [0, 0]) },
  }
}

test('WASD 四方向及松键停止', () => {
  for (const [key, expected] of [['KeyW', [0, -36]], ['KeyA', [-36, 0]], ['KeyS', [0, 36]], ['KeyD', [36, 0]]]) {
    const f = fixture()
    assert.equal(f.keyDown(key).defaultPrevented, true)
    assert.deepEqual(Array.from(f.map.calls[0]), expected)
    f.keyUp(key)
    f.tick(20)
    assert.equal(f.map.calls.length, 1)
    assert.equal(f.frames.size, 0)
    f.detach()
  }
})

test('WASD 持续平移为 720 像素/秒，不依赖键盘重复速率，60 / 120 Hz 速度相同', () => {
  for (const hz of [60, 120]) {
    const f = fixture()
    f.keyDown('KeyD')
    for (let i = 1; i <= hz; i++) {
      f.keyDown('KeyD', { repeat: true })
      f.tick(i * 1000 / hz)
    }
    assert.deepEqual(f.total(), [756, 0])
    f.detach()
  }
})

test('斜向速度归一化、对向按键互相抵消', () => {
  const f = fixture()
  f.keyDown('KeyW')
  f.keyDown('KeyD')
  f.tick(50)
  assert.deepEqual(Array.from(f.map.calls.at(-1)), [25, -25])
  f.keyUp('KeyW')
  f.keyDown('KeyA')
  const count = f.map.calls.length
  f.tick(100)
  assert.equal(f.map.calls.length, count)
  f.keyUp('KeyA')
  f.tick(150)
  assert.ok(f.map.calls.at(-1)[0] > 0)
  f.detach()
})

test('Shift + WASD 四方向以 2140 像素/秒平移，Shift 本身不被消费', () => {
  for (const [key, x, y] of [['KeyW', 0, -1], ['KeyA', -1, 0], ['KeyS', 0, 1], ['KeyD', 1, 0]]) {
    const f = fixture()
    assert.equal(f.keyDown('ShiftLeft', { key: 'Shift', shiftKey: true }).defaultPrevented, false)
    assert.equal(f.map.calls.length, 0)
    f.keyDown(key, { shiftKey: true })
    assert.deepEqual(Array.from(f.map.calls[0]), [108 * x, 108 * y])
    for (let i = 1; i <= 60; i++) f.tick(i * 1000 / 60)
    assert.deepEqual(f.total(), [2248 * x, 2248 * y])
    f.keyUp(key, { shiftKey: true })
    assert.equal(f.frames.size, 0)
    f.detach()
  }
})

test('持键中按下/松开 Shift 即时切速，兼容左右 Shift', () => {
  const f = fixture()
  f.keyDown('KeyD')
  f.tick(50)
  assert.deepEqual(Array.from(f.map.calls.at(-1)), [36, 0])
  f.keyDown('ShiftLeft', { key: 'Shift', shiftKey: true })
  f.tick(100)
  assert.deepEqual(Array.from(f.map.calls.at(-1)), [107, 0])
  f.keyDown('ShiftRight', { key: 'Shift', shiftKey: true })
  f.keyUp('ShiftLeft', { key: 'Shift', shiftKey: true })
  f.tick(150)
  assert.deepEqual(Array.from(f.map.calls.at(-1)), [107, 0])
  f.keyUp('ShiftRight', { key: 'Shift', shiftKey: false })
  f.tick(200)
  assert.deepEqual(Array.from(f.map.calls.at(-1)), [36, 0])
  f.keyUp('KeyD')
  assert.equal(f.frames.size, 0)
  f.detach()
})

test('加速仍受输入/组合快捷键保护，失焦后不残留加速状态', () => {
  const f = fixture()
  f.document.activeElement.editable = true
  f.keyDown('KeyD', { shiftKey: true })
  assert.equal(f.map.calls.length, 0)
  f.document.activeElement.editable = false
  f.keyDown('KeyD', { ctrlKey: true, shiftKey: true })
  assert.equal(f.map.calls.length, 0)
  f.keyDown('KeyD', { shiftKey: true })
  f.window.emit('blur')
  f.keyDown('KeyD', { repeat: true, shiftKey: true })
  assert.equal(f.map.calls.length, 1)
  f.keyDown('KeyD')
  assert.deepEqual(Array.from(f.map.calls.at(-1)), [36, 0])
  f.tick(50)
  assert.deepEqual(Array.from(f.map.calls.at(-1)), [36, 0])
  f.detach()
})

test('输入框、富文本、IME、组合快捷键及已处理事件均不劫持', () => {
  for (const patch of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }]) {
    const f = fixture()
    f.keyDown('KeyW', patch)
    assert.equal(f.map.calls.length, 0)
    f.detach()
  }
  for (const property of ['editable', 'isContentEditable']) {
    const f = fixture()
    const input = new Element()
    input[property] = true
    f.keyDown('KeyW', { target: input })
    assert.equal(f.map.calls.length, 0)
    f.document.activeElement = input
    f.keyDown('KeyW', { target: f.container })
    assert.equal(f.map.calls.length, 0)
    f.detach()
  }
})

test('弹窗、隐藏地图及现有编辑/拖动锁阻止平移', () => {
  for (const block of [f => { f.document.modal = new Element() }, f => { f.container.visible = false }, f => { f.container.isConnected = false }, f => f.setDragging(false), f => f.setKeyboard(false), f => { f.document.visibilityState = 'hidden' }]) {
    const f = fixture()
    block(f)
    assert.equal(f.keyDown('KeyW').defaultPrevented, false)
    assert.equal(f.map.calls.length, 0)
    f.detach()
  }
})

test('失焦、切后台、鼠标操作、输入聚焦、IME和缩放会停止连续移动', () => {
  for (const interrupt of [
    f => f.window.emit('blur'),
    f => f.document.emit('visibilitychange'),
    f => f.document.emit('pointerdown', { pointerId: 1 }),
    f => { const input = new Element(); input.editable = true; f.document.emit('focusin', { target: input }) },
    f => f.document.emit('compositionstart'),
    f => f.map.emit('zoomstart'),
    f => f.keyDown('ControlLeft', { ctrlKey: true }),
    f => f.keyDown('Escape', { key: 'Escape' }),
  ]) {
    const f = fixture()
    f.keyDown('KeyD')
    interrupt(f)
    f.tick(30)
    f.keyDown('KeyD', { repeat: true })
    assert.equal(f.map.calls.length, 1)
    assert.equal(f.frames.size, 0)
    f.detach()
  }
})

test('手势进行中禁用，所有指针释放后可重新按键移动', () => {
  const f = fixture()
  for (const pointerId of [1, 2]) f.document.emit('pointerdown', { pointerId })
  f.keyDown('KeyW')
  assert.equal(f.map.calls.length, 0)
  f.document.emit('pointerup', { pointerId: 1 })
  f.keyDown('KeyW')
  assert.equal(f.map.calls.length, 0)
  f.document.emit('pointercancel', { pointerId: 2 })
  f.keyDown('KeyW')
  assert.equal(f.map.calls.length, 1)
  f.detach()
})

test('持键中新增弹窗/交互锁会停止，卸载移除监听和动画帧', () => {
  const f = fixture()
  f.keyDown('KeyD')
  f.document.modal = new Element()
  f.tick(20)
  assert.equal(f.map.calls.length, 1)
  assert.equal(f.frames.size, 0)
  f.document.modal = null
  f.keyDown('KeyD')
  f.setDragging(false)
  f.tick(40)
  assert.equal(f.map.calls.length, 2)
  f.setDragging(true)
  f.keyDown('KeyD')
  f.detach()
  for (const surface of [f.window, f.document, f.map]) assert.equal(surface.count(), 0)
  assert.equal(f.frames.size, 0)
})

test('物理键位支持大写/其他布局，非 WASD 按键不被消费', () => {
  const f = fixture()
  assert.equal(f.keyDown('KeyQ').defaultPrevented, false)
  assert.equal(f.keyDown('ArrowUp').defaultPrevented, false)
  f.keyDown('KeyW', { key: 'Z' })
  assert.deepEqual(Array.from(f.map.calls[0]), [0, -36])
  f.keyUp('KeyW')
  f.keyDown('', { key: 'D' })
  assert.deepEqual(Array.from(f.map.calls.at(-1)), [36, 0])
  f.detach()
})

test('地图边界钳制在旋转视角下也生效，不触发越界回弹', () => {
  class Point {
    constructor(x, y) { this.x = x; this.y = y }
    add([x, y]) { return new Point(this.x + x, this.y + y) }
    subtract(point) { return new Point(this.x - point.x, this.y - point.y) }
    divideBy(value) { return new Point(this.x / value, this.y / value) }
    round() { return new Point(Math.round(this.x), Math.round(this.y)) }
  }
  for (const [bearing, shiftKey] of [0, 90, 180, 270].flatMap(bearing => [[bearing, false], [bearing, true]])) {
    const f = fixture()
    const radians = bearing * Math.PI / 180
    const center = new Point(0, 0)
    const rotate = (x, y, angle) => new Point(x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle))
    f.map.options.maxBounds = { getNorthEast: () => new Point(100, -100), getSouthWest: () => new Point(-100, 100) }
    f.map.getSize = () => new Point(100, 100)
    f.map.project = f.map.unproject = point => new Point(point.x, point.y)
    f.map.containerPointToLatLng = point => {
      const offset = rotate(point.x - 50, point.y - 50, -radians)
      return new Point(center.x + offset.x, center.y + offset.y)
    }
    f.map.latLngToContainerPoint = point => {
      const offset = rotate(point.x - center.x, point.y - center.y, radians)
      return new Point(50 + offset.x, 50 + offset.y)
    }
    f.map.panBy = offset => {
      const delta = rotate(offset[0], offset[1], -radians)
      center.x += delta.x
      center.y += delta.y
      f.map.calls.push(offset)
    }
    f.keyDown('KeyD', { shiftKey })
    for (let time = 16; time < 2000; time += 16) f.tick(time)
    assert.ok(Math.abs(center.x) <= 50.01 && Math.abs(center.y) <= 50.01)
    assert.equal(f.total()[0], 50)
    assert.ok(Math.abs(f.total()[1]) <= 1)
    const count = f.map.calls.length
    f.tick(2000)
    assert.equal(f.map.calls.length, count)
    f.detach()
  }
})
