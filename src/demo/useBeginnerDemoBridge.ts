import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { Map as LeafletMap } from 'leaflet'
import type { GameDataPlatform } from '../config/gameDataPlatform'
import type { DrawSettings, LayerVisibility, MapState, PropVisibility, ToolMode, WargameState } from '../types'
import {
  BEGINNER_DEMO_CHANNEL,
  BEGINNER_DEMO_PROTOCOL,
  isBeginnerCommand,
  type BeginnerFrameId,
} from './beginnerDemoProtocol'
import { applyBeginnerFixture, beginnerStateSummary, type BeginnerFixturePhase } from './beginnerDemoAdapter'
import { wargameOf } from '../utils/storage'
import { BeginnerDemoInput, type InputStep } from './beginnerDemoInput'
import { checkDemoExpectation, type DemoExpectation } from './beginnerDemoExpectations'
import { configureDemoDiagnostics, traceDemo } from './beginnerDemoDiagnostics'

export interface BeginnerDemoUiState {
  paletteOpen: boolean
  panelOpen: boolean
  legendOpen: boolean
  leftPanelWidth: number
  mapMarkerScale: number
  layers: LayerVisibility
  propVis: PropVisibility
  draw: DrawSettings
  sections: {
    layers: boolean
    props: boolean
    points: boolean
    vehicles: boolean
    wargame: boolean
    vehGroups: Record<string, boolean>
  }
}

interface BeginnerDemoContext {
  enabled: boolean
  frameId: BeginnerFrameId
  mapReady: boolean
  mapId: string
  gameDataPlatform: GameDataPlatform
  activeModeId: string
  activeStageId: string | null
  view: 'attack' | 'defense'
  state: MapState
  ui: BeginnerDemoUiState
  mapRef: MutableRefObject<LeafletMap | null>
  setMapId: Dispatch<SetStateAction<string>>
  setGameDataPlatform: Dispatch<SetStateAction<GameDataPlatform>>
  setView: Dispatch<SetStateAction<'attack' | 'defense'>>
  setTool: Dispatch<SetStateAction<ToolMode>>
  setUi: Dispatch<SetStateAction<BeginnerDemoUiState>>
  onGameMode: (id: string) => void
  onStage: (id: string) => void
  onRoundChange: (round: number) => void
  onCreateRound: (copy: boolean) => void
  onWargameChange: (patch: Partial<WargameState>) => void
  updateMap: (id: string, updater: (state: MapState) => MapState, stageId?: string) => void
  onExportHtml: (stageMode: 'current' | 'all' | 'overview', stageId: string, round: number) => Promise<{ filename: string; html: string }>
  onExportNative: (scope: 'all' | 'stage' | 'current') => { filename: string; content: string }
  onImportNative: (file: File) => Promise<void>
}

function trustedParent(origin: string): boolean {
  if (origin === window.location.origin || origin === 'null') return true
  try {
    const parsed = new URL(origin)
    return parsed.protocol === window.location.protocol
      && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
  } catch {
    return false
  }
}

function roleSessionId(): string {
  return 'pending-session'
}

