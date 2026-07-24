import { describe, expect, it } from 'vitest'
import type { AgentTool } from './agent.tool.types.js'
import {
  Runtime1052ToolRegistry,
  runtime1052ToolRegistry,
} from './1052-tool-registry.js'

function tool(name: string): AgentTool {
  return {
    name,
    description: `${name} description`,
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ ok: true }),
  }
}

describe('1052 tool registry', () => {
  it('builds model definitions and runtime metadata from one registry', () => {
    const definitions = runtime1052ToolRegistry.definitions([
      'filesystem_read_file',
      'filesystem_read_file',
      'terminal_run',
      'missing-tool',
    ])
    const snapshot = runtime1052ToolRegistry.snapshot()

    expect(definitions.map((definition) => definition.function.name)).toEqual([
      'filesystem_read_file',
      'terminal_run',
    ])
    expect(snapshot.total).toBe(runtime1052ToolRegistry.definitions().length)
    expect(snapshot.readCount + snapshot.writeCount).toBe(snapshot.total)
  })

  it('rejects duplicate registrations at construction time', () => {
    expect(() => new Runtime1052ToolRegistry([tool('same'), tool('same')])).toThrow(
      'Duplicate 1052 tool registration: same',
    )
  })

  it('fails closed for every known installer, synchronizer, and state transition', () => {
    const byName = new Map(
      runtime1052ToolRegistry.snapshot().tools.map((metadata) => [metadata.name, metadata]),
    )
    const sideEffectingNames = [
      'skills_install_from_url',
      'skills_marketplace_install',
      'resources_strike',
      'schedule_pause_task',
      'schedule_resume_task',
      'feishu_import_markdown_doc',
      'feishu_sync_resources_doc',
      'feishu_sync_notes_doc',
      'feishu_sync_memory_doc',
      'feishu_sync_resources_bitable',
      'feishu_mount_doc_to_wiki',
      'feishu_index_search_item',
      'feishu_sync_resources_search',
    ]

    for (const name of sideEffectingNames) {
      expect(byName.get(name), `missing registered tool ${name}`).toMatchObject({
        safety: 'write',
        sideEffecting: true,
        requiresConfirmation: true,
        supportsParallel: false,
      })
    }
  })
})
