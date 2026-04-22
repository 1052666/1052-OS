import { HttpError } from '../../../http-error.js'
import {
  createNoteFile,
  createNoteFolder,
  deleteNoteFile,
  deleteNoteFolder,
  getNoteFile,
  getNotesTree,
  moveNoteEntry,
  updateNoteFile,
} from '../../notes/notes.service.js'
import type { NoteTreeNode } from '../../notes/notes.types.js'
import type { AgentTool } from '../agent.tool.types.js'

type FlatNoteNode = Omit<NoteTreeNode, 'children'> & {
  childCount?: number
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeLimit(value: unknown, fallback = 80) {
  const raw = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
  return Math.min(Math.max(raw, 1), 300)
}

function assertConfirmed(value: unknown) {
  if (value !== true) {
    throw new HttpError(
      400,
      '修改笔记前必须先告知用户具体改动，并等待用户明确确认后再执行。',
    )
  }
}

function countFiles(nodes: NoteTreeNode[]): number {
  return nodes.reduce(
    (total, node) =>
      total + (node.type === 'file' ? 1 : 0) + (node.children ? countFiles(node.children) : 0),
    0,
  )
}

function countDirs(nodes: NoteTreeNode[]): number {
  return nodes.reduce(
    (total, node) =>
      total + (node.type === 'dir' ? 1 : 0) + (node.children ? countDirs(node.children) : 0),
    0,
  )
}

function toFlatNode(node: NoteTreeNode): FlatNoteNode {
  const { children, ...rest } = node
  return {
    ...rest,
    childCount: children?.length,
  }
}

function flattenTree(nodes: NoteTreeNode[]) {
  const results: FlatNoteNode[] = []
  const walk = (items: NoteTreeNode[]) => {
    for (const item of items) {
      results.push(toFlatNode(item))
      if (item.children) walk(item.children)
    }
  }
  walk(nodes)
  return results
}

function summarizeTopLevel(nodes: NoteTreeNode[]) {
  return nodes.map((node) => ({
    ...toFlatNode(node),
    fileCount: node.children ? countFiles(node.children) : node.type === 'file' ? 1 : 0,
    folderCount: node.children ? countDirs(node.children) : 0,
  }))
}

export const notesTools: AgentTool[] = [
  {
    name: 'notes_list_notes',
    description:
      'List or search the entire configured notes library, including all top-level folders and nested Markdown notes. Read-only. Use without query for a whole-library overview; use query to search all note names and note bodies.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional keyword searched across note file names and Markdown bodies.',
        },
        limit: {
          type: 'number',
          description: 'Maximum nested entries to return. Default 80, max 300.',
        },
        includeNested: {
          type: 'boolean',
          description:
            'When true, include nested entries in addition to the top-level overview. Search results always include nested matches.',
        },
      },
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      const query = normalizeText(input.query)
      const limit = normalizeLimit(input.limit)
      const includeNested = input.includeNested === true || Boolean(query)
      const tree = await getNotesTree(query)
      const nestedEntries = includeNested ? flattenTree(tree).slice(0, limit) : []

      return {
        scope: 'entire-notes-library',
        query,
        totals: {
          topLevel: tree.length,
          folders: countDirs(tree),
          notes: countFiles(tree),
        },
        topLevel: summarizeTopLevel(tree),
        nestedEntries,
        truncated: includeNested && flattenTree(tree).length > nestedEntries.length,
      }
    },
  },
  {
    name: 'notes_read_note',
    description:
      'Read any Markdown note under the configured notes root by relative path. Read-only.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Note relative path, for example inbox/todo.md or project.md.',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return getNoteFile(input.path)
    },
  },
  {
    name: 'notes_create_note',
    description:
      'Create a Markdown note anywhere under the configured notes root. Before calling, tell the user the target path/name and main content, then wait for explicit confirmation.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Target folder relative path. Use empty string for root.',
        },
        name: {
          type: 'string',
          description: 'Note file name. .md suffix is optional.',
        },
        content: {
          type: 'string',
          description: 'New note content.',
        },
        confirmed: {
          type: 'boolean',
          description: 'Must be true only after explicit user confirmation.',
        },
      },
      required: ['name', 'content', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      return createNoteFile(input)
    },
  },
  {
    name: 'notes_update_note',
    description:
      'Replace the full content of any Markdown note under the configured notes root. Before calling, tell the user which note will change and summarize the change, then wait for explicit confirmation.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Note relative path to update.',
        },
        content: {
          type: 'string',
          description: 'Complete updated note content, not a patch.',
        },
        confirmed: {
          type: 'boolean',
          description: 'Must be true only after explicit user confirmation.',
        },
      },
      required: ['path', 'content', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      return updateNoteFile(input)
    },
  },
  {
    name: 'notes_delete_note',
    description:
      'Delete any Markdown note under the configured notes root. Before calling, tell the user the note path, then wait for explicit confirmation.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Note relative path to delete.',
        },
        confirmed: {
          type: 'boolean',
          description: 'Must be true only after explicit user confirmation.',
        },
      },
      required: ['path', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      return deleteNoteFile(input.path)
    },
  },
  {
    name: 'notes_create_folder',
    description:
      'Create a folder anywhere under the configured notes root. Before calling, tell the user the folder path, then wait for explicit confirmation.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Parent folder relative path. Use empty string for root.',
        },
        name: {
          type: 'string',
          description: 'Folder name to create.',
        },
        confirmed: {
          type: 'boolean',
          description: 'Must be true only after explicit user confirmation.',
        },
      },
      required: ['name', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      return createNoteFolder(input)
    },
  },
  {
    name: 'notes_delete_folder',
    description:
      'Delete a folder and all contents under the configured notes root. Before calling, tell the user the folder path and that contents will be removed, then wait for explicit confirmation.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Folder relative path to delete.',
        },
        confirmed: {
          type: 'boolean',
          description: 'Must be true only after explicit user confirmation.',
        },
      },
      required: ['path', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      return deleteNoteFolder(input.path)
    },
  },
  {
    name: 'notes_move_entry',
    description:
      'Move a Markdown note or folder anywhere inside the configured notes root. Before calling, tell the user source and destination, then wait for explicit confirmation.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Source note or folder relative path.',
        },
        targetDir: {
          type: 'string',
          description: 'Destination folder relative path. Use empty string for root.',
        },
        confirmed: {
          type: 'boolean',
          description: 'Must be true only after explicit user confirmation.',
        },
      },
      required: ['path', 'targetDir', 'confirmed'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      assertConfirmed(input.confirmed)
      return moveNoteEntry(input)
    },
  },
]
