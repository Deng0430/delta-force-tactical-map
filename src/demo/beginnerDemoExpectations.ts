import type { MapState } from '../types'

export interface DemoExpectation {
  drawings?: number
  text?: string
  absentText?: string
  operators?: number
  operatorAt?: [number, number]
  teams?: number
  teamAt?: [number, number]
  route?: boolean
  waypointAt?: [number, number]
  fireLine?: boolean
  round?: number
  note?: string
}

/** Read-only outcome checks. A failed input must not silently become a completed shot. */
export function checkDemoExpectation(state: MapState, expected: DemoExpectation): string | undefined {
  const features = (JSON.parse(state.drawings.attack || '{"features":[]}') as { features: { properties?: { text?: string } }[] }).features
  const text = features.map((feature) => feature.properties?.text ?? '').join('\n')
  const operators = state.operators.attack.filter((operator) => operator.lat != null && operator.lng != null)
  const main = operators.find((operator) => operator.name === '一队主攻')
  const teams = state.teams?.attack ?? []
  const mainTeam = teams.find((team) => team.team === 'A')
  const near = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]) < .8
  if (expected.drawings && features.length < expected.drawings) return '地图没有生成预期的绘制图形'
  if (expected.text && !text.includes(expected.text)) return '文字编辑结果尚未保存到地图'
  if (expected.absentText && text.includes(expected.absentText)) return '取消编辑后仍残留未确认文字'
  if (expected.operators && operators.length < expected.operators) return '兵棋没有成功部署'
  if (expected.operatorAt && (!main || !near([main.lat!, main.lng!], expected.operatorAt))) return '兵棋拖动没有到达预期位置'
  if (expected.teams && teams.filter((team) => team.lat != null && team.lng != null).length < expected.teams) return '队标没有成功部署'
  if (expected.teamAt && (!mainTeam || mainTeam.lat == null || mainTeam.lng == null || !near([mainTeam.lat, mainTeam.lng], expected.teamAt))) return '主攻队标没有到达预期位置'
  if (expected.route && !state.routes.attack.some((route) => route.anchorMode === 'team' && route.teamMarkerUid === mainTeam?.uid && route.waypoints.length >= 4)) return '没有生成绑定主攻队标的真实路线'
  if (expected.waypointAt && !state.routes.attack.some((route) => route.waypoints.slice(1, -1).some((point) => near(point, expected.waypointAt!)))) return '路线中间途经点没有成功移动'
  if (expected.fireLine && !teams.some((team) => team.team === 'B' && team.fireLineEnabled)) return '掩护队标的枪线没有开启'
  if (expected.round && state.wargame.round !== expected.round) return `没有切换到预期的推演回合：预期 ${expected.round}，实际 ${state.wargame.round}`
  if (expected.note && !(state.wargame.stageNotes?.S1 ?? state.wargame.notesMarkdown ?? '').includes(expected.note)) return '推演备注没有保存'
  return undefined
}
