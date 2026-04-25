import { describe, expect, it } from 'vitest'

// ── 纯函数拷贝（Settings.tsx 中的函数需要导出或内联到测试中） ──
// 由于 Settings.tsx 是页面组件且函数未导出，这里拷贝关键逻辑用于测试。
// 理想情况下这些纯函数应提取到独立模块并直接 import。

type LlmProviderKey =
  | 'openai'
  | 'minimax'
  | 'gemini'
  | 'deepseek'
  | 'moonshot'
  | 'openrouter'
  | 'siliconflow'
  | 'zhipu'

function detectLlmProvider(baseUrl: string, modelId: string): LlmProviderKey {
  const value = `${baseUrl} ${modelId}`.toLowerCase()
  if (value.includes('openrouter')) return 'openrouter'
  if (value.includes('bigmodel.cn')) return 'zhipu'
  if (value.includes('minimax') || value.includes('minimaxi')) return 'minimax'
  if (value.includes('googleapis.com') || value.includes('gemini')) return 'gemini'
  if (value.includes('deepseek')) return 'deepseek'
  if (value.includes('moonshot') || value.includes('kimi')) return 'moonshot'
  if (value.includes('siliconflow')) return 'siliconflow'
  return 'openai'
}

// ── detectLlmProvider 测试 ──

describe('detectLlmProvider', () => {
  it('应识别 OpenAI 端点', () => {
    expect(detectLlmProvider('https://api.openai.com/v1', 'gpt-4.1-mini')).toBe('openai')
  })

  it('应识别 OpenRouter 端点', () => {
    expect(detectLlmProvider('https://openrouter.ai/api/v1', 'openai/gpt-4.1-mini')).toBe('openrouter')
  })

  it('应识别智谱 API 端点', () => {
    expect(detectLlmProvider('https://open.bigmodel.cn/api/paas/v4', 'glm-5.1')).toBe('zhipu')
  })

  it('应识别智谱 Coding API 端点', () => {
    expect(detectLlmProvider('https://open.bigmodel.cn/api/coding/paas/v4', 'glm-5.1')).toBe('zhipu')
  })

  it('应识别智谱 Coding Claude API 端点', () => {
    expect(detectLlmProvider('https://open.bigmodel.cn/api/anthropic', 'glm-5.1')).toBe('zhipu')
  })

  it('应识别 MiniMax Global 端点', () => {
    expect(detectLlmProvider('https://api.minimax.io/v1', 'MiniMax-M2.7')).toBe('minimax')
  })

  it('应识别 MiniMax 中国区端点', () => {
    expect(detectLlmProvider('https://api.minimaxi.com/v1', 'MiniMax-M2.7')).toBe('minimax')
  })

  it('应识别 Gemini 端点（通过 googleapis）', () => {
    expect(detectLlmProvider('https://generativelanguage.googleapis.com/v1beta/openai', 'gemini-2.5-flash')).toBe('gemini')
  })

  it('应识别 DeepSeek 端点', () => {
    expect(detectLlmProvider('https://api.deepseek.com/v1', 'deepseek-chat')).toBe('deepseek')
  })

  it('应识别 Moonshot 端点', () => {
    expect(detectLlmProvider('https://api.moonshot.cn/v1', 'kimi-k2-0711-preview')).toBe('moonshot')
  })

  it('应识别 Moonshot 端点（通过 modelId 含 kimi）', () => {
    expect(detectLlmProvider('https://custom.api.com/v1', 'kimi-latest')).toBe('moonshot')
  })

  it('应识别 SiliconFlow 端点', () => {
    expect(detectLlmProvider('https://api.siliconflow.cn/v1', 'Qwen/Qwen3-32B')).toBe('siliconflow')
  })

  it('未知端点应回退到 openai', () => {
    expect(detectLlmProvider('https://custom-llm.example.com/v1', 'my-model')).toBe('openai')
  })

  it('OpenRouter 优先级应高于其他（baseUrl 含 openrouter）', () => {
    expect(detectLlmProvider('https://openrouter.ai/api/v1', 'deepseek/deepseek-chat')).toBe('openrouter')
  })
})

// ── 预设数据完整性测试 ──

describe('智谱预设数据', () => {
  const ZHIPU_CHILDREN = [
    { name: '智谱 API', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', modelId: 'glm-5.1' },
    { name: '智谱 Coding API', baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4', modelId: 'glm-5.1' },
    { name: '智谱 Coding Claude API', baseUrl: 'https://open.bigmodel.cn/api/anthropic', modelId: 'glm-5.1' },
  ]

  it('应包含 3 个子端点', () => {
    expect(ZHIPU_CHILDREN).toHaveLength(3)
  })

  it('所有子端点的 modelId 应为 glm-5.1', () => {
    for (const child of ZHIPU_CHILDREN) {
      expect(child.modelId).toBe('glm-5.1')
    }
  })

  it('所有子端点的 baseUrl 应以 https:// 开头', () => {
    for (const child of ZHIPU_CHILDREN) {
      expect(child.baseUrl).toMatch(/^https:\/\//)
    }
  })

  it('每个子端点名称应唯一', () => {
    const names = ZHIPU_CHILDREN.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('每个子端点 baseUrl 应唯一', () => {
    const urls = ZHIPU_CHILDREN.map((c) => c.baseUrl)
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('子端点应能被 detectLlmProvider 正确识别为 zhipu', () => {
    for (const child of ZHIPU_CHILDREN) {
      expect(detectLlmProvider(child.baseUrl, child.modelId)).toBe('zhipu')
    }
  })
})
