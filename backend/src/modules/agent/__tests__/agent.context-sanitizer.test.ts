import { describe, expect, it } from 'vitest'
import {
  isRequestFailureContent,
  sanitizeCheckpointTextForModel,
} from '../agent.context-sanitizer.service.js'

describe('agent context sanitizer', () => {
  it('does not treat successful HTTP or LLM mentions as request failures', () => {
    expect(isRequestFailureContent('已处理 HTTP 200 响应，并完成结果整理。')).toBe(false)
    expect(isRequestFailureContent('HTTP 404 表示资源不存在，这里只是解释状态码语义。')).toBe(false)

    const checkpoint = sanitizeCheckpointTextForModel(
      '已更新 LLM 客户端并处理 HTTP 200 响应。',
    )
    expect(checkpoint).toBe('已更新 LLM 客户端并处理 HTTP 200 响应。')
  })

  it('keeps explicit request failures as sanitized retry guidance', () => {
    expect(isRequestFailureContent('请求失败: HTTP 500')).toBe(true)
    expect(isRequestFailureContent('Request failed: provider returned an error')).toBe(true)

    expect(sanitizeCheckpointTextForModel('请求失败: HTTP 500 from provider')).toContain(
      '之前有一次请求或工具调用失败',
    )
  })
})
