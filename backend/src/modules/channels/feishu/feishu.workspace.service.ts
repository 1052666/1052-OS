import { randomUUID } from 'node:crypto'
import { HttpError } from '../../../http-error.js'
import {
  getNotesConfig,
  getNoteFile,
  getNotesTree,
} from '../../notes/notes.service.js'
import { listResources } from '../../resources/resources.service.js'
import {
  readMemoryProfile,
  readSecureMemoryProfile,
} from '../../memory/memory.service.js'
import { createFeishuClient } from './feishu.api.js'
import {
  appendFeishuEventLog,
  listFeishuEventLogs,
  listFeishuSyncJobs,
  loadFeishuAppConfig,
  loadFeishuWorkspaceConfig,
  saveFeishuWorkspaceConfig,
  upsertFeishuSyncJob,
} from './feishu.store.js'
import type {
  FeishuEventLogRecord,
  FeishuSyncJobRecord,
  FeishuWorkspaceConfigRecord,
  FeishuWorkspaceStatus,
} from './feishu.types.js'

type JobContext = {
  id: string
  type: string
  title: string
  startedAt: number
}

function nowIso() {
  return new Date().toISOString()
}

function sanitizeTitle(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : fallback
}

function sanitizeToken(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function sanitizeUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const url = value.trim()
  try {
    const parsed = new URL(url)
    if (!/^https?:$/i.test(parsed.protocol)) return undefined
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return undefined
  }
}

function sanitizeFileName(title: string, ext: string) {
  const base = title
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || '1052-os'
  return `${base}${ext}`
}

