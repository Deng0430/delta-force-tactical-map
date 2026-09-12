export interface CameraRect { x: number; y: number; width: number; height: number }

// Shared by the input driver and shell so visibility uses the rendered camera.
export function getDemoCamera(focus?: CameraRect | null) {
  const zoom = focus ? Math.max(1, Math.min(2.4, 1920 / (focus.width + 320), 1080 / (focus.height + 240))) : 1
  const cx = focus ? Math.max(960 / zoom, Math.min(1920 - 960 / zoom, focus.x + focus.width / 2)) : 960
  const cy = focus ? Math.max(540 / zoom, Math.min(1080 - 540 / zoom, focus.y + focus.height / 2)) : 540
  return { zoom, cx, cy }
}

export function canKeepDemoCamera(previous: CameraRect | null | undefined, target: CameraRect) {
  if (!previous) return false
  const { zoom, cx, cy } = getDemoCamera(previous)
  // An establishing wide shot must not prevent the next deliberate close-up.
  if (zoom <= 1.1) return false
  const margin = 24 / zoom
  const left = cx - 960 / zoom
  const top = cy - 540 / zoom
  const right = cx + 960 / zoom
  const bottom = cy + 540 / zoom
  return Math.max(0, target.x) >= (left < 1 ? 0 : left + margin)
    && Math.max(0, target.y) >= (top < 1 ? 0 : top + margin)
    && Math.min(1920, target.x + target.width) <= (right > 1919 ? 1920 : right - margin)
    && Math.min(1080, target.y + target.height) <= (bottom > 1079 ? 1080 : bottom - margin)
}
