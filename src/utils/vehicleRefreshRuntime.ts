import type { CapturePoint, ModeVehicleRefreshRule, TacticalBattleContext } from '../types'
import { refreshTriggerLabel } from './vehicleRefreshRules'
import { normalizeObjectiveName, parseObjectiveStateKey, readStageObjectiveValue } from './objectiveStates'

export interface VehicleRefreshEvaluation {
  eligible: boolean
  reason: string
}

export function parseClockSeconds(value: number | string): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.max(0, value) : null
  const text = value.trim()
  if (!text) return null
  if (/^\d+$/.test(text)) return Number(text)
  const parts = text.split(':').map(Number)
  if (parts.some((part) => !Number.isFinite(part))) return null
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return null
}

export function formatClockSeconds(seconds: number | null): string {
  if (seconds == null) return ''
  const safe = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(safe / 60)
  return `${String(minutes).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}

type RuntimeVehicleRefreshRule = Omit<ModeVehicleRefreshRule, 'verification'>

export interface VehicleRefreshStageContext {
  currentStageIndex: number
  stages: Array<{ id: string; points: CapturePoint[] }>
}

function objectiveKey(rule: RuntimeVehicleRefreshRule): string {
  const triggerValue = String(rule.trigger.value ?? '').trim()
  return triggerValue && !/^\d+(?::\d+){0,2}$/.test(triggerValue) ? triggerValue : rule.objective
}

function objectiveValue<T>(values: Record<string, T>, name: string, stageContext?: VehicleRefreshStageContext): T | undefined {
  const normalized = normalizeObjectiveName(name)
  if (!stageContext) {
    // 无阶段上下文时仅兼容旧格式，不猜测某个阶段的新版状态。
    return values[name] ?? Object.entries(values).find(([key]) => !parseObjectiveStateKey(key) && normalizeObjectiveName(key) === normalized)?.[1]
  }
  const activeStage = stageContext.stages[stageContext.currentStageIndex]
  if (!activeStage) return undefined
  const matches = stageContext.stages.flatMap((stage) => stage.points
    .filter((point) => normalizeObjectiveName(point.name) === normalized)
    .map((point) => ({ stageId: stage.id, name: point.name })))
  const target = matches.find((point) => point.stageId === activeStage.id)
    ?? (matches.length === 1 ? matches[0] : undefined)
  const stageId = target?.stageId ?? activeStage.id
  const direct = readStageObjectiveValue(values, stageId, target?.name ?? name, activeStage.id)
  if (direct !== undefined) return direct
  return Object.entries(values).find(([key]) => {
    const identity = parseObjectiveStateKey(key)
    return identity
      ? identity[0] === stageId && normalizeObjectiveName(identity[1]) === normalized
      : stageId === activeStage.id && normalizeObjectiveName(key) === normalized
  })?.[1]
}

function requiredStageIndex(rule: RuntimeVehicleRefreshRule, stageContext: VehicleRefreshStageContext): number {
  const objective = normalizeObjectiveName(rule.objective)
  if (!objective) return -1
  const stageIdIndex = stageContext.stages.findIndex((stage) => stage.id.toUpperCase() === objective)
  if (stageIdIndex >= 0) return stageIdIndex
  return stageContext.stages.findIndex((stage) => stage.points.some((point) => {
    const pointName = normalizeObjectiveName(point.name)
    return pointName === objective || (/^[A-Z]$/.test(objective) && pointName.startsWith(objective) && /^\d/.test(pointName.slice(objective.length)))
  }))
}

/** 当前阶段应展示的刷新规则；无法映射到具体据点的规则按全局规则保留。 */
export function isVehicleRefreshRuleInStage(
  rule: RuntimeVehicleRefreshRule,
  stageContext: VehicleRefreshStageContext,
): boolean {
  const requiredIndex = requiredStageIndex(rule, stageContext)
  return requiredIndex === -1 || requiredIndex === stageContext.currentStageIndex
}

export function evaluateVehicleRefreshRule(
  rule: RuntimeVehicleRefreshRule,
  context: TacticalBattleContext,
  stageContext?: VehicleRefreshStageContext,
): VehicleRefreshEvaluation {
  if (rule.action === 'disable') return { eligible: false, reason: '该规则用于取消刷新' }
  if (stageContext) {
    const requiredIndex = requiredStageIndex(rule, stageContext)
    if (requiredIndex !== -1 && requiredIndex !== stageContext.currentStageIndex) {
      const requiredStage = stageContext.stages[requiredIndex]
      return {
        eligible: false,
        reason: requiredIndex > stageContext.currentStageIndex
          ? `需进入 ${requiredStage.id} 阶段（${rule.objective}）后才会激活`
          : `该刷新仅限 ${requiredStage.id} 阶段（${rule.objective}），当前阶段已失效`,
      }
    }
  }
  const triggerLabel = refreshTriggerLabel(rule.trigger)

  if (rule.trigger.type === 'tickets') {
    const threshold = Number(rule.trigger.value)
    if (rule.side === 'defense') return { eligible: false, reason: '防守方兵力无限，不适用兵力触发条件' }
    const current = context.tickets.attack
    if (current == null) return { eligible: false, reason: `尚未设置进攻方兵力（条件：${triggerLabel}）` }
    return current <= threshold
      ? { eligible: true, reason: `当前兵力 ${current}，已满足 ${triggerLabel}` }
      : { eligible: false, reason: `当前兵力 ${current}，需降至 ${threshold} 或以下` }
  }

  if (rule.trigger.type === 'match-time') {
    const threshold = parseClockSeconds(rule.trigger.value)
    if (context.matchTimeSeconds == null) return { eligible: false, reason: `尚未设置比赛时间（条件：${triggerLabel}）` }
    if (threshold == null) return { eligible: false, reason: `无法识别规则时间：${String(rule.trigger.value)}` }
    return context.matchTimeSeconds >= threshold
      ? { eligible: true, reason: `比赛时间已达到 ${formatClockSeconds(threshold)}` }
      : { eligible: false, reason: `比赛时间需达到 ${formatClockSeconds(threshold)}` }
  }

  if (rule.trigger.type === 'objective-countdown') {
    const key = rule.objective
    const current = objectiveValue(context.objectiveCountdowns, key, stageContext)
    const threshold = parseClockSeconds(rule.trigger.value)
    if (current == null) return { eligible: false, reason: `尚未设置${key}倒计时（条件：${triggerLabel}）` }
    if (threshold == null) return { eligible: false, reason: `无法识别倒计时条件：${String(rule.trigger.value)}` }
    return current <= threshold
      ? { eligible: true, reason: `${key}倒计时已到 ${formatClockSeconds(current)}` }
      : { eligible: false, reason: `${key}倒计时需到 ${formatClockSeconds(threshold)} 或以下` }
  }

  if (rule.trigger.type === 'objective-captured') {
    const key = objectiveKey(rule)
    const state = objectiveValue(context.objectiveStates, key, stageContext)
    return state?.owner === rule.side
      ? { eligible: true, reason: `${key}已被${rule.side === 'attack' ? '进攻方' : '防守方'}占领` }
      : { eligible: false, reason: `等待${rule.side === 'attack' ? '进攻方' : '防守方'}占领${key}` }
  }

  const eventName = String(rule.trigger.value).trim() || rule.objective
  return context.mapEvents.includes(eventName)
    ? { eligible: true, reason: `地图事件“${eventName}”已触发` }
    : { eligible: false, reason: `等待地图事件“${eventName}”` }
}
