// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatHistory } from '../api/agent'
import { makeMessage, makeUpload } from '../test-utils/chat-fixtures'
import { useChatModel } from './useChatModel'

// Mock AgentApi — hook calls getHistory() on mount, saveHistory() / chatStream()
// / chat() / compactHistory() / uploadFiles() during actions.
vi.mock('../api/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/agent')>()
  return {
    ...actual,
    AgentApi: {
      getHistory: vi.fn(),
      saveHistory: vi.fn(),
      compactHistory: vi.fn(),
      uploadFiles: vi.fn(),
      chat: vi.fn(),
      chatStream: vi.fn(),
    },
  }
})

// Mock SettingsApi — hook calls get() to load streaming preference.
vi.mock('../api/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/settings')>()
  return {
    ...actual,
    SettingsApi: {
      get: vi.fn(),
      update: vi.fn(),
      discoverLocalModels: vi.fn(),
      upsertLlmProfile: vi.fn(),
      activateLlmProfile: vi.fn(),
      updateLlmTaskRoutes: vi.fn(),
    },
  }
})

async function getAgentApi() {
  const mod = await import('../api/agent')
  return mod.AgentApi as unknown as {
    getHistory: ReturnType<typeof vi.fn>
    saveHistory: ReturnType<typeof vi.fn>
    compactHistory: ReturnType<typeof vi.fn>
    uploadFiles: ReturnType<typeof vi.fn>
    chat: ReturnType<typeof vi.fn>
    chatStream: ReturnType<typeof vi.fn>
  }
}

async function getSettingsApi() {
  const mod = await import('../api/settings')
  return mod.SettingsApi as unknown as {
    get: ReturnType<typeof vi.fn>
  }
}

// Minimal EventSource stub: we never assert on events, but the hook
// constructs one on history-loaded — must not throw in jsdom.
class FakeEventSource {
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  close = vi.fn()
}

