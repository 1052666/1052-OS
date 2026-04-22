import { HttpError } from '../../../http-error.js'
import {
  confirmMemorySuggestion,
  createMemory,
  createMemorySuggestion,
  createSecureMemory,
  deleteMemory,
  deleteSecureMemory,
  getMemory,
  getMemoryRuntimePreview,
  getMemorySummary,
  getSecureMemory,
  listMemories,
  listMemorySuggestions,
  listSecureMemories,
  rejectMemorySuggestion,
  updateMemory,
  updateSecureMemory,
} from '../../memory/memory.service.js'
import type { AgentTool } from '../agent.tool.types.js'

function assertConfirmed(value: unknown, message: string) {
  if (value !== true) throw new HttpError(400, message)
}

export const memoryTools: AgentTool[] = [
  {
    name: 'memory_list',
    description:
      'List confirmed long-term memories. Read-only. Supports keyword search and filtering by category, scope, priority, and active state.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional keyword.' },
        category: { type: 'string', description: 'Optional category filter.' },
        scope: { type: 'string', description: 'Optional scope filter.' },
        priority: { type: 'string', description: 'Optional priority filter.' },
        active: { type: 'boolean', description: 'Optional active-state filter.' },
        limit: { type: 'number', description: 'Maximum records to return. Default 120, max 300.' },
      },
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      if (typeof input.limit === 'number') input.limit = Math.min(Math.max(input.limit, 1), 300)
      return listMemories(input)
    },
  },
  {
    name: 'memory_read',
    description: 'Read one confirmed long-term memory by ID. Read-only.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Memory ID.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    execute: async (args) => getMemory((args as Record<string, unknown> | undefined)?.id),
  },
  {
    name: 'memory_summary',
    description: 'Get long-term memory summary counts and recent confirmed/secure items. Read-only.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    execute: async () => getMemorySummary(),
  },
  {
    name: 'memory_runtime_preview',
    description:
      'Preview which long-term memories would be injected for a given request, including the sensitive-memory catalog summary. Read-only.',
    parameters: {
      type: 'object',
      properties: {
        request: { type: 'string', description: 'Current user request to preview runtime memory selection.' },
      },
      additionalProperties: false,
    },
    execute: async (args) => getMemoryRuntimePreview((args as Record<string, unknown> | undefined)?.request),
  },
  {
    name: 'memory_create',
    description:
      'Create a confirmed long-term memory. Use this when the user explicitly wants something remembered long term. Before calling, tell the user what will be remembered and wait for explicit confirmation.',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Memory category.' },
        title: { type: 'string', description: 'Short memory title.' },
        content: { type: 'string', description: 'Actual long-term memory content.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags.' },
        scope: { type: 'string', description: 'Memory scope.' },
        priority: { type: 'string', description: 'Priority.' },
        source: { type: 'string', description: 'Source, such as user_explicit.' },
        active: { type: 'boolean', description: 'Whether this memory is active immediately.' },
        confirmed: { type: 'boolean', description: 'Must be true only after explicit user confirmation.' },
      },
      required: ['title', 'content', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(
        input.confirmed,
        '写入长期记忆前，必须先告知用户将要记住的标题、内容、类别与影响，并等待用户明确确认。',
      )
      return createMemory(input)
    },
  },
  {
    name: 'memory_update',
    description:
      'Update a confirmed long-term memory. Before calling, tell the user which memory will change and summarize the change, then wait for explicit confirmation.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Memory ID.' },
        category: { type: 'string' },
        title: { type: 'string' },
        content: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        scope: { type: 'string' },
        priority: { type: 'string' },
        source: { type: 'string' },
        active: { type: 'boolean' },
        confirmed: { type: 'boolean', description: 'Must be true only after explicit user confirmation.' },
      },
      required: ['id', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(
        input.confirmed,
        '修改长期记忆前，必须先告知用户目标记忆、改动内容和影响，并等待用户明确确认。',
      )
      return updateMemory(input.id, input)
    },
  },
  {
    name: 'memory_delete',
    description:
      'Delete a confirmed long-term memory. Before calling, tell the user the memory ID and summary, then wait for explicit confirmation.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Memory ID.' },
        confirmed: { type: 'boolean', description: 'Must be true only after explicit user confirmation.' },
      },
      required: ['id', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed, '删除长期记忆前，必须先告知用户目标记忆和影响，并等待明确确认。')
      return deleteMemory(input.id)
    },
  },
  {
    name: 'memory_suggestions_list',
    description: 'List pending long-term memory suggestions. Read-only.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional keyword.' },
        limit: { type: 'number', description: 'Maximum records to return. Default 80.' },
      },
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      if (typeof input.limit === 'number') input.limit = Math.min(Math.max(input.limit, 1), 300)
      return listMemorySuggestions(input)
    },
  },
  {
    name: 'memory_suggest',
    description:
      'Create a pending long-term memory suggestion instead of directly activating it. Use when you infer a likely durable preference or rule but the user has not explicitly confirmed it yet.',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Memory category.' },
        title: { type: 'string', description: 'Short suggestion title.' },
        content: { type: 'string', description: 'Suggested long-term memory content.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags.' },
        scope: { type: 'string', description: 'Memory scope.' },
        priority: { type: 'string', description: 'Priority.' },
        source: { type: 'string', description: 'Source, such as agent_inferred.' },
        active: { type: 'boolean', description: 'Whether it should become active when later confirmed.' },
      },
      required: ['title', 'content'],
      additionalProperties: false,
    },
    execute: async (args) => createMemorySuggestion((args ?? {}) as Record<string, unknown>),
  },
  {
    name: 'memory_confirm_suggestion',
    description:
      'Confirm a pending long-term memory suggestion and turn it into an active confirmed memory. Before calling, tell the user which suggestion will be confirmed and wait for explicit confirmation.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Suggestion ID.' },
        category: { type: 'string' },
        title: { type: 'string' },
        content: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        scope: { type: 'string' },
        priority: { type: 'string' },
        source: { type: 'string' },
        active: { type: 'boolean' },
        confirmed: { type: 'boolean', description: 'Must be true only after explicit user confirmation.' },
      },
      required: ['id', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed, '确认长期记忆建议前，必须先告知用户建议内容，并等待明确确认。')
      return confirmMemorySuggestion(input.id, input)
    },
  },
  {
    name: 'memory_reject_suggestion',
    description:
      'Reject and delete a pending long-term memory suggestion. Before calling, tell the user which suggestion will be discarded and wait for explicit confirmation.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Suggestion ID.' },
        confirmed: { type: 'boolean', description: 'Must be true only after explicit user confirmation.' },
      },
      required: ['id', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed, '丢弃长期记忆建议前，必须先告知用户目标建议，并等待明确确认。')
      return rejectMemorySuggestion(input.id)
    },
  },
  {
    name: 'memory_secure_list',
    description:
      'List secure long-term memories (sensitive-memory catalog) without exposing raw values. Read-only.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional keyword.' },
        limit: { type: 'number', description: 'Maximum records to return. Default 100.' },
      },
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      if (typeof input.limit === 'number') input.limit = Math.min(Math.max(input.limit, 1), 300)
      return listSecureMemories(input)
    },
  },
  {
    name: 'memory_secure_read',
    description:
      'Read one secure long-term memory, including the raw sensitive value. Only call this when the task truly requires the raw value; do not expose the raw value in the final user-facing reply unless the user explicitly asks.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Secure memory ID.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    execute: async (args) => getSecureMemory((args as Record<string, unknown> | undefined)?.id),
  },
  {
    name: 'memory_secure_write',
    description:
      'Create a secure long-term memory entry for sensitive information such as API keys, tokens, passwords, or private config. Before calling, tell the user what will be stored, where it will be used, and wait for explicit confirmation.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Human-readable entry title.' },
        type: { type: 'string', description: 'Sensitive entry type such as api_key, token, password, config.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags.' },
        allowedUse: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional allowed-use labels such as llm, image-generation, github.',
        },
        exposureMode: {
          type: 'string',
          description: 'tool_only or raw_on_demand. Prefer tool_only unless raw value is needed later.',
        },
        content: { type: 'string', description: 'Raw sensitive value or secure content.' },
        confirmed: { type: 'boolean', description: 'Must be true only after explicit user confirmation.' },
      },
      required: ['title', 'content', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(
        input.confirmed,
        '写入敏感长期记忆前，必须先告知用户将保存的敏感项标题、用途、暴露方式和影响，并等待明确确认。',
      )
      return createSecureMemory(input)
    },
  },
  {
    name: 'memory_secure_update',
    description:
      'Update an existing secure long-term memory entry. Before calling, tell the user which secure entry will change and wait for explicit confirmation.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Secure memory ID.' },
        title: { type: 'string' },
        type: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        allowedUse: { type: 'array', items: { type: 'string' } },
        exposureMode: { type: 'string' },
        content: { type: 'string' },
        confirmed: { type: 'boolean', description: 'Must be true only after explicit user confirmation.' },
      },
      required: ['id', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(
        input.confirmed,
        '修改敏感长期记忆前，必须先告知用户目标条目、改动内容和影响，并等待明确确认。',
      )
      return updateSecureMemory(input.id, input)
    },
  },
  {
    name: 'memory_secure_delete',
    description:
      'Delete one secure long-term memory entry. Before calling, tell the user which secure entry will be removed and wait for explicit confirmation.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Secure memory ID.' },
        confirmed: { type: 'boolean', description: 'Must be true only after explicit user confirmation.' },
      },
      required: ['id', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed, '删除敏感长期记忆前，必须先告知用户目标条目，并等待明确确认。')
      return deleteSecureMemory(input.id)
    },
  },
]
