import {
  getRepositoryDetail,
  getRepositoryFileContent,
  listRepositories,
} from '../../repository/repository.service.js'
import type { RepositorySummary } from '../../repository/repository.types.js'
import { HttpError } from '../../../http-error.js'
import type { AgentTool } from '../agent.tool.types.js'

function buildRepositoryLink(id: string) {
  return `/repository/${encodeURIComponent(id)}`
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function matchesRepository(repo: RepositorySummary, query: string) {
  if (!query) return false

  return [
    repo.id,
    repo.name,
    repo.relativePath,
    repo.path,
    repo.description,
  ]
    .join('\n')
    .toLowerCase()
    .includes(query)
}

async function findRepositoryBySelector(selector: unknown) {
  const query = normalizeText(selector)
  if (!query) throw new HttpError(400, '仓库标识不能为空')

  const repos = await listRepositories()
  const exact =
    repos.find((repo) => repo.id === selector) ??
    repos.find((repo) => repo.name.toLowerCase() === query) ??
    repos.find((repo) => repo.relativePath.toLowerCase() === query) ??
    repos.find((repo) => repo.path.toLowerCase() === query)

  if (exact) return exact

  const matched = repos.filter((repo) => matchesRepository(repo, query))
  if (matched.length === 0) {
    throw new HttpError(404, '未找到匹配的仓库')
  }
  if (matched.length > 1) {
    throw new HttpError(
      400,
      `匹配到多个仓库，请更具体一些：${matched
        .slice(0, 5)
        .map((repo) => repo.name)
        .join('、')}`,
    )
  }

  return matched[0]
}

export const repositoryTools: AgentTool[] = [
  {
    name: 'repository_list_repos',
    description:
      '列出当前工作区中可访问的仓库项目。适用于回答“有哪些项目”“有哪些仓库”“帮我看看仓库列表”这类问题。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '可选的关键词，用于按名称、路径、简介过滤仓库',
        },
        limit: {
          type: 'number',
          description: '最多返回多少个仓库，1 到 20，可选',
        },
      },
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      const query = normalizeText(input.query)
      const rawLimit =
        typeof input.limit === 'number' && Number.isFinite(input.limit)
          ? Math.floor(input.limit)
          : 10
      const limit = Math.min(Math.max(rawLimit, 1), 20)
      const repos = await listRepositories()
      const filtered = query
        ? repos.filter((repo) => matchesRepository(repo, query))
        : repos

      return {
        count: filtered.length,
        repositories: filtered.slice(0, limit).map((repo) => ({
          id: repo.id,
          name: repo.name,
          relativePath: repo.relativePath,
          description: repo.description,
          language: repo.language,
          branch: repo.branch,
          status: repo.status,
          changes: repo.changes,
          link: buildRepositoryLink(repo.id),
        })),
      }
    },
  },
  {
    name: 'repository_read_repo',
    description:
      '读取指定仓库的详情，包括简介、README 和仓库快速链接。适用于回答“看看这个项目是做什么的”“读一下这个仓库的 README”。',
    parameters: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: '仓库 id、仓库名、相对路径或完整路径',
        },
      },
      required: ['repo'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      const repo = await findRepositoryBySelector(input.repo)
      const detail = await getRepositoryDetail(repo.id)

      return {
        repository: {
          id: repo.id,
          name: repo.name,
          relativePath: repo.relativePath,
          description: repo.description,
          language: repo.language,
          branch: repo.branch,
          status: repo.status,
          changes: repo.changes,
          link: buildRepositoryLink(repo.id),
        },
        readme: detail.readme,
        treeSummary: detail.tree.slice(0, 40).map((node) => ({
          name: node.name,
          relativePath: node.relativePath,
          type: node.type,
        })),
      }
    },
  },
  {
    name: 'repository_read_file',
    description:
      '读取指定仓库中的某个文本文件。适用于继续阅读 README 之外的源码、配置或文档文件。',
    parameters: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: '仓库 id、仓库名、相对路径或完整路径',
        },
        path: {
          type: 'string',
          description: '仓库内相对路径，例如 package.json、src/main.tsx、docs/intro.md',
        },
      },
      required: ['repo', 'path'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      const repo = await findRepositoryBySelector(input.repo)
      const file = await getRepositoryFileContent(repo.id, input.path)

      return {
        repository: {
          id: repo.id,
          name: repo.name,
          link: buildRepositoryLink(repo.id),
        },
        file,
      }
    },
  },
]
