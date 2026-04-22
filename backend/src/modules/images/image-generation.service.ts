import fs from 'node:fs/promises'
import path from 'node:path'
import { HttpError } from '../../http-error.js'
import { config } from '../../config.js'
import { getSettings } from '../settings/settings.service.js'
import type { ImageGenerationSettings } from '../settings/settings.types.js'

const IMAGE_DIR = path.join(config.dataDir, 'generated-images')
const SIZE_OPTIONS = new Set<ImageGenerationSettings['size']>([
  'auto',
  '1024x1024',
  '1536x1024',
  '1024x1536',
])
const QUALITY_OPTIONS = new Set<ImageGenerationSettings['quality']>([
  'auto',
  'low',
  'medium',
  'high',
])
const BACKGROUND_OPTIONS = new Set<ImageGenerationSettings['background']>([
  'auto',
  'opaque',
  'transparent',
])
const FORMAT_OPTIONS = new Set<ImageGenerationSettings['outputFormat']>([
  'png',
  'jpeg',
  'webp',
])
const MAX_IMAGES = 4

type GeneratedImage = {
  fileName: string
  relativePath: string
  url: string
  format: 'png' | 'jpeg' | 'webp'
  sizeBytes: number | null
}

export type ImageGenerationResult = {
  prompt: string
  modelId: string
  apiFormat: ImageGenerationSettings['apiFormat']
  size: ImageGenerationSettings['size']
  quality: ImageGenerationSettings['quality']
  background: ImageGenerationSettings['background']
  outputFormat: ImageGenerationSettings['outputFormat']
  outputCompression: number
  revisedPrompt?: string
  images: GeneratedImage[]
  markdown: string
}

function joinUrl(base: string, nextPath: string) {
  return base.replace(/\/+$/, '') + '/' + nextPath.replace(/^\/+/, '')
}

function geminiGenerateContentUrl(base: string, modelId: string) {
  const cleanBase = base.replace(/\/+$/, '')
  if (/\/models\/[^/]+:generateContent$/i.test(cleanBase)) return cleanBase
  if (/\/models\/[^/]+$/i.test(cleanBase)) return `${cleanBase}:generateContent`
  if (/\/models$/i.test(cleanBase)) {
    return `${cleanBase}/${encodeURIComponent(modelId)}:generateContent`
  }
  return `${cleanBase}/models/${encodeURIComponent(modelId)}:generateContent`
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeEnum<T extends string>(
  value: unknown,
  allowed: Set<T>,
  fallback: T,
): T {
  const next = normalizeText(value) as T
  return allowed.has(next) ? next : fallback
}

function normalizeCount(value: unknown) {
  const raw =
    typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 1
  return Math.min(Math.max(raw, 1), MAX_IMAGES)
}

function normalizeCompression(value: unknown, fallback: number) {
  const raw =
    typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
  return Math.min(Math.max(raw, 0), 100)
}

function detectMimeExtension(contentType: string | null): GeneratedImage['format'] | null {
  if (!contentType) return null
  if (contentType.includes('image/png')) return 'png'
  if (contentType.includes('image/jpeg')) return 'jpeg'
  if (contentType.includes('image/webp')) return 'webp'
  return null
}

function mimeToFormat(mimeType: string | undefined, fallback: GeneratedImage['format']) {
  return detectMimeExtension(mimeType ?? null) ?? fallback
}

function ensureBase64(value: string) {
  const match = value.match(/^data:[^;]+;base64,(.+)$/)
  return match?.[1] ?? value
}

function publicImageUrl(relativePath: string) {
  return '/api/generated-images/' + relativePath.split(path.sep).map(encodeURIComponent).join('/')
}

function filePrefix(now: Date) {
  const year = String(now.getFullYear())
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hour = String(now.getHours()).padStart(2, '0')
  const minute = String(now.getMinutes()).padStart(2, '0')
  const second = String(now.getSeconds()).padStart(2, '0')
  return {
    folder: `${year}-${month}`,
    stamp: `${year}${month}${day}-${hour}${minute}${second}`,
  }
}

async function fetchRemoteImage(url: string) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new HttpError(
      502,
      `Image provider returned a remote URL, but downloading it failed with ${response.status}.`,
    )
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  return {
    bytes,
    format: detectMimeExtension(response.headers.get('content-type')),
  }
}

