import { HttpError } from '../../../http-error.js'
import type { AgentTool } from '../agent.tool.types.js'
import {
  createSkill,
  deleteSkill,
  installSkillFromMarketplace,
  installSkillFromUrl,
  inspectSkillMarketplaceInstall,
  listSkills,
  readSkill,
  searchSkillMarketplace,
} from '../../skills/skills.service.js'

function assertConfirmed(value: unknown) {
  if (value !== true) {
    throw new HttpError(
      400,
      'Skill changes require explicit user confirmation after explaining the skill id, operation, and expected effect.',
    )
  }
}

export const skillsTools: AgentTool[] = [
  {
    name: 'skills_list',
    description:
      'List installed Agent Skills. Read-only. Use this when the user asks what skills are available.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    execute: async () => listSkills(),
  },
  {
    name: 'skills_read',
    description:
      'Read an installed Skill SKILL.md body and bundled file names. Read-only. Use this before applying a skill in detail.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Skill id.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    execute: async (args) => readSkill((args as Record<string, unknown> | null)?.id),
  },
  {
    name: 'skills_create',
    description:
      'Create or replace a local Agent Skill under data/skills/<id>/SKILL.md. Before calling in default permission mode, explain the id, description, and effect, then wait for confirmation.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        body: { type: 'string' },
        enabled: { type: 'boolean' },
        confirmed: { type: 'boolean' },
      },
      required: ['name', 'description', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      return createSkill(input)
    },
  },
  {
    name: 'skills_install_from_url',
    description:
      'Install a Skill from a URL that points to SKILL.md or a raw markdown file. GitHub blob URLs are converted to raw URLs. Before calling in default permission mode, explain the source URL and effect, then wait for confirmation.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        id: { type: 'string' },
        enabled: { type: 'boolean' },
        confirmed: { type: 'boolean' },
      },
      required: ['url', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      return installSkillFromUrl(input)
    },
  },
  {
    name: 'skills_marketplace_search',
    description:
      'Search the public skills.sh marketplace for Agent Skills. Read-only. Use this when the user asks to find or discover installable skills.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search keywords.' },
        limit: { type: 'number', description: 'Maximum results, default 20, max 50.' },
      },
      additionalProperties: false,
    },
    execute: async (args) => searchSkillMarketplace((args ?? {}) as Record<string, unknown>),
  },
  {
    name: 'skills_marketplace_install',
    description:
      'Install a full Skill directory from the public skills.sh marketplace by id owner/repo/skill, including SKILL.md, references, scripts, assets, and other bundled files. Before calling in default permission mode, inspect first, explain the source id, file count, size, scripts, and expected effect, then wait for confirmation.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Marketplace id, for example anthropics/skills/frontend-design.' },
        allowLarge: {
          type: 'boolean',
          description: 'Set true only after explicit confirmation when inspect says the skill exceeds the default size/file limit.',
        },
        confirmed: { type: 'boolean' },
      },
      required: ['id', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      return installSkillFromMarketplace(input)
    },
  },
  {
    name: 'skills_marketplace_inspect',
    description:
      'Inspect a public skills.sh marketplace Skill before installation. Returns file count, total size, top-level directories, whether scripts/references/assets exist, and safety limit status. Read-only.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Marketplace id, for example anthropics/skills/frontend-design.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    execute: async (args) => inspectSkillMarketplaceInstall((args ?? {}) as Record<string, unknown>),
  },
  {
    name: 'skills_delete',
    description:
      'Delete an installed local Skill folder. Before calling in default permission mode, explain the skill id and effect, then wait for confirmation.',
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
      assertConfirmed(input.confirmed)
      return deleteSkill(input.id)
    },
  },
]
