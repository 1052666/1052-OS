import { HttpError } from '../../http-error.js'
import type {
  LLMConversationMessage,
  LLMToolCall,
  LLMToolDefinition,
} from './llm.client.js'
import type { AgentTool } from './agent.tool.types.js'
import { calendarTools } from './tools/calendar.tools.js'
import { filesystemTools } from './tools/filesystem.tools.js'
import { feishuTools } from './tools/feishu.tools.js'
import { imageTools } from './tools/image.tools.js'
import { memoryTools } from './tools/memory.tools.js'
import { notesTools } from './tools/notes.tools.js'
import { orchestrationTools } from './tools/orchestration.tools.js'
import { repositoryTools } from './tools/repository.tools.js'
import { resourcesTools } from './tools/resources.tools.js'
import { scheduleTools } from './tools/schedule.tools.js'
import { skillsTools } from './tools/skills.tools.js'
import { sqlTools } from './tools/sql.tools.js'
import { terminalTools } from './tools/terminal.tools.js'
import { uapisTools } from './tools/uapis.tools.js'
import { websearchTools } from './tools/websearch.tools.js'
import { getSettings } from '../settings/settings.service.js'

const AGENT_TOOLS: AgentTool[] = [
  ...calendarTools,
  ...imageTools,
  ...memoryTools,
  ...repositoryTools,
  ...notesTools,
  ...resourcesTools,
  ...skillsTools,
  ...scheduleTools,
  ...websearchTools,
  ...uapisTools,
  ...filesystemTools,
  ...feishuTools,
  ...sqlTools,
  ...orchestrationTools,
  ...terminalTools,
]
const TOOL_MAP = new Map(AGENT_TOOLS.map((tool) => [tool.name, tool]))

export type AgentToolRuntimeContext = {
  source?:
    | {
        channel: 'wechat'
        accountId: string
        peerId: string
      }
    | {
        channel: 'feishu'
        receiveIdType: 'chat_id'
        receiveId: string
        chatType: 'p2p' | 'group'
        senderOpenId?: string
      }
}

function stringifyResult(result: unknown) {
  return JSON.stringify(result, null, 2)
}

function parseArguments(value: string) {
  if (!value.trim()) return {}
  return JSON.parse(value) as unknown
}

function buildToolDefinition(tool: AgentTool): LLMToolDefinition {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }
}

export function getAgentToolDefinitions(): LLMToolDefinition[] {
  return AGENT_TOOLS.map((tool) => buildToolDefinition(tool))
}

export async function executeToolCalls(
  toolCalls: LLMToolCall[],
  runtimeContext?: AgentToolRuntimeContext,
): Promise<LLMConversationMessage[]> {
  const messages: LLMConversationMessage[] = []
  const settings = await getSettings()
  const fullAccess = settings.agent.fullAccess === true

  for (const toolCall of toolCalls) {
    const tool = TOOL_MAP.get(toolCall.function.name)
    if (!tool) {
      messages.push({
        role: 'tool',
        toolCallId: toolCall.id,
        name: toolCall.function.name,
        content: stringifyResult({
          ok: false,
          error: `未找到工具: ${toolCall.function.name}`,
        }),
      })
      continue
    }

    try {
      const parsedArgs = parseArguments(toolCall.function.arguments)
      const confirmedArgs =
        fullAccess && parsedArgs && typeof parsedArgs === 'object' && !Array.isArray(parsedArgs)
          ? { ...(parsedArgs as Record<string, unknown>), confirmed: true }
          : parsedArgs
      const args =
        runtimeContext &&
        confirmedArgs &&
        typeof confirmedArgs === 'object' &&
        !Array.isArray(confirmedArgs)
          ? { ...(confirmedArgs as Record<string, unknown>), __runtimeContext: runtimeContext }
          : confirmedArgs
      const result = await tool.execute(args)
      messages.push({
        role: 'tool',
        toolCallId: toolCall.id,
        name: tool.name,
        content: stringifyResult({
          ok: true,
          data: result,
        }),
      })
    } catch (error) {
      const message =
        error instanceof HttpError || error instanceof Error
          ? error.message
          : '工具调用失败'

      messages.push({
        role: 'tool',
        toolCallId: toolCall.id,
        name: tool.name,
        content: stringifyResult({
          ok: false,
          error: message,
        }),
      })
    }
  }

  return messages
}
