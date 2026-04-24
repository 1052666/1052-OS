import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from '../../../config.js'
import { HttpError } from '../../../http-error.js'
import { buildAttachmentContextMarkdown } from '../../agent/agent.attachment-context.js'
import { resolveAgentUploadReference } from '../../agent/agent.upload.service.js'
import {
  getWechatUploadUrl,
  sendWechatMessageItem,
  type WechatUploadUrlResponse,
} from './wechat.api.js'
import type { WechatCdnMedia, WechatMessageItem } from './wechat.types.js'

export const WECHAT_CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c'

const WECHAT_MEDIA_ROOT = path.join(config.dataDir, 'channels', 'wechat', 'media')
const GENERATED_IMAGE_ROOT = path.join(config.dataDir, 'generated-images')
const MAX_WECHAT_MEDIA_BYTES = 100 * 1024 * 1024
const FETCH_TIMEOUT_MS = 60_000
const MAX_OUTBOUND_MEDIA_PER_MESSAGE = 8
const CDN_UPLOAD_RETRIES = 3

const ITEM_TYPE = {
  image: 2,
  voice: 3,
  file: 4,
  video: 5,
} as const

const UPLOAD_MEDIA_TYPE = {
  image: 1,
  video: 2,
  file: 3,
} as const

export type WechatMediaKind = 'image' | 'voice' | 'file' | 'video'

export type SavedWechatMedia = {
  id: string
  kind: WechatMediaKind
  fileName: string
  originalFileName?: string
  mimeType: string
  sizeBytes: number
  relativePath: string
  absolutePath: string
  url: string
  text?: string
}

export type OutboundWechatMedia = {
  text: string
  files: string[]
  warnings: string[]
}

type UploadResult = {
  aeskeyHex: string
  encryptedQueryParam: string
  ciphertextSize: number
  plaintextSize: number
  mimeType: string
  fileName: string
}

