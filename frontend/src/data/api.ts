import { z } from 'zod'
import {
  appearanceReviewReportSchema,
  appearanceThemeProfileSchema,
  calendarEventSchema,
  chatHistorySchema,
  dataSourceSchema,
  healthStatusSchema,
  looseObjectSchema,
  memorySchema,
  memorySummarySchema,
  noteFileSchema,
  noteTreeSchema,
  notificationSchema,
  orchestrationSchema,
  outputProfileSchema,
  pkmSearchSchema,
  pkmSummarySchema,
  publicAppearanceThemesSchema,
  researchAssessmentSchema,
  researchClaimReviewSchema,
  researchClaimSchema,
  researchEvidenceSchema,
  researchResultSchema,
  researchSessionSchema,
  researchSnapshotSchema,
  researchStateSchema,
  repositoryDetailSchema,
  repositorySchema,
  resourceSchema,
  scheduledTaskSchema,
  searchSourcesSchema,
  serverSchema,
  settingsSchema,
  shellFileSchema,
  skillSchema,
  sqlFileSchema,
  sqlVariableSchema,
  storedMessageSchema,
  uapiCatalogSchema,
  uapiItemSchema,
  updateStatusSchema,
  wikiPageSchema,
  type StoredMessage,
} from '../contracts/schemas'
import { queryString, request, upload } from './client'

const okSchema = z.object({ ok: z.boolean() }).passthrough()
const unknownArray = z.array(looseObjectSchema)

export const healthApi = {
  status: () => request('/health', { schema: healthStatusSchema }),
}

export const agentApi = {
  history: (signal?: AbortSignal) => request('/agent/history', { schema: chatHistorySchema, signal }),
  saveHistory: (messages: StoredMessage[], reason = 'sync') =>
    request('/agent/history', { method: 'PUT', body: { messages, reason }, schema: chatHistorySchema }),
  compact: (messages: StoredMessage[]) =>
    request('/agent/history/compact', {
      method: 'POST',
      body: { messages },
      schema: chatHistorySchema.extend({ backupPath: z.string(), originalCount: z.number() }),
    }),
  usage: () => request('/agent/stats/usage', { schema: looseObjectSchema }),
  resolveApproval: (approvalId: string, approved: boolean) =>
    request(`/agent/approvals/${encodeURIComponent(approvalId)}/resolve`, {
      method: 'POST',
      body: { approved },
      schema: okSchema.extend({ approvalId: z.string(), approved: z.boolean() }),
    }),
  uploadFiles: (files: File[], signal?: AbortSignal) => {
    const form = new FormData()
    files.forEach((file) => form.append('files', file))
    return upload(
      '/agent/uploads',
      form,
      z.object({ items: z.array(looseObjectSchema.extend({ markdown: z.string(), fileName: z.string() })) }),
      signal,
    )
  },
  previewMigration: (sourcePath: string) =>
    request('/agent/migrations/preview', { method: 'POST', body: { sourcePath }, schema: looseObjectSchema }),
  runMigration: (sourcePath: string, dryRun = false) =>
    request('/agent/migrations/run', { method: 'POST', body: { sourcePath, dryRun }, schema: looseObjectSchema }),
}

export const settingsApi = {
  get: () => request('/settings', { schema: settingsSchema }),
  update: (body: unknown) => request('/settings', { method: 'PUT', body, schema: settingsSchema }),
  discoverModels: () => request('/settings/llm/local-discovery', { schema: looseObjectSchema }),
  upsertProfile: (profile: unknown, activate = false) =>
    request('/settings/llm/profiles', { method: 'POST', body: { profile, activate }, schema: settingsSchema }),
  activateProfile: (id: string) =>
    request(`/settings/llm/profiles/${encodeURIComponent(id)}/activate`, { method: 'POST', body: {}, schema: settingsSchema }),
}

