import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { REQUEST_CONTEXT_UPGRADE_TOOL } from './agent.upgrade.service.js'
import {
  describePackForRouting,
  REQUESTABLE_PACKS,
} from './agent.pack.service.js'
import {
  buildTokenBudgetReport,
  CONTEXT_UPGRADE_TOOL_SCHEMA_TOKEN_BUDGET,
  P0_TOTAL_TOKEN_BUDGET,
  P0_UAPIS_DIRECTORY_TOKEN_BUDGET,
  textBudgetComponent,
  toolSchemaBudgetComponent,
} from './agent.budget.service.js'
import { summarizeCheckpointForInjection } from './agent.checkpoint.service.js'
import { formatUapisDirectorySummary } from '../uapis/uapis.service.js'
import type { AgentCheckpoint, AgentPackName } from './agent.runtime.types.js'
import type { LLMConversationMessage, LLMToolDefinition } from './llm.client.js'

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
    '- If the user asks to generate, draw, design, render, create an image, illustration, poster, logo concept, cover, visual, wallpaper, avatar, or similar visual output, request image-pack and use image_generate. This route has priority over search-pack and UAPIs for image creation.',
    '- Do not search the web for image generation APIs, tools, model docs, stock images, or prompt examples when the user simply wants 1052 OS to create an image. Search only if the user explicitly asks for research/reference material, existing images, or current facts.',
    '- If you need local code, local files, repository inspection, file creation/modification, script execution, build/test commands, or terminal execution, request repo-pack.',
    '- terminal_run_readonly is only for allow-listed read-only inspection. Use terminal_run for scripts, file writes, builds, tests, and other commands that can modify local state when permission allows.',
    '- For news, current affairs, morning briefs, market moves, global intelligence, geopolitics, finance, tech-sector intelligence, or cross-sector causal analysis, first consider the installed intel-center Skill: request skill-pack, read intel-center, use intel_center_collect to collect raw intelligence, then analyze it following the Skill workflow.',
    '- intel_brief_format in channel-pack formats an already structured Intel Brief for Markdown, Feishu card, WeChat text, or WeCom markdown. It does not collect intelligence and does not send messages.',
    '- If you need web search, page reading, or UAPIs lookup/call, request search-pack.',
    '- If you need to read, create, update, delete, suggest, confirm, or reject long-term memories or output profiles, request memory-pack.',
    '- If the user explicitly asks to switch LLM profiles or configure task-level model routing, request settings-pack and wait for confirmation before changing settings unless full-access is enabled.',
    '- If the user asks to enable, disable, or change morning brief time, request settings-pack and use agent_morning_brief_update after confirmation unless full-access is enabled.',
    '- If you need to read or maintain Wiki, ingest raw files, search structured knowledge pages, write synthesis, or lint Wiki health, request data-pack.',
    '- Wiki is not long-term memory: Wiki stores knowledge assets and source-backed synthesis; memory-pack stores durable user preferences, constraints, identity, and habits.',
    '- Output profiles are not raw knowledge storage: they are composition recipes that combine approved cognitive models, preferred writing style, and material scopes for a response.',
    '- If an output profile references Wiki/raw/material sources and the task needs the actual source content, request data-pack and read the referenced material instead of inventing it.',
    '- For Wiki ingestion, read raw, summarize 3-5 key points and page split suggestions, then wait for confirmation before write tools unless full-access is enabled.',
    '- For valuable answers that should be preserved, ask whether to write them into 综合分析/ before wiki_query_writeback unless full-access is enabled.',
    '- For Wiki lint, preview first; automatic fixes, index rebuilds, and log appends are write operations that require confirmation unless full-access is enabled.',
    '- When the user explicitly says to remember something, memory-pack provides memory_create; set confirmed=true because the request itself is the confirmation.',
    '- When you infer a durable preference, recurring workflow rule, project convention, or output preference, proactively request memory-pack if needed and create a memory_suggest after the immediate task is handled. Do not wait for the user to say "remember" every time.',
    '- Use secure-memory tools in memory-pack for API keys, tokens, passwords, private config, and other sensitive values.',
    '- UAPIs is available only after search-pack is mounted; then call uapis_list_apis, uapis_read_api, and uapis_call in order.',
    '- If a tool call fails, read the diagnostic, adjust parameters/tool/permission, and retry when the user intent still requires action. Do not treat a prior request failure as a permanent refusal.',
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
  const coreRules = [coreRuleFiles.core, coreRuleFiles.local].filter(Boolean).join('\n\n')
  const checkpointSummary = summarizeCheckpointForInjection(input.checkpoint)
  const mountedPacksSummary = renderMountedPacks(input.mountedPacks ?? [])
  const extraSections = input.extraSections ?? []
  const routingPrompt = getRoutingPrompt()
  const systemContent = [
    coreRules,
    projectProfile,
    checkpointSummary.text,
    mountedPacksSummary,
    uapisSummary,
    ...extraSections,
    routingPrompt,
  ]
    .filter(Boolean)
    .join('\n\n')
  const messages: LLMConversationMessage[] = [
    {
      role: 'system',
      content: systemContent,
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
    key: 'p0-prompt',
    label: 'P0 prompt',
    limitTokens: P0_TOTAL_TOKEN_BUDGET,
    components: [
      textBudgetComponent({ key: 'core-rules', label: 'Core rules', text: coreRules }),
      textBudgetComponent({ key: 'project-profile', label: 'Project profile', text: projectProfile }),
      {
        key: 'checkpoint',
        label: 'Checkpoint summary',
        tokens: checkpointSummary.injectedTokens,
      },
      textBudgetComponent({ key: 'mounted-packs', label: 'Mounted packs', text: mountedPacksSummary }),
      textBudgetComponent({
        key: 'uapis-directory',
        label: 'UAPIs directory summary',
        text: uapisSummary,
        limitTokens: P0_UAPIS_DIRECTORY_TOKEN_BUDGET,
      }),
      ...extraSections.map((section, index) =>
        textBudgetComponent({
          key: `extra-section-${index + 1}`,
          label: `Extra section ${index + 1}`,
          text: section,
        }),
      ),
      textBudgetComponent({ key: 'routing', label: 'Capability routing', text: routingPrompt }),
      toolSchemaBudgetComponent({
        key: 'context-upgrade-tool',
        label: 'Context upgrade tool schema',
        toolDefinitions: [getContextUpgradeToolDefinition()],
        limitTokens: CONTEXT_UPGRADE_TOOL_SCHEMA_TOKEN_BUDGET,
      }),
    ],
  })
  return { messages, injectedCheckpointTokens: checkpointSummary.injectedTokens, budgetReport }
}
