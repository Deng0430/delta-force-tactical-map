import { surfaceModelForManifest } from '../config/mapSurfaceModels'

export interface SurfaceHeightCandidate {
  id: string
  kind: 'terrain' | 'model'
  heightMeters: number
}

export interface MapSurfaceSample {
  groundMeters: number
  candidates: SurfaceHeightCandidate[]
  sampleSpacingMeters: number
  sourceNote?: string
}

interface SurfaceManifest {
  format: string
  version: number
  tileEncoding: string
  mapId: string
  tileUrl: string
  stepMeters: number
  metersPerMapUnit: number
  columns: number
  rows: number
  tileSize: number
  sourceNote?: string
  mapBounds: { west: number; east: number; north: number; south: number }
  tiles: Array<{ x: number; y: number; file: string; rawBytes: number; rawSha256: string }>
}

interface SurfaceTile {
  width: number
  height: number
  ground: Float32Array
  offsets: Uint32Array
  surfaces: Int32Array
}

const manifests = new Map<string, Promise<SurfaceManifest>>()
const tiles = new Map<string, Promise<SurfaceTile>>()

async function readManifest(url: string): Promise<SurfaceManifest> {
  let pending = manifests.get(url)
  if (!pending) {
    pending = (async () => {
      const expected = surfaceModelForManifest(url)
      if (!expected) throw new Error('高度索引路径未绑定已标定地图')
      const response = await fetch(url, { headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error('高度索引读取失败')
      const value = await response.json() as SurfaceManifest
      if (!value || value.format !== 'deltaforce-map-surfaces' || value.version !== 2 || value.tileEncoding !== 'gzip-base64'
        || value.mapId !== expected.mapId
        || (value.tileUrl !== expected.tileUrl && value.tileUrl !== expected.referenceTileUrl)
        || value.columns !== expected.columns || value.rows !== expected.rows || value.tileSize !== 64
        || value.stepMeters !== 1 || value.metersPerMapUnit !== expected.metersPerMapUnit
        || value.mapBounds?.west !== expected.mapBounds.west || value.mapBounds.east !== expected.mapBounds.east
        || value.mapBounds.north !== expected.mapBounds.north || value.mapBounds.south !== expected.mapBounds.south
        || (value.sourceNote !== undefined && (typeof value.sourceNote !== 'string' || !value.sourceNote.trim() || value.sourceNote.length > 500))
        || (expected.sourceNote !== undefined && value.sourceNote !== expected.sourceNote)
        || !Array.isArray(value.tiles)) throw new Error('高度索引格式不匹配')
      const tileColumns = Math.ceil(value.columns / value.tileSize)
      const tileRows = Math.ceil(value.rows / value.tileSize)
      const positions = new Set<string>()
      if (value.tiles.length !== tileColumns * tileRows) throw new Error('高度索引瓦片布局不匹配')
      for (const tile of value.tiles) {
        if (!tile || !Number.isSafeInteger(tile.x) || !Number.isSafeInteger(tile.y)
          || tile.x < 0 || tile.x >= tileColumns || tile.y < 0 || tile.y >= tileRows
          || tile.file !== `${tile.x}_${tile.y}.json`
          || !Number.isSafeInteger(tile.rawBytes) || tile.rawBytes < 16 || tile.rawBytes > 8 * 1024 * 1024
          || typeof tile.rawSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(tile.rawSha256)) throw new Error('高度索引瓦片布局不匹配')
        const position = `${tile.x}_${tile.y}`
        if (positions.has(position)) throw new Error('高度索引瓦片布局不匹配')
        positions.add(position)
      }
      return value
    })()
    manifests.set(url, pending)
    pending.catch(() => { if (manifests.get(url) === pending) manifests.delete(url) })
  }
  return pending
}

async function readTile(manifestUrl: string, manifest: SurfaceManifest, x: number, y: number): Promise<SurfaceTile> {
  const filename = `${x}_${y}.json`
  const record = manifest.tiles.find((tile) => tile.x === x && tile.y === y && tile.file === filename)
  if (!record || !Number.isSafeInteger(record.rawBytes) || record.rawBytes < 16 || record.rawBytes > 8 * 1024 * 1024) throw new Error('缺少有效高度瓦片')
  const url = `${manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1)}${filename}`
  let pending = tiles.get(url)
  if (pending) {
    tiles.delete(url)
    tiles.set(url, pending)
    return pending
  }
  pending = (async () => {
    // JSON envelopes keep background height requests out of download managers'
    // archive/binary interception rules, on both static web and packaged hosts.
    const response = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error('高度瓦片读取失败')
    const value = await response.json() as { format?: string; version?: number; encoding?: string; data?: string }
    if (value.format !== 'deltaforce-map-surface-tile' || value.version !== 1 || value.encoding !== manifest.tileEncoding
      || typeof value.data !== 'string' || !value.data.length || value.data.length > 12 * 1024 * 1024) throw new Error('高度瓦片传输格式不匹配')
    const binary = atob(value.data)
    const compressed = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) compressed[i] = binary.charCodeAt(i)
    if (compressed[0] !== 31 || compressed[1] !== 139) throw new Error('高度瓦片压缩格式不匹配')
    if (typeof DecompressionStream === 'undefined') throw new Error('当前环境不支持高度数据解压')
    const stream = new Response(compressed).body
    if (!stream) throw new Error('高度数据为空')
    const buffer = await new Response(stream.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
    if (buffer.byteLength !== record.rawBytes || buffer.byteLength < 16) throw new Error('高度瓦片长度不匹配')
    if (globalThis.crypto?.subtle) {
      const digest = await crypto.subtle.digest('SHA-256', buffer)
      const hash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
      if (hash !== record.rawSha256) throw new Error('高度瓦片校验不匹配')
    }
    const header = new DataView(buffer)
    if (header.getUint32(0, true) !== 0x3146534d) throw new Error('高度瓦片格式不匹配')
    const width = header.getUint16(4, true)
    const height = header.getUint16(6, true)
    const surfaceCount = header.getUint32(8, true)
    const groundCount = header.getUint32(12, true)
    if (width !== Math.min(manifest.tileSize, manifest.columns-x*manifest.tileSize)
      || height !== Math.min(manifest.tileSize, manifest.rows-y*manifest.tileSize)
      || groundCount !== (width+1)*(height+1)
      || 16 + (groundCount + width*height + 1 + surfaceCount)*4 !== buffer.byteLength) throw new Error('高度瓦片布局不匹配')
    const ground = new Float32Array(buffer, 16, groundCount)
    const offsets = new Uint32Array(buffer, 16+groundCount*4, width*height+1)
    const surfaces = new Int32Array(buffer, 16+(groundCount+offsets.length)*4, surfaceCount)
    if (offsets[0] !== 0 || offsets[offsets.length-1] !== surfaceCount) throw new Error('表面索引不匹配')
    return { width, height, ground, offsets, surfaces }
  })()
  tiles.set(url, pending)
  if (tiles.size > 32) tiles.delete(tiles.keys().next().value!)
  pending.catch(() => { if (tiles.get(url) === pending) tiles.delete(url) })
  return pending
}

/** 模型面采用所在 1m 格网的中心采样；不跨楼层插值、不把缺失高度当作零。 */
export async function sampleMapSurfaces(manifestUrl: string, lat: number, lng: number): Promise<MapSurfaceSample | null> {
  const manifest = await readManifest(manifestUrl)
  const bounds = manifest.mapBounds
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lng < bounds.west || lng > bounds.east || lat < bounds.south || lat > bounds.north) return null
  const gridX = (lng-bounds.west)*manifest.metersPerMapUnit/manifest.stepMeters
  const gridY = (bounds.north-lat)*manifest.metersPerMapUnit/manifest.stepMeters
  const col = Math.min(manifest.columns-1, Math.floor(gridX))
  const row = Math.min(manifest.rows-1, Math.floor(gridY))
  const tileX = Math.floor(col/manifest.tileSize)
  const tileY = Math.floor(row/manifest.tileSize)
  const tile = await readTile(manifestUrl, manifest, tileX, tileY)
  const x = col-tileX*manifest.tileSize
  const y = row-tileY*manifest.tileSize
  const fx = gridX-col
  const fy = gridY-row
  const stride = tile.width+1
  const a = tile.ground[y*stride+x]
  const b = tile.ground[y*stride+x+1]
  const c = tile.ground[(y+1)*stride+x]
  const d = tile.ground[(y+1)*stride+x+1]
  const groundMeters = (a*(1-fx)+b*fx)*(1-fy)+(c*(1-fx)+d*fx)*fy
  if (!Number.isFinite(groundMeters)) return null
  const index = y*tile.width+x
  const first = tile.offsets[index]
  const last = tile.offsets[index+1]
  if (first > last || last > tile.surfaces.length || last-first > 128) throw new Error('表面候选范围无效')
  const candidates: SurfaceHeightCandidate[] = [{ id: 'terrain', kind: 'terrain', heightMeters: groundMeters }]
  for (let i = first; i < last; i++) {
    const heightMeters = tile.surfaces[i]/100
    if (candidates.every((candidate) => Math.abs(candidate.heightMeters-heightMeters) >= .12)) {
      candidates.push({ id: `model:${i-first}`, kind: 'model', heightMeters })
    }
  }
  candidates.sort((left, right) => right.heightMeters-left.heightMeters)
  return { groundMeters, candidates, sampleSpacingMeters: manifest.stepMeters,
    ...(manifest.sourceNote === undefined ? {} : { sourceNote: manifest.sourceNote }) }
}
