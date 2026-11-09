export function overlayScrollMetrics(viewportHeight: number, scrollHeight: number, scrollTop: number) {
  const trackHeight = Math.max(0, viewportHeight - 6)
  const maxScroll = Math.max(0, scrollHeight - viewportHeight)
  const thumbHeight = Math.min(trackHeight, Math.max(24, trackHeight * viewportHeight / Math.max(1, scrollHeight)))
  const travel = Math.max(0, trackHeight - thumbHeight)
  const top = maxScroll > 0 ? Math.max(0, Math.min(maxScroll, scrollTop)) / maxScroll * travel : 0
  return { trackHeight, maxScroll, thumbHeight, travel, top }
}

/** 原生容器负责滚动；浮层只负责显示/拖动，不改内容宽度，不触发 React 更新。 */
export function attachOverlayScrollbar(viewport: HTMLElement, content: HTMLElement, track: HTMLElement, thumb: HTMLElement) {
  let frame = 0
  let hideTimer = 0
  let metrics = overlayScrollMetrics(0, 0, 0)
  let drag: { pointerId: number; startY: number; startScroll: number } | null = null
  const clearHideTimer = () => {
    window.clearTimeout(hideTimer)
    hideTimer = 0
  }
  const hideLater = () => {
    clearHideTimer()
    if (!drag) hideTimer = window.setTimeout(() => {
      hideTimer = 0
      delete track.dataset.active
    }, 1000)
  }
  const reveal = () => {
    if (track.dataset.visible !== 'true') return
    track.dataset.active = 'true'
    hideLater()
  }
  const finishDrag = () => {
    const pointerId = drag?.pointerId
    if (pointerId === undefined) return
    drag = null
    delete track.dataset.dragging
    if (track.hasPointerCapture(pointerId)) track.releasePointerCapture(pointerId)
    hideLater()
  }
  const paint = () => {
    metrics = overlayScrollMetrics(viewport.clientHeight, viewport.scrollHeight, viewport.scrollTop)
    const visible = metrics.maxScroll > 1 && metrics.travel > 0 && viewport.clientWidth > 0
    track.dataset.visible = String(visible)
    if (!visible) {
      finishDrag()
      clearHideTimer()
      delete track.dataset.active
    }
    track.style.height = `${metrics.trackHeight}px`
    thumb.style.height = `${metrics.thumbHeight}px`
    thumb.style.transform = `translateY(${metrics.top}px)`
  }
  const schedule = () => {
    if (!frame) frame = window.requestAnimationFrame(() => {
      frame = 0
      paint()
    })
  }
  const scroll = () => {
    reveal()
    schedule()
  }
  const touch = (event: PointerEvent) => {
    if (event.pointerType === 'touch') reveal()
  }
  const begin = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0 || drag) return
    paint()
    if (track.dataset.visible !== 'true') return
    event.preventDefault()
    event.stopPropagation()
    const rect = track.getBoundingClientRect()
    if (!thumb.contains(event.target as Node)) {
      viewport.scrollTop = Math.max(0, Math.min(1, (event.clientY - rect.top - metrics.thumbHeight / 2) / metrics.travel)) * metrics.maxScroll
    }
    drag = { pointerId: event.pointerId, startY: event.clientY, startScroll: viewport.scrollTop }
    track.setPointerCapture(event.pointerId)
    track.dataset.dragging = 'true'
    reveal()
    schedule()
  }
  const move = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return
    if (metrics.travel <= 0 || metrics.maxScroll <= 1) {
      finishDrag()
      return
    }
    event.preventDefault()
    const next = drag.startScroll + (event.clientY - drag.startY) / metrics.travel * metrics.maxScroll
    viewport.scrollTop = Math.max(0, Math.min(metrics.maxScroll, next))
    schedule()
  }
  const finish = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return
    finishDrag()
  }
  const observer = new ResizeObserver(schedule)
  observer.observe(viewport)
  observer.observe(content)
  viewport.addEventListener('scroll', scroll, { passive: true })
  viewport.addEventListener('wheel', reveal, { passive: true })
  viewport.addEventListener('pointerdown', touch, { passive: true })
  track.addEventListener('pointerdown', begin)
  track.addEventListener('pointermove', move)
  track.addEventListener('pointerup', finish)
  track.addEventListener('pointercancel', finish)
  track.addEventListener('lostpointercapture', finish)
  schedule()
  return () => {
    window.cancelAnimationFrame(frame)
    observer.disconnect()
    viewport.removeEventListener('scroll', scroll)
    viewport.removeEventListener('wheel', reveal)
    viewport.removeEventListener('pointerdown', touch)
    track.removeEventListener('pointerdown', begin)
    track.removeEventListener('pointermove', move)
    track.removeEventListener('pointerup', finish)
    track.removeEventListener('pointercancel', finish)
    track.removeEventListener('lostpointercapture', finish)
    finishDrag()
    clearHideTimer()
    track.dataset.visible = 'false'
    delete track.dataset.active
  }
}
