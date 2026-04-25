import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { REQUEST_CONTEXT_UPGRADE_TOOL } from './agent.upgrade.service.js'
import {
  describePackForRouting,
  REQUESTABLE_PACKS,
} from './agent.pack.service.js'
import { summarizeCheckpointForInjection } from './agent.checkpoint.service.js'
import { formatUapisDirectorySummary } from '../uapis/uapis.service.js'
import type { AgentCheckpoint, AgentPackName } from './agent.runtime.types.js'
import type { LLMConversationMessage, LLMToolDefinition } from './llm.client.js'
import {
  CONTEXT_UPGRADE_TOOL_SCHEMA_TOKEN_BUDGET,
  P0_TOTAL_TOKEN_BUDGET,
  P0_UAPIS_DIRECTORY_TOKEN_BUDGET,
  buildTokenBudgetReport,
  textBudgetComponent,
  toolSchemaBudgetComponent,
} from './agent.budget.service.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..', '..', '..', '..')

let cachedCoreRuleFiles: { core: string; local: string } | null = null
let cachedProjectProfile: string | null = null

async function readOptionalFile(target: string) {
  try {
    return (await fs.readFile(target, 'utf-8')).trim()
  } catch {
    return ''
  }
}

async function getCoreRuleFiles() {
  if (cachedCoreRuleFiles !== null) return cachedCoreRuleFiles
  const [core, local] = await Promise.all([
    readOptionalFile(path.join(ROOT_DIR, '1052.md')),
    readOptionalFile(path.join(ROOT_DIR, '1052.local.md')),
  ])
  cachedCoreRuleFiles = { core, local }
  return cachedCoreRuleFiles
}

async function getProjectProfileSummary() {
  if (cachedProjectProfile !== null) return cachedProjectProfile
  const readme = await readOptionalFile(path.join(ROOT_DIR, 'README.md'))
  const topEntries = await fs
    .readdir(ROOT_DIR, { withFileTypes: true })
    .then((items) => items.slice(0, 12).map((item) => item.name))
    .catch(() => [])
  cachedProjectProfile = [
    'Project profile:',
    `- root entries: ${topEntries.join(', ') || '(none)'}`,
    readme ? `- README excerpt: ${readme.slice(0, 500)}` : '- README excerpt: (missing)',
  ].join('\n')
  return cachedProjectProfile
}

