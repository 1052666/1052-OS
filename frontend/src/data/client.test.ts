import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { z } from 'zod'
import { ApiFault, queryString, request, upload } from './client'

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  })

describe('ApiClient', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('prefixes backend paths and serializes JSON bodies', async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true, id: 'task-1' }))

    const result = await request('/calendar/tasks', {
      method: 'POST',
      body: { title: '早报' },
      schema: z.object({ ok: z.boolean(), id: z.string() }),
    })

    expect(result).toEqual({ ok: true, id: 'task-1' })
    expect(fetchMock).toHaveBeenCalledWith('/api/calendar/tasks', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ title: '早报' }),
      headers: expect.objectContaining({ 'content-type': 'application/json' }),
    }))
  })

  it('normalizes empty 204 responses for delete endpoints', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))

    const result = await request('/calendar/events/e-1', {
      method: 'DELETE',
      schema: z.object({ ok: z.boolean() }),
    })

    expect(result).toEqual({ ok: true })
  })

  it('raises ApiFault with backend JSON error messages', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: '权限不足', code: 'denied' }, { status: 403, statusText: 'Forbidden' }))

    await expect(request('/settings', { schema: z.object({ ok: z.boolean() }) })).rejects.toMatchObject({
      name: 'ApiFault',
      status: 403,
      message: '权限不足',
      details: { error: '权限不足', code: 'denied' },
    })
  })

  it('raises a compatibility fault when response schema does not match', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 42 }))

    await expect(request('/skills', { schema: z.object({ id: z.string() }) })).rejects.toMatchObject({
      name: 'ApiFault',
      status: 502,
      message: '服务返回的数据格式与当前界面不兼容',
    })
  })

  it('preserves AbortError instead of wrapping cancellation', async () => {
    const abort = new DOMException('aborted', 'AbortError')
    fetchMock.mockRejectedValueOnce(abort)

    await expect(request('/agent/stream', { schema: z.object({ ok: z.boolean() }) })).rejects.toBe(abort)
  })

  it('wraps network errors and upload parse errors consistently', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    await expect(request('/health', { schema: z.object({ ok: z.boolean() }) })).rejects.toMatchObject({
      name: 'ApiFault',
      status: 0,
      message: 'ECONNREFUSED',
    })

    fetchMock.mockResolvedValueOnce(json({ path: 1 }))
    await expect(upload('/files', new FormData(), z.object({ path: z.string() }))).rejects.toBeInstanceOf(ApiFault)
  })
})

describe('queryString', () => {
  it('omits empty values and keeps boolean or numeric filters', () => {
    expect(queryString({ q: '', enabled: false, limit: 20, missing: undefined, page: null })).toBe('?enabled=false&limit=20')
  })
})
