export const BEGINNER_DEMO_CHANNEL = 'map-tools.beginner-demo'
export const BEGINNER_DEMO_PROTOCOL = 1

export type BeginnerFrameId = 'teaser' | 'tutorial' | 'deployment' | 'receiver'
export type BeginnerCommandType =
  | 'input'
  | 'playback'
  | 'prepare'
  | 'reset'
  | 'fixture'
  | 'viewport'
  | 'tool'
  | 'layers'
  | 'stage'
  | 'round-copy'
  | 'round-select'
  | 'note'
  | 'export-html'
  | 'export-native'
  | 'import-native'
  | 'inspect'

export interface BeginnerCommand {
  channel: typeof BEGINNER_DEMO_CHANNEL
  protocol: typeof BEGINNER_DEMO_PROTOCOL
  kind: 'command'
  frameId: BeginnerFrameId
  command: BeginnerCommandType
  requestId: string
  sessionId: string
  runId: number
  payload?: unknown
}

export interface BeginnerReadyMessage {
  channel: typeof BEGINNER_DEMO_CHANNEL
  protocol: typeof BEGINNER_DEMO_PROTOCOL
  kind: 'ready'
  frameId: BeginnerFrameId
  sessionId: string
  phase: 'mounted' | 'map-ready'
  payload?: unknown
}

export interface BeginnerResultMessage {
  channel: typeof BEGINNER_DEMO_CHANNEL
  protocol: typeof BEGINNER_DEMO_PROTOCOL
  kind: 'result'
  frameId: BeginnerFrameId
  requestId: string
  sessionId: string
  runId: number
  ok: boolean
  payload?: unknown
  error?: string
}

export interface BeginnerProgressMessage {
  focus?: { x: number; y: number; width: number; height: number } | null
  channel: typeof BEGINNER_DEMO_CHANNEL
  protocol: typeof BEGINNER_DEMO_PROTOCOL
  kind: 'progress'
  frameId: BeginnerFrameId
  sessionId: string
  runId: number
  caption: string
}
export type BeginnerBridgeMessage = BeginnerReadyMessage | BeginnerResultMessage | BeginnerProgressMessage

export function isBeginnerBridgeMessage(value: unknown): value is BeginnerBridgeMessage {
  if (!value || typeof value !== 'object') return false
  const data = value as Partial<BeginnerBridgeMessage>
  return data.channel === BEGINNER_DEMO_CHANNEL
    && data.protocol === BEGINNER_DEMO_PROTOCOL
    && (data.kind === 'ready' || data.kind === 'result' || data.kind === 'progress')
    && typeof data.frameId === 'string'
    && typeof data.sessionId === 'string'
}

export function isBeginnerCommand(value: unknown): value is BeginnerCommand {
  if (!value || typeof value !== 'object') return false
  const data = value as Partial<BeginnerCommand>
  return data.channel === BEGINNER_DEMO_CHANNEL
    && data.protocol === BEGINNER_DEMO_PROTOCOL
    && data.kind === 'command'
    && typeof data.frameId === 'string'
    && typeof data.command === 'string'
    && typeof data.requestId === 'string'
    && typeof data.sessionId === 'string'
    && typeof data.runId === 'number'
}
