import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { config } from '../../../config.js'
import { HttpError } from '../../../http-error.js'
import { createFeishuClient, sendFeishuMessage } from './feishu.api.js'
import type {
  FeishuAppConfigRecord,
  FeishuMessageType,
  FeishuReceiveIdType,
} from './feishu.types.js'

const FEISHU_MEDIA_ROOT = path.join(config.dataDir, 'channels', 'feishu', 'media')
const GENERATED_IMAGE_ROOT = path.join(config.dataDir, 'generated-images')
const MAX_FEISHU_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_FEISHU_FILE_BYTES = 30 * 1024 * 1024
const MAX_FEISHU_DOWNLOAD_BYTES = 100 * 1024 * 1024
const MAX_OUTBOUND_MEDIA_PER_MESSAGE = 8

const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.bmp',
  '.ico',
  '.tif',
  '.tiff',
  '.heic',
])

const MIME_BY_EXT: Record<string, string> = {
  '.bmp': 'image/bmp',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.opus': 'audio/ogg',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.txt': 'text/plain',
  '.wav': 'audio/wav',
  '.webp': 'image/webp',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
  'audio/mpeg': '.mp3',
  'audio/ogg': '.opus',
  'audio/wav': '.wav',
  'image/bmp': '.bmp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/tiff': '.tiff',
  'image/webp': '.webp',
  'text/markdown': '.md',
  'text/plain': '.txt',
  'video/mp4': '.mp4',
}

export type FeishuMediaKind = 'image' | 'file' | 'audio' | 'media' | 'sticker'
export type FeishuOutboundSendMode = 'auto' | 'image' | 'file' | 'audio' | 'media'

export type SavedFeishuMedia = {
  id: string
  kind: FeishuMediaKind
  fileName: string
  originalFileName?: string
  mimeType: string
  sizeBytes: number
  relativePath: string
  absolutePath: string
  url: string
  fileKey?: string
  imageKey?: string
  durationMs?: number
  coverUrl?: string
}

export type FeishuOutboundMedia = {
  text: string
  files: string[]
  warnings: string[]
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
  return name.slice(0, 160) || 'media'
}

function publicFeishuMediaUrl(relativePath: string) {
  return (
    '/api/channels/feishu/media/' +
    relativePath.split(path.sep).map(encodeURIComponent).join('/')
  )
}

function mimeFromName(fileName: string, fallback = 'application/octet-stream') {
  return MIME_BY_EXT[path.extname(fileName).toLowerCase()] ?? fallback
}

function extensionFromMime(mimeType: string, fallback = '.bin') {
  return EXT_BY_MIME[mimeType.split(';')[0]?.trim().toLowerCase() ?? ''] ?? fallback
}

function extensionFromFileName(fileName: string) {
  const ext = path.extname(fileName).toLowerCase()
  return ext && ext.length <= 12 ? ext : ''
}

