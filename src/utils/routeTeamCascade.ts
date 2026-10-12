import { teamOf } from '../config/operators'
import type { OperatorTeam, TacticalRoute } from '../types'

/** 只沿有效的父路线绑定向下换队；使用队列避免深层递归栈溢出，并防止循环绑定。 */
export function syncRouteTeamCascade(
  routes: TacticalRoute[],
  rootUids: Iterable<string>,
  team: OperatorTeam,
): TacticalRoute[] {
  const routeIds = new Set(routes.map((route) => route.uid))
  const affected = new Set(Array.from(rootUids).filter((uid) => routeIds.has(uid)))
  if (affected.size === 0) return routes

  const childrenByParent = new Map<string, string[]>()
  for (const route of routes) {
    if (route.anchorMode !== 'branch' || !route.branchFromRouteUid) continue
    const children = childrenByParent.get(route.branchFromRouteUid) ?? []
    children.push(route.uid)
    childrenByParent.set(route.branchFromRouteUid, children)
  }
  const queue = Array.from(affected)
  for (let index = 0; index < queue.length; index++) {
    for (const uid of childrenByParent.get(queue[index]) ?? []) {
      if (affected.has(uid)) continue
      affected.add(uid)
      queue.push(uid)
    }
  }

  const color = teamOf(team).color
  return routes.map((route) => affected.has(route.uid) && (route.team !== team || route.color !== color)
    ? { ...route, team, color }
    : route)
}
