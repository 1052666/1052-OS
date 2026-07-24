import { z } from 'zod'

const looseObject = z.object({}).passthrough()
const stringArray = z.array(z.string()).default([])

export const tokenUsageSchema = z
  .object({
    userTokens: z.number().optional(),
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
    totalTokens: z.number().optional(),
    cacheReadTokens: z.number().optional(),
    cacheWriteTokens: z.number().optional(),
    upgradeOverheadInputTokens: z.number().optional(),
    upgradeOverheadOutputTokens: z.number().optional(),
    upgradeOverheadTotalTokens: z.number().optional(),
    estimated: z.boolean().optional(),
  })
  .passthrough()

export const storedMessageSchema = z
  .object({
    id: z.number(),
    ts: z.number(),
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string(),
    usage: tokenUsageSchema.optional(),
    error: z.boolean().optional(),
    streaming: z.boolean().optional(),
    compactSummary: z.string().optional(),
    compactBackupPath: z.string().optional(),
    compactOriginalCount: z.number().optional(),
    meta: looseObject.optional(),
  })
  .passthrough()

export const chatHistorySchema = z.object({ messages: z.array(storedMessageSchema) }).passthrough()

export const runtimeEventSchema = z
  .object({
    type: z.string(),
    turnId: z.string().optional(),
    content: z.string().optional(),
    message: z.string().optional(),
    status: z.number().optional(),
    step: z.number().optional(),
    name: z.string().optional(),
    callId: z.string().optional(),
    argsPreview: z.string().optional(),
    resultPreview: z.string().optional(),
    resultContent: z.string().optional(),
    dangerous: z.boolean().optional(),
    ok: z.boolean().optional(),
    error: z.string().optional(),
    durationMs: z.number().optional(),
    usage: tokenUsageSchema.optional(),
    approvalId: z.string().optional(),
    decision: z.enum(['approved', 'denied', 'cancelled', 'expired']).optional(),
    expiresAt: z.number().optional(),
    packs: stringArray.optional(),
    reason: z.string().optional(),
    stage: z.string().optional(),
    mode: z.string().optional(),
    mountedPacks: stringArray.optional(),
    toolCount: z.number().optional(),
    promptTokens: z.number().optional(),
    promptTokenLimit: z.number().optional(),
    steps: z.number().optional(),
    beforeMessages: z.number().optional(),
    afterMessages: z.number().optional(),
    beforeTokens: z.number().optional(),
    afterTokens: z.number().optional(),
    summaryTokens: z.number().optional(),
    fallback: z.boolean().optional(),
    trigger: z.enum(['auto', 'safety']).optional(),
    phase: z.enum(['pre-step']).optional(),
    strategy: z.enum(['summary-checkpoint', 'tail-trim']).optional(),
    tokenLimit: z.number().optional(),
    windowNumber: z.number().optional(),
    firstWindowId: z.string().optional(),
    previousWindowId: z.string().optional(),
    windowId: z.string().optional(),
  })
  .passthrough()

const llmProfileSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: z.enum(['cloud', 'local']),
    provider: z.string(),
    apiFormat: z.enum(['openai-compatible', 'anthropic', 'gemini']),
    baseUrl: z.string(),
    modelId: z.string(),
    enabled: z.boolean(),
    hasApiKey: z.boolean(),
    apiKeyMask: z.string(),
  })
  .passthrough()

