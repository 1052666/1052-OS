import type { z } from 'zod'

export class ApiFault extends Error {
  readonly status: number
  readonly details?: unknown

  constructor(status: number, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiFault'
    this.status = status
    this.details = details
  }
}

type RequestOptions<TSchema extends z.ZodTypeAny> = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  schema: TSchema
  signal?: AbortSignal
  headers?: HeadersInit
}

async function decode(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) return response.json().catch(() => null)
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export async function request<TSchema extends z.ZodTypeAny>(path: string, options: RequestOptions<TSchema>): Promise<z.output<TSchema>> {
  let response: Response
  try {
    response = await fetch('/api' + path, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...options.headers,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiFault(0, error instanceof Error ? error.message : '无法连接到本地服务')
  }

  const decoded = await decode(response)
  const payload = response.status === 204 && decoded === null ? { ok: true } : decoded
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : response.statusText || `请求失败 (${response.status})`
    throw new ApiFault(response.status, message, payload)
  }

  const parsed = options.schema.safeParse(payload)
  if (!parsed.success) {
    throw new ApiFault(502, '服务返回的数据格式与当前界面不兼容', parsed.error.flatten())
  }
  return parsed.data
}

export async function upload<TSchema extends z.ZodTypeAny>(path: string, form: FormData, schema: TSchema, signal?: AbortSignal): Promise<z.output<TSchema>> {
  const response = await fetch('/api' + path, { method: 'POST', body: form, signal })
  const payload = await decode(response)
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : response.statusText
    throw new ApiFault(response.status, message || '上传失败', payload)
  }
  const parsed = schema.safeParse(payload)
  if (!parsed.success) throw new ApiFault(502, '上传结果格式异常', parsed.error.flatten())
  return parsed.data
}

export function queryString(values: Record<string, string | number | boolean | undefined | null>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  }
  const output = params.toString()
  return output ? `?${output}` : ''
}