function assertInside(root: string, candidate: string) {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(candidate)
  if (
    resolvedCandidate !== resolvedRoot &&
    !resolvedCandidate.startsWith(resolvedRoot + path.sep)
  ) {
    throw new HttpError(400, 'Resolved media path escapes the allowed directory.')
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

function cleanMarkdownUrl(value: string) {
  return value
    .trim()
    .replace(/^<|>$/g, '')
    .replace(/^['"]|['"]$/g, '')
}

function assertMaxBytes(size: number, label: string, maxBytes: number) {
  if (size > maxBytes) {
    throw new HttpError(
      413,
      `${label} is too large (${Math.ceil(size / 1024 / 1024)}MB). The current limit is ${Math.ceil(
        maxBytes / 1024 / 1024,
      )}MB.`,
    )
  }
}

async function pathIfExisting(filePath: string) {
  const stat = await fs.stat(filePath).catch(() => null)
  return stat?.isFile() ? filePath : null
}

async function fetchRemoteBuffer(url: string) {
  const response = await fetch(url)
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new HttpError(
      response.status,
      `Failed to fetch outbound media ${response.status}: ${text || response.statusText}`,
    )
  }
  const contentType =
    response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ??
    'application/octet-stream'
  const buffer = Buffer.from(await response.arrayBuffer())
  assertMaxBytes(buffer.byteLength, 'Remote media', MAX_FEISHU_FILE_BYTES)
  return { buffer, contentType }
}

async function cacheRemoteOutboundMedia(url: string) {
  const { buffer, contentType } = await fetchRemoteBuffer(url)
  const fromUrl = (() => {
    try {
      return path.basename(new URL(url).pathname)
    } catch {
      return ''
    }
  })()
  const ext = extensionFromFileName(fromUrl) || extensionFromMime(contentType)
  const folder = path.join('outbound-cache', nowFolder())
  const dir = path.join(FEISHU_MEDIA_ROOT, folder)
  await fs.mkdir(dir, { recursive: true })
  const filePath = path.join(dir, `${randomUUID()}${ext}`)
  await fs.writeFile(filePath, buffer)
  return filePath
}

async function resolveOutboundMediaReference(reference: string) {
  const value = cleanMarkdownUrl(reference)
  if (!value) return null

  if (value.startsWith('/api/generated-images/')) {
    const relative = splitUrlPath(value.slice('/api/generated-images/'.length))
    return pathIfExisting(
      assertInside(GENERATED_IMAGE_ROOT, path.join(GENERATED_IMAGE_ROOT, relative)),
    )
  }

  if (value.startsWith('/api/channels/feishu/media/')) {
    const relative = splitUrlPath(value.slice('/api/channels/feishu/media/'.length))
    return pathIfExisting(
      assertInside(FEISHU_MEDIA_ROOT, path.join(FEISHU_MEDIA_ROOT, relative)),
    )
  }

  if (value.startsWith('/api/channels/wechat/media/')) {
    const wechatRoot = path.join(config.dataDir, 'channels', 'wechat', 'media')
    const relative = splitUrlPath(value.slice('/api/channels/wechat/media/'.length))
    return pathIfExisting(assertInside(wechatRoot, path.join(wechatRoot, relative)))
  }

  if (value.startsWith('file://')) {
    return pathIfExisting(fileURLToPath(value))
  }

  if (/^https?:\/\//i.test(value)) {
    return cacheRemoteOutboundMedia(value)
  }

  if (path.isAbsolute(value)) {
    return pathIfExisting(value)
  }

  return null
}

export async function extractOutboundFeishuMedia(text: string): Promise<FeishuOutboundMedia> {
  const references: string[] = []
  let cleaned = text

  cleaned = cleaned.replace(
    /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (_match, raw: string) => {
      references.push(raw)
      return ''
    },
  )

  cleaned = cleaned.replace(
    /\[([^\]]+)]\(((?:\/api\/(?:generated-images|channels\/feishu\/media|channels\/wechat\/media)\/[^)\s]+)|(?:file:\/\/[^)\s]+))(?:(?:\s+"[^"]*"))?\)/g,
    (_match, label: string, raw: string) => {
      references.push(raw)
      return label
    },
  )

  cleaned = cleaned.replace(
    /(^|\s)((?:\/api\/(?:generated-images|channels\/feishu\/media|channels\/wechat\/media)\/[^\s)]+)|(?:file:\/\/[^\s)]+))/g,
    (match, prefix: string, raw: string) => {
      references.push(raw)
      return match.startsWith(prefix) ? prefix : ''
    },
  )

  const files: string[] = []
  const warnings: string[] = []
  for (const reference of references.slice(0, MAX_OUTBOUND_MEDIA_PER_MESSAGE)) {
    try {
      const filePath = await resolveOutboundMediaReference(reference)
      if (filePath) {
        files.push(filePath)
      } else {
        warnings.push(`Media file not found: ${reference}`)
      }
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error))
    }
  }

  if (references.length > MAX_OUTBOUND_MEDIA_PER_MESSAGE) {
    warnings.push(
      `Only the first ${MAX_OUTBOUND_MEDIA_PER_MESSAGE} media attachments were forwarded this time.`,
    )
  }

  return {
    text: cleaned.replace(/\n{4,}/g, '\n\n\n').trim(),
    files,
    warnings,
  }
}

async function streamToBuffer(readable: NodeJS.ReadableStream) {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of readable as AsyncIterable<Buffer | Uint8Array | string>) {
    const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += next.byteLength
    assertMaxBytes(total, 'Feishu inbound media', MAX_FEISHU_DOWNLOAD_BYTES)
    chunks.push(next)
  }
  return Buffer.concat(chunks)
}