export const appearanceApi = {
  themes: () => request('/appearance/themes', { schema: publicAppearanceThemesSchema }),
  reviewTheme: (theme: unknown) =>
    request('/appearance/themes/review', { method: 'POST', body: { theme }, schema: appearanceReviewReportSchema }),
  createTheme: (theme: unknown) =>
    request('/appearance/themes', { method: 'POST', body: { theme }, schema: appearanceThemeProfileSchema }),
  applyTheme: (id: string, allowExperimental = false) =>
    request(`/appearance/themes/${encodeURIComponent(id)}/apply`, {
      method: 'POST',
      body: { confirmed: true, allowExperimental },
      schema: publicAppearanceThemesSchema,
    }),
  resetTheme: () =>
    request('/appearance/themes/reset', { method: 'POST', body: { confirmed: true }, schema: publicAppearanceThemesSchema }),
  deleteTheme: (id: string) =>
    request(`/appearance/themes/${encodeURIComponent(id)}`, { method: 'DELETE', schema: publicAppearanceThemesSchema }),
}

export const calendarApi = {
  events: () => request('/calendar/events', { schema: z.array(calendarEventSchema) }),
  createEvent: (body: unknown) => request('/calendar/events', { method: 'POST', body, schema: calendarEventSchema }),
  updateEvent: (id: string, body: unknown) =>
    request(`/calendar/events/${encodeURIComponent(id)}`, { method: 'PUT', body, schema: calendarEventSchema }),
  deleteEvent: (id: string) =>
    request(`/calendar/events/${encodeURIComponent(id)}`, { method: 'DELETE', schema: okSchema }),
  tasks: (enabled?: boolean) =>
    request(`/calendar/tasks${queryString({ enabled })}`, { schema: z.array(scheduledTaskSchema) }),
  createTask: (body: unknown) => request('/calendar/tasks', { method: 'POST', body, schema: scheduledTaskSchema }),
  updateTask: (id: string, body: unknown) =>
    request(`/calendar/tasks/${encodeURIComponent(id)}`, { method: 'PUT', body, schema: scheduledTaskSchema }),
  deleteTask: (id: string) =>
    request(`/calendar/tasks/${encodeURIComponent(id)}`, { method: 'DELETE', schema: okSchema }),
  runTask: (id: string) =>
    request(`/calendar/tasks/${encodeURIComponent(id)}/run`, { method: 'POST', body: {}, schema: looseObjectSchema }),
  pauseTask: (id: string) =>
    request(`/calendar/tasks/${encodeURIComponent(id)}/pause`, { method: 'POST', body: {}, schema: scheduledTaskSchema }),
  resumeTask: (id: string) =>
    request(`/calendar/tasks/${encodeURIComponent(id)}/resume`, { method: 'POST', body: {}, schema: scheduledTaskSchema }),
  runs: (taskId?: string) =>
    request(`/calendar/task-runs${queryString({ taskId })}`, { schema: unknownArray }),
}

