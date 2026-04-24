import { estimateTokenCount, type LLMToolDefinition } from './llm.client.js'

export type TokenBudgetComponent = {
  key: string
  label: string
  tokens: number
  limitTokens?: number
}

export type TokenBudgetReport = {
  key: string
  label: string
  tokens: number
  limitTokens: number
  overLimit: boolean
  components: TokenBudgetComponent[]
}

export const P0_TOTAL_TOKEN_BUDGET = 3000
export const P0_UAPIS_DIRECTORY_TOKEN_BUDGET = 300
export const CONTEXT_UPGRADE_TOOL_SCHEMA_TOKEN_BUDGET = 200

export function estimateJsonTokenCount(value: unknown) {
  return estimateTokenCount(JSON.stringify(value))
}

export function buildTokenBudgetReport(input: {
  key: string
  label: string
  limitTokens: number
  components: TokenBudgetComponent[]
}): TokenBudgetReport {
  const tokens = input.components.reduce((sum, component) => sum + component.tokens, 0)
  return {
    key: input.key,
    label: input.label,
    tokens,
    limitTokens: input.limitTokens,
    overLimit: tokens > input.limitTokens,
    components: input.components,
  }
}

export function textBudgetComponent(input: {
  key: string
  label: string
  text: string
  limitTokens?: number
}): TokenBudgetComponent {
  return {
    key: input.key,
    label: input.label,
    tokens: input.text.trim() ? estimateTokenCount(input.text) : 0,
    limitTokens: input.limitTokens,
  }
}

export function toolSchemaBudgetComponent(input: {
  key: string
  label: string
  toolDefinitions: readonly LLMToolDefinition[]
  limitTokens?: number
}): TokenBudgetComponent {
  return {
    key: input.key,
    label: input.label,
    tokens: estimateJsonTokenCount(input.toolDefinitions),
    limitTokens: input.limitTokens,
  }
}

export function buildToolSchemaBudgetReport(input: {
  key: string
  label: string
  limitTokens: number
  toolDefinitions: readonly LLMToolDefinition[]
}) {
  return buildTokenBudgetReport({
    key: input.key,
    label: input.label,
    limitTokens: input.limitTokens,
    components: input.toolDefinitions.map((tool) =>
      toolSchemaBudgetComponent({
        key: tool.function.name,
        label: tool.function.name,
        toolDefinitions: [tool],
      }),
    ),
  })
}