async function readSdkBinaryResponse(response: any) {
  if (response && typeof response.getReadableStream === 'function') {
    return streamToBuffer(response.getReadableStream())
  }
  if (response?.data instanceof ArrayBuffer) {
    const buffer = Buffer.from(response.data)
    assertMaxBytes(buffer.byteLength, 'Feishu inbound media', MAX_FEISHU_DOWNLOAD_BYTES)
    return buffer
  }
  if (Buffer.isBuffer(response?.data)) {
    assertMaxBytes(response.data.byteLength, 'Feishu inbound media', MAX_FEISHU_DOWNLOAD_BYTES)
    return response.data
  }
  throw new HttpError(502, 'Feishu media download returned an unsupported response body.')
}

async function downloadFeishuMessageResource(params: {
  config: FeishuAppConfigRecord
  messageId: string
  resourceKey: string
  resourceType: 'image' | 'file'
}) {
  const client = createFeishuClient(params.config)
  const response = await client.im.messageResource.get({
    params: {
      type: params.resourceType,
    },
    path: {
      message_id: params.messageId,
      file_key: params.resourceKey,
    },
  } as any)
  return readSdkBinaryResponse(response)
}

async function saveFeishuMedia(params: {
  buffer: Buffer
  kind: FeishuMediaKind
  mimeType: string
  originalFileName?: string
  fileKey?: string
  imageKey?: string
  durationMs?: number
  coverUrl?: string
}) {
  assertMaxBytes(params.buffer.byteLength, 'Feishu media', MAX_FEISHU_DOWNLOAD_BYTES)
  const id = randomUUID()
  const original = params.originalFileName ? sanitizeFileName(params.originalFileName) : undefined
  const ext = extensionFromFileName(original ?? '') || extensionFromMime(params.mimeType)
  const fileName = `${id}${ext}`
  const folder = path.join('inbound', nowFolder())
  const dir = path.join(FEISHU_MEDIA_ROOT, folder)
  await fs.mkdir(dir, { recursive: true })
  const absolutePath = path.join(dir, fileName)
  await fs.writeFile(absolutePath, params.buffer)
  const relativePath = path.join(folder, fileName)
  return {
    id,
    kind: params.kind,
    fileName,
    originalFileName: original,
    mimeType: params.mimeType,
    sizeBytes: params.buffer.byteLength,
    relativePath,
    absolutePath,
    url: publicFeishuMediaUrl(relativePath),
    fileKey: params.fileKey,
    imageKey: params.imageKey,
    durationMs: params.durationMs,
    coverUrl: params.coverUrl,
  } satisfies SavedFeishuMedia
}

export async function downloadFeishuImageAttachment(params: {
  config: FeishuAppConfigRecord
  messageId: string
  imageKey: string
  fileName?: string
}) {
  const buffer = await downloadFeishuMessageResource({
    config: params.config,
    messageId: params.messageId,
    resourceKey: params.imageKey,
    resourceType: 'image',
  })
  return saveFeishuMedia({
    buffer,
    kind: 'image',
    mimeType: mimeFromName(params.fileName ?? `${params.imageKey}.jpg`, 'image/jpeg'),
    originalFileName: params.fileName ?? `${params.imageKey}.jpg`,
    imageKey: params.imageKey,
  })
}

export async function downloadFeishuFileAttachment(params: {
  config: FeishuAppConfigRecord
  messageId: string
  fileKey: string
  kind: Exclude<FeishuMediaKind, 'image' | 'sticker'>
  fileName?: string
  durationMs?: number
  coverImageKey?: string
}) {
  const buffer = await downloadFeishuMessageResource({
    config: params.config,
    messageId: params.messageId,
    resourceKey: params.fileKey,
    resourceType: 'file',
  })

  let coverUrl: string | undefined
  if (params.coverImageKey) {
    const cover = await downloadFeishuImageAttachment({
      config: params.config,
      messageId: params.messageId,
      imageKey: params.coverImageKey,
      fileName: `${params.coverImageKey}.jpg`,
    }).catch(() => null)
    coverUrl = cover?.url
  }

  return saveFeishuMedia({
    buffer,
    kind: params.kind,
    mimeType: mimeFromName(params.fileName ?? `${params.fileKey}.bin`),
    originalFileName: params.fileName ?? `${params.fileKey}.bin`,
    fileKey: params.fileKey,
    durationMs: params.durationMs,
    coverUrl,
  })
}

