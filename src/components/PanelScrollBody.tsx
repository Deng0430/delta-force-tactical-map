import { useEffect, useRef, type ReactNode } from 'react'
import { attachOverlayScrollbar } from '../utils/overlayScrollbar'

export default function PanelScrollBody({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const viewport = viewportRef.current, content = contentRef.current
    const track = trackRef.current, thumb = thumbRef.current
    if (!enabled || !viewport || !content || !track || !thumb) return
    return attachOverlayScrollbar(viewport, content, track, thumb)
  }, [enabled])
  return (
    <div ref={viewportRef} className="panel-body" tabIndex={enabled ? 0 : -1} role="region" aria-label="战术面板滚动内容">
      {/* 零高度 sticky 锚点不参与内容尺寸计算；滚轮/触控事件仍属于原生滚动容器。 */}
      <div className="panel-scroll-anchor" aria-hidden="true">
        <div ref={trackRef} className="panel-scroll-track">
          <div ref={thumbRef} className="panel-scroll-thumb" />
        </div>
      </div>
      <div ref={contentRef} className="panel-scroll-content">{children}</div>
    </div>
  )
}