export const notificationsApi = {
  list: () => request('/notifications', { schema: z.array(notificationSchema) }),
  unread: () => request('/notifications/unread-count', { schema: z.object({ unread: z.number() }) }),
  markRead: (id: string) =>
    request(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST', body: {}, schema: notificationSchema }),
  markAllRead: () =>
    request('/notifications/read-all', { method: 'POST', body: {}, schema: z.object({ updated: z.number() }) }),
  context: (id: string) => request(`/notifications/${encodeURIComponent(id)}/context`, { schema: looseObjectSchema }),
}

export const repositoryApi = {
  config: () => request('/repository/config', { schema: looseObjectSchema }),
  updateConfig: (rootPath: string) =>
    request('/repository/config', { method: 'PUT', body: { rootPath }, schema: looseObjectSchema }),
  list: () => request('/repository/repos', { schema: z.array(repositorySchema) }),
  detail: (id: string) => request(`/repository/repos/${encodeURIComponent(id)}`, { schema: repositoryDetailSchema }),
  file: (id: string, path: string) =>
    request(`/repository/repos/${encodeURIComponent(id)}/file${queryString({ path })}`, { schema: looseObjectSchema }),
  add: (path: string) => request('/repository/repos', { method: 'POST', body: { path }, schema: repositorySchema }),
  remove: (id: string) =>
    request(`/repository/repos/${encodeURIComponent(id)}`, { method: 'DELETE', schema: looseObjectSchema }),
  updateDescription: (id: string, content: string) =>
    request(`/repository/repos/${encodeURIComponent(id)}/description`, {
      method: 'PUT',
      body: { content },
      schema: repositoryDetailSchema,
    }),
}

export const notesApi = {
  config: () => request('/notes/config', { schema: looseObjectSchema }),
  useDefault: () => request('/notes/config/default', { method: 'POST', body: {}, schema: looseObjectSchema }),
  tree: (query = '') => request(`/notes/tree${queryString({ query })}`, { schema: z.array(noteTreeSchema) }),
  file: (path: string) => request(`/notes/file${queryString({ path })}`, { schema: noteFileSchema }),
  createFile: (path: string, name: string, content = '') =>
    request('/notes/file', { method: 'POST', body: { path, name, content }, schema: noteFileSchema }),
  updateFile: (path: string, content: string) =>
    request('/notes/file', { method: 'PUT', body: { path, content }, schema: noteFileSchema }),
  deleteFile: (path: string) => request(`/notes/file${queryString({ path })}`, { method: 'DELETE', schema: okSchema }),
  createFolder: (path: string, name: string) =>
    request('/notes/folder', { method: 'POST', body: { path, name }, schema: okSchema }),
}

export const sqlApi = {
  dataSources: () => request('/sql/datasources', { schema: z.array(dataSourceSchema) }),
  createDataSource: (body: unknown) => request('/sql/datasources', { method: 'POST', body, schema: dataSourceSchema }),
  updateDataSource: (id: string, body: unknown) =>
    request(`/sql/datasources/${encodeURIComponent(id)}`, { method: 'PUT', body, schema: dataSourceSchema }),
  deleteDataSource: (id: string) => request(`/sql/datasources/${encodeURIComponent(id)}`, { method: 'DELETE', schema: okSchema }),
  testDataSource: (id: string) =>
    request(`/sql/datasources/${encodeURIComponent(id)}/test`, { method: 'POST', body: {}, schema: okSchema }),
  files: () => request('/sql/files', { schema: z.array(sqlFileSchema) }),
  createFile: (body: unknown) => request('/sql/files', { method: 'POST', body, schema: sqlFileSchema }),
  updateFile: (id: string, body: unknown) =>
    request(`/sql/files/${encodeURIComponent(id)}`, { method: 'PUT', body, schema: sqlFileSchema }),
  deleteFile: (id: string) => request(`/sql/files/${encodeURIComponent(id)}`, { method: 'DELETE', schema: okSchema }),
  query: (datasourceId: string, sql: string, limit = 200) =>
    request('/sql/query', {
      method: 'POST',
      body: { datasourceId, sql, limit },
      schema: z.object({ columns: z.array(z.string()), rows: unknownArray, rowCount: z.number(), truncated: z.boolean() }).passthrough(),
    }),
  variables: () => request('/sql/variables', { schema: z.array(sqlVariableSchema) }),
  createVariable: (body: unknown) => request('/sql/variables', { method: 'POST', body, schema: sqlVariableSchema }),
  updateVariable: (id: string, body: unknown) =>
    request(`/sql/variables/${encodeURIComponent(id)}`, { method: 'PUT', body, schema: sqlVariableSchema }),
  deleteVariable: (id: string) => request(`/sql/variables/${encodeURIComponent(id)}`, { method: 'DELETE', schema: okSchema }),
  servers: () => request('/sql/servers', { schema: z.array(serverSchema) }),
  createServer: (body: unknown) => request('/sql/servers', { method: 'POST', body, schema: serverSchema }),
  updateServer: (id: string, body: unknown) =>
    request(`/sql/servers/${encodeURIComponent(id)}`, { method: 'PUT', body, schema: serverSchema }),
  deleteServer: (id: string) => request(`/sql/servers/${encodeURIComponent(id)}`, { method: 'DELETE', schema: okSchema }),
  testServer: (id: string) => request(`/sql/servers/${encodeURIComponent(id)}/test`, { method: 'POST', body: {}, schema: okSchema }),
  shellFiles: () => request('/sql/shell-files', { schema: z.array(shellFileSchema) }),
  createShellFile: (body: unknown) => request('/sql/shell-files', { method: 'POST', body, schema: shellFileSchema }),
  updateShellFile: (id: string, body: unknown) =>
    request(`/sql/shell-files/${encodeURIComponent(id)}`, { method: 'PUT', body, schema: shellFileSchema }),
  executeShellFile: (id: string) =>
    request(`/sql/shell-files/${encodeURIComponent(id)}/execute`, { method: 'POST', body: {}, schema: looseObjectSchema }),
  deleteShellFile: (id: string) => request(`/sql/shell-files/${encodeURIComponent(id)}`, { method: 'DELETE', schema: okSchema }),
}

export const orchestrationApi = {
  list: () => request('/orchestration', { schema: z.array(orchestrationSchema) }),
  create: (body: unknown) => request('/orchestration', { method: 'POST', body, schema: orchestrationSchema }),
  update: (id: string, body: unknown) =>
    request(`/orchestration/${encodeURIComponent(id)}`, { method: 'PUT', body, schema: orchestrationSchema }),
  remove: (id: string) => request(`/orchestration/${encodeURIComponent(id)}`, { method: 'DELETE', schema: okSchema }),
  execute: (id: string) =>
    request(`/orchestration/${encodeURIComponent(id)}/execute`, {
      method: 'POST',
      body: {},
      schema: z.object({ executionId: z.string() }),
    }),
  progress: (id: string, executionId: string) =>
    request(`/orchestration/${encodeURIComponent(id)}/progress/${encodeURIComponent(executionId)}`, { schema: looseObjectSchema }),
  active: (id: string) => request(`/orchestration/${encodeURIComponent(id)}/active`, { schema: looseObjectSchema }),
  logs: (id: string) => request(`/orchestration/${encodeURIComponent(id)}/logs`, { schema: unknownArray }),
  stop: (id: string) => request(`/orchestration/${encodeURIComponent(id)}/stop`, { method: 'POST', body: {}, schema: looseObjectSchema }),
}

export const memoryApi = {
  summary: () => request('/memory/summary', { schema: memorySummarySchema }),
  list: (query = '') => request(`/memory${queryString({ query })}`, { schema: z.array(memorySchema) }),
  suggestions: (query = '') => request(`/memory/suggestions${queryString({ query })}`, { schema: z.array(memorySchema) }),
  create: (body: unknown) => request('/memory', { method: 'POST', body, schema: memorySchema }),
  update: (id: string, body: unknown) => request(`/memory/${encodeURIComponent(id)}`, { method: 'PUT', body, schema: memorySchema }),
  remove: (id: string) => request(`/memory/${encodeURIComponent(id)}`, { method: 'DELETE', schema: looseObjectSchema }),
  confirm: (id: string) =>
    request(`/memory/suggestions/${encodeURIComponent(id)}/confirm`, { method: 'POST', body: {}, schema: memorySchema }),
  reject: (id: string) =>
    request(`/memory/suggestions/${encodeURIComponent(id)}`, { method: 'DELETE', schema: looseObjectSchema }),
  secure: () => request('/memory/secure', { schema: unknownArray }),
}

export const resourcesApi = {
  list: (query = '', status = '') => request(`/resources${queryString({ query, status })}`, { schema: z.array(resourceSchema) }),
  create: (body: unknown) => request('/resources', { method: 'POST', body, schema: resourceSchema }),
  update: (id: string, body: unknown) => request(`/resources/${encodeURIComponent(id)}`, { method: 'PUT', body, schema: resourceSchema }),
  strike: (id: string, struck: boolean) =>
    request(`/resources/${encodeURIComponent(id)}/strike`, { method: 'PUT', body: { struck }, schema: resourceSchema }),
  remove: (id: string) => request(`/resources/${encodeURIComponent(id)}`, { method: 'DELETE', schema: looseObjectSchema }),
}

export const wikiApi = {
  summary: () => request('/wiki/summary', { schema: looseObjectSchema }),
  pages: (query = '', category = '') => request(`/wiki/pages${queryString({ query, category })}`, { schema: z.array(wikiPageSchema) }),
  content: (path: string) => request(`/wiki/pages/content${queryString({ path })}`, { schema: wikiPageSchema }),
  create: (body: unknown) => request('/wiki/pages', { method: 'POST', body, schema: wikiPageSchema }),
  update: (body: unknown) => request('/wiki/pages', { method: 'PUT', body, schema: wikiPageSchema }),
  lint: () => request('/wiki/lint', { method: 'POST', body: {}, schema: looseObjectSchema }),
  rebuild: () => request('/wiki/index/rebuild', { method: 'POST', body: {}, schema: looseObjectSchema }),
}

export const pkmApi = {
  summary: () => request('/pkm/summary', { schema: pkmSummarySchema }),
  search: (expression: string) => request('/pkm/search', { method: 'POST', body: { expression }, schema: pkmSearchSchema }),
  reindex: () => request('/pkm/reindex', { method: 'POST', body: {}, schema: looseObjectSchema }),
  thesaurus: () => request('/pkm/thesaurus', { schema: unknownArray }),
}

export const outputProfilesApi = {
  list: (query = '') => request(`/output-profiles${queryString({ query })}`, { schema: z.array(outputProfileSchema) }),
  create: (body: unknown) => request('/output-profiles', { method: 'POST', body, schema: outputProfileSchema }),
  update: (id: string, body: unknown) => request(`/output-profiles/${encodeURIComponent(id)}`, { method: 'PUT', body, schema: outputProfileSchema }),
  remove: (id: string) => request(`/output-profiles/${encodeURIComponent(id)}`, { method: 'DELETE', schema: looseObjectSchema }),
}

export const skillsApi = {
  list: () => request('/skills', { schema: z.array(skillSchema) }),
  detail: (id: string) => request(`/skills/${encodeURIComponent(id)}`, { schema: skillSchema.and(looseObjectSchema) }),
  create: (body: unknown) => request('/skills', { method: 'POST', body, schema: skillSchema.and(looseObjectSchema) }),
  remove: (id: string) => request(`/skills/${encodeURIComponent(id)}`, { method: 'DELETE', schema: looseObjectSchema }),
  search: (query: string) => request(`/skills/marketplace/search${queryString({ q: query, limit: 20 })}`, { schema: looseObjectSchema }),
  install: (id: string) => request('/skills/marketplace/install', { method: 'POST', body: { id }, schema: skillSchema.and(looseObjectSchema) }),
  updates: () => request('/skills/bundled/updates', { schema: unknownArray }),
}

export const uapisApi = {
  catalog: () => request('/uapis/catalog', { schema: uapiCatalogSchema }),
  setEnabled: (id: string, enabled: boolean) =>
    request(`/uapis/apis/${encodeURIComponent(id)}`, { method: 'PATCH', body: { enabled }, schema: uapiItemSchema }),
  call: (body: unknown) => request('/uapis/call', { method: 'POST', body, schema: looseObjectSchema }),
}

export const searchApi = {
  sources: () => request('/websearch/engines', { schema: searchSourcesSchema }),
  toggle: (family: string, id: string, enabled: boolean) =>
    request(`/websearch/sources/${encodeURIComponent(family)}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { enabled },
      schema: searchSourcesSchema,
    }),
}

export const researchApi = {
  sessions: () =>
    request('/websearch/research/sessions', {
      schema: z.object({ sessions: z.array(researchSessionSchema) }),
    }),
  createSession: (body: { title: string; description?: string }) =>
    request('/websearch/research/sessions', {
      method: 'POST',
      body,
      schema: researchSessionSchema,
    }),
  state: (sessionId: string) =>
    request(`/websearch/research/sessions/${encodeURIComponent(sessionId)}`, {
      schema: researchStateSchema,
    }),
  search: (sessionId: string, body: { query: string; limit?: number }) =>
    request(`/websearch/research/sessions/${encodeURIComponent(sessionId)}/search`, {
      method: 'POST',
      body,
      schema: z.object({
        session: researchSessionSchema,
        queryId: z.string(),
        round: z.number(),
        results: z.array(researchResultSchema),
      }).passthrough(),
    }),
  extract: (sessionId: string, resultIds: string[]) =>
    request(`/websearch/research/sessions/${encodeURIComponent(sessionId)}/extract`, {
      method: 'POST',
      body: { resultIds },
      schema: z.object({
        extracted: z.number(),
        failed: z.number(),
        snapshots: z.array(researchSnapshotSchema),
      }).passthrough(),
    }),
  assess: (sessionId: string, queryId?: string) =>
    request(`/websearch/research/sessions/${encodeURIComponent(sessionId)}/assess`, {
      method: 'POST',
      body: { queryId },
      schema: researchAssessmentSchema,
    }),
  reviewResults: (
    sessionId: string,
    decisions: Array<{ resultId: string; status: 'pending' | 'approved' | 'rejected' }>,
  ) =>
    request(`/websearch/research/sessions/${encodeURIComponent(sessionId)}/results/review`, {
      method: 'POST',
      body: { decisions },
      schema: z.object({ updated: z.number(), results: z.array(researchResultSchema) }).passthrough(),
    }),
  createClaim: (
    sessionId: string,
    body: { text: string; riskLevel: 'low' | 'medium' | 'high' },
  ) =>
    request(`/websearch/research/sessions/${encodeURIComponent(sessionId)}/claims`, {
      method: 'POST',
      body: { claims: [body] },
      schema: z.array(researchClaimSchema),
    }),
  evidenceCandidates: (sessionId: string, claimId: string) =>
    request(
      `/websearch/research/sessions/${encodeURIComponent(sessionId)}/claims/${encodeURIComponent(claimId)}/evidence/candidates`,
      {
        method: 'POST',
        body: {},
        schema: z.object({
          claim: researchClaimSchema,
          candidates: z.array(z.object({
            resultId: z.string(),
            resultUrl: z.string(),
            quote: z.string(),
            charStart: z.number(),
            charEnd: z.number(),
            contentHash: z.string(),
            sourceClusterId: z.string(),
            similarity: z.number(),
          }).passthrough()),
        }),
      },
    ),
  addEvidence: (
    sessionId: string,
    claimId: string,
    body: {
      resultId: string
      snapshotId?: string
      quote: string
      charStart: number
      charEnd: number
      stance: 'support' | 'refute' | 'insufficient'
    },
  ) =>
    request(
      `/websearch/research/sessions/${encodeURIComponent(sessionId)}/claims/${encodeURIComponent(claimId)}/evidence`,
      { method: 'POST', body, schema: researchEvidenceSchema },
    ),
  reviewClaim: (sessionId: string, claimId: string) =>
    request(
      `/websearch/research/sessions/${encodeURIComponent(sessionId)}/claims/${encodeURIComponent(claimId)}/review`,
      { method: 'POST', body: {}, schema: researchClaimReviewSchema },
    ),
  writeback: (
    sessionId: string,
    body: {
      title?: string
      summary: string
      content?: string
      claimIds?: string[]
      completeSession?: boolean
    },
  ) =>
    request(`/websearch/research/sessions/${encodeURIComponent(sessionId)}/writeback`, {
      method: 'POST',
      body,
      schema: looseObjectSchema,
    }),
}

export const channelsApi = {
  wechat: () => request('/channels/wechat/status', { schema: looseObjectSchema }),
  wechatAccounts: () => request('/channels/wechat/accounts', { schema: unknownArray }),
  startWechatLogin: () => request('/channels/wechat/login/start', { method: 'POST', body: {}, schema: looseObjectSchema }),
  waitWechatLogin: (sessionKey: string, timeoutMs = 4000) =>
    request('/channels/wechat/login/wait', { method: 'POST', body: { sessionKey, timeoutMs }, schema: looseObjectSchema }),
  startWechatAccount: (accountId: string) =>
    request(`/channels/wechat/accounts/${encodeURIComponent(accountId)}/start`, { method: 'POST', body: {}, schema: looseObjectSchema }),
  stopWechatAccount: (accountId: string) =>
    request(`/channels/wechat/accounts/${encodeURIComponent(accountId)}/stop`, { method: 'POST', body: {}, schema: looseObjectSchema }),
  deleteWechatAccount: (accountId: string) =>
    request(`/channels/wechat/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE', schema: looseObjectSchema }),
  feishu: () => request('/channels/feishu/status', { schema: looseObjectSchema }),
  startFeishuSetupWizard: (brand: 'feishu' | 'lark' = 'feishu') =>
    request('/channels/feishu/setup-wizard/start', { method: 'POST', body: { brand }, schema: looseObjectSchema }),
  cancelFeishuSetupWizard: (sessionId: string) =>
    request(`/channels/feishu/setup-wizard/cancel/${encodeURIComponent(sessionId)}`, { method: 'POST', body: {}, schema: looseObjectSchema }),
  feishuSetupWizardStreamUrl: (sessionId: string) =>
    `/api/channels/feishu/setup-wizard/stream/${encodeURIComponent(sessionId)}`,
  saveFeishu: (body: unknown) => request('/channels/feishu/config', { method: 'POST', body, schema: looseObjectSchema }),
  connectFeishu: () => request('/channels/feishu/connect', { method: 'POST', body: {}, schema: looseObjectSchema }),
  disconnectFeishu: () => request('/channels/feishu/disconnect', { method: 'POST', body: {}, schema: looseObjectSchema }),
  feishuWorkspace: () => request('/channels/feishu/workspace', { schema: looseObjectSchema }),
  wecom: () => request('/channels/wecom/status', { schema: looseObjectSchema }),
  wecomWebhooks: () => request('/channels/wecom/webhooks', { schema: unknownArray }),
  createWecomWebhook: (body: unknown) => request('/channels/wecom/webhooks', { method: 'POST', body, schema: looseObjectSchema }),
  testWecomWebhook: (id: string) =>
    request(`/channels/wecom/webhooks/${encodeURIComponent(id)}/test`, { method: 'POST', body: {}, schema: looseObjectSchema }),
}

export const updatesApi = {
  status: () => request('/updates/status', { schema: updateStatusSchema }),
  check: () => request('/updates/check', { method: 'POST', body: {}, schema: updateStatusSchema }),
  install: (force = false) => request('/updates/install', { method: 'POST', body: { force }, schema: looseObjectSchema }),
  run: (id: string) => request(`/updates/runs/${encodeURIComponent(id)}`, { schema: looseObjectSchema }),
  restart: () => request('/updates/restart', { method: 'POST', body: {}, schema: looseObjectSchema }),
}

export const contractFixtures = {
  storedMessage: storedMessageSchema,
}
