import { HttpError } from '../../../http-error.js'
import {
  createResource,
  deleteResource,
  getResource,
  listResources,
  strikeResource,
  updateResource,
} from '../../resources/resources.service.js'
import type { AgentTool } from '../agent.tool.types.js'

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function assertConfirmed(value: unknown) {
  if (value !== true) {
    throw new HttpError(
      400,
      '修改资源列表前必须先告知用户资源 ID、操作类型和主要影响，并等待用户明确确认后再执行。',
    )
  }
}

export const resourcesTools: AgentTool[] = [
  {
    name: 'resources_list',
    description:
      'List or search user resources. Read-only. Resources can be arbitrary text, URLs with descriptions, or long pasted content. Query searches title, content, note, and tags.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional keyword to search in title, content, note, and tags.' },
        status: { type: 'string', enum: ['active', 'struck'], description: 'Optional status filter.' },
        limit: { type: 'number', description: 'Maximum resources to return. Default 100, max 500.' },
      },
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      const clampedLimit = typeof input.limit === 'number' ? Math.min(Math.max(input.limit, 1), 500) : undefined
      const items = await listResources(input.query, input.status, clampedLimit)
      return {
        query: normalizeText(input.query),
        count: items.length,
        items,
      }
    },
  },
  {
    name: 'resources_read',
    description: 'Read one resource by ID. Read-only.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Resource ID.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return getResource(input.id)
    },
  },
  {
    name: 'resources_create',
    description:
      'Create a resource. Title is the short human-readable name; content is the actual resource body; note is supplemental context; tags are multiple category/search labels. Preserve the user\'s original line breaks in content and note by default. Do not flatten multi-line resources into one line. Only when the user explicitly asks to organize/beautify/structure the resource may you lightly reformat it for readability, without changing facts. Before calling, tell the user title/content/note/tags summary and wait for explicit confirmation.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Optional short title.' },
        content: { type: 'string', description: 'Main resource content. Required. Preserve original line breaks for multi-line text.' },
        note: { type: 'string', description: 'Optional extra note. Preserve original line breaks if provided.' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional category/search tags. Multiple tags are allowed.',
        },
        confirmed: { type: 'boolean', description: 'Must be true only after explicit user confirmation.' },
      },
      required: ['content', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      return createResource(input)
    },
  },
  {
    name: 'resources_update',
    description:
      'Update a resource title/content/note/tags/status. Title is the short name; content is the actual resource body; note is supplemental context; tags are multiple category/search labels. Preserve the user\'s original line breaks in content and note by default. Do not flatten structured text into one line. Only when the user explicitly asks to organize/beautify/structure the resource may you lightly reformat it for readability, without changing facts. Before calling, tell the user resource ID and change summary, then wait for explicit confirmation.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Resource ID.' },
        title: { type: 'string', description: 'Optional replacement title.' },
        content: { type: 'string', description: 'Optional replacement content. Preserve original line breaks for multi-line text.' },
        note: { type: 'string', description: 'Optional replacement note. Preserve original line breaks if provided.' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional replacement tags. Sending tags replaces the whole tag list.',
        },
        status: { type: 'string', enum: ['active', 'struck'], description: 'Optional replacement status.' },
        confirmed: { type: 'boolean', description: 'Must be true only after explicit user confirmation.' },
      },
      required: ['id', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      return updateResource(input.id, input)
    },
  },
  {
    name: 'resources_strike',
    description:
      'Mark a resource as struck-through or restore it to active. Before calling, tell the user resource ID and wait for explicit confirmation.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Resource ID.' },
        struck: { type: 'boolean', description: 'true to add strikethrough, false to restore active.' },
        confirmed: { type: 'boolean', description: 'Must be true only after explicit user confirmation.' },
      },
      required: ['id', 'struck', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      return strikeResource(input.id, input.struck === true)
    },
  },
  {
    name: 'resources_delete',
    description:
      'Delete a resource permanently. Before calling, tell the user resource ID and content summary, then wait for explicit confirmation.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Resource ID.' },
        confirmed: { type: 'boolean', description: 'Must be true only after explicit user confirmation.' },
      },
      required: ['id', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      return deleteResource(input.id)
    },
  },
]
