import type { MapState, OperatorUnit, TacticalRoute, TeamMarker } from '../types'
import {
  connectionsBucketOf,
  fieldSupportsBucketOf,
  operatorsBucketOf,
  routesBucketOf,
  teamsBucketOf,
  vehiclesBucketOf,
  buildingsBucketOf,
  wargameOf,
} from '../utils/storage'

export type BeginnerFixturePhase = 'clean' | 'drawing' | 'text' | 'complete' | 'alternate'

export const BEGINNER_DEMO_IDS = {
  circle: 'beginner-demo-circle',
  arrow: 'beginner-demo-arrow',
  mainText: 'beginner-demo-main-text',
  backupText: 'beginner-demo-backup-text',
  mainTeam: 'beginner-demo-main-team',
  coverTeam: 'beginner-demo-cover-team',
  mainRoute: 'beginner-demo-main-route',
} as const

export const BEGINNER_DEMO_MAP_ID = 'mogoldtown'
export const BEGINNER_DEMO_STAGE_ID = 'S1'
export const BEGINNER_DEMO_VIEW = 'attack' as const

/** A 点取自 PC 攻防官方数据；其余点位是教学示例落点，不代表推荐打法。 */
export const BEGINNER_DEMO_ANCHORS = {
  objective: [-119.301, 84.437] as [number, number],
  rally: [-126.3, 76.8] as [number, number],
  cover: [-128.2, 73.8] as [number, number],
  backup: [-124.4, 71.5] as [number, number],
  waypointOne: [-123.3, 80.5] as [number, number],
  waypointTwo: [-121.2, 83.0] as [number, number],
}

type GeoJsonFeature = {
  type: 'Feature'
  properties: Record<string, unknown>
  geometry: { type: string; coordinates: unknown }
}

function featureCollection(features: GeoJsonFeature[]) {
  return JSON.stringify({ type: 'FeatureCollection', features })
}

function circleFeature(): GeoJsonFeature {
  const [lat, lng] = BEGINNER_DEMO_ANCHORS.rally
  return {
    type: 'Feature',
    properties: {
      uid: BEGINNER_DEMO_IDS.circle,
      type: 'circle',
      color: '#00e39b',
      weight: 4,
      dash: 'solid',
      fillColor: '#00e39b',
      fillEnabled: true,
      radius: 7.5,
      radiusY: 7.5,
    },
    geometry: { type: 'Point', coordinates: [lng, lat] },
  }
}

function arrowFeature(): GeoJsonFeature {
  const [startLat, startLng] = BEGINNER_DEMO_ANCHORS.rally
  const [oneLat, oneLng] = BEGINNER_DEMO_ANCHORS.waypointOne
  const [endLat, endLng] = BEGINNER_DEMO_ANCHORS.objective
  return {
    type: 'Feature',
    properties: {
      uid: BEGINNER_DEMO_IDS.arrow,
      type: 'arrow',
      color: '#ffd54a',
      weight: 4,
      dash: 'solid',
      arrowStyle: 'triangle',
      arrowSize: 13,
      curve: 'straight',
    },
    geometry: {
      type: 'LineString',
      coordinates: [[startLng, startLat], [oneLng, oneLat], [endLng, endLat]],
    },
  }
}

function textFeature(uid: string, text: string, lat: number, lng: number): GeoJsonFeature {
  return {
    type: 'Feature',
    properties: {
      uid,
      type: 'text',
      text,
      color: '#e7fff4',
      backgroundColor: 'rgba(4, 25, 20, .86)',
      borderColor: '#00e39b',
      borderWidth: 1,
      borderStyle: 'solid',
      fontSize: 18,
      fontWeight: 'bold',
      textAlign: 'left',
      textWidth: 220,
    },
    geometry: { type: 'Point', coordinates: [lng, lat] },
  }
}