export function buildFeishuMediaMarkdown(media: SavedFeishuMedia) {
  const label = media.originalFileName || media.fileName
  if (media.kind === 'image') return `![飞书图片：${label}](${media.url})`
  if (media.kind === 'audio') return `[飞书音频：${label}](${media.url})`
  if (media.kind === 'media') {
    if (media.coverUrl) {
      return `![飞书视频封面：${label}](${media.coverUrl})\n\n[飞书视频：${label}](${media.url})`
    }
    return `[飞书视频：${label}](${media.url})`
  }
  if (media.kind === 'sticker') return `[飞书表情包：${label}]`
  return `[飞书文件：${label}](${media.url})`
}

function inferUploadMode(params: {
  fileName: string
  mimeType: string
  sizeBytes: number
  mode: FeishuOutboundSendMode
}) {
  const ext = extensionFromFileName(params.fileName)
  const mimeType = params.mimeType.split(';')[0]?.trim().toLowerCase() ?? 'application/octet-stream'
  const warnings: string[] = []
  let nextMode = params.mode

  if (nextMode === 'auto') {
    if (IMAGE_EXTENSIONS.has(ext) || mimeType.startsWith('image/')) {
      nextMode = 'image'
    } else if (ext === '.opus') {
      nextMode = 'audio'
    } else if (ext === '.mp4' || mimeType === 'video/mp4') {
      nextMode = 'media'
    } else {
      nextMode = 'file'
    }
  }

  if (nextMode === 'image') {
    if (!IMAGE_EXTENSIONS.has(ext) && !mimeType.startsWith('image/')) {
      nextMode = 'file'
      warnings.push(`Image mode is not supported for ${params.fileName}; sent as a normal file.`)
    } else if (params.sizeBytes > MAX_FEISHU_IMAGE_BYTES) {
      nextMode = 'file'
      warnings.push(`Image ${params.fileName} exceeds 10MB; sent as a normal file.`)
    }
  }

  if (nextMode === 'audio' && ext !== '.opus') {
    nextMode = 'file'
    warnings.push(`Feishu audio messages require OPUS files; ${params.fileName} was sent as a normal file.`)
  }

  if (nextMode === 'media' && ext !== '.mp4' && mimeType !== 'video/mp4') {
    nextMode = 'file'
    warnings.push(`Feishu video messages currently require MP4 files; ${params.fileName} was sent as a normal file.`)
  }

  return {
    mode: nextMode,
    warnings,
  }
}

function inferFeishuFileType(fileName: string, mode: 'file' | 'audio' | 'media') {
  const ext = extensionFromFileName(fileName)
  if (mode === 'audio') return 'opus'
  if (mode === 'media') return 'mp4'
  if (ext === '.pdf') return 'pdf'
  if (ext === '.doc') return 'doc'
  if (ext === '.xls') return 'xls'
  if (ext === '.ppt') return 'ppt'
  return 'stream'
}

async function uploadFeishuImage(params: {
  config: FeishuAppConfigRecord
  buffer: Buffer
}) {
  const client = createFeishuClient(params.config)
  const response = await client.im.image.create({
    data: {
      image_type: 'message',
      image: params.buffer,
    } as any,
  } as any)
  const imageKey =
    typeof response?.image_key === 'string'
      ? response.image_key
      : ''
  if (!imageKey) {
    throw new HttpError(502, 'Feishu image upload failed.')
  }
  return imageKey
}

async function uploadFeishuFile(params: {
  config: FeishuAppConfigRecord
  buffer: Buffer
  fileName: string
  fileType: string
  durationMs?: number
}) {
  const client = createFeishuClient(params.config)
  const response = await client.im.file.create({
    data: {
      file_type: params.fileType,
      file_name: params.fileName,
      duration: params.durationMs,
      file: params.buffer,
    } as any,
  } as any)
  const fileKey =
    typeof response?.file_key === 'string'
      ? response.file_key
      : ''
  if (!fileKey) {
    throw new HttpError(502, 'Feishu file upload failed.')
  }
  return fileKey
}

