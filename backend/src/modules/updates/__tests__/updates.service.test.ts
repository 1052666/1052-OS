import express from 'express'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '../updates.types.js'
import { normalizeUpdateInstallInput, planUpdateInstall, shouldRunUpdateInstall } from '../updates.service.js'

afterEach(() => {
  vi.doUnmock('../updates.service.js')
  vi.restoreAllMocks()
  vi.resetModules()
})

function status(overrides: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    workspaceRoot: '/tmp/1052-os',
    dataDir: '/tmp/1052-os/data',
    mode: 'git',
    current: {
      commit: 'current',
      shortCommit: 'current',
      branch: 'main',
      source: 'git',
    },
    latest: {
      commit: 'latest',
      shortCommit: 'latest',
      date: '2026-04-26T00:00:00.000Z',
      message: 'latest commit',
      url: 'https://github.com/1052666/1052-OS/commit/latest',
    },
    updateAvailable: false,
    canInstall: true,
    dirty: false,
    dirtyFiles: [],
    warnings: [],
    lastCheckedAt: '2026-04-26T00:00:00.000Z',
    ...overrides,
  }
}

describe('updates service install gate', () => {
  it('runs normal installs only when an update is available', () => {
    expect(shouldRunUpdateInstall(status({ updateAvailable: true }), { force: false })).toBe(true)
    expect(shouldRunUpdateInstall(status({ updateAvailable: false }), { force: false })).toBe(false)
  })

  it('allows forced reinstall only for archive installs with a known latest commit', () => {
    expect(
      shouldRunUpdateInstall(status({ mode: 'archive', updateAvailable: false }), { force: true }),
    ).toBe(true)
    expect(shouldRunUpdateInstall(status({ mode: 'git', updateAvailable: false }), { force: true })).toBe(false)
    expect(
      shouldRunUpdateInstall(status({ mode: 'archive', latest: null, updateAvailable: false }), {
        force: true,
      }),
    ).toBe(false)
  })

  it('normalizes force to an explicit boolean true only', () => {
    expect(normalizeUpdateInstallInput({ force: true })).toEqual({ force: true })
    expect(normalizeUpdateInstallInput({ force: 'true' })).toEqual({ force: false })
    expect(normalizeUpdateInstallInput()).toEqual({ force: false })
  })

  it('keeps canInstall and latest preflight gates ahead of forced reinstall', () => {
    expect(
      planUpdateInstall(
        status({
          mode: 'archive',
          canInstall: false,
          updateAvailable: false,
          warnings: ['dirty workspace'],
        }),
        { force: true },
      ),
    ).toEqual({ action: 'blocked', message: 'dirty workspace' })
    expect(
      planUpdateInstall(status({ mode: 'archive', latest: null, updateAvailable: false }), {
        force: true,
      }),
    ).toEqual({ action: 'blocked', message: '无法获取 GitHub 最新版本。' })
    expect(planUpdateInstall(status({ mode: 'git', updateAvailable: false }), { force: true })).toEqual({
      action: 'noop',
    })
    expect(
      planUpdateInstall(status({ mode: 'archive', updateAvailable: false }), { force: true }),
    ).toMatchObject({ action: 'install', forcedArchiveReinstallCommit: 'latest' })
  })

  it('forwards install request body to the update service', async () => {
    vi.resetModules()
    const startUpdateInstall = vi.fn(async () => ({
      id: 'run-1',
      status: 'queued',
      phase: 'queued',
      phaseLabel: '等待开始',
      progress: 0,
      message: 'queued',
      logPath: '',
      logTail: '',
      startedAt: '2026-04-26T00:00:00.000Z',
      finishedAt: null,
      error: null,
      statusSnapshot: null,
    }))
    vi.doMock('../updates.service.js', () => ({
      getUpdateRun: vi.fn(),
      getUpdateStatus: vi.fn(),
      scheduleUpdateRestart: vi.fn(),
      startUpdateInstall,
    }))
    const { updatesRouter } = await import('../updates.routes.js')
    const app = express()
    app.use(express.json())
    app.use('/api/updates', updatesRouter)
    const server = app.listen(0)

    try {
      const { port } = server.address() as AddressInfo
      const response = await fetch(`http://127.0.0.1:${port}/api/updates/install`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ force: true }),
      })
      expect(response.status).toBe(202)
      expect(startUpdateInstall).toHaveBeenCalledWith({ force: true })
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })
})