export function beginnerDrawingOf(phase: BeginnerFixturePhase): string {
  if (phase === 'clean') return JSON.stringify({ type: 'FeatureCollection', features: [] })
  const features: GeoJsonFeature[] = [circleFeature(), arrowFeature()]
  if (phase === 'text' || phase === 'complete' || phase === 'alternate') {
    features.push(textFeature(BEGINNER_DEMO_IDS.mainText, '主攻 A 点\n一队主攻，二队掩护', -125.3, 78.5))
  }
  if (phase === 'complete' || phase === 'alternate') {
    features.push(textFeature(BEGINNER_DEMO_IDS.backupText, '备用集合点', -123.8, 69.8))
  }
  return featureCollection(features)
}

function demoTeam(uid: string, name: string, team: 'A' | 'B', lat: number, lng: number, rotation: number): TeamMarker {
  return { uid, name, side: 'attack', team, role: 'infantry', lat, lng, rotation }
}

function demoRoute(waypoints: [number, number][]): TacticalRoute {
  return {
    uid: BEGINNER_DEMO_IDS.mainRoute,
    side: 'attack',
    team: 'A',
    teamMarkerUid: BEGINNER_DEMO_IDS.mainTeam,
    anchorMode: 'team',
    name: '一队·主攻路线',
    showLabel: true,
    orderType: 'attack',
    status: 'planned',
    color: '#00e39b',
    lineStyle: 'solid',
    geometryType: 'curve',
    opacity: 1,
    strokeWidth: 5,
    waypoints,
    operatorIds: [],
    vehicleIds: [],
    createdAt: 0,
  }
}

function updateNamedOperators(operators: OperatorUnit[], complete: boolean): OperatorUnit[] {
  let attackIndex = 0
  return operators.map((operator) => {
    if (operator.side !== 'attack' || operator.team !== 'A') return operator
    const next = attackIndex
    attackIndex += 1
    if (!complete || next > 1) return { ...operator, lat: null, lng: null, fireLineEnabled: false }
    return next === 0
      ? { ...operator, name: '一队·主攻', lat: BEGINNER_DEMO_ANCHORS.rally[0], lng: BEGINNER_DEMO_ANCHORS.rally[1], rotation: 42, fireLineEnabled: false }
      : { ...operator, name: '二队·掩护', lat: BEGINNER_DEMO_ANCHORS.cover[0], lng: BEGINNER_DEMO_ANCHORS.cover[1], rotation: 8, fireLineEnabled: true, fireLineLength: 64 }
  })
}

function removeBeginnerFeatures(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { type?: string; features?: GeoJsonFeature[] }
    if (parsed.type !== 'FeatureCollection' || !Array.isArray(parsed.features)) return raw
    const ids = new Set<string>(Object.values(BEGINNER_DEMO_IDS))
    return JSON.stringify({
      ...parsed,
      features: parsed.features.filter((feature) => !ids.has(String(feature.properties?.uid ?? ''))),
    })
  } catch {
    return raw
  }
}

export function clearBeginnerFixture(state: MapState): MapState {
  const operatorBuckets = operatorsBucketOf(state)
  const resetOperators = (items: OperatorUnit[]) => items.map((operator) => {
    if (operator.name === '一队·主攻' || operator.name === '二队·掩护') {
      return { ...operator, name: operator.uid, lat: null, lng: null, fireLineEnabled: false }
    }
    return operator
  })
  const teamBuckets = teamsBucketOf(state)
  const routeBuckets = routesBucketOf(state)
  const filterDemoTeams = (items: TeamMarker[]) => items.filter((item) => !item.uid.startsWith('beginner-demo-'))
  const filterDemoRoutes = (items: TacticalRoute[]) => items.filter((item) => !item.uid.startsWith('beginner-demo-'))
  const currentWargame = wargameOf(state)
  return {
    ...state,
    drawings: {
      attack: removeBeginnerFeatures(state.drawings.attack),
      defense: removeBeginnerFeatures(state.drawings.defense),
    },
    operators: { attack: resetOperators(operatorBuckets.attack), defense: resetOperators(operatorBuckets.defense) },
    teams: { attack: filterDemoTeams(teamBuckets.attack), defense: filterDemoTeams(teamBuckets.defense) },
    routes: { attack: filterDemoRoutes(routeBuckets.attack), defense: filterDemoRoutes(routeBuckets.defense) },
    wargame: {
      ...currentWargame,
      enabled: false,
      stageNotes: { ...(currentWargame.stageNotes ?? {}), [BEGINNER_DEMO_STAGE_ID]: '' },
      notesMarkdown: '',
    },
  }
}