export function getContextUpgradeToolDefinition(): LLMToolDefinition {
  return {
    type: 'function',
    function: {
      name: REQUEST_CONTEXT_UPGRADE_TOOL,
      description: 'Request one or two capability packs before continuing.',
      parameters: {
        type: 'object',
        properties: {
          packs: {
            type: 'array',
            items: {
              type: 'string',
              enum: REQUESTABLE_PACKS,
            },
          },
          reason: {
            type: 'string',
          },
          scope: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['packs', 'reason'],
        additionalProperties: false,
      },
    },
  }
}

function getRoutingPrompt() {
  return [
    'Capability routing:',
    ...REQUESTABLE_PACKS.map((pack) => `- ${pack}: ${describePackForRouting(pack)}`),
    '- Start in P0 with no business tools.',
    '- If you need local code, local files, or readonly terminal inspection, request repo-pack.',
    '- If you need web search, page reading, or UAPIs lookup/call, request search-pack.',
    '- If you need to read, create, update, delete, suggest, confirm, or reject long-term memories, request memory-pack.',
    '- If you need to read or maintain Wiki, ingest raw files, search structured knowledge pages, write synthesis, or lint Wiki health, request data-pack.',
    '- Wiki is not long-term memory: Wiki stores knowledge assets and source-backed synthesis; memory-pack stores durable user preferences, constraints, identity, and habits.',
    '- For Wiki ingestion, read raw, summarize 3-5 key points and page split suggestions, then wait for confirmation before write tools unless full-access is enabled.',
    '- For valuable answers that should be preserved, ask whether to write them into 综合分析/ before wiki_query_writeback unless full-access is enabled.',
    '- For Wiki lint, preview first; automatic fixes, index rebuilds, and log appends are write operations that require confirmation unless full-access is enabled.',
    '- When the user explicitly says to remember something, memory-pack provides memory_create; set confirmed=true because the request itself is the confirmation.',
    '- When you infer a durable preference but the user did not explicitly ask to remember it, use memory_suggest after memory-pack is mounted.',
    '- Use secure-memory tools in memory-pack for API keys, tokens, passwords, private config, and other sensitive values.',
    '- UAPIs is available only after search-pack is mounted; then call uapis_list_apis, uapis_read_api, and uapis_call in order.',
    '- Request at most 2 packs at once and at most 2 upgrades in one user turn.',
    '- Do not mix request_context_upgrade with business tool calls in the same assistant turn.',
  ].join('\n')
}

async function getP0UapisSummary() {
  return formatUapisDirectorySummary({
    maxCategories: 8,
    maxApisPerCategory: 4,
  }).catch(() =>
    [
      'UAPIs directory summary:',
      '- unavailable: failed to load local UAPIs catalog',
      '- workflow after mounting search-pack: uapis_list_apis -> uapis_read_api -> uapis_call',
    ].join('\n'),
  )
}

function renderMountedPacks(mountedPacks: readonly AgentPackName[]) {
  if (mountedPacks.length === 0) return 'Mounted packs:\n- none'
  return ['Mounted packs:', ...mountedPacks.map((pack) => `- ${pack}`)].join('\n')
}

export async function buildP0Messages(input: {
  history: LLMConversationMessage[]
  checkpoint: AgentCheckpoint
  userPrompt: string
  mountedPacks?: readonly AgentPackName[]
  extraSections?: string[]
}) {
  const [coreRuleFiles, projectProfile, uapisSummary] = await Promise.all([
    getCoreRuleFiles(),
    getProjectProfileSummary(),
    getP0UapisSummary(),
  ])
  const checkpointSummary = summarizeCheckpointForInjection(input.checkpoint)
  const coreRules = [coreRuleFiles.core, coreRuleFiles.local].filter(Boolean).join('\n\n').trim()
  const mountedPacks = renderMountedPacks(input.mountedPacks ?? [])
  const extraSections = input.extraSections ?? []
  const routingPrompt = getRoutingPrompt()
  const contextUpgradeTool = getContextUpgradeToolDefinition()
  const messages: LLMConversationMessage[] = [
    {
      role: 'system',
      content: [
        coreRules,
        projectProfile,
        checkpointSummary.text,
        mountedPacks,
        uapisSummary,
        ...extraSections,
        routingPrompt,
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ]

  if (input.userPrompt.trim()) {
    messages.push({
      role: 'user',
      content: `以下是用户的长期偏好，请持续遵守但不要复述：\n${input.userPrompt.trim()}`,
    })
  }

  messages.push(...input.history)

  const budgetReport = buildTokenBudgetReport({
    key: 'p0',
    label: 'P0 static prompt budget',
    limitTokens: P0_TOTAL_TOKEN_BUDGET,
    components: [
      textBudgetComponent({
        key: 'core-rules',
        label: '1052.md core rules',
        text: coreRuleFiles.core,
        limitTokens: 800,
      }),
      textBudgetComponent({
        key: 'local-rules',
        label: '1052.local.md local rules',
        text: coreRuleFiles.local,
        limitTokens: 200,
      }),
      textBudgetComponent({
        key: 'project-profile',
        label: 'Project profile summary',
        text: projectProfile,
        limitTokens: 500,
      }),
      textBudgetComponent({
        key: 'checkpoint',
        label: 'Checkpoint injection summary',
        text: checkpointSummary.text,
        limitTokens: 800,
      }),
      textBudgetComponent({
        key: 'mounted-packs',
        label: 'Mounted packs summary',
        text: mountedPacks,
      }),
      textBudgetComponent({
        key: 'user-prompt',
        label: 'User preference prompt',
        text: input.userPrompt,
        limitTokens: 200,
      }),
      textBudgetComponent({
        key: 'uapis-directory',
        label: 'UAPIs P0 directory',
        text: uapisSummary,
        limitTokens: P0_UAPIS_DIRECTORY_TOKEN_BUDGET,
      }),
      ...extraSections.map((section, index) =>
        textBudgetComponent({
          key: `extra-section-${index + 1}`,
          label: `Extra runtime section ${index + 1}`,
          text: section,
        }),
      ),
      textBudgetComponent({
        key: 'routing-prompt',
        label: 'Capability routing prompt',
        text: routingPrompt,
        limitTokens: 400,
      }),
      toolSchemaBudgetComponent({
        key: 'context-upgrade-tool',
        label: 'request_context_upgrade schema',
        toolDefinitions: [contextUpgradeTool],
        limitTokens: CONTEXT_UPGRADE_TOOL_SCHEMA_TOKEN_BUDGET,
      }),
    ],
  })

  return { messages, injectedCheckpointTokens: checkpointSummary.injectedTokens, budgetReport }
}
