export type NotesConfig = {
  rootPath: string
}

export type PublicNotesConfig = NotesConfig & {
  configured: boolean
  exists: boolean
  defaultRootPath: string
}

export type NotesConfigInput = {
  rootPath?: unknown
}

export type NoteTreeNode = {
  name: string
  relativePath: string
  type: 'file' | 'dir'
  size: number
  updatedAt: number
  children?: NoteTreeNode[]
}

export type NoteFile = {
  path: string
  name: string
  content: string
  size: number
  updatedAt: number
}

export type NoteFileInput = {
  path?: unknown
  name?: unknown
  content?: unknown
}

export type NoteFolderInput = {
  path?: unknown
  name?: unknown
}

export type NoteMoveInput = {
  path?: unknown
  targetDir?: unknown
}