export function applyBeginnerFixture(state: MapState, phase: BeginnerFixturePhase): MapState {
  if (phase === 'clean') return clearBeginnerFixture(state)

  const complete = phase === 'complete' || phase === 'alternate'
  const operatorBuckets = operatorsBucketOf(state)
  const teamBuckets = teamsBucketOf(state)
  const routeBuckets = routesBucketOf(state)
  const connectionBuckets = connectionsBucketOf(state)
  const vehicleBuckets = vehiclesBucketOf(state)
  const buildingBuckets = buildingsBucketOf(state)
  const supportBuckets = fieldSupportsBucketOf(state)
  const currentWargame = wargameOf(state)
  const mainTeam = demoTeam(BEGINNER_DEMO_IDS.mainTeam, '一队·主攻', 'A', BEGINNER_DEMO_ANCHORS.rally[0], BEGINNER_DEMO_ANCHORS.rally[1], 42)
  const coverTeam = demoTeam(BEGINNER_DEMO_IDS.coverTeam, '二队·掩护', 'B', BEGINNER_DEMO_ANCHORS.cover[0], BEGINNER_DEMO_ANCHORS.cover[1], 8)
  const routeEnd = phase === 'alternate' ? BEGINNER_DEMO_ANCHORS.backup : BEGINNER_DEMO_ANCHORS.objective
  const route = demoRoute([
    BEGINNER_DEMO_ANCHORS.rally,
    BEGINNER_DEMO_ANCHORS.waypointOne,
    BEGINNER_DEMO_ANCHORS.waypointTwo,
    routeEnd,
  ])
  const notes = '## 行动目标\n推进至 A 据点附近。\n\n## 分工\n一队按路线主攻，二队负责掩护。\n\n## 备选\n回合 2 保留经备用集合点推进的方案。'

  return {
    ...state,
    drawings: { ...state.drawings, attack: beginnerDrawingOf(phase) },
    vehicles: vehicleBuckets,
    buildings: buildingBuckets,
    fieldSupports: supportBuckets,
    connections: connectionBuckets,
    operators: {
      ...operatorBuckets,
      attack: updateNamedOperators(operatorBuckets.attack, complete),
    },
    teams: {
      ...teamBuckets,
      attack: complete ? [
        ...teamBuckets.attack.filter((item) => !item.uid.startsWith('beginner-demo-')),
        mainTeam,
        coverTeam,
      ] : teamBuckets.attack.filter((item) => !item.uid.startsWith('beginner-demo-')),
    },
    routes: {
      ...routeBuckets,
      attack: complete
        ? [...routeBuckets.attack.filter((item) => !item.uid.startsWith('beginner-demo-')), route]
        : routeBuckets.attack.filter((item) => !item.uid.startsWith('beginner-demo-')),
    },
    wargame: {
      ...currentWargame,
      enabled: complete,
      showFireLines: complete,
      showRouteLabels: complete,
      stageNotes: { ...(currentWargame.stageNotes ?? {}), [BEGINNER_DEMO_STAGE_ID]: complete ? notes : '' },
      notesMarkdown: complete ? notes : '',
    },
  }
}

export function beginnerStateSummary(state: MapState) {
  const operators = operatorsBucketOf(state).attack.filter((item) => item.lat != null && item.lng != null)
  const teams = teamsBucketOf(state).attack.filter((item) => item.uid.startsWith('beginner-demo-'))
  const routes = routesBucketOf(state).attack.filter((item) => item.uid.startsWith('beginner-demo-'))
  return {
    drawingFeatures: (() => {
      try { return (JSON.parse(state.drawings.attack) as { features?: unknown[] }).features?.length ?? 0 } catch { return 0 }
    })(),
    deployedOperators: operators.length,
    demoTeams: teams.length,
    demoRoutes: routes.length,
    round: wargameOf(state).round,
  }
}
