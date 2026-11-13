import type { Side } from '../types'
import type { InfantrySpawnGroupKind } from '../config/infantrySpawnAreas'

export const INFANTRY_SPAWN_SYMBOL_SIZE = 16

/** Match the objective/base friendly green and enemy red; shared with the legend. */
export function infantrySpawnColor(side: Side, view: Side): string {
  return side === view ? '#01ff84' : '#e0453a'
}

/** Static, trusted SVG; currentColor keeps the map symbol and panel swatch identical. */
export function infantrySpawnSymbolMarkup(kind: InfantrySpawnGroupKind): string {
  const core = kind === 'inner'
    ? '<circle cx="8" cy="8" r="4" fill="currentColor"/>'
    : '<circle cx="8" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="1.35"/>'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <circle cx="8" cy="8" r="5.5" fill="#080d10" fill-opacity=".95"/>
    ${core}
  </svg>`
}
