/** 前端 → 后端薄客户端。Vite 已把 /api 代理到 10053。 */

export type ApiError = { status: number; message: string }

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  const data = text ? safeParse(text) : null
  if (!res.ok) {
    const err: ApiError = {
      status: res.status,
      message:
        (data && typeof data === 'object' && 'error' in (data as object)
          ? String((data as { error: unknown }).error)
          : res.statusText) || '请求失败',
    }
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
  put: <T>(p: string, body: unknown) => request<T>('PUT', p, body),
  post: <T>(p: string, body: unknown) => request<T>('POST', p, body),
  patch: <T>(p: string, body: unknown) => request<T>('PATCH', p, body),
  delete: <T>(p: string) => request<T>('DELETE', p),
}
