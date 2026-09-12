import type { Map as LeafletMap } from 'leaflet'
import { canKeepDemoCamera } from './beginnerDemoCamera'
import { traceDemo } from './beginnerDemoDiagnostics'

/** Demo-only DOM input driver. It never writes map entities or editor state. */
export interface InputTarget {
  selector?: string
  text?: string
  index?: number
  latLng?: [number, number]
  fraction?: [number, number]
}
export interface DemoFocusRect { x: number; y: number; width: number; height: number }
export interface InputStep {
  drawTool?: 'circle' | 'arrow'
  inputSurface?: 'map'
  focus?: 'auto' | 'keep' | 'clear'
  highlightWidth?: number
  caption?: string
  kind: 'click' | 'double-click' | 'drag' | 'wheel' | 'type' | 'key' | 'select' | 'highlight' | 'hover' | 'wait'
  target?: InputTarget
  to?: InputTarget
  text?: string
  key?: string
  ctrl?: boolean
  deltaY?: number
  ms?: number
  optional?: boolean
  skipIfSelectorExists?: string
  expect?: InputTarget
}

/** Keep edge highlights inside the iframe; ordinary controls retain a 5px halo. */
export function getDemoHighlightBounds(box: { left: number; top: number; width: number; height: number }, viewportWidth: number, viewportHeight: number) {
  const right = box.left + box.width
  const bottom = box.top + box.height
  const inset = box.left < 17 || box.top < 17 || right > viewportWidth - 17 || bottom > viewportHeight - 17
  const padding = inset ? -2 : 5
  const left = Math.max(2, box.left - padding)
  const top = Math.max(2, box.top - padding)
  const width = Math.min(viewportWidth - 2, right + padding) - left
  const height = Math.min(viewportHeight - 2, bottom + padding) - top
  if (width < 4 || height < 4) return null
  return { left, top, width, height, inset }
}

export class BeginnerDemoInput {
  onFocus?: (rect: DemoFocusRect | null) => void
  paused = false
  fast = false
  speed = 1
  private generation = 0
  private cursor?: HTMLDivElement
  private outline?: HTMLDivElement
  private release?: () => void
  private lastFocus?: DemoFocusRect | null
  private hovered?: Element
  private cursorPoint?: { x: number; y: number }

  cancel(preserveFocus = false) {
    traceDemo('input-cancel', { preserveFocus })
    this.hovered?.classList.remove('demo-hover')
    this.hovered = undefined
    if (!preserveFocus) { this.onFocus?.(null); this.lastFocus = null }
    this.cursorPoint = undefined
    this.generation++
    this.release?.()
    this.release = undefined
    this.cursor?.remove()
    this.outline?.remove()
    this.cursor = this.outline = undefined
  }

