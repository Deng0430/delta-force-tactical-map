/** Capture the live Leaflet DOM, never rebuild it from a saved stage/round bucket. */
import { platform } from '../platform'

export function mapImageFilename(mapName: string, stageId: string, round: number, now = new Date()): string {
  const timestamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  return `${mapName}_${stageId}_回合${round}_${timestamp}.png`.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
}

/** Keep geographic content and the metric scale; omit editing/interaction controls. */
export function includeInMapImage(node: HTMLElement): boolean {
  return !(node instanceof Element && node.matches(
    '.leaflet-control:not(.map-metric-scale), .leaflet-tooltip:not(.map-measure-tooltip), .leaflet-popup-pane, '
    + '.leaflet-draw-tooltip, .leaflet-editing-icon, .edit-handle-wrap, .edit-selection-box, '
    + '.edit-style-trigger-wrap, .edit-delete-trigger-wrap, .route-editor-trigger-wrap, '
    + '.op-action-fan, .veh-action-fan, .building-action-fan, .tm-action-fan, .unit-team-trigger, '
    + '.op-route, .op-fireline, .op-info, .op-delete, .op-rotate-control, '
    + '.veh-side, .veh-route, .veh-fireline, .veh-delete-control, .veh-rotate-control, '
    + '.building-side, .building-route, .building-fireline, .building-delete-control, .building-rotate-control, '
    + '.tm-route, .tm-fireline, .tm-delete, .tm-rotate-control, [data-map-image-exclude]',
  ))
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

/** Side panels overlay the map: crop their covered pixels, without recentering the map. */
export function mapImageViewport(rect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>,
  leftPanel?: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>,
  rightPanel?: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>) {
  const overlaps = (panel?: typeof leftPanel) => panel && panel.right > panel.left && panel.bottom > panel.top
    && panel.bottom > rect.top && panel.top < rect.bottom
  const left = overlaps(leftPanel) ? Math.max(rect.left, leftPanel!.right) : rect.left
  const right = overlaps(rightPanel) ? Math.min(rect.right, rightPanel!.left) : rect.right
  return { x: left - rect.left, y: 0, width: Math.max(0, right - left), height: rect.bottom - rect.top }
}

export async function exportMapImage(element: HTMLElement, filename: string): Promise<void> {
  // Lazy-load the rasterizer only when needed. The modal stays open to prevent view changes,
  // but is outside the captured subtree and cannot appear in the exported image.
  const { toCanvas } = await import('html-to-image')
  await document.fonts.ready
  await nextPaint()
  const rect = element.getBoundingClientRect()
  if (!element.isConnected || rect.width <= 0 || rect.height <= 0) throw new Error('地图尚未就绪，请稍后重试')
  const app = element.closest('.app')
  const crop = mapImageViewport(rect,
    app?.querySelector('.left-panel:not(.collapsed)')?.getBoundingClientRect(),
    app?.querySelector('.point-panel')?.getBoundingClientRect())
  if (crop.width < 1 || crop.height < 1) throw new Error('地图被侧栏遮挡，请先收起侧栏再导出')
  const visibleImages = Array.from(element.querySelectorAll('img')).filter((img) => {
    const bounds = img.getBoundingClientRect()
    return bounds.width > 0 && bounds.height > 0 && bounds.right > rect.left && bounds.left < rect.right
      && bounds.bottom > rect.top && bounds.top < rect.bottom && getComputedStyle(img).visibility !== 'hidden'
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      Promise.all(visibleImages.map((img) => img.decode())),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('地图图片加载超时，请等待底图加载完成后重试')), 10_000) }),
    ])
  } catch (error) {
    if (error instanceof Error && error.message.includes('超时')) throw error
    throw new Error('当前画面有未加载的图片，请等待底图和图标加载完成后重试')
  } finally {
    clearTimeout(timer)
  }
  const canvas = await toCanvas(element, {
    width: Math.round(rect.width), height: Math.round(rect.height),
    // Bound memory use on high-DPI phones and large desktop monitors.
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(16_000_000 / (rect.width * rect.height))),
    filter: includeInMapImage,
    backgroundColor: getComputedStyle(element).backgroundColor,
    includeQueryParams: true,
    preferredFontFormat: 'woff2',
    fetchRequestInit: { signal: AbortSignal.timeout(15_000) },
  })
  const output = document.createElement('canvas')
  const ratioX = canvas.width / Math.round(rect.width)
  const ratioY = canvas.height / Math.round(rect.height)
  output.width = Math.max(1, Math.round(crop.width * ratioX))
  output.height = Math.max(1, Math.round(crop.height * ratioY))
  const context = output.getContext('2d')
  if (!context) throw new Error('当前设备无法生成图片')
  context.drawImage(canvas, crop.x * ratioX, crop.y * ratioY, crop.width * ratioX, crop.height * ratioY, 0, 0, output.width, output.height)
  const blob = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, 'image/png'))
  if (!blob || !blob.size) throw new Error('图片生成失败，请稍后重试')
  await platform.downloadBlob(filename, blob)
}
