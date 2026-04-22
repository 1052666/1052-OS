import { api } from './client'

export type RepositoryConfig = {
  rootPath: string
  manualPaths: string[]
  configured: boolean
  exists: boolean
  manualCount: number
}

export type RepositorySummary = {
  id: string
  name: string
  path: string
  relativePath: string
  description: string
  descriptionContent: string
  descriptionFileName: string
  hasDescriptionFile: boolean
  isGit: boolean
  branch: string
  status: 'clean' | 'dirty' | 'unknown'
  changes: number
  language: string
  languageColor: string
  updatedAt: number
  source: 'root' | 'manual'
}

export type RepositoryReadme = {
  fileName: string
  content: string
}

export type RepositoryTreeNode = {
  name: string
  relativePath: string
  type: 'file' | 'dir'
  size: number
  updatedAt: number
  children?: RepositoryTreeNode[]
}

export type RepositoryDetail = {
  repository: RepositorySummary
  readme: RepositoryReadme | null
  tree: RepositoryTreeNode[]
}

export type RepositoryFileContent = {
  path: string
  name: string
  content: string
  size: number
  truncated: boolean
  language: string
  mime: string
  previewType: 'text' | 'markdown' | 'json' | 'image' | 'binary'
}

export const RepositoryApi = {
  getConfig: () => api.get<RepositoryConfig>('/repository/config'),
  updateConfig: (rootPath: string) =>
    api.put<RepositoryConfig>('/repository/config', { rootPath }),
  listRepositories: () => api.get<RepositorySummary[]>('/repository/repos'),
  getRepositoryDetail: (id: string) =>
    api.get<RepositoryDetail>('/repository/repos/' + id),
  updateRepositoryDescription: (id: string, content: string) =>
    api.put<RepositoryDetail>('/repository/repos/' + id + '/description', {
      content,
    }),
  getFileContent: (id: string, path: string) =>
    api.get<RepositoryFileContent>(
      '/repository/repos/' + id + '/file?path=' + encodeURIComponent(path),
    ),
  rawFileUrl: (id: string, path: string) =>
    '/api/repository/repos/' + id + '/raw?path=' + encodeURIComponent(path),
  archiveUrl: (id: string) => '/api/repository/repos/' + id + '/archive',
  addRepository: (path: string) =>
    api.post<RepositorySummary>('/repository/repos', { path }),
  removeRepository: (id: string) =>
    api.delete<RepositoryConfig>('/repository/repos/' + id),
}
