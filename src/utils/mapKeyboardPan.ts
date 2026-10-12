import type { Map as LeafletMap } from 'leaflet'

const PAN_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD'])
const EDITABLE_SELECTOR = 'input, textarea, select, [role="textbox"], [role="combobox"], .text-marker-editing'
const MODAL_SELECTOR = '[aria-modal="true"], dialog[open], .tb-overlay'
const PAN_SPEED = 720 // 屏幕像素/秒，与地图缩放、旋转和键盘重复速率无关。
const FAST_PAN_SPEED = 2140
// 轻按独立于持续速度，保留小步微调能力。
const TAP_DISTANCE = 36
const FAST_TAP_DISTANCE = 108

function isEditing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || Boolean(target.closest(EDITABLE_SELECTOR)))
}

function panKey(event: KeyboardEvent): string {
  return event.code || `Key${event.key.toUpperCase()}`
}

/** 先约束目标视角，避免持键到边缘后与 Leaflet 的自动回弹动画竞争。 */
function limitOffset(map: LeafletMap, offset: [number, number]): [number, number] {
  const bounds = map.options.maxBounds
  // setMaxBounds 会把数组配置规范化为 LatLngBounds。
  if (!bounds || !('getNorthEast' in bounds)) return offset
  const halfSize = map.getSize().divideBy(2)
  const target = map.project(map.containerPointToLatLng(halfSize.add(offset)))
  const ne = map.project(bounds.getNorthEast())
  const sw = map.project(bounds.getSouthWest())
  const clampAxis = (value: number, low: number, high: number, half: number) => {
    if (high - low <= half * 2) return (low + high) / 2
    return Math.min(Math.max(value, low + half), high - half)
  }
  target.x = clampAxis(target.x, Math.min(ne.x, sw.x), Math.max(ne.x, sw.x), halfSize.x)
  target.y = clampAxis(target.y, Math.min(ne.y, sw.y), Math.max(ne.y, sw.y), halfSize.y)
  const screen = map.latLngToContainerPoint(map.unproject(target)).subtract(halfSize).round()
  return [screen.x, screen.y]
}

/** 一张地图只注册一套监听；按键状态和动画帧留在闭包中，不触发 React 更新。 */
export function attachMapKeyboardPan(map: LeafletMap): () => void {
  const container = map.getContainer()
  const pressed = new Set<string>()
  const pointers = new Set<number>()
  let frameId = 0
  let lastTime = 0
  let remainderX = 0
  let remainderY = 0
  let fastPan = false

  const stop = () => {
    pressed.clear()
    window.cancelAnimationFrame(frameId)
    frameId = 0
    remainderX = remainderY = 0
    fastPan = false
  }
  const reset = () => {
    stop()
    pointers.clear()
  }
  const canPan = () => document.visibilityState !== 'hidden'
    && container.isConnected && container.getClientRects().length > 0
    && pointers.size === 0
    && map.dragging.enabled() && map.keyboard.enabled()
    && !isEditing(document.activeElement)
    && !document.querySelector(MODAL_SELECTOR)

  const move = (distance: number) => {
    const x = Number(pressed.has('KeyD')) - Number(pressed.has('KeyA'))
    const y = Number(pressed.has('KeyS')) - Number(pressed.has('KeyW'))
    const length = Math.hypot(x, y)
    if (!length) return
    remainderX += x / length * distance
    remainderY += y / length * distance
    const dx = Math.round(remainderX)
    const dy = Math.round(remainderY)
    remainderX -= dx
    remainderY -= dy
    // panBy 操作屏幕坐标；旋转后 W 仍然向屏幕上方移动视角。
    const offset: [number, number] = dx || dy ? limitOffset(map, [dx, dy]) : [0, 0]
    if (offset[0] || offset[1]) map.panBy(offset, { animate: false })
  }
  const tick = (now: number) => {
    frameId = 0
    if (!canPan()) {
      stop()
      return
    }
    const elapsed = Math.min(Math.max(now - lastTime, 0), 50)
    lastTime = now
    move((fastPan ? FAST_PAN_SPEED : PAN_SPEED) * elapsed / 1000)
    if (pressed.size > 0) frameId = window.requestAnimationFrame(tick)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey
      || event.isComposing || event.keyCode === 229 || event.key === 'Escape'
      || event.composedPath().some(isEditing) || !canPan()) {
      stop()
      return
    }
    // 单独按下 Shift 也更新状态，持键平移时无需松开 WASD 就能加速。
    fastPan = event.shiftKey
    const key = panKey(event)
    if (!PAN_KEYS.has(key)) return
    // 失焦/交互锁清空后，不能用仍按住的键所产生的重复事件重新启动。
    if (event.repeat && !pressed.has(key)) return
    event.preventDefault()
    if (pressed.has(key)) return
    const starting = pressed.size === 0
    pressed.add(key)
    if (starting) {
      map.stop()
      lastTime = performance.now()
      move(fastPan ? FAST_TAP_DISTANCE : TAP_DISTANCE)
      frameId = window.requestAnimationFrame(tick)
    }
  }
  const onKeyUp = (event: KeyboardEvent) => {
    // 使用修饰键状态而非某个 Shift 的键位，兼容左右 Shift 同时按住。
    fastPan = event.shiftKey
    pressed.delete(panKey(event))
    if (pressed.size === 0) stop()
  }
  const onFocusIn = (event: FocusEvent) => {
    if (isEditing(event.target) || document.querySelector(MODAL_SELECTOR)) stop()
  }
  const onPointerDown = (event: PointerEvent) => {
    stop()
    pointers.add(event.pointerId)
  }
  const onPointerUp = (event: PointerEvent) => { pointers.delete(event.pointerId) }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', reset)
  document.addEventListener('visibilitychange', reset)
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('pointerup', onPointerUp, true)
  document.addEventListener('pointercancel', onPointerUp, true)
  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('compositionstart', stop)
  map.on('zoomstart unload', stop)
  return () => {
    stop()
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', reset)
    document.removeEventListener('visibilitychange', reset)
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('pointerup', onPointerUp, true)
    document.removeEventListener('pointercancel', onPointerUp, true)
    document.removeEventListener('focusin', onFocusIn)
    document.removeEventListener('compositionstart', stop)
    map.off('zoomstart unload', stop)
  }
}
