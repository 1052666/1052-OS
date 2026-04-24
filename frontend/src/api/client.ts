/** 鍓嶇 鈫?鍚庣钖勫鎴风銆俈ite 宸叉妸 /api 浠ｇ悊鍒?10053銆?*/
import { logFrontendRuntime } from '../runtime-logs'

export type ApiError = { status: number; message: string }

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  let res: Response
  try {
    res = await fetch('/api' + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch (error) {
    logFrontendRuntime(
      'error',
      'API network request failed',
      {
        method,
        path,
        message: error instanceof Error ? error.message : String(error),
      },
      { source: 'api', immediate: true },
    )
    throw error
  }

  const text = await res.text()
  const data = text ? safeParse(text) : null
  if (!res.ok) {
    const err: ApiError = {
      status: res.status,
      message:
        (data && typeof data === 'object' && 'error' in (data as object)
          ? String((data as { error: unknown }).error)
          : res.statusText) || '璇锋眰澶辫触',
    }
    logFrontendRuntime(
      res.status >= 500 ? 'error' : 'warn',
      'API request returned non-ok status',
      {
        method,
        path,
        status: res.status,
        message: err.message,
      },
      { source: 'api', immediate: res.status >= 500 },
    )
    throw err
  }
  return data as T
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  patch: <T>(p: string, body: unknown) => request<T>('PATCH', p, body),
  put: <T>(p: string, body: unknown) => request<T>('PUT', p, body),
  post: <T>(p: string, body: unknown) => request<T>('POST', p, body),
  delete: <T>(p: string) => request<T>('DELETE', p),
}
