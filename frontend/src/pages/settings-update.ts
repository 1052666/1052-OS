import type { UpdateInstallOptions, UpdateStatus } from '../api/updates'

export function canReinstallArchiveLatest(updateStatus: UpdateStatus | null) {
  return Boolean(updateStatus?.mode === 'archive' && updateStatus.latest && !updateStatus.updateAvailable)
}

export function canInstallSystemUpdate(updateStatus: UpdateStatus | null) {
  return Boolean(
    updateStatus?.canInstall &&
      (updateStatus.updateAvailable || canReinstallArchiveLatest(updateStatus)),
  )
}

export function getSystemUpdateInstallOptions(updateStatus: UpdateStatus | null): UpdateInstallOptions {
  return { force: canReinstallArchiveLatest(updateStatus) }
}
