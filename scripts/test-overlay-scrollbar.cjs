const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '../src/utils/overlayScrollbar.ts'), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText

class Element {
  dataset = {}
  style = {}
  listeners = new Map()
  captures = new Set()
  addEventListener(type, listener, options) { this.listeners.set(type, { listener, options }) }
  removeEventListener(type, listener) {
    if (this.listeners.get(type)?.listener === listener) this.listeners.delete(type)
  }
  emit(type, patch = {}) {
    const event = {
      isPrimary: true, button: 0, pointerId: 1, clientY: 3, target: this,
      defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true },
      stopPropagation() { this.stopped = true },
      ...patch,
    }
    this.listeners.get(type)?.listener(event)
    return event
  }
  contains(node) { return node === this }
  getBoundingClientRect() { return { top: 3 } }
  setPointerCapture(id) { this.captures.add(id) }
  hasPointerCapture(id) { return this.captures.has(id) }
  releasePointerCapture(id) { this.captures.delete(id) }
}

function fixture() {
  const viewport = Object.assign(new Element(), { clientWidth: 280, clientHeight: 300, scrollHeight: 1200, scrollTop: 0 })
  const content = new Element(), track = new Element(), thumb = new Element()
  const frames = new Map(), timers = new Map(), observers = []
  let frameId = 0
  let timerId = 0, now = 0
  const window = {
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId },
    cancelAnimationFrame(id) { frames.delete(id) },
    setTimeout(callback, delay) { timers.set(++timerId, { callback, at: now + delay }); return timerId },
    clearTimeout(id) { timers.delete(id) },
  }
  class ResizeObserver {
    targets = new Set()
    disconnected = false
    constructor(callback) { this.callback = callback; observers.push(this) }
    observe(target) { this.targets.add(target) }
    disconnect() { this.disconnected = true; this.targets.clear() }
  }
  const module = { exports: {} }
  vm.runInNewContext(compiled, { module, exports: module.exports, window, ResizeObserver })
  const detach = module.exports.attachOverlayScrollbar(viewport, content, track, thumb)
  return {
    viewport, content, track, thumb, frames, timers, observers, detach,
    metrics: module.exports.overlayScrollMetrics,
    tick() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()) },
    resize() { observers[0].callback() },
    advance(ms) {
      now += ms
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) { timers.delete(id); timer.callback() }
      }
    },
  }
}

test('滑块按内容比例缩放，顶部/底部钳制且短视口不出现负值', () => {
  const f = fixture()
  const start = f.metrics(300, 1200, -5), end = f.metrics(300, 1200, 9999)
  assert.equal(start.trackHeight, 294)
  assert.equal(start.thumbHeight, 73.5)
  assert.equal(start.top, 0)
  assert.equal(end.top + end.thumbHeight, end.trackHeight)
  assert.equal(f.metrics(300, 100, 0).travel, 0)
  assert.equal(f.metrics(300, 100000, 0).thumbHeight, 24)
  for (const height of [0, 4, 12, 30]) {
    const metrics = f.metrics(height, 1200, 300)
    for (const value of Object.values(metrics)) assert.ok(Number.isFinite(value) && value >= 0)
    assert.ok(metrics.thumbHeight <= metrics.trackHeight)
  }
  f.detach()
})

test('溢出才显示轨道；内容及容器变化通过 ResizeObserver 更新', () => {
  const f = fixture()
  assert.equal(f.observers[0].targets.size, 2)
  f.tick()
  assert.equal(f.track.dataset.visible, 'true')
  f.viewport.scrollHeight = 250
  f.resize()
  f.tick()
  assert.equal(f.track.dataset.visible, 'false')
  f.viewport.scrollHeight = 2000
  f.viewport.clientHeight = 400
  f.resize()
  f.tick()
  assert.equal(f.track.dataset.visible, 'true')
  assert.equal(f.track.style.height, '394px')
  f.viewport.clientWidth = 0
  f.resize()
  f.tick()
  assert.equal(f.track.dataset.visible, 'false')
  f.detach()
})

test('原生 scroll 使用 passive 监听，多次滚动只更新一次动画帧', () => {
  const f = fixture()
  f.tick()
  assert.equal(f.viewport.listeners.get('scroll').options.passive, true)
  for (let i = 0; i < 30; i++) {
    f.viewport.scrollTop = i * 30
    f.viewport.emit('scroll')
  }
  assert.equal(f.frames.size, 1)
  f.tick()
  assert.equal(f.thumb.style.transform, `translateY(${f.metrics(300, 1200, 870).top}px)`)
  assert.equal(f.frames.size, 0)
  f.detach()
})

test('滑块可拖动到首尾，只有捕获的主指针生效', () => {
  const f = fixture()
  f.tick()
  const begin = f.track.emit('pointerdown', { target: f.thumb })
  assert.equal(begin.defaultPrevented, true)
  assert.equal(begin.stopped, true)
  assert.equal(f.track.dataset.dragging, 'true')
  assert.equal(f.track.hasPointerCapture(1), true)
  f.track.emit('pointermove', { clientY: 600, pointerId: 2 })
  assert.equal(f.viewport.scrollTop, 0)
  f.track.emit('pointermove', { clientY: 600 })
  assert.equal(f.viewport.scrollTop, 900)
  f.track.emit('pointermove', { clientY: -600 })
  assert.equal(f.viewport.scrollTop, 0)
  f.track.emit('pointerup')
  assert.equal(f.track.dataset.dragging, undefined)
  assert.equal(f.track.captures.size, 0)
  f.detach()
})

