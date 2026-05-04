import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineAgentTool } from './agent.tool.define.js'

describe('defineAgentTool', () => {
  const tool = defineAgentTool({
    name: 'test_tool',
    description: 'A test tool',
    schema: z.object({
      query: z.string().describe('Search query'),
      limit: z.number().optional().describe('Max results'),
      tags: z.array(z.string()).optional().describe('Filter tags'),
      mode: z.enum(['fast', 'full']).optional().describe('Run mode'),
    }),
    execute: async ({ query, limit }) => ({
      found: query,
      capped: limit ?? 10,
    }),
  })

  it('produces correct JSON Schema parameters', () => {
    const params = tool.parameters as {
      type: string
      properties: Record<string, Record<string, unknown>>
      required?: string[]
      additionalProperties?: boolean
    }

    expect(params.type).toBe('object')
    expect(params.additionalProperties).toBe(false)
    expect(params.required).toEqual(['query'])

    expect(params.properties.query).toMatchObject({
      type: 'string',
      description: 'Search query',
    })
    expect(params.properties.limit).toMatchObject({
      type: 'number',
      description: 'Max results',
    })
    expect(params.properties.tags).toMatchObject({
      type: 'array',
      items: { type: 'string' },
      description: 'Filter tags',
    })
    expect(params.properties.mode).toMatchObject({
      type: 'string',
      enum: ['fast', 'full'],
      description: 'Run mode',
    })
  })

  it('validates and passes typed args to execute', async () => {
    const result = await tool.execute({ query: 'hello', limit: 5 })
    expect(result).toEqual({ found: 'hello', capped: 5 })
  })

  it('applies defaults for optional args', async () => {
    const result = await tool.execute({ query: 'world' })
    expect(result).toEqual({ found: 'world', capped: 10 })
  })

  it('throws human-readable error on missing required args', async () => {
    await expect(tool.execute({})).rejects.toThrow('参数校验失败')
    await expect(tool.execute({})).rejects.toThrow('"query"')
  })

  it('throws human-readable error on wrong type', async () => {
    await expect(tool.execute({ query: 123 })).rejects.toThrow('参数校验失败')
  })

  it('handles undefined/null rawArgs gracefully', async () => {
    await expect(tool.execute(undefined)).rejects.toThrow('参数校验失败')
    await expect(tool.execute(null)).rejects.toThrow('参数校验失败')
  })

  it('zero-arg tool works with empty input', async () => {
    const noArgTool = defineAgentTool({
      name: 'noop',
      description: 'noop',
      schema: z.object({}),
      execute: async () => 'ok',
    })
    expect(await noArgTool.execute(undefined)).toBe('ok')
    expect(await noArgTool.execute({})).toBe('ok')
    expect(noArgTool.parameters).toMatchObject({
      type: 'object',
      properties: {},
      additionalProperties: false,
    })
  })
})
