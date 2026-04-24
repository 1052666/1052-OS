import { HttpError } from '../../../http-error.js'
import {
  appendWikiLog,
  appendWikiPageSection,
  buildWikiIngestPreview,
  commitWikiIngest,
  copyAgentWorkspaceFileToRaw,
  fixWikiLint,
  getWikiSummary,
  listWikiPages,
  listWikiRawFiles,
  readWikiPage,
  readWikiRawFile,
  rebuildWikiIndex,
  writeWikiPage,
  writeWikiQueryBack,
} from '../../wiki/wiki.service.js'
import { lintWiki } from '../../wiki/wiki.lint.js'
import type { AgentTool } from '../agent.tool.types.js'

function assertConfirmed(value: unknown, action: string) {
  if (value !== true) {
    throw new HttpError(400, `${action} 属于 Wiki 写入操作，默认权限下必须先说明影响并等待用户确认。`)
  }
}

function normalizeLimit(value: unknown, fallback = 60) {
  const raw = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
  return Math.min(Math.max(raw, 1), 200)
}

export const wikiTools: AgentTool[] = [
  {
    name: 'wiki_summary',
    description:
      'Read local Wiki summary counts and health numbers. Read-only. Use after data-pack is mounted.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => getWikiSummary(),
  },
  {
    name: 'wiki_raw_list',
    description:
      'List files in data/wiki/raw. Read-only. Raw is the immutable source area for Wiki ingestion.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => listWikiRawFiles(),
  },
  {
    name: 'wiki_raw_read',
    description:
      'Read a text raw source file under data/wiki/raw by relative path. Read-only; returns truncated content.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Raw relative path, for example source.md.' },
        maxChars: { type: 'number', description: 'Maximum characters. Default 24000.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return readWikiRawFile(input.path, normalizeLimit(input.maxChars, 24000))
    },
  },
  {
    name: 'wiki_page_search',
    description:
      'Search structured Wiki pages by title, path, tags, summary, source, or body. Read-only.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional keyword.' },
        limit: { type: 'number', description: 'Maximum pages. Default 60, max 200.' },
      },
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      const pages = await listWikiPages(input.query)
      return pages.slice(0, normalizeLimit(input.limit)).map((page) => ({
        path: page.path,
        title: page.title,
        category: page.category,
        summary: page.summary,
        tags: page.tags,
        sources: page.sources,
        links: page.links,
        backlinks: page.backlinks,
        lastUpdated: page.lastUpdated,
      }))
    },
  },
  {
    name: 'wiki_page_read',
    description:
      'Read one structured Wiki page by relative path. Read-only. Wiki stores knowledge assets, not user preferences.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Wiki page relative path, for example 核心理念/1052-PD.md.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return readWikiPage(input.path)
    },
  },
  {
    name: 'wiki_lint_preview',
    description:
      'Preview Wiki health issues: broken links, orphan pages, missing frontmatter, missing sources, and index gaps. Read-only.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => lintWiki(),
  },
  {
    name: 'wiki_raw_upload_from_agent_workspace',
    description:
      'Copy a file from data/agent-workspace into data/wiki/raw. Write operation; requires confirmation unless full-access is enabled.',
    parameters: {
      type: 'object',
      properties: {
        sourcePath: { type: 'string', description: 'Path relative to data/agent-workspace.' },
        targetPath: { type: 'string', description: 'Optional target raw relative path.' },
        overwrite: { type: 'boolean', description: 'Overwrite an existing raw file.' },
        confirmed: { type: 'boolean', description: 'Must be true after user confirmation.' },
      },
      required: ['sourcePath', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed, '上传 raw')
      return copyAgentWorkspaceFileToRaw({
        sourcePath: input.sourcePath,
        targetPath: input.targetPath,
        overwrite: input.overwrite === true,
      })
    },
  },
  {
    name: 'wiki_page_write',
    description:
      'Create or replace a structured Wiki page. Must maintain frontmatter, index, and operation log. Requires confirmation unless full-access is enabled.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Optional page path. If omitted, category/title decide it.' },
        title: { type: 'string' },
        category: { type: 'string', enum: ['entity', 'concept', 'synthesis'] },
        tags: { type: 'array', items: { type: 'string' } },
        sources: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
        content: { type: 'string', description: 'Markdown body, with heading and sections.' },
        confirmed: { type: 'boolean' },
      },
      required: ['content', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed, '写入 Wiki 页面')
      return writeWikiPage(input)
    },
  },
  {
    name: 'wiki_page_append_section',
    description:
      'Append a section to a Wiki page and update index/log. Requires confirmation unless full-access is enabled.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        heading: { type: 'string' },
        content: { type: 'string' },
        confirmed: { type: 'boolean' },
      },
      required: ['path', 'content', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed, '追加 Wiki 页面')
      return appendWikiPageSection({
        path: input.path,
        heading: input.heading,
        content: input.content,
      })
    },
  },
  {
    name: 'wiki_ingest_commit',
    description:
      'Commit an approved raw ingestion into Wiki pages, then rebuild index and append log. Requires confirmation unless full-access is enabled.',
    parameters: {
      type: 'object',
      properties: {
        rawPaths: { type: 'array', items: { type: 'string' } },
        pages: { type: 'array', items: { type: 'object' } },
        confirmed: { type: 'boolean' },
      },
      required: ['pages', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed, '提交 Wiki 摄取')
      return commitWikiIngest(input)
    },
  },
  {
    name: 'wiki_query_writeback',
    description:
      'Write a valuable answer or synthesis into 综合分析/. Requires confirmation unless full-access is enabled.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
        sources: { type: 'array', items: { type: 'string' } },
        tags: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
        confirmed: { type: 'boolean' },
      },
      required: ['content', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed, '回写综合分析')
      return writeWikiQueryBack(input)
    },
  },
  {
    name: 'wiki_lint_fix',
    description:
      'Apply small automatic Wiki lint fixes, currently index rebuild. Requires confirmation unless full-access is enabled.',
    parameters: {
      type: 'object',
      properties: { confirmed: { type: 'boolean' } },
      required: ['confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed, '修复 Wiki lint 问题')
      return fixWikiLint()
    },
  },
  {
    name: 'wiki_index_rebuild',
    description:
      'Rebuild data/wiki/wiki/索引.md generated area. Requires confirmation unless full-access is enabled.',
    parameters: {
      type: 'object',
      properties: { confirmed: { type: 'boolean' } },
      required: ['confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed, '重建 Wiki 索引')
      return rebuildWikiIndex()
    },
  },
  {
    name: 'wiki_log_append',
    description:
      'Append an audit entry to data/wiki/wiki/操作日志.md. Requires confirmation unless full-access is enabled.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['ingest', 'query-writeback', 'lint', 'manual-update', 'index-rebuild', 'raw-upload'],
        },
        summary: { type: 'string' },
        targets: { type: 'array', items: { type: 'string' } },
        confirmed: { type: 'boolean' },
      },
      required: ['type', 'summary', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed, '追加 Wiki 操作日志')
      return appendWikiLog({
        type: input.type as never,
        summary: String(input.summary ?? ''),
        targets: Array.isArray(input.targets) ? input.targets.map(String) : undefined,
      })
    },
  },
  {
    name: 'wiki_ingest_preview',
    description:
      'Preview raw ingestion input and workflow. Read-only. Before committing, summarize 3-5 key points and wait for user confirmation.',
    parameters: {
      type: 'object',
      properties: {
        rawPaths: { type: 'array', items: { type: 'string' } },
        maxChars: { type: 'number' },
      },
      required: ['rawPaths'],
      additionalProperties: false,
    },
    execute: async (args) => buildWikiIngestPreview((args ?? {}) as Record<string, unknown>),
  },
]
