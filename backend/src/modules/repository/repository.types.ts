export type RepositoryConfig = {
  rootPath: string
  manualPaths: string[]
}

export type PublicRepositoryConfig = RepositoryConfig & {
  configured: boolean
  exists: boolean
  manualCount: number
}

export type RepositoryConfigInput = {
  rootPath?: unknown
}

export type RepositoryPathInput = {
  path?: unknown
}

export type RepositoryDescriptionInput = {
  content?: unknown
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

export type RepositoryArchive = {
  filePath: string
  fileName: string
}

export type RepositoryFileResource = {
  filePath: string
  fileName: string
  mime: string
}
