import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import * as L from 'leaflet'
import { metricScaleReading } from '../utils/mapMetricScale'

/** 屏幕固定控件：只更新自身 DOM，不在缩放时重渲染整张战术地图。 */
export default function MapMetricScale({ metersPerMapUnit }: { metersPerMapUnit?: number }) {
  const map = useMap()
  useEffect(() => {
    if (!metricScaleReading(metersPerMapUnit, map.getZoom())) return
    const control = new L.Control({ position: 'bottomright' })
    const container = L.DomUtil.create('div', 'map-metric-scale')
    container.setAttribute('role', 'img')
    const ruler = L.DomUtil.create('div', 'map-metric-scale-ruler', container)
    ruler.setAttribute('aria-hidden', 'true')
    L.DomUtil.create('span', 'map-metric-scale-zero', ruler).textContent = '0'
    const label = L.DomUtil.create('span', 'map-metric-scale-value', ruler)
    const bar = L.DomUtil.create('div', 'map-metric-scale-bar', ruler)
    let previousLabel = ''
    let previousWidth = ''

    const update = () => {
      const reading = metricScaleReading(metersPerMapUnit, map.getZoom(), Math.min(120, map.getSize().x / 4))
      if (!reading) return
      if (reading.label !== previousLabel) {
        previousLabel = label.textContent = reading.label
        container.setAttribute('aria-label', `地图比例尺：${reading.label}（水平距离）`)
      }
      bar.dataset.meters = String(reading.distanceMeters)
      const width = `${reading.widthPx.toFixed(3)}px`
      if (width !== previousWidth) {
        previousWidth = ruler.style.width = width
      }
    }
    control.onAdd = () => container
    control.addTo(map)
    map.on('zoomend resize', update)
    update()
    return () => {
      map.off('zoomend resize', update)
      control.remove()
    }
  }, [map, metersPerMapUnit])
  return null
}
