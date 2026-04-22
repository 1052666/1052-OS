import type { AgentTool } from '../agent.tool.types.js'
import {
  createFeishuCalendar,
  createFeishuCalendarEvent,
  createFeishuExternalApprovalDefinition,
  createFeishuExternalApprovalInstance,
  createFeishuSearchDataSource,
  createFeishuTask,
  importMarkdownDocument,
  indexFeishuSearchDataSourceItem,
  listFeishuCalendars,
  listFeishuCalendarEvents,
  listFeishuSearchDataSources,
  listFeishuTasks,
  moveDocumentToFeishuWiki,
  readFeishuDocumentRawContent,
  searchFeishuApprovalTasks,
  syncMemoryToFeishuDoc,
  syncNotesToFeishuDoc,
  syncResourcesToFeishuBitable,
  syncResourcesToFeishuDoc,
  syncResourcesToFeishuSearch,
} from '../../channels/feishu/feishu.workspace.service.js'

export const feishuTools: AgentTool[] = [
  {
    name: 'feishu_import_markdown_doc',
    description:
      'Import Markdown content into Feishu Docs as a docx document inside the configured Feishu drive folder.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        markdown: { type: 'string' },
        folderToken: { type: 'string' },
      },
      required: ['title', 'markdown'],
      additionalProperties: false,
    },
    execute: async (args) => importMarkdownDocument((args ?? {}) as Record<string, unknown>),
  },
  {
    name: 'feishu_read_doc_raw_content',
    description: 'Read one Feishu docx document as raw plain text.',
    parameters: {
      type: 'object',
      properties: {
        documentId: { type: 'string' },
      },
      required: ['documentId'],
      additionalProperties: false,
    },
    execute: async (args) =>
      readFeishuDocumentRawContent((args as Record<string, unknown> | undefined)?.documentId),
  },
  {
    name: 'feishu_sync_resources_doc',
    description: 'Export the current 1052 OS resources library into a Feishu document.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => syncResourcesToFeishuDoc(),
  },
  {
    name: 'feishu_sync_notes_doc',
    description:
      'Export the notes index or one note under the configured notes root into a Feishu document.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Optional note path under the configured notes root.' },
      },
      additionalProperties: false,
    },
    execute: async (args) => syncNotesToFeishuDoc((args ?? {}) as Record<string, unknown>),
  },
  {
    name: 'feishu_sync_memory_doc',
    description: 'Export long-term memory profiles into a Feishu document.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => syncMemoryToFeishuDoc(),
  },
  {
    name: 'feishu_sync_resources_bitable',
    description:
      'Sync the current 1052 OS resources library into a Feishu Bitable app/table. Uses configured app/table when available, otherwise creates them in the configured drive folder.',
    parameters: {
      type: 'object',
      properties: {
        appToken: { type: 'string' },
        tableId: { type: 'string' },
      },
      additionalProperties: false,
    },
    execute: async (args) =>
      syncResourcesToFeishuBitable((args ?? {}) as Record<string, unknown>),
  },
  {
    name: 'feishu_mount_doc_to_wiki',
    description:
      'Mount one Feishu document into the configured Feishu Wiki space or a specified Wiki space.',
    parameters: {
      type: 'object',
      properties: {
        documentToken: { type: 'string' },
        spaceId: { type: 'string' },
        parentWikiToken: { type: 'string' },
        title: { type: 'string' },
      },
      required: ['documentToken'],
      additionalProperties: false,
    },
    execute: async (args) => moveDocumentToFeishuWiki((args ?? {}) as Record<string, unknown>),
  },
  {
    name: 'feishu_list_calendars',
    description: 'List Feishu calendars available to the current app identity.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => listFeishuCalendars(),
  },
  {
    name: 'feishu_create_calendar',
    description: 'Create a shared Feishu calendar.',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        description: { type: 'string' },
        permissions: { type: 'string', description: 'private, show_only_free_busy, or public.' },
      },
      additionalProperties: false,
    },
    execute: async (args) => createFeishuCalendar((args ?? {}) as Record<string, unknown>),
  },
  {
    name: 'feishu_list_calendar_events',
    description: 'List Feishu calendar events from one calendar.',
    parameters: {
      type: 'object',
      properties: {
        calendarId: { type: 'string' },
      },
      additionalProperties: false,
    },
    execute: async (args) =>
      listFeishuCalendarEvents((args ?? {}) as Record<string, unknown>),
  },
  {
    name: 'feishu_create_calendar_event',
    description: 'Create one Feishu calendar event using Unix millisecond timestamps.',
    parameters: {
      type: 'object',
      properties: {
        calendarId: { type: 'string' },
        summary: { type: 'string' },
        description: { type: 'string' },
        startTimestamp: { type: 'string' },
        endTimestamp: { type: 'string' },
        timezone: { type: 'string' },
        locationName: { type: 'string' },
      },
      required: ['summary', 'startTimestamp', 'endTimestamp'],
      additionalProperties: false,
    },
    execute: async (args) =>
      createFeishuCalendarEvent((args ?? {}) as Record<string, unknown>),
  },
  {
    name: 'feishu_list_tasks',
    description: 'List Feishu tasks available to the current app identity.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => listFeishuTasks(),
  },
  {
    name: 'feishu_create_task',
    description: 'Create one Feishu task.',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        description: { type: 'string' },
        dueTimestamp: { type: 'string' },
        completedAt: { type: 'string' },
      },
      required: ['summary'],
      additionalProperties: false,
    },
    execute: async (args) => createFeishuTask((args ?? {}) as Record<string, unknown>),
  },
  {
    name: 'feishu_create_approval_definition',
    description: 'Create one external Feishu approval definition for 1052 OS workflows.',
    parameters: {
      type: 'object',
      properties: {
        approvalCode: { type: 'string' },
        approvalName: { type: 'string' },
        description: { type: 'string' },
        groupCode: { type: 'string' },
        groupName: { type: 'string' },
      },
      additionalProperties: false,
    },
    execute: async (args) =>
      createFeishuExternalApprovalDefinition((args ?? {}) as Record<string, unknown>),
  },
  {
    name: 'feishu_create_approval_instance',
    description: 'Create or sync one external Feishu approval instance.',
    parameters: {
      type: 'object',
      properties: {
        approvalCode: { type: 'string' },
        instanceId: { type: 'string' },
        title: { type: 'string' },
        form: { type: 'array', items: { type: 'object' } },
        pcLink: { type: 'string' },
        mobileLink: { type: 'string' },
        userId: { type: 'string' },
        userName: { type: 'string' },
        status: { type: 'string' },
      },
      additionalProperties: false,
    },
    execute: async (args) =>
      createFeishuExternalApprovalInstance((args ?? {}) as Record<string, unknown>),
  },
  {
    name: 'feishu_search_approval_tasks',
    description: 'Search Feishu approval tasks.',
    parameters: {
      type: 'object',
      properties: {
        approvalCode: { type: 'string' },
        userId: { type: 'string' },
      },
      additionalProperties: false,
    },
    execute: async (args) =>
      searchFeishuApprovalTasks((args ?? {}) as Record<string, unknown>),
  },
  {
    name: 'feishu_list_search_data_sources',
    description: 'List Feishu search connector data sources created by the current app.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => listFeishuSearchDataSources(),
  },
  {
    name: 'feishu_create_search_data_source',
    description: 'Create one Feishu search connector data source.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        callbackEndpoint: { type: 'string' },
      },
      additionalProperties: false,
    },
    execute: async (args) =>
      createFeishuSearchDataSource((args ?? {}) as Record<string, unknown>),
  },
  {
    name: 'feishu_index_search_item',
    description:
      'Index one item into a Feishu search data source. acl must be provided as an array of Feishu ACL rules.',
    parameters: {
      type: 'object',
      properties: {
        dataSourceId: { type: 'string' },
        itemId: { type: 'string' },
        title: { type: 'string' },
        sourceUrl: { type: 'string' },
        structuredData: { type: 'string' },
        content: { type: 'string' },
        acl: { type: 'array', items: { type: 'object' } },
      },
      required: ['title', 'acl'],
      additionalProperties: false,
    },
    execute: async (args) =>
      indexFeishuSearchDataSourceItem((args ?? {}) as Record<string, unknown>),
  },
  {
    name: 'feishu_sync_resources_search',
    description:
      'Index the current resources library into the configured Feishu search data source. acl must be provided as an array of Feishu ACL rules.',
    parameters: {
      type: 'object',
      properties: {
        dataSourceId: { type: 'string' },
        acl: { type: 'array', items: { type: 'object' } },
      },
      required: ['acl'],
      additionalProperties: false,
    },
    execute: async (args) =>
      syncResourcesToFeishuSearch((args ?? {}) as Record<string, unknown>),
  },
]
