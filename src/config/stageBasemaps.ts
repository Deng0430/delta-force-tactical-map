import type { MapConfig } from '../types'
import type { GameDataPlatform } from './gameDataPlatform'

export const ASCENT_PC_S5_TILE_URL = '/maps/ascent-pc-s5-render-v1/{z}_{x}_{y}.webp'

/** Keep the native basemap in every stage; the experimental S5 render is archived only. */
export function mapConfigForStage(config: MapConfig, _stageId: string | null | undefined, _platform: GameDataPlatform): MapConfig {
  return config
}
