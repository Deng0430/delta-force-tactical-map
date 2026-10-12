export interface ScreenRect {
  left: number
  top: number
  right: number
  bottom: number
}

/** 优先在入口下方展开；空间不足则翻到上方，最后按实际面板尺寸钳制。 */
export function floatingPanelPosition(anchor: ScreenRect, width: number, height: number, bounds: ScreenRect) {
  const gap = 6
  const left = Math.max(bounds.left, Math.min(anchor.left, bounds.right - width))
  const below = anchor.bottom + gap
  const preferredTop = below + height <= bounds.bottom ? below : anchor.top - gap - height
  const top = Math.max(bounds.top, Math.min(preferredTop, bounds.bottom - height))
  return { left, top }
}
