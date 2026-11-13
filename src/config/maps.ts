import type { MapConfig } from '../types'
import skyportOfficial from './skyportOfficial.json'
import { metersPerMapUnitForBasemap } from './mapMetricCalibration'

/**
 * 腾讯 CDN 瓦片基地址。
 * 瓦片版权归腾讯所有，本项目仅用于个人学习 / 非商业用途。
 * URL 规则：{base}/{图层目录}/{z}_{x}_{y}.jpg
 */
const TILE_BASE = 'https://game.gtimg.cn/images/dfm/cp/a20240729directory/img'

/**
 * 全面战场地图配置，正式版与模式配置器共用这一份地图目录。
 * 数据来自官网地图工具（df.qq.com/cp/a20240729directory）脚本中的
 * mapScaleInfo：boundsW/boundsH、minZoom/initZoom、initX/initY，
 * 边界换算公式（攻防模式，pixelToLatLngRatio = -1）：
 *   southWest = [0, -80]
 *   northEast = [-(boundsH - 70), -boundsW]
 */
const BASE_MAPS: MapConfig[] = [
  {
    id: 'ascent',
    name: '攀升',
    enName: 'Ascent',
    layerName: 'map_pc',
    // PC原生底图经无损顺时针90度对齐，Q80仅改变编码，不改变地图坐标。
    tileUrl: '/maps/ascent-pc-q80-v1/{z}_{x}_{y}.webp',
    minZoom: 2.5,
    initZoom: 2.5,
    maxZoom: 8,
    maxNativeZoom: 4,
    boundsW: -300,
    boundsH: 300,
    southWest: [0, -80],
    northEast: [-230, 300],
    initCenter: [-120, 90],
  },
  {
    id: 'flashpoint',
    name: '临界点',
    enName: 'Flashpoint',
    layerName: 'map_ljd_pc',
    // PC ClipMap原生4096/2048两级，无损顺时针90°对齐后按Q80切片。
    tileUrl: '/maps/flashpoint-pc-q80-v1/{z}_{x}_{y}.webp',
    minZoom: 3,
    initZoom: 3,
    maxZoom: 8,
    maxNativeZoom: 4,
    boundsW: -250,
    boundsH: 300,
    southWest: [0, -80],
    northEast: [-230, 250],
    initCenter: [-120, 105],
  },
  {
    id: 'fault',
    name: '断层',
    enName: 'Fault',
    layerName: 'map_dc',
    tileUrl: `${TILE_BASE}/map_dc/{z}_{x}_{y}.jpg`,
    minZoom: 2.5,
    initZoom: 2.5,
    maxZoom: 8,
    maxNativeZoom: 4,
    boundsW: -300,
    boundsH: 300,
    southWest: [0, -80],
    northEast: [-230, 300],
    initCenter: [-125, 105],
  },
  {
    id: 'brokentrack',
    name: '断轨',
    enName: 'BrokenTrack',
    layerName: 'map_dg',
    tileUrl: `${TILE_BASE}/map_dg/{z}_{x}_{y}.jpg`,
    minZoom: 2,
    initZoom: 2.5,
    maxZoom: 8,
    maxNativeZoom: 4,
    boundsW: -300,
    boundsH: 350,
    southWest: [0, -80],
    northEast: [-280, 300],
    initCenter: [-130, 130],
  },
  {
    id: 'colosseum',
    name: '克劳狄斗兽场',
    enName: 'ClaudiusColosseum',
    layerName: 'map_dsc',
    tileUrl: `${TILE_BASE}/map_dsc/{z}_{x}_{y}.jpg`,
    minZoom: 2.5,
    initZoom: 2.5,
    maxZoom: 8,
    maxNativeZoom: 4,
    boundsW: -300,
    boundsH: 300,
    southWest: [0, -80],
    northEast: [-230, 300],
    initCenter: [-115, 110],
  },
  {
    id: 'stormeye',
    name: '风暴眼',
    enName: 'StormEye',
    layerName: 'map_hdz',
    tileUrl: '/maps/stormeye-pc-q80-v1/{z}_{x}_{y}.webp',
    minZoom: 2.6,
    initZoom: 2.6,
    maxZoom: 8,
    maxNativeZoom: 4,
    boundsW: -300,
    boundsH: 300,
    southWest: [0, -80],
    northEast: [-230, 300],
    initCenter: [-105, 105],
  },
  {
    id: 'ember',
    name: '烬区',
    enName: 'Ember',
    layerName: 'map_jq',
    // 手游包原生底图已与官网总览瓦片完成像素对齐，保留现有据点/区域坐标。
    // 4096 详细层对应原生 z4；Q80 只压缩编码，不改变像素网格。
    tileUrl: '/maps/ember-mobile-q80-v1/{z}_{x}_{y}.webp',
    minZoom: 3,
    initZoom: 3,
    maxZoom: 8,
    maxNativeZoom: 4,
    boundsW: -300,
    boundsH: 300,
    southWest: [0, -80],
    northEast: [-230, 300],
    initCenter: [-130, 100],
  },
  {
    id: 'pyramid',
    name: '金字塔',
    enName: 'Pyramid',
    layerName: 'map_jzt',
    tileUrl: `${TILE_BASE}/map_jzt/{z}_{x}_{y}.jpg`,
    minZoom: 2.5,
    initZoom: 2.5,
    maxZoom: 8,
    maxNativeZoom: 4,
    boundsW: -300,
    boundsH: 300,
    southWest: [0, -80],
    northEast: [-230, 300],
    initCenter: [-125, 105],
  },
  {
    id: 'trench',
    name: '堑壕战',
    enName: 'TrenchWarfare',
    layerName: 'map_qhz',
    // PC ClipMap 原生 Mip1/Mip0 分别为 2048/4096，直接对应 z3/z4。
    // 保留官网坐标与平移边界；高于 z4 时复用真实原图，不伪造更高清层。
    tileUrl: '/maps/trench-pc-q80-v1/{z}_{x}_{y}.webp',
    minZoom: 2.5,
    initZoom: 2.5,
    maxZoom: 8,
    maxNativeZoom: 4,
    boundsW: -300,
    boundsH: 300,
    southWest: [0, -80],
    northEast: [-230, 300],
    initCenter: [-130, 110],
  },
  {
    id: 'umuscanal',
    name: '乌姆斯运河',
    enName: 'UmusCanal',
    layerName: 'map_wmsyh',
    tileUrl: `${TILE_BASE}/map_wmsyh/{z}_{x}_{y}.jpg`,
    minZoom: 2.5,
    initZoom: 2.5,
    maxZoom: 8,
    maxNativeZoom: 4,
    boundsW: -300,
    boundsH: 300,
    southWest: [0, -80],
    northEast: [-230, 300],
    initCenter: [-115, 110],
  },
  {
    id: 'aftershock',
    name: '余震',
    enName: 'Aftershock',
    layerName: 'map_yz',
    tileUrl: `${TILE_BASE}/map_yz/{z}_{x}_{y}.jpg`,
    minZoom: 2.5,
    initZoom: 2.5,
    maxZoom: 8,
    maxNativeZoom: 4,
    boundsW: -300,
    boundsH: 300,
    southWest: [0, -80],
    northEast: [-230, 300],
    initCenter: [-115, 110],
  },
  {
    id: 'mogoldtown',
    name: '摩格旧城区',
    enName: 'MogOldTown',
    layerName: 'map_mgjcq',
    tileUrl: `${TILE_BASE}/map_mgjcq/{z}_{x}_{y}.jpg`,
    minZoom: 2.5,
    initZoom: 2.5,
    maxZoom: 8,
    maxNativeZoom: 4,
    boundsW: -300,
    boundsH: 300,
    southWest: [0, -80],
    northEast: [-230, 300],
    initCenter: [-136, 127],
  },
  skyportOfficial.mapConfig as unknown as MapConfig,
]

export const MAPS: MapConfig[] = BASE_MAPS.map((map) => {
  const metersPerMapUnit = metersPerMapUnitForBasemap(map.id, map.tileUrl)
  return metersPerMapUnit === undefined ? map : { ...map, metersPerMapUnit }
})

export const MAP_BY_ID: Record<string, MapConfig> = Object.fromEntries(
  MAPS.map((m) => [m.id, m]),
)
