import { HttpError } from '../../../http-error.js'
import {
  createOutputProfile,
  deleteOutputProfile,
  getOutputProfile,
  getOutputProfileRuntimePreview,
  getOutputProfileSummary,
  listOutputProfiles,
  updateOutputProfile,
} from '../../output-profiles/output-profile.service.js'
import type { AgentTool } from '../agent.tool.types.js'

function assertConfirmed(value: unknown, message: string) {
  if (value !== true) throw new HttpError(400, message)
}

const refArraySchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['memory', 'wiki', 'raw', 'resource', 'note', 'tag', 'freeform'],
      },
      ref: { type: 'string' },
      label: { type: 'string' },
      note: { type: 'string' },
    },
    additionalProperties: false,
  },
}

const profileProperties = {
  title: { type: 'string', description: 'Profile title.' },
  description: { type: 'string', description: 'Short description.' },
  active: { type: 'boolean', description: 'Whether this profile is injected at runtime.' },
  isDefault: { type: 'boolean', description: 'Whether this profile is preferred by default.' },
  priority: { type: 'string', enum: ['high', 'normal', 'low'] },
  modes: { type: 'array', items: { type: 'string' }, description: 'Output modes such as essay, report, analysis.' },
  tags: { type: 'array', items: { type: 'string' } },
  cognitiveModels: refArraySchema,
  writingStyles: refArraySchema,
  materials: refArraySchema,
  instructions: { type: 'string', description: 'How to compose model, style, and materials.' },
  guardrails: { type: 'array', items: { type: 'string' } },
  sampleOutput: { type: 'string', description: 'Optional preferred sample excerpt.' },
} as const

export const outputProfileTools: AgentTool[] = [
  {
    name: 'output_profile_summary',
    description:
      'Get counts and recent output profiles. Output profiles are reusable composition recipes combining cognitive models, writing style, and material scopes. Read-only.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => getOutputProfileSummary(),
  },
  {
    name: 'output_profile_list',
    description:
      'List output profiles. Use when the user asks about approved cognitive models, writing styles, or material composition recipes. Read-only.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        active: { type: 'boolean' },
        limit: { type: 'number' },
      },
      additionalProperties: false,
    },
    execute: async (args) => listOutputProfiles((args ?? {}) as Record<string, unknown>),
  },
  {
    name: 'output_profile_read',
    description: 'Read one output profile by ID. Read-only.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    execute: async (args) => getOutputProfile((args as Record<string, unknown> | undefined)?.id),
  },
  {
    name: 'output_profile_runtime_preview',
    description:
      'Preview which active output profiles would be injected for a request and the rendered runtime context. Read-only.',
    parameters: {
      type: 'object',
      properties: {
        request: { type: 'string' },
      },
      additionalProperties: false,
    },
    execute: async (args) =>
      getOutputProfileRuntimePreview((args as Record<string, unknown> | undefined)?.request),
  },
  {
    name: 'output_profile_create',
    description:
      'Create an output profile. Tell the user what profile will be stored before calling. The 1052 runtime requests exact approval under the default profile; danger-full-access may execute directly.',
    parameters: {
      type: 'object',
      properties: {
        ...profileProperties,
        confirmed: { type: 'boolean' },
      },
      required: ['title', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(
        input.confirmed,
        '创建输出配方前，必须先说明将保存的认知模型、文风、素材范围和影响，并等待用户确认。',
      )
      return createOutputProfile(input)
    },
  },
  {
    name: 'output_profile_update',
    description:
      'Update an output profile. Tell the user which profile will change before calling. The 1052 runtime requests exact approval under the default profile; danger-full-access may execute directly.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        ...profileProperties,
        confirmed: { type: 'boolean' },
      },
      required: ['id', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed, '修改输出配方前，必须先说明目标配方、改动内容和影响，并等待用户确认。')
      return updateOutputProfile(input.id, input)
    },
  },
  {
    name: 'output_profile_delete',
    description:
      'Delete an output profile. Tell the user which profile will be removed before calling. The 1052 runtime requests exact approval under the default profile; danger-full-access may execute directly.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        confirmed: { type: 'boolean' },
      },
      required: ['id', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed, '删除输出配方前，必须先说明目标配方和影响，并等待用户确认。')
      return deleteOutputProfile(input.id)
    },
  },
]
