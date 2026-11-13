import { Fragment, useEffect, useRef, useState } from 'react'
import { Circle, Marker, Tooltip, useMap } from 'react-leaflet'
import * as L from 'leaflet'
import type { FieldSupportInstance, Side } from '../types'
import { platform } from '../platform'
import { fieldSupportRangeRings, fieldSupportOf } from '../config/fieldSupports'

interface Props {
  supports: FieldSupportInstance[]
  view: Side
  interactive: boolean
  metersPerMapUnit?: number
  onMove: (uid: string, lat: number, lng: number) => void
  onDelete: (uid: string) => void
}

const ownColor = '#01ff84'
const enemyColor = '#e0453a'

function iconFor(item: FieldSupportInstance, view: Side, name: string) {
  const color = item.side === view ? ownColor : enemyColor
  return L.divIcon({
    className: 'field-support-marker-wrap',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<div class="field-support-marker ${item.definitionId === 'vehicle-airdrop' ? 'vehicle-airdrop' : ''}" style="--support-color:${color}"><span class="field-support-glow"></span><img src="${item.iconUrl}" alt="${name}" draggable="false" /></div>`,
  })
}

export default function FieldSupportLayer({ supports, view, interactive, metersPerMapUnit, onMove, onDelete }: Props) {
  return <>{supports.map((item) => {
    const mobile = platform.kind === 'android'
    return <Fragment key={item.uid}>
      <FieldSupportMarker item={item} view={view} interactive={interactive} mobile={mobile} metersPerMapUnit={metersPerMapUnit} onMove={onMove} onDelete={onDelete} />
    </Fragment>
  })}</>
}

function FieldSupportMarker({ item, view, interactive, mobile, metersPerMapUnit, onMove, onDelete }: { item: FieldSupportInstance; view: Side; interactive: boolean; mobile: boolean; metersPerMapUnit?: number; onMove: Props['onMove']; onDelete: Props['onDelete'] }) {
  const [expanded, setExpanded] = useState(false)
  const circles = useRef(new Map<number, L.Circle>())
  const map = useMap()
  const definition = fieldSupportOf(item.definitionId)
  const name = definition?.name ?? item.name
  const hasDetails = Boolean(definition?.details?.length || definition?.detailNote)
  const rangeRings = fieldSupportRangeRings(item.definitionId, metersPerMapUnit)
  useEffect(() => {
    if (!mobile) return
    const closeFromMap = () => setExpanded(false)
    const closeFromSelection = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== item.uid) setExpanded(false)
    }
    map.on('click', closeFromMap)
    window.addEventListener('mobile-unit-selected', closeFromSelection)
    return () => { map.off('click', closeFromMap); window.removeEventListener('mobile-unit-selected', closeFromSelection) }
  }, [item.uid, map, mobile])
  const icon = mobile ? L.divIcon({ ...iconFor(item, view, name).options, html: `<div class="field-support-marker-wrap"><div class="field-support-marker ${item.definitionId === 'vehicle-airdrop' ? 'vehicle-airdrop' : ''} ${expanded ? 'expanded' : ''}" style="--support-color:${item.side === view ? ownColor : enemyColor}"><span class="field-support-glow"></span><img src="${item.iconUrl}" alt="${name}" draggable="false" />${expanded ? `<button class="field-support-delete-control danger" aria-label="删除阵地支援" onclick="event.stopPropagation();event.preventDefault();window.__fieldSupportDelete('${item.uid}')"><i class="fa-regular fa-trash-can"></i></button>` : ''}</div></div>` }) : iconFor(item, view, name)
  useEffect(() => {
    if (!mobile) return
    const target = window as typeof window & { __fieldSupportDelete?: (uid: string) => void; __fieldSupportDeleteHandlers?: Record<string, () => void> }
    if (!target.__fieldSupportDeleteHandlers) target.__fieldSupportDeleteHandlers = {}
    if (!target.__fieldSupportDelete) target.__fieldSupportDelete = (uid) => target.__fieldSupportDeleteHandlers?.[uid]?.()
    target.__fieldSupportDeleteHandlers[item.uid] = () => onDelete(item.uid)
    return () => { if (target.__fieldSupportDeleteHandlers) delete target.__fieldSupportDeleteHandlers[item.uid] }
  }, [item.uid, mobile, onDelete])
  return <>
    {rangeRings.slice().reverse().map((ring) => <Circle
      key={ring.radiusMeters}
      ref={(circle) => { if (circle) circles.current.set(ring.radiusMeters, circle); else circles.current.delete(ring.radiusMeters) }}
      center={[item.lat, item.lng]}
      radius={ring.mapRadius}
      pathOptions={{ color: ring.color, weight: ring.weight, opacity: ring.opacity, fill: ring.fill, fillOpacity: ring.fillOpacity, dashArray: ring.dashArray, className: `field-support-damage-range damage-range-${ring.radiusMeters}${ring.kind === 'placement' ? ' field-support-placement-range' : ''}` }}
      interactive={false}
    />)}
    <Marker position={[item.lat, item.lng]} icon={icon} draggable={interactive} eventHandlers={{
      click: (event) => { if (!mobile) return; L.DomEvent.stop(event.originalEvent); window.dispatchEvent(new CustomEvent('mobile-unit-selected', { detail: item.uid })); setExpanded((value) => !value) },
      // 只更新 Leaflet 范围圈，不在 drag 过程中写入全局 React 状态。
      drag: (event) => { const point = (event.target as L.Marker).getLatLng(); circles.current.forEach((circle) => circle.setLatLng(point)) },
      dragend: (event) => { const point = (event.target as L.Marker).getLatLng(); circles.current.forEach((circle) => circle.setLatLng(point)); onMove(item.uid, point.lat, point.lng) },
      contextmenu: mobile ? (event) => L.DomEvent.stop(event.originalEvent) : () => onDelete(item.uid),
    }}>
      {!mobile || (hasDetails && expanded) ? <Tooltip
        direction={mobile ? 'auto' : 'top'}
        offset={mobile ? [18, 0] : [0, -18]}
        permanent={mobile && expanded}
        interactive={mobile}
        className={`${hasDetails ? 'field-support-details' : 'field-support-brief'}${mobile ? ' field-support-details-mobile' : ''}`}
        eventHandlers={{ add: (event) => {
          const tooltip = event.target as L.Tooltip
          const element = tooltip.getElement()
          if (!element) return
          element.style.setProperty('--support-tooltip-max-width', `${Math.max(1, map.getSize().x - 24)}px`)
          if (mobile) { L.DomEvent.disableClickPropagation(element); L.DomEvent.disableScrollPropagation(element) }
          tooltip.update()
        } }}
      >
        <div className="field-support-tooltip">
          <strong>{name} · {item.side === 'attack' ? '攻方' : '守方'}</strong>
          {definition?.details?.map((line) => <span key={line}>{line}</span>)}
          {definition?.detailNote ? <span className="field-support-detail-note">{definition.detailNote}</span> : null}
          {definition?.details?.length && rangeRings.length === 0 ? <span>该地图的米制范围尚未标定</span> : null}
          {!mobile ? <span>右键删除</span> : null}
        </div>
      </Tooltip> : null}
    </Marker>
  </>
}
