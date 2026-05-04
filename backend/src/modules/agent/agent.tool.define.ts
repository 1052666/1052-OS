/**
 * Zod-powered tool definition helper.
 *
 * Usage:
 *
 * ```ts
 * import { z } from 'zod'
 * import { defineAgentTool } from '../agent.tool.define.js'
 *
 * export const myTool = defineAgentTool({
 *   name: 'my_tool',
 *   description: 'Does something useful.',
 *   schema: z.object({
 *     query: z.string().describe('Search query'),
 *     limit: z.number().optional().describe('Max results'),
 *   }),
 *   execute: async ({ query, limit }) => {
 *     // `query` is `string`, `limit` is `number | undefined` — fully typed!
 *     return { results: [] }
 *   },
 * })
 * ```
 *
 * Benefits over hand-written `AgentTool`:
 * - **Type-safe execute args**: no more `args as Record<string, unknown>` casts.
 * - **Automatic validation**: malformed/missing args from the LLM produce a clear
 *   Chinese error message that the model can understand and retry, instead of
 *   crashing inside the tool implementation.
 * - **Single source of truth**: the Zod schema drives both the JSON Schema sent to
 *   the model AND the runtime validation — no more drift between the two.
 */

import { z, type ZodTypeAny } from 'zod'
import type { AgentTool } from './agent.tool.types.js'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

type ZodAgentToolDef<S extends z.ZodObject<z.ZodRawShape>> = {
  name: string
  description: string
  schema: S
  execute: (args: z.infer<S>) => Promise<unknown>
}

/**
 * Define an agent tool with Zod schema validation.
 *
 * The returned `AgentTool` is fully compatible with the existing tool registry
 * in `agent.tool.service.ts` — just spread it into the tools array.
 */
export function defineAgentTool<S extends z.ZodObject<z.ZodRawShape>>(
  def: ZodAgentToolDef<S>,
): AgentTool {
  return {
    name: def.name,
    description: def.description,
    parameters: zodObjectToJsonSchema(def.schema),
    execute: async (rawArgs: unknown) => {
      // Ensure rawArgs is at least an object (LLM may send `undefined` for
      // zero-arg tools, or a parsed JSON object for parameterised tools).
      const input = rawArgs != null && typeof rawArgs === 'object' ? rawArgs : {}

      const result = def.schema.safeParse(input)
      if (!result.success) {
        const issues = result.error.issues
          .map((i) => {
            const path = i.path.length > 0 ? `"${i.path.join('.')}"` : '(root)'
            return `${path}: ${i.message}`
          })
          .join('; ')
        throw new Error(`参数校验失败: ${issues}`)
      }

      return def.execute(result.data as z.infer<S>)
    },
  }
}

// ---------------------------------------------------------------------------
// Zod → JSON Schema converter (lightweight, covers OpenAI function-calling subset)
// ---------------------------------------------------------------------------

type JsonSchema = Record<string, unknown>

/**
 * Convert a `z.object(...)` into the JSON Schema `{ type: "object", ... }`
 * shape expected by OpenAI's `function.parameters`.
 *
 * Coverage: string, number, integer, boolean, literal, enum, nativeEnum,
 * array, object, optional, nullable, default, union of literals. This is
 * sufficient for every tool in the current codebase. Unsupported types fall
 * back to `{}` (any) with a console warning so they are easy to spot.
 */
function zodObjectToJsonSchema(schema: z.ZodObject<z.ZodRawShape>): JsonSchema {
  const shape = schema.shape
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []

  for (const [key, zodType] of Object.entries(shape)) {
    const { schema: propSchema, isOptional } = unwrapOptional(zodType as ZodTypeAny)
    const propJsonSchema = zodTypeToJsonSchema(propSchema)
    const wrapperDescription = (zodType as ZodTypeAny)._def.description
    if (wrapperDescription && !propJsonSchema.description) {
      propJsonSchema.description = wrapperDescription
    }
    properties[key] = propJsonSchema
    if (!isOptional) required.push(key)
  }

  const result: JsonSchema = {
    type: 'object',
    properties,
    additionalProperties: false,
  }
  if (required.length > 0) result.required = required
  return result
}

/** Peel off ZodOptional / ZodDefault wrappers and track whether the field is optional. */
function unwrapOptional(t: ZodTypeAny): { schema: ZodTypeAny; isOptional: boolean } {
  let isOptional = false
  let current = t
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (current instanceof z.ZodOptional) {
      isOptional = true
      current = (current as z.ZodOptional<ZodTypeAny>)._def.innerType
    } else if (current instanceof z.ZodDefault) {
      isOptional = true
      current = (current as z.ZodDefault<ZodTypeAny>)._def.innerType
    } else if (current instanceof z.ZodNullable) {
      current = (current as z.ZodNullable<ZodTypeAny>)._def.innerType
    } else {
      break
    }
  }
  return { schema: current, isOptional }
}

function zodTypeToJsonSchema(t: ZodTypeAny): JsonSchema {
  const desc = t._def.description
  const base = convertCore(t)
  if (desc) base.description = desc
  return base
}

function convertCore(t: ZodTypeAny): JsonSchema {
  // Primitives
  if (t instanceof z.ZodString) return { type: 'string' }
  if (t instanceof z.ZodNumber) {
    if (t._def.checks?.some((c: { kind: string }) => c.kind === 'int')) {
      return { type: 'integer' }
    }
    return { type: 'number' }
  }
  if (t instanceof z.ZodBoolean) return { type: 'boolean' }

  // Enum
  if (t instanceof z.ZodEnum) {
    return { type: 'string', enum: t._def.values as string[] }
  }

  // Native enum (TypeScript enum)
  if (t instanceof z.ZodNativeEnum) {
    const values = Object.values(t._def.values as Record<string, string | number>)
    return { type: 'string', enum: values }
  }

  // Literal
  if (t instanceof z.ZodLiteral) {
    const val = t._def.value
    const litType = typeof val === 'number' ? 'number' : typeof val === 'boolean' ? 'boolean' : 'string'
    return { type: litType, enum: [val] }
  }

  // Array
  if (t instanceof z.ZodArray) {
    return {
      type: 'array',
      items: zodTypeToJsonSchema(t._def.type),
    }
  }

  // Nested object
  if (t instanceof z.ZodObject) {
    return zodObjectToJsonSchema(t as z.ZodObject<z.ZodRawShape>)
  }

  // Union — if all members are literals, collapse into a single enum
  if (t instanceof z.ZodUnion) {
    const options = (t._def.options as ZodTypeAny[])
    const allLiterals = options.every((o) => o instanceof z.ZodLiteral)
    if (allLiterals) {
      const values = options.map((o) => (o as z.ZodLiteral<unknown>)._def.value)
      return { type: 'string', enum: values }
    }
    // Generic union → anyOf
    return { anyOf: options.map((o) => zodTypeToJsonSchema(o)) }
  }

  // Nullable — no need for special handling in OpenAI JSON Schema
  if (t instanceof z.ZodNullable) {
    return zodTypeToJsonSchema((t as z.ZodNullable<ZodTypeAny>)._def.innerType)
  }

  // Passthrough wrappers
  if (t instanceof z.ZodOptional) {
    return zodTypeToJsonSchema((t as z.ZodOptional<ZodTypeAny>)._def.innerType)
  }
  if (t instanceof z.ZodDefault) {
    return zodTypeToJsonSchema((t as z.ZodDefault<ZodTypeAny>)._def.innerType)
  }

  // Fallback — warn and emit permissive schema
  console.warn(`[defineAgentTool] Unsupported Zod type: ${t.constructor.name}, falling back to {}`)
  return {}
}
