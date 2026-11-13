import { useMemo } from 'react'
import { Marker, Polyline, Tooltip } from 'react-leaflet'
import * as L from 'leaflet'
import type { MapProp, PropVisibility } from '../types'
import { MAP_PROPS } from '../config/pointsStages'
import { POINT_ICON_BASE } from '../config/points'
import { mapPropThemeOf } from '../config/mapPropTheme'
import { platform } from '../platform'
import { buildMapPropZiplineDisplay, ZIPLINE_VERTICAL_BADGE_HTML, ziplineEndpointHtml } from '../utils/mapZiplines'
import { AIR_SUPPLY_BADGE_HTML, airSupplyHeightLabel } from '../utils/airSupply'

function propIcon(prop: MapProp, endpoint = false): L.DivIcon {
  const t = mapPropThemeOf(prop.name)
  const iconUrl = `${POINT_ICON_BASE}/${encodeURIComponent(prop.icon).replace(/'/g, '%27')}.png`
  const touchSize = platform.kind === 'android' ? 44 : t.size
  return L.divIcon({
    className: 'prop-marker-wrap',
    html: endpoint ? ziplineEndpointHtml(prop.zipline!.endpoint, t.color) : `
      <div class="prop-marker" style="--pc:${t.color};--prop-visual-size:${t.size}px;--prop-icon:url('${iconUrl}')">
        <span class="prop-glyph" aria-hidden="true"></span>
        ${prop.zipline?.orientation === 'vertical' ? ZIPLINE_VERTICAL_BADGE_HTML : ''}
        ${prop.name === '空中载具补给站' ? AIR_SUPPLY_BADGE_HTML : ''}
      </div>`,
    iconSize: [touchSize, touchSize],
    iconAnchor: [touchSize / 2, touchSize / 2],
  })
}

interface MapPropsLayerProps {
  mapId: string
  /** 地图道具总开关（问题1） */
  visible: boolean
  /** 道具按类型显示开关（问题2） */
  propVis: PropVisibility
  /** 绘制工具激活时禁用交互（不弹名称提示） */
  interactive: boolean
  /** 自定义模式转换后的正式版道具数据；未提供时使用攻防模式内置数据。 */
  propsOverride?: MapProp[]
  stageId?: string
}

/**
 * 地图道具图层（问题1/2/4）：
 * 渲染官网地图道具（载具补给站/固定防空炮/固定机枪/岸防炮/滑索/电梯/固定弹药箱），
 * 原图透明轮廓直接着色，无圆形底片；悬停/点击显示道具名称；
 * 受左侧面板"地图道具"总开关与各类型开关双重控制，开关状态存入 localStorage。
 */
export default function MapPropsLayer({ mapId, visible, propVis, interactive, propsOverride, stageId }: MapPropsLayerProps) {
  const props = useMemo<MapProp[]>(() => propsOverride ?? MAP_PROPS[mapId] ?? [], [mapId, propsOverride])
  const display = useMemo(() => buildMapPropZiplineDisplay(props.filter((prop) => (propVis[prop.name] ?? true)
    && (!stageId || !/^S\d+$/.test(prop.stage) || prop.stage === stageId))), [props, propVis, stageId])
  if (!visible || props.length === 0) return null

  return (
    <>
      {display.connections.map((line) => <Polyline key={line.id} positions={line.latlngs}
        pathOptions={{ color: mapPropThemeOf('滑索').color, weight: 1.8, opacity: .8, dashArray: '4 4', interactive: false, className: 'map-zipline-connection' }} interactive={false} />)}
      {display.midpoints.map(({ id, prop }) => <Marker key={`zipline-mid-${id}`} position={[prop.lat, prop.lng]}
        icon={propIcon(prop)} zIndexOffset={521} interactive={interactive}>
        {interactive ? <Tooltip sticky direction="top" opacity={1}>滑索 · 斜向{prop.stage ? ` · ${prop.stage}` : ''}</Tooltip> : null}
      </Marker>)}
      {[...display.markers, ...display.endpoints].map((p, i) => {
        return (
          <Marker
            key={`prop-${mapId}-${i}-${p.icon}`}
            position={[p.lat, p.lng]}
            icon={propIcon(p, display.endpoints.includes(p))}
            zIndexOffset={520}
            interactive={interactive}
          >
            {/* 绘制工具激活时不绑定 tooltip，道具名称提示消失 */}
            {interactive && (
              <Tooltip sticky direction="top" opacity={1}>
                <span className="prop-tip">
                  {p.name}
                  {p.zipline ? <em> · {p.zipline.orientation === 'vertical' ? '垂直' : p.zipline.endpoint === 'green' ? 'A端' : 'B端'}</em> : null}
                  {p.stage ? <em> · {p.stage}</em> : null}
                  {p.name === '空中载具补给站' ? <><br /><em>{airSupplyHeightLabel(p.airSupply)}</em></> : null}
                </span>
              </Tooltip>
            )}
          </Marker>
        )
      })}
    </>
  )
}
