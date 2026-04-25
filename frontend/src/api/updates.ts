import { api } from './client'

export type UpdateInstallMode = 'git' | 'archive'

export type UpdateRunStatus = 'queued' | 'running' | 'success' | 'failed'

export type UpdatePhase =
  | 'queued'
  | 'preflight'
  | 'fetch'
  | 'backup'
  | 'apply'
  | 'dependencies'
  | 'build'
  | 'restart'
  | 'complete'
  | 'failed'

export type UpdateCommitInfo = {
  commit: string
  shortCommit: string
  date: string
  message: string
  url: string
}

export type UpdateStatus = {
  workspaceRoot: string
  dataDir: string
  mode: UpdateInstallMode
  current: {
    commit: string
    shortCommit: string
    branch: string
    source: 'git' | 'state' | 'unknown'
  }
  latest: UpdateCommitInfo | null
  updateAvailable: boolean
  canInstall: boolean
  dirty: boolean
  dirtyFiles: string[]
  warnings: string[]
  lastCheckedAt: string
}

export type UpdateRun = {
  id: string
  status: UpdateRunStatus
  phase: UpdatePhase
  phaseLabel: string
  progress: number
  message: string
  logPath: string
  logTail: string
  startedAt: string
  finishedAt: string | null
  error: string | null
  statusSnapshot: UpdateStatus | null
}

export type UpdateRestartResponse = {
  scheduled: boolean
  message: string
  scriptPath: string
}

export const UpdatesApi = {
  status: () => api.get<UpdateStatus>('/updates/status'),
  check: () => api.post<UpdateStatus>('/updates/check', {}),
  install: () => api.post<{ run: UpdateRun }>('/updates/install', {}),
  run: (id: string) => api.get<UpdateRun>(`/updates/runs/${encodeURIComponent(id)}`),
  restart: () => api.post<UpdateRestartResponse>('/updates/restart', {}),
}
