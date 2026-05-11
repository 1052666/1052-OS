import type { Dispatch, SetStateAction } from 'react'
import type {
  AgentUploadItem,
  ChatMessage,
  StoredChatMessage,
} from '../api/agent'
import type { ToolCallEntry } from '../components/ToolCallPanel'

// Public shape of a chat message as seen by the page.
// Mirrors StoredChatMessage + a transient `streaming` flag.
export type Msg = StoredChatMessage & { streaming?: boolean }

export const CHAT_HISTORY_CACHE_KEY = '1052os.chat-history-cache'
export const INTERRUPTED_MESSAGE_PLACEHOLDER =
  '⚠️ 回复生成未完成，可能是连接中断或手动停止。'
export const LEGACY_INTERRUPTED_MESSAGE_PLACEHOLDER = '已中止。'

export function normalizeInterruptedMessageContent(_content: string): string {
  throw new Error('useChatModel: not yet implemented')
}

export function stripThinkForModel(_content: string): string {
  throw new Error('useChatModel: not yet implemented')
}

// Pure transform: take in-memory Msg[] and convert to the ChatMessage[]
// payload sent to AgentApi.chat / AgentApi.chatStream. Exported for parity
// testing — the send() contract is independent of React.
export function toChatMessages(_messages: Msg[], _assistantId?: number): ChatMessage[] {
  throw new Error('useChatModel: not yet implemented')
}

export interface UseChatModelReturn {
  // State exposed to the page
  messages: Msg[]
  input: string
  setInput: Dispatch<SetStateAction<string>>
  loading: boolean
  useStream: boolean
  historyLoaded: boolean
  upgradeState: string
  toolCalls: ToolCallEntry[]
  pendingUploads: AgentUploadItem[]
  uploading: boolean
  uploadState: string

  // Actions
  send: () => Promise<void>
  stop: () => void
  clearConversation: () => Promise<void>
  compactConversation: () => Promise<void>
  handleUploadSelection: (files: FileList | null) => Promise<void>
  removePendingUpload: (id: string) => void
}

export function useChatModel(): UseChatModelReturn {
  throw new Error('useChatModel: not yet implemented')
}
