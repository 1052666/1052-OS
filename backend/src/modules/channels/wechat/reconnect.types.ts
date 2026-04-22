export type ReconnectEventType = 'started' | 'success' | 'failed' | 'giving-up'

export interface ReconnectEvent {
  type: ReconnectEventType
  attempt: number
  nextDelayMs?: number
  timestamp: number
  error?: string
}
