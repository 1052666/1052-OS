import fs from 'node:fs/promises'
import path from 'node:path'

const MAX_INLINE_TEXT_CHARS = 12_000
const TEXT_EXTENSIONS = new Set(['.csv', '.json', '.log', '.md', '.markdown', '.txt', '.yaml', '.yml'])

export type AttachmentContextInput = {
  sourceLabel: string
  displayName: string
  url: string
  absolutePath: string
  mimeType: string
  sizeBytes: number
  isImage?: boolean
}

function isLikelyTextFile(input: AttachmentContextInput) {
  const mimeType = input.mimeType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (mimeType.startsWith('text/')) return true
  if (mimeType === 'application/json') return true
  return TEXT_EXTENSIONS.has(path.extname(input.displayName).toLowerCase())
}

function fenceLanguage(fileName: string, mimeType: string) {
  const ext = path.extname(fileName).toLowerCase()
  if (ext === '.json' || mimeType.includes('json')) return 'json'
  if (ext === '.md' || ext === '.markdown') return 'markdown'
  if (ext === '.csv') return 'csv'
  if (ext === '.yaml' || ext === '.yml') return 'yaml'
  return 'text'
}

function escapeFence(content: string) {
  return content.replace(/```/g, '`\\`\\`')
}

async function readInlineText(input: AttachmentContextInput) {
  if (!isLikelyTextFile(input)) return null
  const content = await fs.readFile(input.absolutePath, 'utf-8').catch(() => null)
  if (content === null) return null
  const normalized = content.replace(/\u0000/g, '').trim()
  if (!normalized) return ''
  if (normalized.length <= MAX_INLINE_TEXT_CHARS) return normalized
  return `${normalized.slice(0, MAX_INLINE_TEXT_CHARS)}\n\n[内容已截断，仅展示前 ${MAX_INLINE_TEXT_CHARS} 字符]`
}

export async function buildAttachmentContextMarkdown(input: AttachmentContextInput) {
  const link = input.isImage
    ? `![${input.sourceLabel}：${input.displayName}](${input.url})`
    : `[${input.sourceLabel}：${input.displayName}](${input.url})`
  const lines = [
    link,
    '',
    `- 文件名：${input.displayName}`,
    `- 类型：${input.mimeType || 'application/octet-stream'}`,
    `- 大小：${input.sizeBytes} bytes`,
    `- 本地路径：${input.absolutePath}`,
  ]

  const inlineText = await readInlineText(input)
  if (inlineText !== null) {
    lines.push(
      '',
      '文件内容：',
      `\`\`\`${fenceLanguage(input.displayName, input.mimeType)}`,
      escapeFence(inlineText),
      '```',
    )
  }

  return lines.join('\n')
}
