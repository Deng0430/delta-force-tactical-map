import type { MapConfig } from '../types'

/** Local basemaps must be embedded in exported HTML, not referenced on the user's machine. */
export function localMapTileUrls(config: MapConfig): string[] {
  if (!config.tileUrl.startsWith('/') || config.tileUrl.startsWith('//')) return []
  const west = Math.min(config.southWest[1], config.northEast[1])
  const east = Math.max(config.southWest[1], config.northEast[1])
  const south = Math.min(config.southWest[0], config.northEast[0])
  const north = Math.max(config.southWest[0], config.northEast[0])
  const urls: string[] = []
  for (let z = Math.ceil(config.minZoom); z <= config.maxNativeZoom; z++) {
    const scale = 2 ** z / 256
    for (let y = Math.floor(-north * scale); y < Math.ceil(-south * scale); y++) {
      for (let x = Math.floor(west * scale); x < Math.ceil(east * scale); x++) {
        urls.push(config.tileUrl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)))
      }
    }
  }
  return urls
}