test('点击空轨道按滑块中心跳转，右键及第二触点不劫持', () => {
  const f = fixture()
  f.tick()
  for (const patch of [{ button: 2 }, { isPrimary: false }]) {
    assert.equal(f.track.emit('pointerdown', patch).defaultPrevented, false)
    assert.equal(f.track.captures.size, 0)
  }
  f.track.emit('pointerdown', { clientY: 150 })
  assert.equal(f.viewport.scrollTop, 450)
  f.track.emit('pointercancel')
  assert.equal(f.track.captures.size, 0)
  f.detach()
})

test('开始拖动不会丢失已排队的动画帧；卸载完整移除监听和捕获', () => {
  const f = fixture()
  f.tick()
  f.viewport.emit('scroll')
  f.track.emit('pointerdown', { target: f.thumb })
  assert.equal(f.frames.size, 1)
  f.detach()
  assert.equal(f.frames.size, 0)
  assert.equal(f.timers.size, 0)
  assert.equal(f.viewport.listeners.size, 0)
  assert.equal(f.track.listeners.size, 0)
  assert.equal(f.track.captures.size, 0)
  assert.equal(f.observers[0].disconnected, true)
  assert.equal(f.track.dataset.visible, 'false')
})

test('拖动中内容缩短或侧栏隐藏，立即停止且坐标不出现 NaN', () => {
  for (const change of [
    f => { f.viewport.scrollHeight = 100 },
    f => { f.viewport.clientHeight = 12 },
    f => { f.viewport.clientWidth = 0 },
  ]) {
    const f = fixture()
    f.tick()
    f.track.emit('pointerdown', { target: f.thumb })
    change(f)
    f.resize()
    f.tick()
    f.track.emit('pointermove', { clientY: 200 })
    assert.equal(f.track.captures.size, 0)
    assert.equal(f.track.dataset.dragging, undefined)
    assert.ok(Number.isFinite(f.viewport.scrollTop))
    f.detach()
  }
})

test('pointer capture 丢失后不再继续拖动', () => {
  const f = fixture()
  f.tick()
  f.track.emit('pointerdown', { target: f.thumb })
  f.track.emit('lostpointercapture')
  f.track.emit('pointermove', { clientY: 200 })
  assert.equal(f.viewport.scrollTop, 0)
  assert.equal(f.track.dataset.dragging, undefined)
  f.detach()
})

test('初始隐藏，滚动时显示，停止一秒后隐藏；连续操作延长显示', () => {
  const f = fixture()
  f.tick()
  assert.equal(f.track.dataset.visible, 'true')
  assert.equal(f.track.dataset.active, undefined)
  f.viewport.emit('scroll')
  assert.equal(f.track.dataset.active, 'true')
  f.advance(800)
  f.viewport.emit('scroll')
  assert.equal(f.timers.size, 1)
  f.advance(800)
  assert.equal(f.track.dataset.active, 'true')
  f.advance(200)
  assert.equal(f.track.dataset.active, undefined)
  f.detach()
})

test('滚轮到边界或触摸时仍显示，监听不阻塞原生滚动', () => {
  for (const [type, patch] of [['wheel', {}], ['pointerdown', { pointerType: 'touch' }]]) {
    const f = fixture()
    f.tick()
    const event = f.viewport.emit(type, patch)
    assert.equal(event.defaultPrevented, false)
    assert.equal(f.viewport.listeners.get(type).options.passive, true)
    assert.equal(f.track.dataset.active, 'true')
    f.advance(1000)
    assert.equal(f.track.dataset.active, undefined)
    f.detach()
  }
})

test('拖动期间不隐藏，松开/取消后才开始倒计时', () => {
  for (const finish of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    const f = fixture()
    f.tick()
    f.viewport.emit('wheel')
    f.track.emit('pointerdown', { target: f.thumb })
    f.viewport.emit('scroll')
    f.advance(5000)
    assert.equal(f.track.dataset.active, 'true')
    assert.equal(f.timers.size, 0)
    f.track.emit(finish)
    f.advance(999)
    assert.equal(f.track.dataset.active, 'true')
    f.advance(1)
    assert.equal(f.track.dataset.active, undefined)
    f.detach()
  }
})

test('内容不再溢出或卸载时，清除显隐状态及计时器', () => {
  const f = fixture()
  f.tick()
  f.viewport.emit('scroll')
  f.viewport.scrollHeight = 100
  f.resize()
  f.tick()
  assert.equal(f.track.dataset.active, undefined)
  assert.equal(f.timers.size, 0)
  f.viewport.scrollHeight = 1200
  f.resize()
  f.tick()
  f.viewport.emit('wheel')
  assert.equal(f.timers.size, 1)
  f.detach()
  assert.equal(f.timers.size, 0)
  assert.equal(f.track.dataset.active, undefined)
})
