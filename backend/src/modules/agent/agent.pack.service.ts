import type { AgentPackName } from './agent.runtime.types.js'

const BASE_READ_PACK_TOOL_NAMES = [
  'agent_runtime_status',
  'filesystem_stat_path',
  'filesystem_list_directory',
  'filesystem_search_files',
  'filesystem_search_content',
  'filesystem_read_file',
] as const

const PACK_TOOL_NAMES: Record<Exclude<AgentPackName, 'base-read-pack'>, readonly string[]> = {
  'repo-pack': [
    'repository_list_repos',
    'repository_read_repo',
    'repository_read_file',
    'terminal_status',
    'terminal_set_cwd',
    'terminal_run_readonly',
    'terminal_run',
    'terminal_interrupt',
  ],
  'search-pack': [
    'websearch_list_engines',
    'websearch_search',
    'websearch_read_page',
    'uapis_list_apis',
    'uapis_read_api',
    'uapis_call',
  ],
  'memory-pack': [
    'memory_list',
    'memory_read',
    'memory_summary',
    'memory_runtime_preview',
    'memory_create',
    'memory_update',
    'memory_delete',
    'memory_suggestions_list',
    'memory_suggest',
    'memory_confirm_suggestion',
    'memory_reject_suggestion',
    'memory_secure_list',
    'memory_secure_read',
    'memory_secure_write',
    'memory_secure_update',
    'memory_secure_delete',
    'output_profile_summary',
    'output_profile_list',
    'output_profile_read',
    'output_profile_runtime_preview',
    'output_profile_create',
    'output_profile_update',
    'output_profile_delete',
  ],
  'skill-pack': [
    'skills_list',
    'skills_read',
    'skills_marketplace_search',
    'skills_marketplace_inspect',
  ],
  'plan-pack': [
    'calendar_list_events',
    'schedule_list_tasks',
    'schedule_list_runs',
  ],
  'data-pack': [
    'notes_list_notes',
    'notes_read_note',
    'resources_list',
    'resources_read',
    'sql_datasource_list',
    'sql_file_list',
    'wiki_summary',
    'wiki_raw_list',
    'wiki_raw_read',
    'wiki_page_search',
    'wiki_page_read',
    'wiki_lint_preview',
    'wiki_ingest_preview',
    'wiki_raw_upload_from_agent_workspace',
    'wiki_page_write',
    'wiki_page_append_section',
    'wiki_ingest_commit',
    'wiki_query_writeback',
    'wiki_lint_fix',
    'wiki_index_rebuild',
    'wiki_log_append',
  ],
  'channel-pack': [
    'intel_brief_format',
    'feishu_list_calendars',
    'feishu_list_calendar_events',
    'feishu_list_tasks',
  ],
}

export const REQUESTABLE_PACKS = Object.keys(PACK_TOOL_NAMES) as Exclude<
  AgentPackName,
  'base-read-pack'
>[]

export function isAgentPackName(value: unknown): value is AgentPackName {
  return value === 'base-read-pack' || REQUESTABLE_PACKS.includes(value as never)
}

export function normalizeRequestedPacks(value: unknown): Exclude<AgentPackName, 'base-read-pack'>[] {
  if (!Array.isArray(value)) return []
  const deduped = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item): item is Exclude<AgentPackName, 'base-read-pack'> =>
      REQUESTABLE_PACKS.includes(item as never),
    )
  return [...new Set(deduped)]
}

export function expandMountedPacks(
  requested: readonly Exclude<AgentPackName, 'base-read-pack'>[],
): AgentPackName[] {
  if (requested.length === 0) return []
  return ['base-read-pack', ...requested]
}

export function getToolNamesForPack(pack: AgentPackName): string[] {
  if (pack === 'base-read-pack') return [...BASE_READ_PACK_TOOL_NAMES]
  return [...(PACK_TOOL_NAMES[pack] ?? [])]
}

export function getToolNamesForMountedPacks(packs: readonly AgentPackName[]): string[] {
  const result: string[] = []
  for (const pack of packs) {
    for (const toolName of getToolNamesForPack(pack)) {
      if (!result.includes(toolName)) result.push(toolName)
    }
  }
  return result
}

export function describePackForRouting(pack: Exclude<AgentPackName, 'base-read-pack'>) {
  switch (pack) {
    case 'repo-pack':
      return '本地仓库、项目文件读取、终端检查和本地执行。适合读代码、看目录、查 git diff/log/status，也适合在权限允许时创建/修改文件、运行脚本、执行构建或测试。'
    case 'search-pack':
      return '联网搜索、网页阅读、UAPIs 工具箱。使用 UAPIs 时必须按 uapis_list_apis -> uapis_read_api -> uapis_call 三步走。'
    case 'memory-pack':
      return '长期记忆、敏感长期记忆和输出配方的读取、建议、写入、更新与删除。普通写入需用户明确要求记住或确认；敏感信息用 secure memory；输出配方用于组合认知模型、写作风格和素材范围。'
    case 'skill-pack':
      return 'Skill 查询、读取和 Marketplace 检索。'
    case 'plan-pack':
      return '日程、定时任务、计划类工具。'
    case 'data-pack':
      return '笔记、资源列表、SQL 数据源、Wiki raw 原始资料、结构化知识页、综合分析、Wiki lint 健康检查和知识沉淀工具。Wiki 写入、索引、日志和 lint 修复默认需要用户确认。'
    case 'channel-pack':
      return '微信、飞书等外部通道能力、Intel Brief 通道格式渲染和飞书工作区工具。'
  }
}