beforeEach(() => {
  // Reset localStorage between tests so cache state doesn't leak.
  if (typeof window !== 'undefined') {
    window.localStorage.clear()
  }
  // Install fake EventSource.
  ;(globalThis as unknown as { EventSource: typeof FakeEventSource }).EventSource =
    FakeEventSource
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useChatModel', () => {
  beforeEach(async () => {
    const api = await getAgentApi()
    api.getHistory.mockReset()
    api.saveHistory.mockReset()
    api.compactHistory.mockReset()
    api.uploadFiles.mockReset()
    api.chat.mockReset()
    api.chatStream.mockReset()
    const settings = await getSettingsApi()
    settings.get.mockReset()
    settings.get.mockImplementation(() =>
      Promise.resolve({
        llm: {
          baseUrl: '',
          modelId: '',
          kind: 'cloud',
          provider: 'openai-compatible',
          apiFormat: 'openai-compatible',
          activeProfileId: '',
          profiles: [],
          taskRoutes: [],
          hasApiKey: false,
          apiKeyMask: '',
        },
        imageGeneration: {
          apiFormat: 'openai-compatible',
          baseUrl: '',
          modelId: '',
          size: 'auto',
          quality: 'auto',
          background: 'auto',
          outputFormat: 'png',
          outputCompression: 80,
          hasApiKey: false,
          apiKeyMask: '',
        },
        appearance: { theme: 'dark', language: 'zh-CN' },
        agent: {
          streaming: true,
          userPrompt: '',
          fullAccess: false,
          contextMessageLimit: 50,
          progressiveDisclosureEnabled: true,
          providerCachingEnabled: true,
          checkpointEnabled: true,
          seedOnResumeEnabled: true,
          upgradeDebugEventsEnabled: true,
          autoCompactEnabled: true,
          autoCompactThreshold: 100,
          morningBrief: { enabled: false, time: '09:30' },
        },
        ocr: {
          provider: 'uapis',
          customBaseUrl: '',
          customModelId: '',
          hasCustomApiKey: false,
          customApiKeyMask: '',
        },
        uapis: {
          hasApiKey: false,
          apiKeyMask: '',
          mode: 'free-ip-quota',
          home: 'https://uapis.cn',
          console: 'https://uapis.cn/console',
          anonymousMonthlyCredits: 1500,
          apiKeyMonthlyCredits: 3500,
        },
      }),
    )
  })

  it('exposes initial empty state before history loads', async () => {
    const api = await getAgentApi()
    // Pending so initial fetch never resolves during this test.
    api.getHistory.mockImplementation(() => new Promise<ChatHistory>(() => undefined))

    const { result } = renderHook(() => useChatModel())
    expect(result.current.messages).toEqual([])
    expect(result.current.input).toBe('')
    expect(result.current.loading).toBe(false)
    expect(result.current.historyLoaded).toBe(false)
    expect(result.current.pendingUploads).toEqual([])
    expect(result.current.toolCalls).toEqual([])
  })

  it('loads history from server on mount and marks historyLoaded', async () => {
    const api = await getAgentApi()
    api.getHistory.mockResolvedValueOnce({
      messages: [makeMessage({ id: 1, role: 'user', content: 'hi' })],
    })

    const { result } = renderHook(() => useChatModel())

    await waitFor(() => {
      expect(result.current.historyLoaded).toBe(true)
    })
    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0].content).toBe('hi')
  })

  it('falls back gracefully when getHistory rejects (no cache)', async () => {
    const api = await getAgentApi()
    api.getHistory.mockRejectedValueOnce(new Error('network'))

    const { result } = renderHook(() => useChatModel())
    await waitFor(() => {
      expect(result.current.historyLoaded).toBe(true)
    })
    expect(result.current.messages).toEqual([])
  })

  it('send() with empty input is a no-op', async () => {
    const api = await getAgentApi()
    api.getHistory.mockResolvedValueOnce({ messages: [] })

    const { result } = renderHook(() => useChatModel())
    await waitFor(() => expect(result.current.historyLoaded).toBe(true))

    await act(async () => {
      await result.current.send()
    })

    expect(api.chatStream).not.toHaveBeenCalled()
    expect(api.chat).not.toHaveBeenCalled()
  })

  it('send() emits user+assistant message pair, clears input, sets loading', async () => {
    const api = await getAgentApi()
    api.getHistory.mockResolvedValueOnce({ messages: [] })
    api.saveHistory.mockResolvedValue({ messages: [] })
    // chatStream resolves after we observe loading=true mid-send.
    let resolveStream: (() => void) | null = null
    api.chatStream.mockImplementation((_history, handlers) => {
      return new Promise<void>((resolve) => {
        resolveStream = () => {
          handlers.onDone()
          resolve()
        }
      })
    })

    const { result } = renderHook(() => useChatModel())
    await waitFor(() => expect(result.current.historyLoaded).toBe(true))

    act(() => {
      result.current.setInput('hello world')
    })

    let sendPromise: Promise<void> | null = null
    act(() => {
      sendPromise = result.current.send()
    })

    await waitFor(() => expect(result.current.loading).toBe(true))
    expect(result.current.input).toBe('')
    expect(result.current.messages).toHaveLength(2)
    expect(result.current.messages[0].role).toBe('user')
    expect(result.current.messages[0].content).toBe('hello world')
    expect(result.current.messages[1].role).toBe('assistant')
    expect(result.current.messages[1].streaming).toBe(true)

    await act(async () => {
      resolveStream?.()
      await sendPromise
    })

    expect(result.current.loading).toBe(false)
    expect(result.current.messages[1].streaming).toBeFalsy()
  })

  it('stop() aborts the active stream and marks the streaming message as error', async () => {
    const api = await getAgentApi()
    api.getHistory.mockResolvedValueOnce({ messages: [] })
    api.saveHistory.mockResolvedValue({ messages: [] })
    api.chatStream.mockImplementation((_history, _handlers, signal) => {
      return new Promise<void>((_resolve, reject) => {
        ;(signal as AbortSignal).addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
      })
    })

    const { result } = renderHook(() => useChatModel())
    await waitFor(() => expect(result.current.historyLoaded).toBe(true))

    act(() => {
      result.current.setInput('go')
    })

    let sendPromise: Promise<void> | null = null
    act(() => {
      sendPromise = result.current.send()
    })
    await waitFor(() => expect(result.current.loading).toBe(true))

    act(() => {
      result.current.stop()
    })

    await act(async () => {
      // send() rejects internally and is caught by the error branch.
      await sendPromise
    })

    expect(result.current.loading).toBe(false)
    const last = result.current.messages.at(-1)
    expect(last?.error).toBe(true)
    expect(last?.streaming).toBeFalsy()
    expect(last?.content).toContain('已手动停止')
  })

  it('addUpload via handleUploadSelection / removePendingUpload manages list', async () => {
    const api = await getAgentApi()
    api.getHistory.mockResolvedValueOnce({ messages: [] })
    api.uploadFiles.mockResolvedValueOnce({
      items: [makeUpload({ id: 'u1', url: '/uploads/a.png' })],
    })

    const { result } = renderHook(() => useChatModel())
    await waitFor(() => expect(result.current.historyLoaded).toBe(true))

    const file = new File(['x'], 'a.png', { type: 'image/png' })
    const fileList = {
      length: 1,
      0: file,
      item: (i: number) => (i === 0 ? file : null),
      *[Symbol.iterator]() {
        yield file
      },
    } as unknown as FileList

    await act(async () => {
      await result.current.handleUploadSelection(fileList)
    })
    expect(result.current.pendingUploads).toHaveLength(1)
    expect(result.current.pendingUploads[0].id).toBe('u1')

    act(() => {
      result.current.removePendingUpload('u1')
    })
    expect(result.current.pendingUploads).toHaveLength(0)
  })

  it('clearConversation() empties messages and calls saveHistory with reason=clear', async () => {
    const api = await getAgentApi()
    api.getHistory.mockResolvedValueOnce({
      messages: [makeMessage({ id: 1, role: 'user', content: 'old' })],
    })
    api.saveHistory.mockResolvedValue({ messages: [] })

    const { result } = renderHook(() => useChatModel())
    await waitFor(() => expect(result.current.messages).toHaveLength(1))

    await act(async () => {
      await result.current.clearConversation()
    })

    expect(result.current.messages).toEqual([])
    const calls = api.saveHistory.mock.calls
    const clearCall = calls.find((c) => c[1] === 'clear')
    expect(clearCall).toBeTruthy()
    expect(clearCall![0]).toEqual([])
  })

  it('compactConversation() replaces messages with compaction result', async () => {
    const api = await getAgentApi()
    api.getHistory.mockResolvedValueOnce({
      messages: [makeMessage({ id: 1, role: 'user', content: 'old' })],
    })
    api.saveHistory.mockResolvedValue({ messages: [] })
    api.compactHistory.mockResolvedValueOnce({
      messages: [
        makeMessage({
          id: 10,
          role: 'assistant',
          content: 'summary',
          compactSummary: 'short',
          compactOriginalCount: 1,
        }),
      ],
      backupPath: '/tmp/backup',
      originalCount: 1,
    })

    const { result } = renderHook(() => useChatModel())
    await waitFor(() => expect(result.current.messages).toHaveLength(1))

    await act(async () => {
      await result.current.compactConversation()
    })

    expect(api.compactHistory).toHaveBeenCalledTimes(1)
    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0].compactSummary).toBe('short')
    expect(result.current.loading).toBe(false)
  })

  it('useStream reflects SettingsApi.get().agent.streaming on mount', async () => {
    const api = await getAgentApi()
    api.getHistory.mockResolvedValueOnce({ messages: [] })
    const settings = await getSettingsApi()
    settings.get.mockReset()
    settings.get.mockResolvedValueOnce({
      llm: {
        baseUrl: '',
        modelId: '',
        kind: 'cloud',
        provider: 'openai-compatible',
        apiFormat: 'openai-compatible',
        activeProfileId: '',
        profiles: [],
        taskRoutes: [],
        hasApiKey: false,
        apiKeyMask: '',
      },
      imageGeneration: {
        apiFormat: 'openai-compatible',
        baseUrl: '',
        modelId: '',
        size: 'auto',
        quality: 'auto',
        background: 'auto',
        outputFormat: 'png',
        outputCompression: 80,
        hasApiKey: false,
        apiKeyMask: '',
      },
      appearance: { theme: 'dark', language: 'zh-CN' },
      agent: {
        streaming: false,
        userPrompt: '',
        fullAccess: false,
        contextMessageLimit: 50,
        progressiveDisclosureEnabled: true,
        providerCachingEnabled: true,
        checkpointEnabled: true,
        seedOnResumeEnabled: true,
        upgradeDebugEventsEnabled: true,
        autoCompactEnabled: true,
        autoCompactThreshold: 100,
        morningBrief: { enabled: false, time: '09:30' },
      },
      ocr: {
        provider: 'uapis',
        customBaseUrl: '',
        customModelId: '',
        hasCustomApiKey: false,
        customApiKeyMask: '',
      },
      uapis: {
        hasApiKey: false,
        apiKeyMask: '',
        mode: 'free-ip-quota',
        home: 'https://uapis.cn',
        console: 'https://uapis.cn/console',
        anonymousMonthlyCredits: 1500,
        apiKeyMonthlyCredits: 3500,
      },
    })

    const { result } = renderHook(() => useChatModel())
    await waitFor(() => expect(result.current.useStream).toBe(false))
  })
})
