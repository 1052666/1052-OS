import { createHash } from 'node:crypto'
import {
  createMemorySuggestion,
  listMemories,
  listMemorySuggestions,
} from '../memory/memory.service.js'
import type { MemoryCategory, MemoryPriority, MemoryScope } from '../memory/memory.types.js'
import { looksSensitive, redactSensitiveText } from './agent.redaction.service.js'

const MAX_CAPTURE_CHARS = 1_200

const DURABLE_SIGNAL_PATTERNS = [
  /以后|后续|长期|每次|默认|固定|持续|一直|以后都/,
  /记住|保存到记忆|不要忘|项目约定|工作约定/,
  /必须|务必|一定要|不允许|不要再|不能再|严禁/,
  /我喜欢|我不喜欢|偏好|习惯|写作风格|说话风格|输出风格/,
  /核心认知模型|个人知识库|素材库|输出配方/,
  /你要|应该要|要让.*主动|主动性/,
]

const NEGATIVE_MEMORY_PATTERNS = [/不要记|别记|不要保存到记忆|不用记忆/]

function normalizeText(value: unknown) {
  return typeof value === 'string'
    ? value.replace(/\r\n/g, '\n').replace(/\u0000/g, '').replace(/\s+/g, ' ').trim()
    : ''
}

function hasDurableSignal(text: string) {
  if (text.length < 8) return false
  if (NEGATIVE_MEMORY_PATTERNS.some((pattern) => pattern.test(text))) return false
  return DURABLE_SIGNAL_PATTERNS.some((pattern) => pattern.test(text))
}

function classifyCategory(text: string): MemoryCategory {
  if (/写作风格|说话风格|输出风格|语气|文风/.test(text)) return 'style'
  if (/必须|务必|不允许|不能再|不要再|严禁|一定要/.test(text)) return 'hard_rule'
  if (/流程|每次|默认|项目约定|工作约定|提交|推送|PR|重启|检查|运行/.test(text)) {
    return 'workflow'
  }
  if (/项目|仓库|1052|Agent|AI|系统提示词|工具|记忆中心/.test(text)) return 'project_context'
  return 'preference'
}

function classifyScope(text: string): MemoryScope {
  return /项目|仓库|1052|Agent|AI|系统提示词|工具|记忆中心|前端|后端|GitHub|PR/.test(text)
    ? 'workspace'
    : 'global'
}

function classifyPriority(text: string, category: MemoryCategory): MemoryPriority {
  if (category === 'hard_rule') return 'high'
  if (/必须|务必|一定|不要忘|长期|以后都/.test(text)) return 'high'
  return 'normal'
}

function buildTitle(text: string, category: MemoryCategory) {
  const prefix =
    category === 'hard_rule'
      ? '用户长期硬性要求'
      : category === 'workflow'
        ? '用户工作流偏好'
        : category === 'style'
          ? '用户风格偏好'
          : category === 'project_context'
            ? '项目上下文偏好'
            : '用户长期偏好'
  const body = text.length > 42 ? `${text.slice(0, 42)}...` : text
  return `${prefix}: ${body}`
}

function fingerprint(text: string) {
  return createHash('sha1').update(text).digest('hex').slice(0, 12)
}

export async function maybeCreateInferredMemorySuggestion(input: {
  latestUserContent: string
  usedToolNames?: ReadonlySet<string>
}) {
  if (input.usedToolNames?.has('memory_suggest') || input.usedToolNames?.has('memory_create')) {
    return null
  }

  const normalized = normalizeText(input.latestUserContent)
  if (!hasDurableSignal(normalized)) return null
  if (looksSensitive(normalized)) return null

  const content = redactSensitiveText(normalized).slice(0, MAX_CAPTURE_CHARS)
  const hashTag = `auto-${fingerprint(content)}`
  const [existingSuggestions, existingMemories] = await Promise.all([
    listMemorySuggestions({ query: hashTag, limit: 1 }),
    listMemories({ query: hashTag, limit: 1 }),
  ])
  if (existingSuggestions.length > 0 || existingMemories.length > 0) return null

  const category = classifyCategory(content)
  const scope = classifyScope(content)
  const priority = classifyPriority(content, category)

  return createMemorySuggestion({
    category,
    title: buildTitle(content, category),
    content: `Agent 从用户消息中推断出的长期偏好/规则，待用户确认后生效：${content}`,
    tags: ['agent-inferred', 'auto-suggest', hashTag],
    scope,
    priority,
    source: 'agent_inferred',
    active: true,
  })
}
