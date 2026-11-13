import type { ZiplineEndpointInfo } from '../types'

export const ZIPLINE_VERTICAL_BADGE_HTML = '<span class="prop-zipline-vertical" aria-hidden="true">⊥</span>'

export function normalizeZiplineEndpoint(value: unknown): ZiplineEndpointInfo | undefined {
  if (!value || typeof value !== 'object') return undefined
  const item = value as Partial<ZiplineEndpointInfo>
  if (typeof item.lineId !== 'string' || !item.lineId.trim()
    || !['vertical', 'span'].includes(item.orientation ?? '')
    || !['green', 'red'].includes(item.endpoint ?? '')
    || typeof item.elevationMeters !== 'number' || !Number.isFinite(item.elevationMeters)) return undefined
  return { lineId: item.lineId, orientation: item.orientation!, endpoint: item.endpoint!, elevationMeters: item.elevationMeters }
}

interface ZiplineProp {
  name: string
  icon: string
  lat: number
  lng: number
  stage?: string
  stageId?: string
  zipline?: ZiplineEndpointInfo
}

/** Self-contained so exported tactical HTML uses the same pairing and collapse rules. */
export function buildMapPropZiplineDisplay<T extends ZiplineProp>(props: T[], collapseVertical = true) {
  const groups = new Map<string, T[]>()
  const hidden = new Set<T>()
  const connections: { id: string; latlngs: [number, number][] }[] = []
  const endpoints: T[] = []
  const midpoints: { id: string; prop: T }[] = []
  for (const prop of props) {
    if (prop.name !== '滑索' || prop.icon !== 'q_hs' || !prop.zipline) continue
    const key = JSON.stringify([prop.stageId ?? prop.stage ?? '', prop.zipline.lineId])
    const group = groups.get(key) ?? []
    group.push(prop)
    groups.set(key, group)
  }
  for (const [id, group] of groups) {
    if (group.every((prop) => prop.zipline!.orientation === 'vertical')) {
      if (collapseVertical) {
        const lower = group.reduce((a, b) => a.zipline!.elevationMeters <= b.zipline!.elevationMeters ? a : b)
        group.forEach((prop) => { if (prop !== lower) hidden.add(prop) })
      }
      continue
    }
    if (!group.every((prop) => prop.zipline!.orientation === 'span')) continue
    const green = group.filter((prop) => prop.zipline!.endpoint === 'green')
    const red = group.filter((prop) => prop.zipline!.endpoint === 'red')
    if (green.length !== 1 || red.length !== 1) continue
    if (green[0].lat === red[0].lat && green[0].lng === red[0].lng) continue
    connections.push({ id, latlngs: [[green[0].lat, green[0].lng], [red[0].lat, red[0].lng]] })
    endpoints.push(green[0], red[0])
    hidden.add(green[0])
    hidden.add(red[0])
    midpoints.push({ id, prop: { ...green[0], lat: (green[0].lat + red[0].lat) / 2, lng: (green[0].lng + red[0].lng) / 2 } })
  }
  return { markers: props.filter((prop) => !hidden.has(prop)), connections, endpoints, midpoints }
}

/** Keep endpoint positions editable, but use small visual anchors rather than duplicate icons. */
export function ziplineEndpointHtml(end: 'green' | 'red', color: string): string {
  return `<span class="prop-zipline-endpoint${end === 'red' ? ' end' : ''}" style="--pc:${color}" aria-hidden="true"></span>`
}
