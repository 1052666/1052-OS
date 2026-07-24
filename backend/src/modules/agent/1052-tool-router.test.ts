import { describe, expect, it, vi } from 'vitest'
import { routeRuntime1052ToolCalls, type Runtime1052ToolExecutor } from './1052-tool-router.js'
import { resolve1052PermissionProfile } from './1052-permission-profile.js'
import { resolveRuntime1052Approval } from './1052-approval.service.js'
import type { Runtime1052Event } from './1052-kernel.types.js'
import type { LLMConversationMessage, LLMToolCall } from './llm.client.js'

function call(id: string, name: string): LLMToolCall {
  return {
    id,
    type: 'function',
    function: { name, arguments: '{}' },
  }
}

async function collect(
  stream: AsyncGenerator<Runtime1052Event, LLMConversationMessage[], void>,
) {
  const events: Runtime1052Event[] = []
  let item = await stream.next()
  while (!item.done) {
    events.push(item.value)
    item = await stream.next()
  }
  return { events, messages: item.value }
}

describe('1052 tool router', () => {
  it('runs independent read tools concurrently but preserves tool-message order', async () => {
    const execute: Runtime1052ToolExecutor = async (toolCall) => {
      await new Promise((resolve) =>
        setTimeout(resolve, toolCall.id === 'slow' ? 20 : 1),
      )
      return {
        role: 'tool',
        toolCallId: toolCall.id,
        name: toolCall.function.name,
        content: JSON.stringify({ ok: true, data: toolCall.id }),
      }
    }

    const result = await collect(
      routeRuntime1052ToolCalls({
        turnId: 'turn-1',
        toolCalls: [call('slow', 'filesystem_read_file'), call('fast', 'notes_read_note')],
        source: { channel: 'web' },
        permissionProfile: resolve1052PermissionProfile({ permissionProfile: 'default' }),
        execute,
      }),
    )

    const finished = result.events.filter((event) => event.type === 'tool-call-finished')
    expect(finished.map((event) => event.callId)).toEqual(['fast', 'slow'])
    expect(result.messages.map((message) => (message.role === 'tool' ? message.toolCallId : '')))
      .toEqual(['slow', 'fast'])
  })

  it('serializes a batch when it contains a side-effecting tool', async () => {
    const executionOrder: string[] = []
    const execute: Runtime1052ToolExecutor = async (toolCall) => {
      executionOrder.push(`start:${toolCall.id}`)
      await Promise.resolve()
      executionOrder.push(`end:${toolCall.id}`)
      return {
        role: 'tool',
        toolCallId: toolCall.id,
        name: toolCall.function.name,
        content: JSON.stringify({ ok: true }),
      }
    }

    await collect(
      routeRuntime1052ToolCalls({
        turnId: 'turn-1',
        toolCalls: [call('write', 'terminal_run'), call('read', 'filesystem_read_file')],
        source: { channel: 'web' },
        permissionProfile: resolve1052PermissionProfile({
          permissionProfile: 'danger-full-access',
        }),
        execute,
      }),
    )

    expect(executionOrder).toEqual([
      'start:write',
      'end:write',
      'start:read',
      'end:read',
    ])
  })

  it('waits for a runtime approval before executing a side-effecting tool', async () => {
    let approvedByRuntime = false
    const execute: Runtime1052ToolExecutor = async (toolCall, _context, authorization) => {
      approvedByRuntime = authorization?.approved === true
      return {
        role: 'tool',
        toolCallId: toolCall.id,
        name: toolCall.function.name,
        content: JSON.stringify({ ok: true }),
      }
    }
    const stream = routeRuntime1052ToolCalls({
      turnId: 'turn-approval',
      toolCalls: [call('write', 'terminal_run')],
      source: { channel: 'web' },
      approvalMode: 'interactive',
      permissionProfile: resolve1052PermissionProfile({ permissionProfile: 'default' }),
      execute,
    })

    expect((await stream.next()).value).toMatchObject({ type: 'tool-call-started' })
    const requested = await stream.next()
    expect(requested.done).toBe(false)
    expect(requested.value).toMatchObject({ type: 'approval-requested', callId: 'write' })
    if (!requested.done && requested.value.type === 'approval-requested') {
      expect(resolveRuntime1052Approval(requested.value.approvalId, true)).toBe(true)
    }

    const remaining = await collect(stream)
    expect(remaining.events.map((event) => event.type)).toEqual([
      'approval-resolved',
      'tool-call-finished',
    ])
    expect(approvedByRuntime).toBe(true)
    expect(remaining.messages[0]).toMatchObject({ role: 'tool', toolCallId: 'write' })
  })

  it('fails closed instead of waiting when the caller cannot display an approval', async () => {
    const execute = vi.fn<Runtime1052ToolExecutor>()
    const result = await collect(
      routeRuntime1052ToolCalls({
        turnId: 'turn-noninteractive',
        toolCalls: [call('write', 'terminal_run')],
        source: { channel: 'web' },
        approvalMode: 'deny',
        permissionProfile: resolve1052PermissionProfile({ permissionProfile: 'default' }),
        execute,
      }),
    )

    expect(result.events.map((event) => event.type)).toEqual([
      'tool-call-started',
      'tool-call-finished',
    ])
    expect(result.messages[0]).toMatchObject({ role: 'tool', toolCallId: 'write' })
    expect(result.messages[0]?.role === 'tool' ? result.messages[0].content : '').toContain(
      'cannot display one',
    )
    expect(execute).not.toHaveBeenCalled()
  })
})
