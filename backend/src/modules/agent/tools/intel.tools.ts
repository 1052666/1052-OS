import type { AgentTool } from '../agent.tool.types.js'
import {
  formatIntelBrief,
  type IntelBriefTargetFormat,
} from '../../intel/intel-brief.service.js'
import { collectIntelCenterData } from '../../intel/intel-center.service.js'

const TARGET_FORMATS: IntelBriefTargetFormat[] = [
  'markdown',
  'plain_text',
  'feishu_card',
  'wechat_text',
  'wecom_markdown',
]

export const intelTools: AgentTool[] = [
  {
    name: 'intel_center_collect',
    description:
      'Run the installed intel-center Skill collector with the correct skill directory as cwd and return collected raw intelligence JSON. Collection only; the Agent must analyze the result. It does not render channel formats or send messages.',
    parameters: {
      type: 'object',
      properties: {
        timeoutMs: {
          type: 'number',
          description: 'Optional timeout in milliseconds. Defaults to 180000 and is clamped.',
        },
      },
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return collectIntelCenterData({ timeoutMs: input.timeoutMs })
    },
  },
  {
    name: 'intel_brief_format',
    description:
      'Render a structured Intel Brief into channel-ready formats such as Markdown, Feishu card JSON, WeChat text, or WeCom markdown. Formats only; it does not send messages or collect intelligence.',
    parameters: {
      type: 'object',
      properties: {
        brief: {
          type: 'object',
          description:
            'Structured Intel Brief. Recognized fields include title, date, summary, sectors or sector_summaries, market_anomalies, transmission_chains, delta_alerts, and sources.',
          additionalProperties: true,
        },
        targetFormat: {
          type: 'string',
          enum: TARGET_FORMATS,
          description: 'Output format. Defaults to markdown.',
        },
        maxMessageChars: {
          type: 'number',
          description:
            'Optional chunk size for text channels that may need multiple messages. Defaults to 1800 and is clamped by the formatter.',
        },
      },
      required: ['brief'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return formatIntelBrief({
        brief: input.brief,
        targetFormat: input.targetFormat,
        maxMessageChars: input.maxMessageChars,
      })
    },
  },
]