const MIME_BY_EXT: Record<string, string> = {
  '.avif': 'image/avif',
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
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.rar': 'application/vnd.rar',
  '.silk': 'audio/silk',
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
  'application/pdf': '.pdf',
  'application/zip': '.zip',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/silk': '.silk',
  'audio/wav': '.wav',
  'image/avif': '.avif',
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
  'video/quicktime': '.mov',
  'video/webm': '.webm',
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

function publicWechatMediaUrl(relativePath: string) {
  return (
    '/api/channels/wechat/media/' +
    relativePath.split(path.sep).map(encodeURIComponent).join('/')
  )
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

function guessInboundName(kind: WechatMediaKind, item: WechatMessageItem) {
  if (kind === 'file' && item.file_item?.file_name) return item.file_item.file_name
  if (kind === 'image') return `wechat-image${extensionFromMime('image/jpeg')}`
  if (kind === 'voice') return 'wechat-voice.silk'
  if (kind === 'video') return 'wechat-video.mp4'
  return 'wechat-media.bin'
}

function assertSize(size: number, label: string) {
  if (size > MAX_WECHAT_MEDIA_BYTES) {
    throw new HttpError(
      413,
      `${label} is too large (${Math.ceil(size / 1024 / 1024)}MB). The current limit is 100MB.`,
    )
  }
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

function parseAesKey(value: string) {
  const cleaned = value.trim()
  if (/^[0-9a-f]{32}$/i.test(cleaned)) return Buffer.from(cleaned, 'hex')

  const decoded = Buffer.from(cleaned, 'base64')
  if (decoded.length === 16) return decoded

  const decodedAsText = decoded.toString('ascii')
  if (/^[0-9a-f]{32}$/i.test(decodedAsText)) return Buffer.from(decodedAsText, 'hex')

  throw new HttpError(502, 'Wechat media AES key is invalid.')
}

function decryptAesEcb(ciphertext: Buffer, aesKey: string) {
  const decipher = createDecipheriv('aes-128-ecb', parseAesKey(aesKey), null)
  decipher.setAutoPadding(true)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

function encryptAesEcb(plaintext: Buffer, aesKeyHex: string) {
  const cipher = createCipheriv('aes-128-ecb', Buffer.from(aesKeyHex, 'hex'), null)
  cipher.setAutoPadding(true)
  return Buffer.concat([cipher.update(plaintext), cipher.final()])
}

function aesKeyForWechatMessage(aesKeyHex: string) {
  // iLink expects base64 of the 32-char hex key string, matching OpenClaw's payload.
  return Buffer.from(aesKeyHex, 'utf-8').toString('base64')
}

function aesEcbCiphertextSize(plaintextSize: number) {
  return Math.ceil((plaintextSize + 1) / 16) * 16
}

function buildCdnDownloadUrl(media: WechatCdnMedia) {
  if (media.full_url) return media.full_url
  if (!media.encrypt_query_param) return null
  return `${WECHAT_CDN_BASE_URL}/download?encrypted_query_param=${encodeURIComponent(
    media.encrypt_query_param,
  )}`
}

function buildCdnUploadUrl(response: WechatUploadUrlResponse, filekey: string) {
  if (response.upload_full_url) return response.upload_full_url
  if (response.full_url) return response.full_url
  const uploadParam =
    response.upload_param ?? response.encrypted_query_param ?? response.encrypt_query_param
  if (!uploadParam) return null
  return `${WECHAT_CDN_BASE_URL}/upload?encrypted_query_param=${encodeURIComponent(
    uploadParam,
  )}&filekey=${encodeURIComponent(filekey)}`
}

async function fetchBuffer(url: string, init?: RequestInit, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const text = response.ok ? '' : await response.text().catch(() => '')
    if (!response.ok) {
      throw new HttpError(response.status, `Media request failed ${response.status}: ${text}`)
    }
    const length = Number(response.headers.get('content-length') ?? 0)
    if (Number.isFinite(length) && length > 0) assertSize(length, 'Wechat media')
    const buffer = Buffer.from(await response.arrayBuffer())
    assertSize(buffer.byteLength, 'Wechat media')
    return { buffer, response }
  } finally {
    clearTimeout(timer)
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

async function postWechatCdnUpload(url: string, encrypted: Buffer) {
  let lastError: unknown
  for (let attempt = 1; attempt <= CDN_UPLOAD_RETRIES; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(encrypted),
        signal: controller.signal,
      })
      const body = await response.text().catch(() => '')

      if (response.status >= 400 && response.status < 500) {
        const message = response.headers.get('x-error-message') ?? body
        throw new HttpError(response.status, `Wechat CDN upload client error: ${message}`)
      }

      if (response.status !== 200) {
        const message =
          response.headers.get('x-error-message') ?? (body || `status ${response.status}`)
        throw new Error(`Wechat CDN upload server error: ${message}`)
      }

      const headerParam =
        response.headers.get('x-encrypted-param') ??
        response.headers.get('x-encrypt-param') ??
        ''
      if (headerParam) return headerParam

      if (body.trim()) {
        try {
          const parsed = JSON.parse(body) as {
            encrypted_query_param?: string
            encrypt_query_param?: string
          }
          const bodyParam = parsed.encrypted_query_param ?? parsed.encrypt_query_param ?? ''
          if (bodyParam) return bodyParam
        } catch {
          // CDN upload bodies are not guaranteed to be JSON.
        }
      }

      throw new Error('Wechat CDN upload response missing x-encrypted-param header.')
    } catch (error) {
      lastError = error
      if (error instanceof HttpError && error.status >= 400 && error.status < 500) throw error
      if (attempt < CDN_UPLOAD_RETRIES) await sleep(250 * attempt)
    } finally {
      clearTimeout(timer)
    }
  }

  throw new HttpError(
    502,
    lastError instanceof Error
      ? lastError.message
      : 'Wechat CDN upload failed after retries.',
  )
}

async function downloadWechatCdnMedia(media: WechatCdnMedia, aesKey?: string) {
  const url = buildCdnDownloadUrl(media)
  if (!url) throw new HttpError(502, 'Wechat media is missing a CDN download URL.')
  const { buffer } = await fetchBuffer(url)
  return aesKey ? decryptAesEcb(buffer, aesKey) : buffer
}

function itemKind(item: WechatMessageItem): WechatMediaKind | null {
  if (item.type === ITEM_TYPE.image || item.image_item) return 'image'
  if (item.type === ITEM_TYPE.voice || item.voice_item) return 'voice'
  if (item.type === ITEM_TYPE.file || item.file_item) return 'file'
  if (item.type === ITEM_TYPE.video || item.video_item) return 'video'
  return null
}

function itemMedia(item: WechatMessageItem, kind: WechatMediaKind) {
  if (kind === 'image') return item.image_item?.media ?? item.image_item?.thumb_media
  if (kind === 'voice') return item.voice_item?.media
  if (kind === 'file') return item.file_item?.media
  if (kind === 'video') return item.video_item?.media
  return undefined
}

function itemAesKey(item: WechatMessageItem, kind: WechatMediaKind, media?: WechatCdnMedia) {
  if (kind === 'image' && item.image_item?.aeskey) return item.image_item.aeskey
  return media?.aes_key
}

async function saveWechatMedia(params: {
  buffer: Buffer
  kind: WechatMediaKind
  mimeType: string
  originalFileName?: string
  text?: string
}) {
  assertSize(params.buffer.byteLength, 'Wechat media')
  const id = randomUUID()
  const original = params.originalFileName ? sanitizeFileName(params.originalFileName) : undefined
  const originalExt = original ? extensionFromFileName(original) : ''
  const ext = originalExt || extensionFromMime(params.mimeType)
  const fileName = `${id}${ext}`
  const folder = path.join('inbound', nowFolder())
  const dir = path.join(WECHAT_MEDIA_ROOT, folder)
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
    url: publicWechatMediaUrl(relativePath),
    text: params.text,
  } satisfies SavedWechatMedia
}

function inferMimeForInbound(kind: WechatMediaKind, originalName: string) {
  if (kind === 'image') return mimeFromName(originalName, 'image/jpeg')
  if (kind === 'voice') return mimeFromName(originalName, 'audio/silk')
  if (kind === 'video') return mimeFromName(originalName, 'video/mp4')
  return mimeFromName(originalName)
}

export async function downloadWechatMediaAttachment(item: WechatMessageItem) {
  const kind = itemKind(item)
  if (!kind) return null

  const media = itemMedia(item, kind)
  const originalFileName = guessInboundName(kind, item)
  const mimeType = inferMimeForInbound(kind, originalFileName)

  let buffer: Buffer | null = null
  if (media) {
    buffer = await downloadWechatCdnMedia(media, itemAesKey(item, kind, media))
  } else if (kind === 'image' && item.image_item?.url?.trim()) {
    const { buffer: downloaded } = await fetchBuffer(item.image_item.url.trim())
    buffer = downloaded
  }

  if (!buffer) return null
  return saveWechatMedia({
    buffer,
    kind,
    mimeType,
    originalFileName,
    text: kind === 'voice' ? item.voice_item?.text : undefined,
  })
}

export function buildWechatMediaMarkdown(media: SavedWechatMedia) {
  const label = media.originalFileName || media.fileName
  if (media.kind === 'image') return `![微信图片：${label}](${media.url})`
  if (media.kind === 'voice') return `[微信语音：${label}](${media.url})`
  if (media.kind === 'video') return `[微信视频：${label}](${media.url})`
  return `[微信文件：${label}](${media.url})`
}

export async function buildWechatMediaContextMarkdown(media: SavedWechatMedia) {
  const label = media.originalFileName || media.fileName
  const sourceLabel =
    media.kind === 'image'
      ? '微信图片'
      : media.kind === 'voice'
        ? '微信语音'
        : media.kind === 'video'
          ? '微信视频'
          : '微信文件'
  const markdown = await buildAttachmentContextMarkdown({
    sourceLabel,
    displayName: label,
    url: media.url,
    absolutePath: media.absolutePath,
    mimeType: media.mimeType,
    sizeBytes: media.sizeBytes,
    isImage: media.kind === 'image',
  })

  if (media.kind === 'voice' && media.text?.trim()) {
    return `${markdown}\n\n语音转写：\n${media.text.trim()}`
  }
  return markdown
}

function cleanMarkdownUrl(value: string) {
  return value
    .trim()
    .replace(/^<|>$/g, '')
    .replace(/^['"]|['"]$/g, '')
    .replace(/^`|`$/g, '')
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

async function cacheRemoteOutboundMedia(url: string) {
  const { buffer, response } = await fetchBuffer(url)
  const contentType =
    response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ??
    'application/octet-stream'
  const fromUrl = (() => {
    try {
      return path.basename(new URL(url).pathname)
    } catch {
      return ''
    }
  })()
  const ext = extensionFromFileName(fromUrl) || extensionFromMime(contentType)
  const folder = path.join('outbound-cache', nowFolder())
  const dir = path.join(WECHAT_MEDIA_ROOT, folder)
  await fs.mkdir(dir, { recursive: true })
  const filePath = path.join(dir, `${randomUUID()}${ext}`)
  await fs.writeFile(filePath, buffer)
  return filePath
}

async function resolveOutboundMediaReference(reference: string) {
  const value = cleanMarkdownUrl(reference)
  if (!value) return null

  const agentUpload = await resolveAgentUploadReference(value)
  if (agentUpload) return agentUpload

  if (value.startsWith('/api/generated-images/')) {
    const relative = splitUrlPath(value.slice('/api/generated-images/'.length))
    return pathIfExisting(assertInside(GENERATED_IMAGE_ROOT, path.join(GENERATED_IMAGE_ROOT, relative)))
  }

  if (value.startsWith('/api/channels/wechat/media/')) {
    const relative = splitUrlPath(value.slice('/api/channels/wechat/media/'.length))
    return pathIfExisting(assertInside(WECHAT_MEDIA_ROOT, path.join(WECHAT_MEDIA_ROOT, relative)))
  }

  if (value.startsWith('/api/channels/feishu/media/')) {
    const feishuRoot = path.join(config.dataDir, 'channels', 'feishu', 'media')
    const relative = splitUrlPath(value.slice('/api/channels/feishu/media/'.length))
    return pathIfExisting(assertInside(feishuRoot, path.join(feishuRoot, relative)))
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

export async function extractOutboundWechatMedia(text: string): Promise<OutboundWechatMedia> {
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
    /\[([^\]]+)]\(((?:\/api\/(?:agent\/uploads|generated-images|channels\/wechat\/media|channels\/feishu\/media)\/[^)\s]+)|(?:file:\/\/[^)\s]+))(?:\s+"[^"]*")?\)/g,
    (_match, label: string, raw: string) => {
      references.push(raw)
      return label
    },
  )

  cleaned = cleaned.replace(
    /(^|\s)((?:\/api\/(?:agent\/uploads|generated-images|channels\/wechat\/media|channels\/feishu\/media)\/[^\s)]+)|(?:file:\/\/[^\s)]+))/g,
    (match, prefix: string, raw: string) => {
      references.push(raw)
      return match.startsWith(prefix) ? prefix : ''
    },
  )

  cleaned = cleaned
    .split('\n')
    .map((line) => {
      const localPath = line.match(/^\s*-?\s*(?:本地路径|Local Path)\s*[：:]\s*(.+?)\s*$/i)
      if (localPath?.[1]) {
        references.push(localPath[1])
        return ''
      }
      const standalonePath = line.match(/^\s*`?([A-Za-z]:[\\/].+?)`?\s*$/)
      if (standalonePath?.[1]) {
        references.push(standalonePath[1])
        return ''
      }
      return line
    })
    .join('\n')

  const files: string[] = []
  const warnings: string[] = []
  for (const reference of references.slice(0, MAX_OUTBOUND_MEDIA_PER_MESSAGE)) {
    try {
      const file = await resolveOutboundMediaReference(reference)
      if (file) files.push(file)
      else warnings.push(`未找到媒体文件：${reference}`)
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error))
    }
  }

  if (references.length > MAX_OUTBOUND_MEDIA_PER_MESSAGE) {
    warnings.push(`本次只发送前 ${MAX_OUTBOUND_MEDIA_PER_MESSAGE} 个媒体文件。`)
  }

  return {
    text: cleaned.replace(/\n{4,}/g, '\n\n\n').trim(),
    files,
    warnings,
  }
}

