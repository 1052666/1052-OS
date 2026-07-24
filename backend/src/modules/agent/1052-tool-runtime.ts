import type { AgentTool } from './agent.tool.types.js'
import type { PermissionProfile1052 } from './1052-permission-profile.js'
import { classifyToolSafety, type ToolSafetyClass } from './agent.tool.safety.js'

const SERIAL_TOOL_NAMES: ReadonlySet<string> = new Set([
  'claude_code',
  'orchestration_execute',
  'sql_query',
  'terminal_interrupt',
  'terminal_run',
])

export type ToolRuntime1052Metadata = {
  name: string
  safety: ToolSafetyClass
  sideEffecting: boolean
  requiresConfirmation: boolean
  supportsParallel: boolean
  timeoutMs: number | null
}

export type ToolRuntime1052Snapshot = {
  tools: ToolRuntime1052Metadata[]
  total: number
  readCount: number
  writeCount: number
}

export function metadataFor1052ToolName(
  name: string,
  timeoutMs: number | null = null,
): ToolRuntime1052Metadata {
  const safety = classifyToolSafety(name)
  const sideEffecting = safety === 'write'

  return {
    name,
    safety,
    sideEffecting,
    requiresConfirmation: sideEffecting,
    supportsParallel: !sideEffecting && !SERIAL_TOOL_NAMES.has(name),
    timeoutMs,
  }
}

export function metadataFor1052Tool(tool: AgentTool): ToolRuntime1052Metadata {
  return metadataFor1052ToolName(tool.name)
}

export function is1052ToolSideEffecting(name: string): boolean {
  return metadataFor1052ToolName(name).sideEffecting
}

export function canRun1052ToolInParallel(name: string): boolean {
  return metadataFor1052ToolName(name).supportsParallel
}

export function canAutoConfirm1052Tool(
  name: string,
  profile: PermissionProfile1052,
): boolean {
  const metadata = metadataFor1052ToolName(name)
  return metadata.requiresConfirmation && profile.approvalPolicy === 'never'
}

export function build1052ToolRuntimeSnapshot(
  tools: readonly AgentTool[],
): ToolRuntime1052Snapshot {
  const metadata = tools.map((tool) => metadataFor1052Tool(tool))

  return {
    tools: metadata,
    total: metadata.length,
    readCount: metadata.filter((tool) => tool.safety === 'read').length,
    writeCount: metadata.filter((tool) => tool.safety === 'write').length,
  }
}