  async run(steps: InputStep[], getMap: () => LeafletMap | null, onStep?: (step: InputStep) => void) {
    const generation = this.generation
    const check = () => { if (generation !== this.generation) throw new Error('操作已取消') }
    const wait = async (ms: number) => {
      let remaining = this.fast ? Math.min(ms, 35) : ms * 1.2
      while (remaining > 0 || this.paused) {
        check()
        await new Promise<void>((resolve) => window.setTimeout(resolve, 20))
        if (!this.paused) remaining -= 20 * this.speed
      }
      check()
    }
    const locate = (target: InputTarget = {}) => {
      const map = getMap()
      if (!map) throw new Error('地图尚未就绪')
      const rect = map.getContainer().getBoundingClientRect()
      if (target.latLng || target.fraction) {
        const point = target.latLng ? map.latLngToContainerPoint(target.latLng) : { x: rect.width * target.fraction![0], y: rect.height * target.fraction![1] }
        const x = rect.left + point.x, y = rect.top + point.y
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) throw new Error(`操作目标不在地图可视区域：${JSON.stringify(target)}`)
        return { element: document.elementFromPoint(x, y) as HTMLElement ?? map.getContainer(), x, y }
      }
      const elements = [...document.querySelectorAll<HTMLElement>(target.selector ?? '.leaflet-container')]
        .filter((element) => element.getBoundingClientRect().width > 0 && getComputedStyle(element).visibility !== 'hidden'
          && (!target.text || element.textContent?.includes(target.text)))
      const element = elements[target.index ?? 0]
      if (!element) throw new Error(`找不到真实操作控件：${JSON.stringify(target)}`)
      if (!element.closest('.leaflet-pane') && !element.classList.contains('leaflet-container')) {
        element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
      }
      const box = element.getBoundingClientRect()
      return { element, x: box.left + box.width / 2, y: box.top + box.height / 2 }
    }
    const resolve = async (target?: InputTarget) => {
      let last: unknown
      for (let i = 0; i < 50; i++) {
        check()
        try { return locate(target) } catch (error) { last = error; await wait(60) }
      }
      throw last
    }
    const pointer = (x: number, y: number, down = false) => {
      this.cursorPoint = { x, y }
      if (!this.cursor) {
        this.cursor = document.createElement('div')
        this.cursor.setAttribute('aria-hidden', 'true')
        this.cursor.style.cssText = 'position:fixed;z-index:2147483647;width:26px;height:26px;border:2px solid #08f0a4;border-radius:50%;pointer-events:none;transform:translate(-50%,-50%);box-shadow:0 0 12px #08f0a466;transition:background-color .16s ease;'
        document.body.append(this.cursor)
        this.cursor.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220 })
      }
      this.cursor.style.left = `${x}px`
      this.cursor.style.top = `${y}px`
      this.cursor.style.background = down ? '#57efb166' : 'transparent'
      this.cursor.style.display = this.fast ? 'none' : ''
    }
    const glide = async (x: number, y: number) => {
      const start = this.cursorPoint
      if (this.fast || !start || Math.hypot(start.x - x, start.y - y) < 8) { pointer(x, y); return }
      for (let i = 1; i <= 22; i++) {
        await wait(16)
        const t = i / 22, ease = t * t * (3 - 2 * t)
        pointer(start.x + (x - start.x) * ease, start.y + (y - start.y) * ease)
      }
    }
    const mouse = (element: EventTarget, type: string, x: number, y: number, buttons = 0, detail = 1) => {
      const event = new MouseEvent(type, { view: window, bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons, detail })
      // Leaflet 1.x Draggable tests the legacy which field before starting.
      Object.defineProperty(event, 'which', { value: 1 })
      element.dispatchEvent(event)
    }
    const press = (element: HTMLElement, x: number, y: number) => {
      element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: x, clientY: y, button: 0, buttons: 1 }))
      mouse(element, 'mousedown', x, y, 1)
    }
    const lift = (element: EventTarget, x: number, y: number) => {
      element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: x, clientY: y, button: 0, buttons: 0 }))
      mouse(element, 'mouseup', x, y)
    }
    try {
      for (const step of steps) {
        if (step.skipIfSelectorExists && document.querySelector(step.skipIfSelectorExists)) continue
        check()
        await wait(60)
        onStep?.(step)
        if (step.focus === 'clear') {
          this.onFocus?.(null)
          this.lastFocus = null
        }
        if (step.kind === 'wait') { await wait(step.ms ?? 400); continue }
        let target: Awaited<ReturnType<typeof resolve>>
        try { target = step.optional ? locate(step.target) : await resolve(step.target) } catch (error) { if (step.optional) continue; throw error }
        if (step.kind === 'key' && !step.target && document.activeElement instanceof HTMLElement && document.activeElement.matches('input, textarea, [contenteditable="true"]')) {
          const element = document.activeElement
          const box = element.getBoundingClientRect()
          target = { element, x: box.left + box.width / 2, y: box.top + box.height / 2 }
        }
        let { element, x, y } = target
        if (this.hovered && !this.hovered.contains(element)) {
          this.hovered.classList.remove('demo-hover')
          this.hovered = undefined
        }
        const sidebarToggle = step.kind === 'click' && element.closest('.collapse-float, .left-panel .collapse-btn, .point-panel .collapse-btn, [title="收起点位面板"], [aria-label="展开战术面板"], [aria-label="展开点位面板"]')
        const auxiliary = step.kind === 'key' || (step.kind === 'click' && element.closest('[aria-label="关闭路线属性"], .tb-close, [aria-label="还原备注窗口"], [aria-label="展开备注"]'))
        if (!this.fast && step.focus !== 'keep' && !sidebarToggle && !auxiliary) {
          const region = element.closest('.topbar-select, .toolbar-draw, .wg-controls, .wg-member, .text-style-panel, .route-editor-panel, .wg-notes-dock, .tb-modal') ?? element
          const box = region.getBoundingClientRect()
          let rect = step.target?.latLng || step.target?.fraction
            ? { x: x - 160, y: y - 110, width: 320, height: 220 }
            : { x: box.left, y: box.top, width: box.width, height: box.height }
          if (step.kind === 'drag') {
            const end = await resolve(step.to)
            rect = { x: Math.min(x, end.x) - 150, y: Math.min(y, end.y) - 120, width: Math.abs(x - end.x) + 300, height: Math.abs(y - end.y) + 240 }
          }
          // Large regions stay wide. Small controls use the same real iframe,
          // enlarged by the shell; iframe DOM and map coordinates never change.
          const previous = this.lastFocus
          const focus = rect.width > 1500 || rect.height > 900 ? null
            : canKeepDemoCamera(previous, rect) ? previous ?? rect : rect
          const changed = focus !== previous
          if (changed || this.lastFocus === undefined) { this.onFocus?.(focus); this.lastFocus = focus }
          await wait(changed ? 800 : 100)
        }
        if (step.kind !== 'key') {
          // Layout/Leaflet markers may settle while the camera is moving.
          ;({ element, x, y } = await resolve(step.target))
          await glide(x, y)
          await wait(300)
          const latest = await resolve(step.target)
          if (Math.hypot(latest.x - x, latest.y - y) > 1) await glide(latest.x, latest.y)
          ;({ element, x, y } = latest)
        }
        if (step.kind === 'hover') {
          if (!document.querySelector('.beginner-demo-app')) throw new Error('模拟悬浮仅限 Demo 实例')
          this.hovered = element.closest('.tm-marker') ?? element
          this.hovered.classList.add('demo-hover')
          mouse(element, 'mouseover', x, y)
          await wait(step.ms ?? 700)
        } else if (step.kind === 'highlight') {
          this.outline?.remove()
          this.outline = document.createElement('div')
          const box = step.target?.latLng ? { left: x - 30, top: y - 30, width: 60, height: 60 } : element.getBoundingClientRect()
          const bounds = getDemoHighlightBounds(box, document.documentElement.clientWidth, document.documentElement.clientHeight)
          if (!bounds) continue
          const borderWidth = Math.max(1, Math.min(6, step.highlightWidth ?? 2))
          this.outline.style.cssText = `position:fixed;box-sizing:border-box;pointer-events:none;z-index:2147483646;border:${borderWidth}px solid #57efb1;border-radius:8px;box-shadow:${bounds.inset ? 'inset ' : ''}0 0 12px #57efb166;left:${bounds.left}px;top:${bounds.top}px;width:${bounds.width}px;height:${bounds.height}px;`
          document.body.append(this.outline)
          this.outline.animate([{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 300, easing: 'ease-out' })
          await wait(step.ms ?? 850)
          this.outline.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: 'forwards' })
          await wait(180)
          this.outline.remove()
        } else if (step.kind === 'click' || step.kind === 'double-click') {
          traceDemo('click-before', { target: step.target, x, y, tag: element.tagName, class: element.getAttribute('class'), connected: element.isConnected })
          for (let i = 0; i < (step.kind === 'double-click' ? 2 : 1); i++) {
            pointer(x, y, true); press(element, x, y); await wait(70); lift(element, x, y)
            traceDemo('click-after-release', { target: step.target, connected: element.isConnected })
            mouse(element, 'click', x, y, 0, i + 1)
          }
          traceDemo('click-after-dispatch', { target: step.target })
          if (step.kind === 'double-click') mouse(element, 'dblclick', x, y, 0, 2)
        } else if (step.kind === 'drag') {
          const end = await resolve(step.to)
          // New drawing gestures belong to the map, not transient preview paths.
          const drawingSurface = step.inputSurface === 'map' ? getMap()!.getContainer() : null
          const drawingMap = drawingSurface ? getMap()! : null
          const drawEvent = (type: 'mousedown' | 'mousemove' | 'mouseup', px: number, py: number) => {
            if (!drawingMap || !drawingSurface || !document.querySelector('.beginner-demo-app')) return
            const originalEvent = new MouseEvent(type, { view: window, bubbles: true, cancelable: true, clientX: px, clientY: py, button: 0, buttons: type === 'mouseup' ? 0 : 1 })
            Object.defineProperty(originalEvent, 'target', { value: drawingSurface })
            const containerPoint = drawingMap.mouseEventToContainerPoint(originalEvent)
            drawingMap.fire(type, { originalEvent, containerPoint, layerPoint: drawingMap.containerPointToLayerPoint(containerPoint), latlng: drawingMap.containerPointToLatLng(containerPoint) })
          }
          if (drawingSurface && step.drawTool) {
            // The button can already look active before the drawing effect attaches.
            for (let attempt = 0; attempt < 30 && drawingSurface.dataset.demoDrawPhase !== `${step.drawTool}:ready`; attempt++) await wait(50)
            if (drawingSurface.dataset.demoDrawPhase !== `${step.drawTool}:ready`) throw new Error(`绘制器未就绪：工具 ${step.drawTool}，状态 ${drawingSurface.dataset.demoDrawPhase ?? '未注册'}`)
          }
          pointer(x, y, true)
          if (drawingSurface) drawEvent('mousedown', x, y)
          else press(element, x, y)
          let lastX = x, lastY = y
          this.release = () => {
            if (drawingSurface) drawingSurface.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape', code: 'Escape' }))
            else lift(document, lastX, lastY)
          }
          try {
            const frames = this.fast ? 3 : 36
            for (let i = 1; i <= frames; i++) {
              await wait((step.ms ?? 1000) / frames)
              const t = i / frames, ease = t * t * (3 - 2 * t)
              lastX = x + (end.x - x) * ease; lastY = y + (end.y - y) * ease
              pointer(lastX, lastY, true)
              // Leaflet markers track document mousemove; drawing handlers require the
              // map container even when the preview path has moved under the pointer.
              const hit = getMap()!.getContainer()
              if (drawingSurface) drawEvent('mousemove', lastX, lastY)
              else {
                hit.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: lastX, clientY: lastY, buttons: 1 }))
                mouse(hit, 'mousemove', lastX, lastY, 1)
              }
            }
          } finally {
            if (drawingSurface && generation === this.generation) drawEvent('mouseup', lastX, lastY)
            else if (!drawingSurface) lift(document.elementFromPoint(lastX, lastY) ?? document, lastX, lastY)
            this.release = undefined
          }
          if (drawingSurface && step.drawTool && drawingSurface.dataset.demoDrawPhase !== `${step.drawTool}:committed`) {
            throw new Error(`绘制未提交：${step.drawTool}，状态 ${drawingSurface.dataset.demoDrawPhase ?? '未注册'}，请反馈此状态`)
          }
        } else if (step.kind === 'wheel') {
          element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: x, clientY: y, deltaY: step.deltaY ?? -120 }))
        } else if (step.kind === 'select') {
          if (!(element instanceof HTMLSelectElement)) throw new Error('目标不是选择控件')
          element.value = step.text ?? ''
          element.dispatchEvent(new Event('change', { bubbles: true }))
        } else if (step.kind === 'key') {
          const key = step.key ?? 'Escape'
          const owner = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : element
          owner.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, ctrlKey: step.ctrl }))
          owner.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key, ctrlKey: step.ctrl }))
        } else if (step.kind === 'type') {
          element.focus()
          const value = step.text ?? ''
          if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            const proto = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!
            const once = this.fast || element instanceof HTMLInputElement && ['color', 'number', 'range'].includes(element.type)
            for (let i = 1; i <= value.length; i += once ? value.length : 1) {
              setter.call(element, value.slice(0, once ? value.length : i))
              element.dispatchEvent(new Event('input', { bubbles: true }))
              await wait(28)
            }
            element.dispatchEvent(new Event('change', { bubbles: true }))
            element.blur()
          } else if (element.isContentEditable) {
            const selection = window.getSelection(), range = document.createRange()
            range.selectNodeContents(element); selection?.removeAllRanges(); selection?.addRange(range)
            // Browser editing commands exercise contenteditable/ProseMirror's actual input pipeline.
            document.execCommand('delete')
            for (const char of value) {
              document.execCommand(char === '\n' ? 'insertLineBreak' : 'insertText', false, char === '\n' ? undefined : char)
              await wait(28)
            }
            element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }))
            if (!(element.textContent ?? '').trim()) throw new Error('真实编辑器未接收文字输入')
          } else throw new Error('目标不是可编辑文本框')
        }
        // Leave the cursor at the release point, not back at the drag origin.
        if (step.kind === 'drag' && this.cursorPoint) pointer(this.cursorPoint.x, this.cursorPoint.y)
        else if (step.kind !== 'key') pointer(x, y)
        await wait(180)
        traceDemo('step-settled', { kind: step.kind, target: step.target })
        if (step.expect) await resolve(step.expect)
      }
    } finally {
      if (generation === this.generation) {
        // Keep framing between action groups. The next target moves it smoothly;
        // scene changes/cancellation explicitly reset it in cancel().
        this.outline?.remove(); this.outline = undefined
        this.hovered?.classList.remove('demo-hover'); this.hovered = undefined
      }
    }
  }
}
