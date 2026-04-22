import { api } from './client'

export type NotesConfig = {
  rootPath: string
  configured: boolean
  exists: boolean
  defaultRootPath: string
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

export const NotesApi = {
  getConfig: () => api.get<NotesConfig>('/notes/config'),
  updateConfig: (rootPath: string) =>
    api.put<NotesConfig>('/notes/config', { rootPath }),
  useDefaultConfig: () => api.post<NotesConfig>('/notes/config/default', {}),
  getTree: (query = '') =>
    api.get<NoteTreeNode[]>(
      '/notes/tree' + (query ? '?query=' + encodeURIComponent(query) : ''),
    ),
  getFile: (path: string) =>
    api.get<NoteFile>('/notes/file?path=' + encodeURIComponent(path)),
  createFile: (path: string, name: string, content = '') =>
    api.post<NoteFile>('/notes/file', { path, name, content }),
  updateFile: (path: string, content: string) =>
    api.put<NoteFile>('/notes/file', { path, content }),
  deleteFile: (path: string) =>
    api.delete<{ ok: true }>('/notes/file?path=' + encodeURIComponent(path)),
  createFolder: (path: string, name: string) =>
    api.post<{ ok: true }>('/notes/folder', { path, name }),
  deleteFolder: (path: string) =>
    api.delete<{ ok: true }>('/notes/folder?path=' + encodeURIComponent(path)),
  moveEntry: (path: string, targetDir: string) =>
    api.put<{ ok: true }>('/notes/move', { path, targetDir }),
}