function uploadMediaType(mimeType: string) {
  if (mimeType.startsWith('image/')) return UPLOAD_MEDIA_TYPE.image
  if (mimeType.startsWith('video/')) return UPLOAD_MEDIA_TYPE.video
  return UPLOAD_MEDIA_TYPE.file
}

function buildUploadItem(upload: UploadResult): WechatMessageItem {
  const media = {
    encrypt_query_param: upload.encryptedQueryParam,
    aes_key: aesKeyForWechatMessage(upload.aeskeyHex),
    encrypt_type: 1,
  }

  if (upload.mimeType.startsWith('image/')) {
    return {
      type: ITEM_TYPE.image,
      image_item: {
        media,
        mid_size: upload.ciphertextSize,
      },
    }
  }

  if (upload.mimeType.startsWith('video/')) {
    return {
      type: ITEM_TYPE.video,
      video_item: {
        media,
        video_size: upload.ciphertextSize,
      },
    }
  }

  return {
    type: ITEM_TYPE.file,
    file_item: {
      media,
      file_name: upload.fileName,
      len: String(upload.plaintextSize),
    },
  }
}

async function uploadWechatMediaBufferInternal(params: {
  baseUrl: string
  token?: string
  to: string
  fileName: string
  mimeType?: string
  buffer: Buffer
}) {
  const bytes = params.buffer
  assertSize(bytes.byteLength, 'Wechat outbound media')
  const fileName = sanitizeFileName(params.fileName)
  const mimeType = params.mimeType?.split(';')[0]?.trim().toLowerCase() || mimeFromName(fileName)
  const aeskeyHex = randomBytes(16).toString('hex')
  const filekey = randomBytes(16).toString('hex')
  const encrypted = encryptAesEcb(bytes, aeskeyHex)
  const rawMd5 = createHash('md5').update(bytes).digest('hex')

  const uploadUrl = await getWechatUploadUrl({
    baseUrl: params.baseUrl,
    token: params.token,
    filekey,
    mediaType: uploadMediaType(mimeType),
    to: params.to,
    rawsize: bytes.byteLength,
    rawfilemd5: rawMd5,
    filesize: aesEcbCiphertextSize(bytes.byteLength),
    aeskey: aeskeyHex,
  })

  const isError =
    (uploadUrl.ret !== undefined && uploadUrl.ret !== 0) ||
    (uploadUrl.errcode !== undefined && uploadUrl.errcode !== 0)
  if (isError) {
    throw new HttpError(
      502,
      `Wechat getuploadurl failed: ${uploadUrl.errmsg ?? uploadUrl.errcode ?? uploadUrl.ret}`,
    )
  }

  const cdnUrl = buildCdnUploadUrl(uploadUrl, filekey)
  if (!cdnUrl) throw new HttpError(502, 'Wechat getuploadurl did not return an upload URL.')

  const encryptedQueryParam = await postWechatCdnUpload(cdnUrl, encrypted)

  return {
    aeskeyHex,
    encryptedQueryParam,
    ciphertextSize: encrypted.byteLength,
    plaintextSize: bytes.byteLength,
    mimeType,
    fileName,
  } satisfies UploadResult
}

export async function sendWechatMediaFile(params: {
  baseUrl: string
  token?: string
  to: string
  filePath: string
  contextToken?: string
}) {
  const filePath = await pathIfExisting(params.filePath)
  if (!filePath) throw new HttpError(404, 'Media file does not exist.')
  const upload = await uploadWechatMediaBufferInternal({
    baseUrl: params.baseUrl,
    token: params.token,
    to: params.to,
    fileName: path.basename(filePath),
    mimeType: mimeFromName(filePath),
    buffer: await fs.readFile(filePath),
  })
  return sendWechatMessageItem({
    baseUrl: params.baseUrl,
    token: params.token,
    to: params.to,
    item: buildUploadItem(upload),
    contextToken: params.contextToken,
  })
}

export async function sendWechatMediaBuffer(params: {
  baseUrl: string
  token?: string
  to: string
  fileName: string
  mimeType?: string
  buffer: Buffer
  contextToken?: string
}) {
  const upload = await uploadWechatMediaBufferInternal(params)
  return sendWechatMessageItem({
    baseUrl: params.baseUrl,
    token: params.token,
    to: params.to,
    item: buildUploadItem(upload),
    contextToken: params.contextToken,
  })
}
