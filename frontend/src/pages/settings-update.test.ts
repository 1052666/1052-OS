import { describe, expect, it } from 'vitest'
import type { UpdateStatus } from '../api/updates'
import {
  canInstallSystemUpdate,
  canReinstallArchiveLatest,
  getSystemUpdateInstallOptions,
} from './settings-update'

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

describe('system update install options', () => {
  it('sends force only for archive reinstall when latest is known and no update is pending', () => {
    const archiveReinstall = status({ mode: 'archive', updateAvailable: false })
    expect(canReinstallArchiveLatest(archiveReinstall)).toBe(true)
    expect(getSystemUpdateInstallOptions(archiveReinstall)).toEqual({ force: true })

    expect(getSystemUpdateInstallOptions(status({ mode: 'git', updateAvailable: false }))).toEqual({
      force: false,
    })
    expect(getSystemUpdateInstallOptions(status({ mode: 'archive', updateAvailable: true }))).toEqual({
      force: false,
    })
    expect(
      getSystemUpdateInstallOptions(status({ mode: 'archive', latest: null, updateAvailable: false })),
    ).toEqual({ force: false })
  })

  it('allows install action for normal updates and archive reinstall only when canInstall is true', () => {
    expect(canInstallSystemUpdate(status({ updateAvailable: true }))).toBe(true)
    expect(canInstallSystemUpdate(status({ mode: 'archive', updateAvailable: false }))).toBe(true)
    expect(
      canInstallSystemUpdate(status({ mode: 'archive', updateAvailable: false, canInstall: false })),
    ).toBe(false)
    expect(canInstallSystemUpdate(status({ mode: 'git', updateAvailable: false }))).toBe(false)
  })
})