export const settingsSchema = z
  .object({
    llm: z
      .object({
        baseUrl: z.string(),
        modelId: z.string(),
        kind: z.enum(['cloud', 'local']),
        provider: z.string(),
        apiFormat: z.enum(['openai-compatible', 'anthropic', 'gemini']),
        activeProfileId: z.string(),
        profiles: z.array(llmProfileSchema),
        taskRoutes: z.array(looseObject),
        hasApiKey: z.boolean(),
        apiKeyMask: z.string(),
      })
      .passthrough(),
    appearance: z
      .object({
        theme: z.enum(['dark', 'light', 'auto']),
        language: z.string().optional(),
        reduceMotion: z.boolean().nullable().optional(),
      })
      .passthrough(),
    agent: z
      .object({
        streaming: z.boolean(),
        userPrompt: z.string(),
        permissionProfile: z.enum(['read-only', 'default', 'danger-full-access']),
        contextMessageLimit: z.number(),
        progressiveDisclosureEnabled: z.boolean(),
        providerCachingEnabled: z.boolean(),
        checkpointEnabled: z.boolean(),
        seedOnResumeEnabled: z.boolean(),
        upgradeDebugEventsEnabled: z.boolean(),
        autoCompactEnabled: z.boolean(),
        autoCompactThreshold: z.number(),
        morningBrief: z.object({ enabled: z.boolean(), time: z.string() }),
      })
      .passthrough(),
    imageGeneration: looseObject,
    ocr: looseObject,
    uapis: looseObject,
  })
  .passthrough()

export const calendarEventSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    date: z.string(),
    startTime: z.string().default(''),
    endTime: z.string().default(''),
    location: z.string().default(''),
    notes: z.string().default(''),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .passthrough()

export const scheduledTaskSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    notes: z.string().default(''),
    target: z.enum(['agent', 'terminal']),
    mode: z.enum(['once', 'recurring', 'ongoing']),
    startDate: z.string(),
    time: z.string(),
    timezone: z.literal('Asia/Hong_Kong').default('Asia/Hong_Kong'),
    repeatUnit: z.enum(['day', 'week', 'month', '']).default(''),
    repeatInterval: z.number().default(1),
    repeatWeekdays: z.array(z.number()).default([]),
    endDate: z.string().default(''),
    prompt: z.string().default(''),
    command: z.string().default(''),
    shell: z.string().default('powershell'),
    delivery: looseObject.default({}),
    enabled: z.boolean(),
    nextRunAt: z.number().nullable().optional(),
    lastRunAt: z.number().nullable().optional(),
    lastRunStatus: z.enum(['success', 'failed']).nullable().default(null),
    lastRunSummary: z.string().default(''),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .passthrough()

export const notificationSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    message: z.string(),
    level: z.enum(['info', 'success', 'warning', 'error']),
    read: z.boolean(),
    createdAt: z.number(),
    source: z.string(),
    taskId: z.string().optional(),
  })
  .passthrough()

export const repositorySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    path: z.string(),
    relativePath: z.string().default(''),
    description: z.string().default(''),
    isGit: z.boolean(),
    branch: z.string().default(''),
    status: z.enum(['clean', 'dirty', 'unknown']),
    changes: z.number(),
    language: z.string().default(''),
    updatedAt: z.number(),
  })
  .passthrough()

export const repositoryDetailSchema = z
  .object({
    repository: repositorySchema,
    readme: z.object({ fileName: z.string(), content: z.string() }).nullable(),
    tree: z.array(looseObject),
  })
  .passthrough()

export const noteTreeSchema: z.ZodType<NoteTreeNode> = z.lazy(() =>
  z
    .object({
      name: z.string(),
      relativePath: z.string(),
      type: z.enum(['file', 'dir']),
      size: z.number(),
      updatedAt: z.number(),
      children: z.array(noteTreeSchema).optional(),
    })
    .passthrough(),
)

export type NoteTreeNode = {
  name: string
  relativePath: string
  type: 'file' | 'dir'
  size: number
  updatedAt: number
  children?: NoteTreeNode[]
}

export const noteFileSchema = z
  .object({ path: z.string(), name: z.string(), content: z.string(), size: z.number(), updatedAt: z.number() })
  .passthrough()

export const dataSourceSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.enum(['mysql', 'oracle', 'sqlite', 'hive']),
    host: z.string().default(''),
    port: z.number().default(0),
    user: z.string().default(''),
    database: z.string().default(''),
    filePath: z.string().default(''),
  })
  .passthrough()