function toMarkdownDate(value: number) {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

async function createJob(type: string, title: string): Promise<JobContext> {
  const startedAt = Date.now()
  const job: FeishuSyncJobRecord = {
    id: randomUUID(),
    type,
    title,
    status: 'running',
    startedAt,
  }
  await upsertFeishuSyncJob(job)
  return { id: job.id, type, title, startedAt }
}

async function finishJob(
  context: JobContext,
  status: 'success' | 'failed',
  summary: string,
  result?: Record<string, unknown>,
) {
  await upsertFeishuSyncJob({
    id: context.id,
    type: context.type,
    title: context.title,
    status,
    startedAt: context.startedAt,
    finishedAt: Date.now(),
    summary,
    result,
  })
  await appendFeishuEventLog({
    id: randomUUID(),
    type: `workspace.${context.type}`,
    title: context.title,
    detail: summary,
    source: status,
    createdAt: Date.now(),
  })
}

async function runJob<T>(
  type: string,
  title: string,
  execute: () => Promise<{ summary: string; result: T }>,
) {
  const context = await createJob(type, title)
  try {
    const outcome = await execute()
    await finishJob(
      context,
      'success',
      outcome.summary,
      outcome.result && typeof outcome.result === 'object'
        ? (outcome.result as Record<string, unknown>)
        : undefined,
    )
    return outcome.result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await finishJob(context, 'failed', message)
    throw error
  }
}

function getClient(config: Awaited<ReturnType<typeof loadFeishuAppConfig>>) {
  return createFeishuClient(config)
}

async function getWorkspaceConfigOrThrow() {
  const appConfig = await loadFeishuAppConfig()
  const workspace = await loadFeishuWorkspaceConfig()
  return { appConfig, workspace }
}

function requireFolderToken(token?: string) {
  if (!token) {
    throw new HttpError(
      400,
      'Feishu driveFolderToken is required before importing a document or creating a Bitable app.',
    )
  }
  return token
}

async function uploadMarkdownAsDocx(params: {
  title: string
  markdown: string
  folderToken: string
}) {
  const appConfig = await loadFeishuAppConfig()
  const client: any = getClient(appConfig)
  const fileName = sanitizeFileName(params.title, '.md')
  const buffer = Buffer.from(params.markdown, 'utf-8')
  const upload = await client.drive.file.uploadAll({
    data: {
      file_name: fileName,
      parent_type: 'explorer',
      parent_node: params.folderToken,
      size: buffer.length,
      file: buffer,
    },
  })

  const fileToken = upload?.file_token
  if (!fileToken) {
    throw new HttpError(502, 'Feishu file upload failed before import.')
  }

  const importTask = await client.drive.importTask.create({
    data: {
      file_extension: 'md',
      file_token: fileToken,
      type: 'docx',
      file_name: fileName,
      point: {
        mount_type: 1,
        mount_key: params.folderToken,
      },
    },
  })

  const ticket = importTask?.data?.ticket
  if (!ticket) {
    throw new HttpError(502, 'Feishu import task did not return a ticket.')
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await client.drive.importTask.get({
      path: { ticket },
    })
    const imported = result?.data?.result
    if (imported?.token && imported?.url) {
      return {
        ticket,
        token: imported.token,
        url: imported.url,
        type: imported.type,
      }
    }
    if (imported?.job_status && imported.job_status !== 0 && imported.job_error_msg) {
      throw new HttpError(502, imported.job_error_msg)
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  throw new HttpError(504, 'Feishu import task timed out while waiting for the document.')
}

function flattenNoteTree(
  nodes: Awaited<ReturnType<typeof getNotesTree>>,
  depth = 0,
  lines: string[] = [],
) {
  for (const node of nodes) {
    const prefix = `${'  '.repeat(depth)}- `
    lines.push(`${prefix}${node.type === 'dir' ? '📁' : '📄'} ${node.relativePath}`)
    if (node.type === 'dir' && Array.isArray(node.children)) {
      flattenNoteTree(node.children, depth + 1, lines)
    }
  }
  return lines
}

function buildResourceMarkdown(resources: Awaited<ReturnType<typeof listResources>>) {
  const lines = ['# 1052 OS Resources', '', `Updated: ${nowIso()}`, '']
  for (const item of resources) {
    lines.push(`## ${item.title || item.id}`)
    lines.push(`- ID: ${item.id}`)
    lines.push(`- Status: ${item.status}`)
    lines.push(`- Updated: ${toMarkdownDate(item.updatedAt)}`)
    if (item.tags.length) {
      lines.push(`- Tags: ${item.tags.join(', ')}`)
    }
    lines.push('')
    lines.push(item.content || '(empty)')
    if (item.note) {
      lines.push('')
      lines.push('> Note')
      lines.push('>')
      lines.push(...item.note.split('\n').map((line) => `> ${line}`))
    }
    lines.push('')
  }
  return lines.join('\n')
}

async function buildNotesMarkdown(notePath?: string) {
  if (notePath) {
    const note = await getNoteFile(notePath)
    return {
      title: note.name.replace(/\.md$/i, '') || 'Note',
      markdown: `# ${note.name}\n\n${note.content}`,
    }
  }

  const config = await getNotesConfig()
  const tree = config.configured ? await getNotesTree() : []
  const lines = [
    '# 1052 OS Notes Index',
    '',
    `Configured: ${config.configured ? 'yes' : 'no'}`,
    `Root: ${config.rootPath || '(not configured)'}`,
    '',
  ]
  if (tree.length === 0) {
    lines.push('No notes found.')
  } else {
    lines.push(...flattenNoteTree(tree))
  }
  return {
    title: '1052 OS Notes Index',
    markdown: lines.join('\n'),
  }
}

function buildMemoryMarkdown(profile: string, secureProfile: string) {
  return ['# 1052 OS Memory Profiles', '', '## Public Memory Profile', '', profile || '(empty)', '', '## Secure Memory Profile', '', secureProfile || '(empty)', ''].join('\n')
}

async function ensureBitableApp(params: {
  appToken?: string
  folderToken: string
}) {
  const appConfig = await loadFeishuAppConfig()
  const workspace = await loadFeishuWorkspaceConfig()
  const client: any = getClient(appConfig)
  const appToken = sanitizeToken(params.appToken) ?? workspace.bitableAppToken
  if (appToken) {
    return appToken
  }

  const created = await client.bitable.app.create({
    data: {
      name: '1052 OS Resources',
      folder_token: params.folderToken,
      time_zone: 'Asia/Hong_Kong',
    },
  })
  const createdToken = created?.data?.app?.app_token
  if (!createdToken) {
    throw new HttpError(502, 'Feishu Bitable app creation failed.')
  }
  await saveFeishuWorkspaceConfig({ bitableAppToken: createdToken })
  return createdToken
}

async function ensureBitableTable(params: {
  appToken: string
  tableId?: string
}) {
  const appConfig = await loadFeishuAppConfig()
  const workspace = await loadFeishuWorkspaceConfig()
  const client: any = getClient(appConfig)
  const tableId = sanitizeToken(params.tableId) ?? workspace.bitableTableId
  if (tableId) {
    return tableId
  }

  const created = await client.bitable.appTable.create({
    path: {
      app_token: params.appToken,
    },
    data: {
      table: {
        name: 'Resources',
        default_view_name: 'All Resources',
        fields: [
          { field_name: 'Resource ID', type: 1, ui_type: 'Text' },
          { field_name: 'Title', type: 1, ui_type: 'Text' },
          { field_name: 'Content', type: 1, ui_type: 'Text' },
          { field_name: 'Note', type: 1, ui_type: 'Text' },
          { field_name: 'Tags', type: 1, ui_type: 'Text' },
          { field_name: 'Status', type: 3, ui_type: 'SingleSelect', property: { options: [{ name: 'active' }, { name: 'struck' }] } },
          { field_name: 'Updated At', type: 1, ui_type: 'Text' },
        ],
      },
    },
  })
  const createdId = created?.data?.table?.table_id
  if (!createdId) {
    throw new HttpError(502, 'Feishu Bitable table creation failed.')
  }
  await saveFeishuWorkspaceConfig({ bitableAppToken: params.appToken, bitableTableId: createdId })
  return createdId
}

function toBitableResourceFields(item: Awaited<ReturnType<typeof listResources>>[number]) {
  return {
    'Resource ID': item.id,
    Title: item.title || item.id,
    Content: item.content,
    Note: item.note,
    Tags: item.tags.join(', '),
    Status: item.status,
    'Updated At': toMarkdownDate(item.updatedAt),
  }
}

function resolveWebBaseUrl(workspace: FeishuWorkspaceConfigRecord) {
  return sanitizeUrl(workspace.webBaseUrl) ?? 'https://github.com/1052666/1052-OS'
}

function normalizeAcl(input: unknown) {
  if (!Array.isArray(input) || input.length === 0) {
    throw new HttpError(
      400,
      'Search data source item ACL is required. Pass an array of Feishu ACL rules.',
    )
  }
  return input
}

export async function getFeishuWorkspaceStatus(): Promise<FeishuWorkspaceStatus> {
  const [config, recentJobs, recentEvents] = await Promise.all([
    loadFeishuWorkspaceConfig(),
    listFeishuSyncJobs(),
    listFeishuEventLogs(),
  ])
  return {
    config,
    recentJobs: recentJobs.slice(0, 20),
    recentEvents: recentEvents.slice(0, 40),
  }
}

export async function updateFeishuWorkspaceConfig(
  input: Partial<FeishuWorkspaceConfigRecord>,
) {
  return saveFeishuWorkspaceConfig({
    webBaseUrl: sanitizeUrl(input.webBaseUrl),
    driveFolderToken: sanitizeToken(input.driveFolderToken),
    wikiSpaceId: sanitizeToken(input.wikiSpaceId),
    wikiParentNodeToken: sanitizeToken(input.wikiParentNodeToken),
    bitableAppToken: sanitizeToken(input.bitableAppToken),
    bitableTableId: sanitizeToken(input.bitableTableId),
    searchDataSourceId: sanitizeToken(input.searchDataSourceId),
    approvalCode: sanitizeToken(input.approvalCode),
    calendarId: sanitizeToken(input.calendarId),
    enableNotificationCards:
      typeof input.enableNotificationCards === 'boolean'
        ? input.enableNotificationCards
        : undefined,
    enableMemoryCards:
      typeof input.enableMemoryCards === 'boolean' ? input.enableMemoryCards : undefined,
    enableScheduledTaskCards:
      typeof input.enableScheduledTaskCards === 'boolean'
        ? input.enableScheduledTaskCards
        : undefined,
  })
}

export async function importMarkdownDocument(input: {
  title?: unknown
  markdown?: unknown
  folderToken?: unknown
}) {
  const { workspace } = await getWorkspaceConfigOrThrow()
  const title = sanitizeTitle(input.title, '1052 OS Document')
  const markdown = typeof input.markdown === 'string' && input.markdown.trim()
    ? input.markdown
    : ''
  if (!markdown) throw new HttpError(400, 'Markdown content is required.')
  const folderToken = requireFolderToken(sanitizeToken(input.folderToken) ?? workspace.driveFolderToken)

  return runJob('doc-import', `Import document: ${title}`, async () => {
    const imported = await uploadMarkdownAsDocx({ title, markdown, folderToken })
    return {
      summary: `Imported ${title} to Feishu Docs.`,
      result: imported,
    }
  })
}

export async function readFeishuDocumentRawContent(documentIdInput: unknown) {
  const documentId = sanitizeToken(documentIdInput)
  if (!documentId) throw new HttpError(400, 'documentId is required.')
  const appConfig = await loadFeishuAppConfig()
  const client: any = getClient(appConfig)
  const response = await client.docx.document.rawContent({
    path: { document_id: documentId },
  })
  return {
    documentId,
    content: response?.data?.content ?? '',
  }
}

export async function syncResourcesToFeishuDoc() {
  const { workspace } = await getWorkspaceConfigOrThrow()
  const folderToken = requireFolderToken(workspace.driveFolderToken)
  return runJob('resources-doc', 'Sync resources to Feishu Doc', async () => {
    const resources = await listResources('', '', 500)
    const imported = await uploadMarkdownAsDocx({
      title: '1052 OS Resources',
      markdown: buildResourceMarkdown(resources),
      folderToken,
    })
    return {
      summary: `Synced ${resources.length} resources to a Feishu document.`,
      result: {
        ...imported,
        count: resources.length,
      },
    }
  })
}

export async function syncNotesToFeishuDoc(input?: { path?: unknown }) {
  const { workspace } = await getWorkspaceConfigOrThrow()
  const folderToken = requireFolderToken(workspace.driveFolderToken)
  return runJob('notes-doc', 'Sync notes to Feishu Doc', async () => {
    const payload = await buildNotesMarkdown(
      typeof input?.path === 'string' ? input.path : undefined,
    )
    const imported = await uploadMarkdownAsDocx({
      title: payload.title,
      markdown: payload.markdown,
      folderToken,
    })
    return {
      summary: `Synced ${payload.title} to a Feishu document.`,
      result: imported,
    }
  })
}

export async function syncMemoryToFeishuDoc() {
  const { workspace } = await getWorkspaceConfigOrThrow()
  const folderToken = requireFolderToken(workspace.driveFolderToken)
  return runJob('memory-doc', 'Sync memory profiles to Feishu Doc', async () => {
    const [profile, secureProfile] = await Promise.all([
      readMemoryProfile(),
      readSecureMemoryProfile(),
    ])
    const imported = await uploadMarkdownAsDocx({
      title: '1052 OS Memory Profiles',
      markdown: buildMemoryMarkdown(profile, secureProfile),
      folderToken,
    })
    return {
      summary: 'Synced memory profiles to a Feishu document.',
      result: imported,
    }
  })
}

export async function syncResourcesToFeishuBitable(input?: {
  appToken?: unknown
  tableId?: unknown
}) {
  const { workspace } = await getWorkspaceConfigOrThrow()
  const folderToken = requireFolderToken(workspace.driveFolderToken)
  return runJob('resources-bitable', 'Sync resources to Feishu Bitable', async () => {
    const appConfig = await loadFeishuAppConfig()
    const client: any = getClient(appConfig)
    const appToken = await ensureBitableApp({
      appToken: sanitizeToken(input?.appToken),
      folderToken,
    })
    const tableId = await ensureBitableTable({
      appToken,
      tableId: sanitizeToken(input?.tableId),
    })
    const resources = await listResources('', '', 500)

    const existing = await client.bitable.appTableRecord.list({
      path: {
        app_token: appToken,
        table_id: tableId,
      },
      params: {
        page_size: 500,
      },
    })

    const existingMap = new Map<string, string>()
    for (const record of existing?.data?.items ?? []) {
      const resourceId = record?.fields?.['Resource ID']
      if (typeof resourceId === 'string' && record.record_id) {
        existingMap.set(resourceId, record.record_id)
      }
    }

    let created = 0
    let updated = 0
    for (const resource of resources) {
      const recordId = existingMap.get(resource.id)
      if (recordId) {
        await client.bitable.appTableRecord.update({
          path: {
            app_token: appToken,
            table_id: tableId,
            record_id: recordId,
          },
          data: {
            fields: toBitableResourceFields(resource),
          },
        })
        updated += 1
      } else {
        await client.bitable.appTableRecord.create({
          path: {
            app_token: appToken,
            table_id: tableId,
          },
          data: {
            fields: toBitableResourceFields(resource),
          },
        })
        created += 1
      }
    }

    await saveFeishuWorkspaceConfig({
      bitableAppToken: appToken,
      bitableTableId: tableId,
    })

    return {
      summary: `Synced ${resources.length} resources to Feishu Bitable.`,
      result: {
        appToken,
        tableId,
        created,
        updated,
        count: resources.length,
      },
    }
  })
}

export async function moveDocumentToFeishuWiki(input: {
  documentToken?: unknown
  spaceId?: unknown
  parentWikiToken?: unknown
  title?: unknown
}) {
  const { workspace } = await getWorkspaceConfigOrThrow()
  const documentToken = sanitizeToken(input.documentToken)
  const spaceId = sanitizeToken(input.spaceId) ?? workspace.wikiSpaceId
  const parentWikiToken =
    sanitizeToken(input.parentWikiToken) ?? workspace.wikiParentNodeToken
  if (!documentToken) throw new HttpError(400, 'documentToken is required.')
  if (!spaceId) throw new HttpError(400, 'wikiSpaceId is required.')

  return runJob('wiki-mount', 'Mount document into Feishu Wiki', async () => {
    const appConfig = await loadFeishuAppConfig()
    const client: any = getClient(appConfig)
    const moved = await client.wiki.spaceNode.moveDocsToWiki({
      path: {
        space_id: spaceId,
      },
      data: {
        parent_wiki_token: parentWikiToken,
        obj_type: 'docx',
        obj_token: documentToken,
        apply: true,
      },
    })

    const wikiToken = moved?.data?.wiki_token
    if (wikiToken && typeof input.title === 'string' && input.title.trim()) {
      await client.wiki.spaceNode.updateTitle({
        path: {
          space_id: spaceId,
          node_token: wikiToken,
        },
        data: {
          title: input.title.trim(),
        },
      })
    }

    await saveFeishuWorkspaceConfig({
      wikiSpaceId: spaceId,
      wikiParentNodeToken: parentWikiToken,
    })

    return {
      summary: 'Mounted the document into Feishu Wiki.',
      result: {
        spaceId,
        wikiToken,
        taskId: moved?.data?.task_id,
        applied: moved?.data?.applied,
      },
    }
  })
}

export async function listFeishuCalendars() {
  const appConfig = await loadFeishuAppConfig()
  const client: any = getClient(appConfig)
  const response = await client.calendar.calendar.list({
    params: {
      page_size: 100,
    },
  })
  return {
    items: response?.data?.calendar_list ?? [],
  }
}

export async function createFeishuCalendar(input: {
  summary?: unknown
  description?: unknown
  permissions?: unknown
}) {
  return runJob('calendar-create', 'Create Feishu shared calendar', async () => {
    const appConfig = await loadFeishuAppConfig()
    const client: any = getClient(appConfig)
    const response = await client.calendar.calendar.create({
      data: {
        summary: sanitizeTitle(input.summary, '1052 OS Calendar'),
        description:
          typeof input.description === 'string' ? input.description.trim() : undefined,
        permissions:
          input.permissions === 'private' ||
          input.permissions === 'show_only_free_busy' ||
          input.permissions === 'public'
            ? input.permissions
            : 'private',
      },
    })
    const calendarId = response?.data?.calendar?.calendar_id
    if (calendarId) {
      await saveFeishuWorkspaceConfig({ calendarId })
    }
    return {
      summary: 'Created a shared Feishu calendar.',
      result: response?.data?.calendar ?? {},
    }
  })
}

export async function listFeishuCalendarEvents(input?: {
  calendarId?: unknown
}) {
  const { workspace } = await getWorkspaceConfigOrThrow()
  const calendarId = sanitizeToken(input?.calendarId) ?? workspace.calendarId
  if (!calendarId) throw new HttpError(400, 'calendarId is required.')
  const appConfig = await loadFeishuAppConfig()
  const client: any = getClient(appConfig)
  const response = await client.calendar.calendarEvent.list({
    path: {
      calendar_id: calendarId,
    },
    params: {
      page_size: 100,
    },
  })
  return {
    calendarId,
    items: response?.data?.items ?? [],
  }
}

export async function createFeishuCalendarEvent(input: {
  calendarId?: unknown
  summary?: unknown
  description?: unknown
  startTimestamp?: unknown
  endTimestamp?: unknown
  timezone?: unknown
  locationName?: unknown
}) {
  const { workspace } = await getWorkspaceConfigOrThrow()
  const calendarId = sanitizeToken(input.calendarId) ?? workspace.calendarId
  if (!calendarId) throw new HttpError(400, 'calendarId is required.')
  const startTimestamp = String(input.startTimestamp ?? '')
  const endTimestamp = String(input.endTimestamp ?? '')
  if (!startTimestamp || !endTimestamp) {
    throw new HttpError(400, 'startTimestamp and endTimestamp are required.')
  }

  return runJob('calendar-event-create', 'Create Feishu calendar event', async () => {
    const appConfig = await loadFeishuAppConfig()
    const client: any = getClient(appConfig)
    const response = await client.calendar.calendarEvent.create({
      path: {
        calendar_id: calendarId,
      },
      data: {
        summary: sanitizeTitle(input.summary, '1052 OS Event'),
        description:
          typeof input.description === 'string' ? input.description.trim() : undefined,
        start_time: {
          timestamp: startTimestamp,
          timezone:
            typeof input.timezone === 'string' && input.timezone.trim()
              ? input.timezone.trim()
              : 'Asia/Hong_Kong',
        },
        end_time: {
          timestamp: endTimestamp,
          timezone:
            typeof input.timezone === 'string' && input.timezone.trim()
              ? input.timezone.trim()
              : 'Asia/Hong_Kong',
        },
        location:
          typeof input.locationName === 'string' && input.locationName.trim()
            ? { name: input.locationName.trim() }
            : undefined,
      },
    })
    return {
      summary: 'Created a Feishu calendar event.',
      result: response?.data?.event ?? {},
    }
  })
}

export async function listFeishuTasks() {
  const appConfig = await loadFeishuAppConfig()
  const client: any = getClient(appConfig)
  const response = await client.task.task.list({
    params: {
      page_size: 100,
    },
  })
  return {
    items: response?.data?.items ?? [],
  }
}

export async function createFeishuTask(input: {
  summary?: unknown
  description?: unknown
  dueTimestamp?: unknown
  completedAt?: unknown
}) {
  return runJob('task-create', 'Create Feishu task', async () => {
    const appConfig = await loadFeishuAppConfig()
    const client: any = getClient(appConfig)
    const dueTimestamp =
      typeof input.dueTimestamp === 'string' && input.dueTimestamp.trim()
        ? input.dueTimestamp.trim()
        : undefined
    const response = await client.task.task.create({
      data: {
        summary: sanitizeTitle(input.summary, '1052 OS Task'),
        description:
          typeof input.description === 'string' ? input.description.trim() : undefined,
        due: dueTimestamp
          ? {
              timestamp: dueTimestamp,
              is_all_day: false,
            }
          : undefined,
        completed_at:
          typeof input.completedAt === 'string' && input.completedAt.trim()
            ? input.completedAt.trim()
            : undefined,
      },
    })
    return {
      summary: 'Created a Feishu task.',
      result: response?.data?.task ?? {},
    }
  })
}

export async function createFeishuExternalApprovalDefinition(input: {
  approvalCode?: unknown
  approvalName?: unknown
  description?: unknown
  groupCode?: unknown
  groupName?: unknown
}) {
  return runJob('approval-definition-create', 'Create Feishu approval definition', async () => {
    const appConfig = await loadFeishuAppConfig()
    const workspace = await loadFeishuWorkspaceConfig()
    const client: any = getClient(appConfig)
    const approvalCode =
      sanitizeToken(input.approvalCode) ??
      workspace.approvalCode ??
      `approval_${Date.now().toString(36)}`
    const response = await client.approval.externalApproval.create({
      data: {
        approval_name: sanitizeTitle(input.approvalName, '1052 OS Approval'),
        approval_code: approvalCode,
        group_code: sanitizeToken(input.groupCode) ?? '1052-os',
        group_name: sanitizeTitle(input.groupName, '1052 OS'),
        description:
          typeof input.description === 'string'
            ? input.description.trim()
            : '1052 OS managed approval definition',
        external: {
          biz_name: '1052 OS',
          biz_type: '1052-os',
          support_pc: true,
          support_mobile: true,
          support_batch_read: false,
          enable_mark_readed: true,
          enable_quick_operate: false,
          allow_batch_operate: false,
        },
      },
    })

    await saveFeishuWorkspaceConfig({ approvalCode })
    return {
      summary: `Created external approval definition ${approvalCode}.`,
      result: response?.data ?? { approval_code: approvalCode },
    }
  })
}

export async function createFeishuExternalApprovalInstance(input: {
  approvalCode?: unknown
  instanceId?: unknown
  title?: unknown
  form?: unknown
  pcLink?: unknown
  mobileLink?: unknown
  userId?: unknown
  userName?: unknown
  status?: unknown
}) {
  return runJob('approval-instance-create', 'Sync Feishu approval instance', async () => {
    const appConfig = await loadFeishuAppConfig()
    const workspace = await loadFeishuWorkspaceConfig()
    const client: any = getClient(appConfig)
    const approvalCode = sanitizeToken(input.approvalCode) ?? workspace.approvalCode
    if (!approvalCode) throw new HttpError(400, 'approvalCode is required.')
    const pcLink =
      sanitizeUrl(input.pcLink) ??
      `${resolveWebBaseUrl(workspace)}/social-channels/feishu`
    const mobileLink = sanitizeUrl(input.mobileLink) ?? pcLink
    const form =
      Array.isArray(input.form) && input.form.every((item) => item && typeof item === 'object')
        ? input.form
        : []

    const timestamp = Date.now().toString()
    const response = await client.approval.externalInstance.create({
      data: {
        approval_code: approvalCode,
        status:
          input.status === 'APPROVED' ||
          input.status === 'REJECTED' ||
          input.status === 'CANCELED' ||
          input.status === 'DELETED' ||
          input.status === 'HIDDEN' ||
          input.status === 'TERMINATED'
            ? input.status
            : 'PENDING',
        instance_id:
          sanitizeToken(input.instanceId) ?? `inst_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`,
        links: {
          pc_link: pcLink,
          mobile_link: mobileLink,
        },
        title: sanitizeTitle(input.title, '1052 OS Approval Instance'),
        form,
        user_id: sanitizeToken(input.userId),
        user_name:
          typeof input.userName === 'string' && input.userName.trim()
            ? input.userName.trim()
            : undefined,
        start_time: timestamp,
        end_time: timestamp,
        update_time: timestamp,
        i18n_resources: [
          {
            locale: 'zh-CN',
            is_default: true,
            texts: [],
          },
        ],
      },
    })

    return {
      summary: 'Synced an external approval instance to Feishu.',
      result: response?.data?.data ?? {},
    }
  })
}

export async function searchFeishuApprovalTasks(input?: {
  approvalCode?: unknown
  userId?: unknown
}) {
  const appConfig = await loadFeishuAppConfig()
  const workspace = await loadFeishuWorkspaceConfig()
  const client: any = getClient(appConfig)
  const response = await client.approval.task.search({
    data: {
      approval_code: sanitizeToken(input?.approvalCode) ?? workspace.approvalCode,
      user_id: sanitizeToken(input?.userId),
      task_status: 'ALL',
    },
    params: {
      page_size: 100,
    },
  })
  return {
    count: response?.data?.count ?? 0,
    items: response?.data?.task_list ?? [],
  }
}

export async function listFeishuSearchDataSources() {
  const appConfig = await loadFeishuAppConfig()
  const client: any = getClient(appConfig)
  const response = await client.search.dataSource.list({
    params: {
      page_size: 100,
    },
  })
  return {
    items: response?.data?.items ?? [],
  }
}

export async function createFeishuSearchDataSource(input: {
  name?: unknown
  description?: unknown
  callbackEndpoint?: unknown
}) {
  return runJob('search-datasource-create', 'Create Feishu search data source', async () => {
    const appConfig = await loadFeishuAppConfig()
    const client: any = getClient(appConfig)
    const response = await client.search.dataSource.create({
      data: {
        name: sanitizeTitle(input.name, '1052 OS Search'),
        description:
          typeof input.description === 'string'
            ? input.description.trim()
            : '1052 OS indexed content',
        state: 1,
        i18n_name: {
          zh_cn: sanitizeTitle(input.name, '1052 OS Search'),
        },
        i18n_description: {
          zh_cn:
            typeof input.description === 'string'
              ? input.description.trim()
              : '1052 OS indexed content',
        },
        searchable_fields: ['title', 'type', 'tags'],
        connector_param: sanitizeUrl(input.callbackEndpoint)
          ? {
              callback_endpoint: sanitizeUrl(input.callbackEndpoint),
              callback_user_id_type: 3,
            }
          : undefined,
      },
    })
    const dataSourceId = response?.data?.data_source?.id
    if (dataSourceId) {
      await saveFeishuWorkspaceConfig({ searchDataSourceId: dataSourceId })
    }
    return {
      summary: 'Created a Feishu search data source.',
      result: response?.data?.data_source ?? {},
    }
  })
}

export async function indexFeishuSearchDataSourceItem(input: {
  dataSourceId?: unknown
  itemId?: unknown
  title?: unknown
  sourceUrl?: unknown
  structuredData?: unknown
  content?: unknown
  acl?: unknown
}) {
  const workspace = await loadFeishuWorkspaceConfig()
  const dataSourceId = sanitizeToken(input.dataSourceId) ?? workspace.searchDataSourceId
  if (!dataSourceId) throw new HttpError(400, 'searchDataSourceId is required.')
  return runJob('search-item-index', 'Index Feishu search data source item', async () => {
    const appConfig = await loadFeishuAppConfig()
    const client: any = getClient(appConfig)
    await client.search.dataSourceItem.create({
      path: {
        data_source_id: dataSourceId,
      },
      data: {
        id: sanitizeToken(input.itemId) ?? `item_${Date.now().toString(36)}`,
        acl: normalizeAcl(input.acl),
        metadata: {
          title: sanitizeTitle(input.title, '1052 OS Item'),
          source_url:
            sanitizeUrl(input.sourceUrl) ??
            `${resolveWebBaseUrl(workspace)}/social-channels/feishu`,
          create_time: Date.now(),
          update_time: Date.now(),
        },
        structured_data:
          typeof input.structuredData === 'string' && input.structuredData.trim()
            ? input.structuredData
            : JSON.stringify({ title: sanitizeTitle(input.title, '1052 OS Item') }),
        content:
          typeof input.content === 'string' && input.content.trim()
            ? {
                format: 'plaintext',
                content_data: input.content,
              }
            : undefined,
      },
    })

    return {
      summary: 'Indexed one search data source item.',
      result: {
        dataSourceId,
        itemId: sanitizeToken(input.itemId) ?? `item_${Date.now().toString(36)}`,
      },
    }
  })
}

export async function syncResourcesToFeishuSearch(input: {
  dataSourceId?: unknown
  acl?: unknown
}) {
  const workspace = await loadFeishuWorkspaceConfig()
  const dataSourceId = sanitizeToken(input.dataSourceId) ?? workspace.searchDataSourceId
  if (!dataSourceId) throw new HttpError(400, 'searchDataSourceId is required.')
  return runJob('search-resources-sync', 'Index resources into Feishu search', async () => {
    const appConfig = await loadFeishuAppConfig()
    const client: any = getClient(appConfig)
    const acl = normalizeAcl(input.acl)
    const resources = await listResources('', '', 300)
    const baseUrl = resolveWebBaseUrl(workspace)

    for (const resource of resources) {
      await client.search.dataSourceItem.create({
        path: {
          data_source_id: dataSourceId,
        },
        data: {
          id: `resource_${resource.id}`,
          acl,
          metadata: {
            title: resource.title || resource.id,
            source_url: `${baseUrl}/resources`,
            create_time: resource.createdAt,
            update_time: resource.updatedAt,
          },
          structured_data: JSON.stringify({
            id: resource.id,
            title: resource.title,
            type: 'resource',
            tags: resource.tags,
            status: resource.status,
          }),
          content: {
            format: 'plaintext',
            content_data: [resource.content, resource.note].filter(Boolean).join('\n\n'),
          },
        },
      })
    }

    return {
      summary: `Indexed ${resources.length} resources into Feishu search.`,
      result: {
        dataSourceId,
        count: resources.length,
      },
    }
  })
}

export async function logFeishuPlatformEvent(entry: Omit<FeishuEventLogRecord, 'id' | 'createdAt'>) {
  await appendFeishuEventLog({
    id: randomUUID(),
    type: entry.type,
    title: entry.title,
    detail: entry.detail,
    source: entry.source,
    createdAt: Date.now(),
  })
}