async function persistImage(
  bytes: Buffer,
  format: GeneratedImage['format'],
  index: number,
) {
  const now = new Date()
  const { folder, stamp } = filePrefix(now)
  const dir = path.join(IMAGE_DIR, folder)
  await fs.mkdir(dir, { recursive: true })
  const fileName = `${stamp}-${index + 1}.${format}`
  const fullPath = path.join(dir, fileName)
  await fs.writeFile(fullPath, bytes)
  const relativePath = path.join(folder, fileName)
  return {
    fileName,
    relativePath,
    url: publicImageUrl(relativePath),
    format,
    sizeBytes: bytes.byteLength,
  }
}

function parseProviderError(body: string) {
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string } | string
    }
    if (typeof parsed.error === 'string') return parsed.error
    if (parsed.error && typeof parsed.error.message === 'string') return parsed.error.message
  } catch {}
  return body
}

function isOpenAIGeminiImageProvider(configured: ImageGenerationSettings) {
  return /generativelanguage\.googleapis\.com/i.test(configured.baseUrl)
}

function geminiAspectRatio(size: ImageGenerationSettings['size']) {
  if (size === '1024x1024') return '1:1'
  if (size === '1536x1024') return '3:2'
  if (size === '1024x1536') return '2:3'
  return undefined
}

function extractGeminiError(body: string) {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } }
    return parsed.error?.message ?? body
  } catch {
    return body
  }
}

function buildMarkdown(images: GeneratedImage[]) {
  return images
    .map((image, index) => {
      const alt = `Generated image ${index + 1}`
      return `![${alt}](${image.url})`
    })
    .join('\n\n')
}

function resolveImageSettings(
  configured: ImageGenerationSettings,
  overrides: Record<string, unknown>,
): {
  prompt: string
  count: number
  size: ImageGenerationSettings['size']
  quality: ImageGenerationSettings['quality']
  background: ImageGenerationSettings['background']
  outputFormat: ImageGenerationSettings['outputFormat']
  outputCompression: number
} {
  return {
    prompt: normalizeText(overrides.prompt),
    count: normalizeCount(overrides.count),
    size: normalizeEnum(overrides.size, SIZE_OPTIONS, configured.size),
    quality: normalizeEnum(overrides.quality, QUALITY_OPTIONS, configured.quality),
    background: normalizeEnum(overrides.background, BACKGROUND_OPTIONS, configured.background),
    outputFormat: normalizeEnum(overrides.outputFormat, FORMAT_OPTIONS, configured.outputFormat),
    outputCompression: normalizeCompression(
      overrides.outputCompression,
      configured.outputCompression,
    ),
  }
}

type ResolvedImageRequest = ReturnType<typeof resolveImageSettings>