export const sqlFileSchema = z
  .object({ id: z.string(), name: z.string(), datasourceId: z.string(), content: z.string(), updatedAt: z.number() })
  .passthrough()

export const sqlVariableSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    valueType: z.enum(['static', 'sql']),
    value: z.string(),
    datasourceId: z.string().default(''),
  })
  .passthrough()

export const serverSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    host: z.string(),
    port: z.number(),
    user: z.string(),
    authType: z.enum(['password', 'privateKey']),
    description: z.string().default(''),
  })
  .passthrough()

export const shellFileSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    serverId: z.string(),
    content: z.string(),
    description: z.string().default(''),
    updatedAt: z.number(),
  })
  .passthrough()

export const orchestrationNodeSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.enum(['sql', 'debug', 'load', 'wait', 'shell', 'loop']),
    enabled: z.boolean(),
    position: z.object({ x: z.number(), y: z.number() }).optional(),
  })
  .passthrough()

export const orchestrationSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().default(''),
    nodes: z.array(orchestrationNodeSchema),
    edges: z.array(z.object({ id: z.string(), source: z.string(), target: z.string() }).passthrough()),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .passthrough()

export const orchestrationExecutionSchema = z
  .object({
    id: z.string(),
    orchestrationId: z.string(),
    orchestrationName: z.string(),
    status: z.enum(['success', 'failed', 'warning', 'running']),
    logs: z.array(looseObject),
  })
  .passthrough()

export const memorySchema = z
  .object({
    id: z.string(),
    category: z.string(),
    title: z.string(),
    content: z.string(),
    tags: stringArray,
    scope: z.string(),
    priority: z.enum(['high', 'normal', 'low']),
    source: z.string(),
    confidence: z.enum(['confirmed', 'suggested']),
    active: z.boolean(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .passthrough()

export const memorySummarySchema = z
  .object({
    counts: z.object({ confirmed: z.number(), active: z.number(), suggestions: z.number(), secure: z.number(), highPriority: z.number() }),
    recent: z.array(memorySchema),
    secure: z.array(looseObject),
  })
  .passthrough()

export const resourceSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    content: z.string(),
    note: z.string(),
    tags: stringArray,
    status: z.enum(['active', 'struck']),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .passthrough()

export const wikiPageSchema = z
  .object({
    path: z.string(),
    title: z.string(),
    category: z.string(),
    tags: stringArray,
    summary: z.string(),
    content: z.string(),
    updatedAt: z.number(),
  })
  .passthrough()

export const pkmSummarySchema = z
  .object({
    totalEntries: z.number(),
    bySource: z.record(z.number()),
    byCategory: z.record(z.number()),
    thesaurusSize: z.number(),
    lastIndexAt: z.string().nullable(),
  })
  .passthrough()

export const pkmSearchSchema = z
  .object({
    results: z.array(looseObject),
    total: z.number(),
    fallbackUsed: z.string().optional(),
  })
  .passthrough()

export const outputProfileSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    active: z.boolean(),
    isDefault: z.boolean(),
    priority: z.enum(['high', 'normal', 'low']),
    modes: stringArray,
    tags: stringArray,
    instructions: z.string(),
    updatedAt: z.number(),
  })
  .passthrough()

export const skillSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    enabled: z.boolean(),
    path: z.string(),
    updatedAt: z.number(),
    size: z.number(),
  })
  .passthrough()

export const uapiItemSchema = z
  .object({
    id: z.string(),
    categoryId: z.string(),
    categoryName: z.string(),
    name: z.string(),
    method: z.enum(['GET', 'POST']),
    path: z.string(),
    description: z.string(),
    enabled: z.boolean(),
  })
  .passthrough()

export const uapiCatalogSchema = z
  .object({
    provider: looseObject,
    categories: z.array(looseObject),
    apis: z.array(uapiItemSchema),
    counts: z.object({ total: z.number(), enabled: z.number(), disabled: z.number(), searchApis: z.number() }),
  })
  .passthrough()

