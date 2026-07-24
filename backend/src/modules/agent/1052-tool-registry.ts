import type { AgentTool } from './agent.tool.types.js'
import { agentRuntimeTools } from './tools/agent-runtime.tools.js'
import { calendarTools } from './tools/calendar.tools.js'
import { claudeCodeTools } from './tools/claude-code.tools.js'
import { feishuTools } from './tools/feishu.tools.js'
import { filesystemTools } from './tools/filesystem.tools.js'
import { imageTools } from './tools/image.tools.js'
import { intelTools } from './tools/intel.tools.js'
import { memoryTools } from './tools/memory.tools.js'
import { notesTools } from './tools/notes.tools.js'
import { ocrTools } from './tools/ocr.tools.js'
import { orchestrationTools } from './tools/orchestration.tools.js'
import { outputProfileTools } from './tools/output-profile.tools.js'
import { pkmTools } from './tools/pkm.tools.js'
import { repositoryTools } from './tools/repository.tools.js'
import { resourcesTools } from './tools/resources.tools.js'
import { scheduleTools } from './tools/schedule.tools.js'
import { skillsTools } from './tools/skills.tools.js'
import { sqlTools } from './tools/sql.tools.js'
import { terminalTools } from './tools/terminal.tools.js'
import { uapisTools } from './tools/uapis.tools.js'
import { websearchTools } from './tools/websearch.tools.js'
import { wikiTools } from './tools/wiki.tools.js'
import {
  build1052ToolRuntimeSnapshot,
  type ToolRuntime1052Snapshot,
} from './1052-tool-runtime.js'
import type { LLMToolDefinition } from './llm.client.js'

const BUILTIN_1052_TOOLS: readonly AgentTool[] = [
  ...agentRuntimeTools,
  ...calendarTools,
  ...claudeCodeTools,
  ...imageTools,
  ...memoryTools,
  ...outputProfileTools,
  ...repositoryTools,
  ...notesTools,
  ...resourcesTools,
  ...skillsTools,
  ...scheduleTools,
  ...websearchTools,
  ...wikiTools,
  ...pkmTools,
  ...uapisTools,
  ...filesystemTools,
  ...feishuTools,
  ...intelTools,
  ...sqlTools,
  ...orchestrationTools,
  ...terminalTools,
  ...ocrTools,
]

function toDefinition(tool: AgentTool): LLMToolDefinition {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }
}

export class Runtime1052ToolRegistry {
  private readonly tools: readonly AgentTool[]
  private readonly byName: ReadonlyMap<string, AgentTool>

  constructor(tools: readonly AgentTool[]) {
    const byName = new Map<string, AgentTool>()
    for (const tool of tools) {
      if (byName.has(tool.name)) {
        throw new Error(`Duplicate 1052 tool registration: ${tool.name}`)
      }
      byName.set(tool.name, tool)
    }
    this.tools = [...tools]
    this.byName = byName
  }

  get(name: string) {
    return this.byName.get(name)
  }

  has(name: string) {
    return this.byName.has(name)
  }

  definitions(names?: readonly string[]): LLMToolDefinition[] {
    if (!names) return this.tools.map(toDefinition)

    const seen = new Set<string>()
    const definitions: LLMToolDefinition[] = []
    for (const name of names) {
      if (seen.has(name)) continue
      const tool = this.byName.get(name)
      if (!tool) continue
      seen.add(name)
      definitions.push(toDefinition(tool))
    }
    return definitions
  }

  snapshot(): ToolRuntime1052Snapshot {
    return build1052ToolRuntimeSnapshot(this.tools)
  }
}

export const runtime1052ToolRegistry = new Runtime1052ToolRegistry(BUILTIN_1052_TOOLS)
