// Shared test fixtures for Chat hook / parity tests.
//
// Why this exists: useChatModel.test.ts and chat-parity.test.ts both need
// concrete StoredChatMessage / AgentUploadItem shapes. Keep one source of
// truth so renames / new optional fields don't drift across test files.
import type { AgentUploadItem, StoredChatMessage } from '../api/agent'

export function makeMessage(overrides: Partial<StoredChatMessage> = {}): StoredChatMessage {
  const base: StoredChatMessage = {
    id: 1,
    role: 'user',
    content: 'hello',
    ts: 1_700_000_000_000,
  }
  return { ...base, ...overrides }
}

export function makeUpload(overrides: Partial<AgentUploadItem> = {}): AgentUploadItem {
  const base: AgentUploadItem = {
    id: 'upload-1',
    kind: 'image',
    fileName: 'pic.png',
    originalFileName: 'pic.png',
    mimeType: 'image/png',
    sizeBytes: 1024,
    relativePath: 'uploads/pic.png',
    absolutePath: '/tmp/uploads/pic.png',
    url: '/uploads/pic.png',
    markdown: '![pic](/uploads/pic.png)',
  }
  return { ...base, ...overrides }
}