export const searchSourcesSchema = z
  .object({ engines: z.array(looseObject), sourceGroups: z.array(looseObject) })
  .passthrough()

export const updateStatusSchema = z
  .object({
    mode: z.enum(['git', 'archive']),
    current: looseObject,
    latest: looseObject.nullable(),
    updateAvailable: z.boolean(),
    canInstall: z.boolean(),
    dirty: z.boolean(),
    dirtyFiles: stringArray,
    warnings: stringArray,
    lastCheckedAt: z.string(),
  })
  .passthrough()

export const healthStatusSchema = z.object({ ok: z.boolean(), ts: z.number() }).passthrough()

export const appearanceReviewIssueSchema = z
  .object({
    code: z.string(),
    path: z.string(),
    message: z.string(),
    suggestedFix: z.string(),
  })
  .passthrough()

export const appearanceReviewReportSchema = z
  .object({
    passed: z.boolean(),
    safetyLevel: z.enum(['safe', 'experimental', 'rejected']),
    blockingIssues: z.array(appearanceReviewIssueSchema),
    warnings: z.array(appearanceReviewIssueSchema),
  })
  .passthrough()

export const appearanceThemeSpecSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: z.string(),
    mode: z.enum(['dark', 'light']),
    scope: z.enum(['chat', 'workspace', 'brief', 'all']),
    safetyLevel: z.enum(['safe', 'experimental', 'rejected']),
    coreTokens: looseObject,
    tokens: looseObject,
  })
  .passthrough()

export const appearanceThemeProfileSchema = z
  .object({
    id: z.string(),
    theme: appearanceThemeSpecSchema,
    review: appearanceReviewReportSchema,
    createdAt: z.number(),
    updatedAt: z.number(),
    source: z.enum(['user', 'builtin']).optional(),
    builtinVersion: z.number().optional(),
  })
  .passthrough()

export const publicAppearanceThemesSchema = z
  .object({
    schemaVersion: z.literal(1),
    activeProfileId: z.string(),
    activeProfile: appearanceThemeProfileSchema.nullable(),
    applyHistory: z.array(looseObject),
    profiles: z.array(appearanceThemeProfileSchema),
  })
  .passthrough()

export const looseObjectSchema = looseObject

export type TokenUsage = z.infer<typeof tokenUsageSchema>
export type StoredMessage = z.infer<typeof storedMessageSchema>
export type RuntimeEventPayload = z.infer<typeof runtimeEventSchema>
export type PublicSettings = z.infer<typeof settingsSchema>
export type CalendarEvent = z.infer<typeof calendarEventSchema>
export type ScheduledTask = z.infer<typeof scheduledTaskSchema>
export type AppNotification = z.infer<typeof notificationSchema>
export type Repository = z.infer<typeof repositorySchema>
export type NoteFile = z.infer<typeof noteFileSchema>
export type DataSource = z.infer<typeof dataSourceSchema>
export type SqlFile = z.infer<typeof sqlFileSchema>
export type SqlVariable = z.infer<typeof sqlVariableSchema>
export type Server = z.infer<typeof serverSchema>
export type ShellFile = z.infer<typeof shellFileSchema>
export type Orchestration = z.infer<typeof orchestrationSchema>
export type MemoryItem = z.infer<typeof memorySchema>
export type ResourceItem = z.infer<typeof resourceSchema>
export type WikiPage = z.infer<typeof wikiPageSchema>
export type OutputProfile = z.infer<typeof outputProfileSchema>
export type Skill = z.infer<typeof skillSchema>
export type UapiItem = z.infer<typeof uapiItemSchema>
export type AppearanceThemeProfile = z.infer<typeof appearanceThemeProfileSchema>
export type AppearanceReviewReport = z.infer<typeof appearanceReviewReportSchema>
export type HealthStatus = z.infer<typeof healthStatusSchema>
