import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { config } from '../../config.js'
import { HttpError } from '../../http-error.js'
import { buildAttachmentContextMarkdown } from './agent.attachment-context.js'

export const AGENT_UPLOAD_ROOT = path.join(config.dataDir, '1052', 'uploads')
const MAX_AGENT_UPLOAD_BYTES = 30 * 1024 * 1024

const MIME_BY_EXT: Record<string, string> = {
  '.bmp': 'image/bmp',
  '.csv': 'text/csv',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip',
}

const EXT_BY_MIME: Record<string, string> = {
  'application/json': '.json',
  'application/msword': '.doc',
  'application/pdf': '.pdf',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/zip': '.zip',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'image/bmp': '.bmp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'text/csv': '.csv',
  'text/markdown': '.md',
  'text/plain': '.txt',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
}

export type AgentUploadKind = 'image' | 'file'

export type AgentUploadedFile = {
  id: string
  kind: AgentUploadKind
  fileName: string
  originalFileName: string
  mimeType: string
  sizeBytes: number
  relativePath: string
  absolutePath: string
  url: string
  markdown: string
}

function nowFolder() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function sanitizeFileName(value: string) {
  const name = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  return name.slice(0, 160) || 'upload'
}

function mimeFromName(fileName: string, fallback = 'application/octet-stream') {
  return MIME_BY_EXT[path.extname(fileName).toLowerCase()] ?? fallback
}

function extensionFromMime(mimeType: string, fallback = '.bin') {
  const normalized = mimeType.split(';')[0]?.trim().toLowerCase() ?? ''
  return EXT_BY_MIME[normalized] ?? fallback
}

function extensionFromFileName(fileName: string) {
  const ext = path.extname(fileName).toLowerCase()
  return ext && ext.length <= 12 ? ext : ''
}

function normalizeMimeType(fileName: string, mimeType?: string) {
  const normalized = mimeType?.split(';')[0]?.trim().toLowerCase()
  if (normalized && normalized !== 'application/octet-stream') return normalized
  return mimeFromName(fileName)
}

function publicAgentUploadUrl(relativePath: string) {
  return '/api/agent/uploads/' + relativePath.split(path.sep).map(encodeURIComponent).join('/')
}

function assertInside(root: string, candidate: string) {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(candidate)
  if (
    resolvedCandidate !== resolvedRoot &&
    !resolvedCandidate.startsWith(resolvedRoot + path.sep)
  ) {
    throw new HttpError(400, 'Resolved upload path escapes the allowed directory.')
  }
  return resolvedCandidate
}

function splitUrlPath(value: string) {
  return value
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment))
    .join(path.sep)
}

async function pathIfExisting(filePath: string) {
  const stat = await fs.stat(filePath).catch(() => null)
  return stat?.isFile() ? filePath : null
}

export async function saveAgentUpload(params: {
  buffer: Buffer
  fileName: string
  mimeType?: string
}) {
  if (!params.buffer?.byteLength || !params.fileName?.trim()) {
    throw new HttpError(400, 'An uploaded file is required.')
  }
  if (params.buffer.byteLength > MAX_AGENT_UPLOAD_BYTES) {
    throw new HttpError(
      413,
      `Uploaded file is too large (${Math.ceil(params.buffer.byteLength / 1024 / 1024)}MB). The current limit is 30MB.`,
    )
  }

  const id = randomUUID()
  const originalFileName = sanitizeFileName(params.fileName)
  const mimeType = normalizeMimeType(originalFileName, params.mimeType)
  const ext = extensionFromFileName(originalFileName) || extensionFromMime(mimeType)
  const fileName = `${id}${ext}`
  const folder = nowFolder()
  const relativePath = path.join(folder, fileName)
  const absolutePath = path.join(AGENT_UPLOAD_ROOT, relativePath)

  await fs.mkdir(path.dirname(absolutePath), { recursive: true })
  await fs.writeFile(absolutePath, params.buffer)

  const kind: AgentUploadKind = mimeType.startsWith('image/') ? 'image' : 'file'
  const url = publicAgentUploadUrl(relativePath)

  const markdown = await buildAttachmentContextMarkdown({
    sourceLabel: kind === 'image' ? '网页上传图片' : '网页上传文件',
    displayName: originalFileName,
    url,
    absolutePath,
    mimeType,
    sizeBytes: params.buffer.byteLength,
    isImage: kind === 'image',
  })

  return {
    id,
    kind,
    fileName,
    originalFileName,
    mimeType,
    sizeBytes: params.buffer.byteLength,
    relativePath,
    absolutePath,
    url,
    markdown,
  } satisfies AgentUploadedFile
}

export async function resolveAgentUploadReference(reference: string) {
  const value = reference.trim().replace(/^<|>$/g, '').replace(/^['"]|['"]$/g, '')
  if (!value.startsWith('/api/agent/uploads/')) return null
  const relative = splitUrlPath(value.slice('/api/agent/uploads/'.length))
  return pathIfExisting(assertInside(AGENT_UPLOAD_ROOT, path.join(AGENT_UPLOAD_ROOT, relative)))
}