export function useBeginnerDemoBridge(context: BeginnerDemoContext) {
  const contextRef = useRef(context)
  contextRef.current = context
  const sessionIdRef = useRef(roleSessionId())
  const lastRunIdRef = useRef(-1)
  useEffect(() => {
    if (!context.enabled) return
    configureDemoDiagnostics(() => {
      const current = contextRef.current
      return { frameId: current.frameId, runId: lastRunIdRef.current, mapId: current.mapId,
        mode: current.activeModeId, stage: current.activeStageId, view: current.view,
        drawings: current.state.drawings[current.view], map: current.mapRef.current }
    })
    traceDemo('bridge-mounted')
    const error = (event: ErrorEvent) => traceDemo('window-error', { message: event.message, stack: event.error?.stack })
    const rejection = (event: PromiseRejectionEvent) => traceDemo('unhandled-rejection', String(event.reason))
    window.addEventListener('error', error)
    window.addEventListener('unhandledrejection', rejection)
    return () => { traceDemo('bridge-unmounted'); configureDemoDiagnostics(); window.removeEventListener('error', error); window.removeEventListener('unhandledrejection', rejection) }
  }, [context.enabled])
  useEffect(() => { if (context.enabled) traceDemo('state-rendered') }, [context.enabled, context.state.drawings, context.mapId, context.activeStageId, context.view])
  const inputRef = useRef(new BeginnerDemoInput())
  inputRef.current.onFocus = (focus) => {
    if (!context.enabled) return
    window.parent.postMessage({ channel: BEGINNER_DEMO_CHANNEL, protocol: BEGINNER_DEMO_PROTOCOL, kind: 'progress', frameId: context.frameId, sessionId: sessionIdRef.current, runId: lastRunIdRef.current, caption: '', focus }, window.location.origin)
  }
  const exportsRef = useRef<{ html?: ReturnType<BeginnerDemoContext['onExportHtml']>; native?: ReturnType<BeginnerDemoContext['onExportNative']>; imported?: Promise<void> }>({})
  useEffect(() => () => inputRef.current.cancel(), [])

  useEffect(() => {
    if (!context.enabled) return
    const postReady = (phase: 'mounted' | 'map-ready') => {
      window.parent.postMessage({
        channel: BEGINNER_DEMO_CHANNEL,
        protocol: BEGINNER_DEMO_PROTOCOL,
        kind: 'ready',
        frameId: context.frameId,
        sessionId: sessionIdRef.current,
        phase,
        payload: { mapId: context.mapId, stageId: context.activeStageId, summary: beginnerStateSummary(context.state) },
      }, '*')
    }
    postReady('mounted')
    if (context.mapReady) postReady('map-ready')

    const respond = (message: { requestId: string; runId: number }, ok: boolean, payload?: unknown, error?: string) => {
      window.parent.postMessage({
        channel: BEGINNER_DEMO_CHANNEL,
        protocol: BEGINNER_DEMO_PROTOCOL,
        kind: 'result',
        frameId: context.frameId,
        requestId: message.requestId,
        sessionId: sessionIdRef.current,
        runId: message.runId,
        ok,
        payload,
        error,
      }, '*')
    }

    const onMessage = (event: MessageEvent<unknown>) => {
      if (!trustedParent(event.origin) || event.source !== window.parent || !isBeginnerCommand(event.data)) return
      const command = event.data
      if (command.frameId !== context.frameId) return
      if (sessionIdRef.current === roleSessionId()) sessionIdRef.current = command.sessionId
      if (command.sessionId !== sessionIdRef.current || command.runId < lastRunIdRef.current) {
        respond(command, false, undefined, '已忽略过期或未登记的 Demo 请求')
        return
      }
      if (command.runId > lastRunIdRef.current) inputRef.current.cancel(true)
      lastRunIdRef.current = command.runId
      traceDemo('command', { command: command.command })
      const current = contextRef.current
      const payload = command.payload as Record<string, unknown> | undefined
      const finish = (value?: unknown) => respond(command, true, value)

      try {
        switch (command.command) {
          case 'playback':
            inputRef.current.paused = payload?.paused === true
            inputRef.current.fast = payload?.fast === true
            if (typeof payload?.speed === 'number') inputRef.current.speed = Math.max(.25, Math.min(8, payload.speed))
            if (payload?.cancel) inputRef.current.cancel()
            finish()
            break
          case 'input':
            void inputRef.current.run((payload?.steps ?? []) as InputStep[], () => contextRef.current.mapRef.current, (step) => {
              if (step.caption) window.parent.postMessage({ channel: BEGINNER_DEMO_CHANNEL, protocol: BEGINNER_DEMO_PROTOCOL, kind: 'progress', frameId: current.frameId, sessionId: command.sessionId, runId: command.runId, caption: step.caption }, event.origin)
            })
              .then(async () => {
                if (payload?.expectState) {
                  let reason: string | undefined
                  for (let attempt = 0; attempt < 30; attempt++) {
                    if (command.runId !== lastRunIdRef.current) throw new Error('操作已取消')
                    reason = checkDemoExpectation(contextRef.current.state, payload.expectState as DemoExpectation)
                    if (!reason) break
                    await new Promise<void>((resolve) => window.setTimeout(resolve, 50))
                  }
                  if (reason) throw new Error(reason)
                }
                finish({ completed: true })
              })
              .catch((error: unknown) => respond(command, false, undefined, error instanceof Error ? error.message : '操作失败'))
            break
          case 'prepare': {
            const requestedPlatform = payload?.platform === 'mobile' ? 'mobile' : payload?.platform === 'pc' ? 'pc' : undefined
            if (requestedPlatform && requestedPlatform !== current.gameDataPlatform) current.setGameDataPlatform(requestedPlatform)
            if (typeof payload?.mapId === 'string' && payload.mapId !== current.mapId) current.setMapId(payload.mapId)
            if (payload?.mode === 'attack-defense') current.onGameMode('attack-defense')
            current.setView(payload?.view === 'defense' ? 'defense' : 'attack')
            if (typeof payload?.stage === 'string') current.onStage(String(payload.stage))
            finish({ accepted: true })
            break
          }
          case 'reset':
            current.updateMap(current.mapId, (state) => applyBeginnerFixture(state, 'clean'), current.activeStageId ?? undefined)
            finish({ reset: true })
            break
          case 'fixture': {
            const phase: BeginnerFixturePhase = payload?.phase === 'drawing' || payload?.phase === 'text' || payload?.phase === 'complete' || payload?.phase === 'alternate' ? payload.phase : 'clean'
            current.updateMap(current.mapId, (state) => applyBeginnerFixture(state, phase), current.activeStageId ?? undefined)
            finish({ phase })
            break
          }
          case 'viewport': {
            const map = current.mapRef.current
            const lat = Number(payload?.lat)
            const lng = Number(payload?.lng)
            const zoom = Number(payload?.zoom)
            if (!map || !Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(zoom)) {
              respond(command, false, undefined, '地图尚未准备好或取景参数无效')
              break
            }
            map.invalidateSize({ animate: false })
            map.setView([lat, lng], zoom, { animate: false })
            finish({ lat, lng, zoom })
            break
          }
          case 'tool':
            if (typeof payload?.tool === 'string') current.setTool(payload.tool as ToolMode)
            finish({ tool: payload?.tool })
            break
          case 'layers': {
            const layerPatch = payload?.layers && typeof payload.layers === 'object' ? payload.layers as Partial<LayerVisibility> : {}
            current.setUi((ui) => ({
              ...ui,
              paletteOpen: typeof payload?.paletteOpen === 'boolean' ? payload.paletteOpen : ui.paletteOpen,
              panelOpen: typeof payload?.panelOpen === 'boolean' ? payload.panelOpen : ui.panelOpen,
              legendOpen: typeof payload?.legendOpen === 'boolean' ? payload.legendOpen : ui.legendOpen,
              layers: { ...ui.layers, ...layerPatch },
            }))
            finish({ layers: layerPatch })
            break
          }
          case 'stage':
            if (typeof payload?.stage === 'string') current.onStage(payload.stage)
            finish({ stage: payload?.stage })
            break
          case 'round-copy':
            current.onCreateRound(true)
            finish({ copied: true })
            break
          case 'round-select':
            if (Number.isFinite(Number(payload?.round))) current.onRoundChange(Number(payload?.round))
            finish({ round: Number(payload?.round) })
            break
          case 'note': {
            const stage = typeof payload?.stage === 'string' ? payload.stage : current.activeStageId ?? 'S1'
            const notes = '## 行动目标\n推进至 A 据点附近。\n\n## 分工\n一队按路线主攻，二队负责掩护。\n\n## 备选\n回合 2 保留经备用集合点推进的方案。'
            current.onWargameChange({ enabled: true, stageNotes: { ...wargameOf(current.state).stageNotes, [stage]: notes }, notesMarkdown: notes })
            finish({ stage, notes })
            break
          }
          case 'export-html': {
            exportsRef.current.html = undefined
            void inputRef.current.run([{ kind: 'click', target: { selector: '.tb-primary' } }], () => contextRef.current.mapRef.current)
              .then(async () => {
                if (!exportsRef.current.html) throw new Error('导出按钮未触发 HTML 导出')
                return await exportsRef.current.html
              }).then((result) => respond(command, true, result))
              .catch((error: unknown) => respond(command, false, undefined, error instanceof Error ? error.message : 'HTML 导出失败'))
            break
          }
          case 'export-native': {
            exportsRef.current.native = undefined
            void inputRef.current.run([{ kind: 'click', target: { selector: '.tb-native-submenu button', text: '当前阶段数据' } }], () => contextRef.current.mapRef.current)
              .then(() => {
                if (!exportsRef.current.native) throw new Error('原生导出按钮没有生成文件')
                finish(exportsRef.current.native)
              }).catch((error: unknown) => respond(command, false, undefined, String(error)))
            break
          }
          case 'import-native': {
            const filename = typeof payload?.filename === 'string' ? payload.filename : 'beginner-demo.dfboard'
            const content = typeof payload?.content === 'string' ? payload.content : ''
            exportsRef.current.imported = undefined
            void inputRef.current.run([{ kind: 'click', target: { selector: '.tactical-btn' } }], () => contextRef.current.mapRef.current)
              .then(async () => {
                const input = document.querySelector<HTMLInputElement>('.tb-modal input[type="file"]')
                if (!input) throw new Error('找不到原生战术包导入控件')
                const transfer = new DataTransfer()
                transfer.items.add(new File([content], filename, { type: 'application/json' }))
                input.files = transfer.files
                input.dispatchEvent(new Event('change', { bubbles: true }))
                if (!exportsRef.current.imported) throw new Error('文件输入没有触发导入')
                await exportsRef.current.imported
                document.querySelector<HTMLButtonElement>('.tb-close')?.click()
                respond(command, true, { imported: true })
              })
              .catch((error: unknown) => respond(command, false, undefined, error instanceof Error ? error.message : '原生包导入失败'))
            break
          }
          case 'inspect':
            finish({ mapId: current.mapId, stageId: current.activeStageId, view: current.view, summary: beginnerStateSummary(current.state) })
            break
          default:
            respond(command, false, undefined, `不支持的 Demo 指令：${command.command}`)
        }
      } catch (error) {
        respond(command, false, undefined, error instanceof Error ? error.message : 'Demo 指令执行失败')
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [context.enabled, context.frameId, context.mapReady, context.mapId, context.activeStageId, context.state])
  return {
    exportHtml: (...args: Parameters<BeginnerDemoContext['onExportHtml']>) => {
      const result = contextRef.current.onExportHtml(...args)
      exportsRef.current.html = result
      return result
    },
    exportNative: (...args: Parameters<BeginnerDemoContext['onExportNative']>) => {
      const result = contextRef.current.onExportNative(...args)
      exportsRef.current.native = result
      return result
    },
    importNative: (...args: Parameters<BeginnerDemoContext['onImportNative']>) => {
      const result = contextRef.current.onImportNative(...args)
      exportsRef.current.imported = result
      return result
    },
  }
}
