import { describe, expect, it } from 'vitest'
import type { AgentTool } from './agent.tool.types.js'
import {
  build1052ToolRuntimeSnapshot,
  canAutoConfirm1052Tool,
  canRun1052ToolInParallel,
  is1052ToolSideEffecting,
  metadataFor1052ToolName,
} from './1052-tool-runtime.js'
import { resolve1052PermissionProfile } from './1052-permission-profile.js'

function tool(name: string): AgentTool {
  return {
    name,
    description: name,
    parameters: {},
    execute: async () => ({ ok: true }),
  }
}

describe('1052 tool runtime metadata', () => {
  it('marks read tools as parallel and side-effect free', () => {
    const metadata = metadataFor1052ToolName('filesystem_read_file')

    expect(metadata).toMatchObject({
      name: 'filesystem_read_file',
      safety: 'read',
      sideEffecting: false,
      requiresConfirmation: false,
      supportsParallel: true,
      timeoutMs: null,
    })
  })

  it('marks write tools as side-effecting and confirmation-gated', () => {
    const metadata = metadataFor1052ToolName('filesystem_write_file')

    expect(metadata).toMatchObject({
      safety: 'write',
      sideEffecting: true,
      requiresConfirmation: true,
      supportsParallel: false,
    })
    expect(is1052ToolSideEffecting('terminal_run')).toBe(true)
  })

  it('keeps explicitly serial tools out of parallel execution', () => {
    expect(canRun1052ToolInParallel('terminal_run')).toBe(false)
    expect(canRun1052ToolInParallel('terminal_status')).toBe(true)
  })

  it('auto-confirms only confirmation-gated tools under never-ask permissions', () => {
    const defaultProfile = resolve1052PermissionProfile({ fullAccess: false })
    const fullAccessProfile = resolve1052PermissionProfile({ fullAccess: true })

    expect(canAutoConfirm1052Tool('filesystem_write_file', defaultProfile)).toBe(false)
    expect(canAutoConfirm1052Tool('filesystem_write_file', fullAccessProfile)).toBe(true)
    expect(canAutoConfirm1052Tool('filesystem_read_file', fullAccessProfile)).toBe(false)
  })

  it('builds a stable runtime snapshot for registered tools', () => {
    const snapshot = build1052ToolRuntimeSnapshot([
      tool('filesystem_read_file'),
      tool('filesystem_write_file'),
      tool('terminal_status'),
    ])

    expect(snapshot.total).toBe(3)
    expect(snapshot.readCount).toBe(2)
    expect(snapshot.writeCount).toBe(1)
    expect(snapshot.tools.map((item) => item.name)).toEqual([
      'filesystem_read_file',
      'filesystem_write_file',
      'terminal_status',
    ])
  })
})