async function sendFeishuUploadedBuffer(params: {
  config: FeishuAppConfigRecord
  receiveIdType: FeishuReceiveIdType
  receiveId: string
  fileName: string
  mimeType: string
  buffer: Buffer
  mode?: FeishuOutboundSendMode
}) {
  assertMaxBytes(params.buffer.byteLength, params.fileName || 'Feishu media', MAX_FEISHU_FILE_BYTES)
  const fileName = sanitizeFileName(params.fileName || `upload${extensionFromMime(params.mimeType)}`)
  const inferred = inferUploadMode({
    fileName,
    mimeType: params.mimeType || mimeFromName(fileName),
    sizeBytes: params.buffer.byteLength,
    mode: params.mode ?? 'auto',
  })
  const warnings = [...inferred.warnings]

  if (inferred.mode === 'image') {
    const imageKey = await uploadFeishuImage({
      config: params.config,
      buffer: params.buffer,
    }).catch(async (error) => {
      warnings.push(
        `Image upload failed and was downgraded to a normal file: ${error instanceof Error ? error.message : String(error)}`,
      )
      const fileKey = await uploadFeishuFile({
        config: params.config,
        buffer: params.buffer,
        fileName,
        fileType: inferFeishuFileType(fileName, 'file'),
      })
      return { downgradedFileKey: fileKey }
    })

    if (typeof imageKey === 'object' && imageKey?.downgradedFileKey) {
      const result = await sendFeishuMessage({
        config: params.config,
        receiveIdType: params.receiveIdType,
        receiveId: params.receiveId,
        msgType: 'file',
        content: JSON.stringify({ file_key: imageKey.downgradedFileKey }),
      })
      return { result, warnings }
    }

    const result = await sendFeishuMessage({
      config: params.config,
      receiveIdType: params.receiveIdType,
      receiveId: params.receiveId,
      msgType: 'image',
      content: JSON.stringify({ image_key: imageKey }),
    })
    return { result, warnings }
  }

  const fileMode = inferred.mode === 'audio' || inferred.mode === 'media' ? inferred.mode : 'file'
  const fileKey = await uploadFeishuFile({
    config: params.config,
    buffer: params.buffer,
    fileName,
    fileType: inferFeishuFileType(fileName, fileMode),
  })

  const msgType: FeishuMessageType =
    inferred.mode === 'audio'
      ? 'audio'
      : inferred.mode === 'media'
        ? 'media'
        : 'file'
  const content =
    msgType === 'media'
      ? JSON.stringify({ file_key: fileKey })
      : JSON.stringify({ file_key: fileKey })
  const result = await sendFeishuMessage({
    config: params.config,
    receiveIdType: params.receiveIdType,
    receiveId: params.receiveId,
    msgType,
    content,
  })
  return { result, warnings }
}

export async function sendFeishuMediaFile(params: {
  config: FeishuAppConfigRecord
  receiveIdType: FeishuReceiveIdType
  receiveId: string
  filePath: string
  mode?: FeishuOutboundSendMode
}) {
  const existing = await pathIfExisting(params.filePath)
  if (!existing) throw new HttpError(404, 'Feishu media file does not exist.')
  const stat = await fs.stat(existing)
  assertMaxBytes(stat.size, path.basename(existing), MAX_FEISHU_FILE_BYTES)
  const buffer = await fs.readFile(existing)
  return sendFeishuUploadedBuffer({
    config: params.config,
    receiveIdType: params.receiveIdType,
    receiveId: params.receiveId,
    fileName: path.basename(existing),
    mimeType: mimeFromName(existing),
    buffer,
    mode: params.mode,
  })
}

export async function sendFeishuMediaBuffer(params: {
  config: FeishuAppConfigRecord
  receiveIdType: FeishuReceiveIdType
  receiveId: string
  fileName: string
  mimeType: string
  buffer: Buffer
  mode?: FeishuOutboundSendMode
}) {
  return sendFeishuUploadedBuffer(params)
}