async function generateOpenAICompatibleImages(
  configured: ImageGenerationSettings,
  resolved: ResolvedImageRequest,
) {
  const payload: Record<string, unknown> = {
    model: configured.modelId,
    prompt: resolved.prompt,
    n: resolved.count,
    size: resolved.size,
    quality: resolved.quality,
    background: resolved.background,
    output_format: resolved.outputFormat,
  }

  if (resolved.outputFormat === 'jpeg' || resolved.outputFormat === 'webp') {
    payload.output_compression = resolved.outputCompression
  }
  if (configured.modelId.startsWith('dall-e') || isOpenAIGeminiImageProvider(configured)) {
    payload.response_format = 'b64_json'
  }

  let response: Response
  try {
    response = await fetch(joinUrl(configured.baseUrl, 'images/generations'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${configured.apiKey}`,
      },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    throw new HttpError(
      502,
      `Unable to reach the image generation provider: ${(error as Error).message}`,
    )
  }

  const body = await response.text().catch(() => '')
  if (!response.ok) {
    throw new HttpError(
      response.status,
      `Image generation provider returned ${response.status}: ${parseProviderError(body).slice(0, 500)}`,
    )
  }

  const parsed = body
    ? (JSON.parse(body) as {
        data?: {
          b64_json?: string
          url?: string
          revised_prompt?: string
        }[]
      })
    : null
  const items = parsed?.data ?? []
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(502, 'Image generation provider did not return any image data.')
  }

  const images: GeneratedImage[] = []
  let revisedPrompt = ''

  for (const [index, item] of items.entries()) {
    if (!revisedPrompt && typeof item?.revised_prompt === 'string') {
      revisedPrompt = item.revised_prompt
    }

    if (typeof item?.b64_json === 'string' && item.b64_json.trim()) {
      const buffer = Buffer.from(ensureBase64(item.b64_json.trim()), 'base64')
      images.push(await persistImage(buffer, resolved.outputFormat, index))
      continue
    }

    if (typeof item?.url === 'string' && item.url.trim()) {
      const remote = await fetchRemoteImage(item.url.trim())
      images.push(
        await persistImage(
          remote.bytes,
          remote.format ?? resolved.outputFormat,
          index,
        ),
      )
      continue
    }
  }

  return { images, revisedPrompt }
}

async function generateGeminiNativeImages(
  configured: ImageGenerationSettings,
  resolved: ResolvedImageRequest,
) {
  const images: GeneratedImage[] = []
  let revisedPrompt = ''
  const aspectRatio = geminiAspectRatio(resolved.size)
  const generationConfig: Record<string, unknown> = {
    responseModalities: ['IMAGE'],
  }

  if (aspectRatio) {
    generationConfig.imageConfig = { aspectRatio }
  }

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: resolved.prompt }],
      },
    ],
    generationConfig,
  }

  for (let index = 0; index < resolved.count; index += 1) {
    let response: Response
    try {
      response = await fetch(geminiGenerateContentUrl(configured.baseUrl, configured.modelId), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': configured.apiKey,
        },
        body: JSON.stringify(payload),
      })
    } catch (error) {
      throw new HttpError(
        502,
        `Unable to reach the Gemini image provider: ${(error as Error).message}`,
      )
    }

    const body = await response.text().catch(() => '')
    if (!response.ok) {
      throw new HttpError(
        response.status,
        `Gemini image provider returned ${response.status}: ${extractGeminiError(body).slice(0, 500)}`,
      )
    }

    const parsed = body
      ? (JSON.parse(body) as {
          candidates?: {
            content?: {
              parts?: {
                text?: string
                inlineData?: { data?: string; mimeType?: string }
                inline_data?: { data?: string; mime_type?: string }
              }[]
            }
          }[]
        })
      : null
    const parts = parsed?.candidates?.flatMap((candidate) => candidate.content?.parts ?? []) ?? []

    for (const part of parts) {
      if (!revisedPrompt && typeof part.text === 'string' && part.text.trim()) {
        revisedPrompt = part.text.trim()
      }

      const inlineData = (part.inlineData ?? part.inline_data) as
        | { data?: string; mimeType?: string; mime_type?: string }
        | undefined
      if (!inlineData?.data) continue

      const buffer = Buffer.from(ensureBase64(inlineData.data), 'base64')
      const mimeType = inlineData.mimeType ?? inlineData.mime_type
      images.push(await persistImage(buffer, mimeToFormat(mimeType, resolved.outputFormat), images.length))
    }
  }

  return { images, revisedPrompt }
}

export async function generateImages(input: Record<string, unknown>) {
  const settings = await getSettings()
  const configured = settings.imageGeneration
  if (!configured.baseUrl) {
    throw new HttpError(400, 'Image generation base URL is not configured.')
  }
  if (!configured.modelId) {
    throw new HttpError(400, 'Image generation model ID is not configured.')
  }
  if (!configured.apiKey) {
    throw new HttpError(400, 'Image generation API key is not configured.')
  }

  const resolved = resolveImageSettings(configured, input)
  if (!resolved.prompt) {
    throw new HttpError(400, 'Image generation prompt cannot be empty.')
  }

  const { images, revisedPrompt } =
    configured.apiFormat === 'gemini-native'
      ? await generateGeminiNativeImages(configured, resolved)
      : await generateOpenAICompatibleImages(configured, resolved)

  if (images.length === 0) {
    throw new HttpError(
      502,
      'Image generation provider responded, but no savable image payload was found.',
    )
  }

  return {
    prompt: resolved.prompt,
    modelId: configured.modelId,
    apiFormat: configured.apiFormat,
    size: resolved.size,
    quality: resolved.quality,
    background: resolved.background,
    outputFormat: resolved.outputFormat,
    outputCompression: resolved.outputCompression,
    revisedPrompt: revisedPrompt || undefined,
    images,
    markdown: buildMarkdown(images),
  } satisfies ImageGenerationResult
}
