import { useMemo, useState } from 'react'
import { Marker, Pane, Polyline, useMap, useMapEvents } from 'react-leaflet'
import * as L from 'leaflet'
import type { Side } from '../types'
import type { InfantrySpawnBase, InfantrySpawnGroup, InfantrySpawnGroupKind } from '../config/infantrySpawnAreas'
import { INFANTRY_SPAWN_SYMBOL_SIZE, infantrySpawnColor, infantrySpawnSymbolMarkup } from '../utils/infantrySpawnSymbol'

function markerIcon(kind: InfantrySpawnGroupKind, color: string): L.DivIcon {
  return L.divIcon({
    className: 'infantry-spawn-marker-wrap',
    html: `<span class="infantry-spawn-map-symbol" style="color:${color}">${infantrySpawnSymbolMarkup(kind)}</span>`,
    iconSize: [INFANTRY_SPAWN_SYMBOL_SIZE, INFANTRY_SPAWN_SYMBOL_SIZE],
    iconAnchor: [INFANTRY_SPAWN_SYMBOL_SIZE / 2, INFANTRY_SPAWN_SYMBOL_SIZE / 2],
  })
}

interface Props {
  groups: InfantrySpawnGroup[]
  view: Side
  base?: (InfantrySpawnBase & { origin: [number, number] }) | null
}

export default function InfantrySpawnLayer({ groups, view, base }: Props) {
  const map = useMap()
  const [zoom, setZoom] = useState(() => map.getZoom())
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) })
  const icons = useMemo(() => {
    const forSide = (side: Side) => ({
      inner: markerIcon('inner', infantrySpawnColor(side, view)),
      outer: markerIcon('outer', infantrySpawnColor(side, view)),
    })
    return { attack: forSide('attack'), defense: forSide('defense') }
  }, [view])
  // Objective references and guides remain below icons. Lift only the inspected base
  // reference so it is still visible when its position overlaps the deployment icon.
  // Bounds centers remain display anchors, not recovered landing coordinates.
  return <>
    <Pane name="infantry-spawn-points" style={{ zIndex: 410, pointerEvents: 'none' }}>
    {base?.areas.map((area) => {
      const center = L.latLngBounds(area.points).getCenter()
      const separated = map.project(base.origin, zoom).distanceTo(map.project(center, zoom)) > 28
      return separated ? <Polyline key={`base-line-${area.id}`} positions={[base.origin, center]} interactive={false}
        pathOptions={{ color: infantrySpawnColor(base.side, view), weight: 1, opacity: 0.65, dashArray: '3 5' }} /> : null
    })}
    {groups.flatMap((group) => group.areas.map((area) => (
    <Marker
      key={`${group.side}-${group.kind}-${area.id}`}
      position={L.latLngBounds(area.points).getCenter()}
      icon={icons[group.side][group.kind]}
      interactive={false}
      keyboard={false}
    />
  )))}</Pane>
    <Pane name="infantry-base-reference-points" style={{ zIndex: 620, pointerEvents: 'none' }}>
      {base?.areas.map((area) => <Marker key={`base-${area.id}`}
        position={L.latLngBounds(area.points).getCenter()} icon={icons[base.side].inner}
        interactive={false} keyboard={false} />)}
    </Pane>
  </>
}
