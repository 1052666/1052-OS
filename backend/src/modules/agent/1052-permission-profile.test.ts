import { describe, expect, it } from 'vitest'
import {
  describe1052PermissionProfile,
  resolve1052PermissionProfile,
  shouldAutoConfirm1052Tool,
} from './1052-permission-profile.js'

describe('1052 permission profile', () => {
  it('maps default settings to on-request workspace permissions', () => {
    const profile = resolve1052PermissionProfile({ permissionProfile: 'default' })

    expect(profile).toEqual({
      id: ':default',
      approvalPolicy: 'on-request',
      sandboxPolicy: {
        type: 'workspace-write',
        networkAccess: true,
        writableRoots: [],
      },
    })
    expect(shouldAutoConfirm1052Tool(profile, { requiresConfirmation: true })).toBe(false)
  })

  it('maps full access to never-ask danger-full-access permissions', () => {
    const profile = resolve1052PermissionProfile({ permissionProfile: 'danger-full-access' })

    expect(profile).toEqual({
      id: ':danger-full-access',
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'danger-full-access' },
    })
    expect(shouldAutoConfirm1052Tool(profile, { requiresConfirmation: true })).toBe(true)
    expect(shouldAutoConfirm1052Tool(profile, { requiresConfirmation: false })).toBe(false)
  })

  it('blocks side effects in the read-only profile', () => {
    const profile = resolve1052PermissionProfile({ permissionProfile: 'read-only' })

    expect(profile).toEqual({
      id: ':read-only',
      approvalPolicy: 'on-request',
      sandboxPolicy: { type: 'read-only', networkAccess: false },
    })
    expect(describe1052PermissionProfile(profile)).toContain(
      'Side-effecting tools are blocked by the runtime.',
    )
  })

  it('keeps legacy fullAccess settings compatible during migration', () => {
    expect(resolve1052PermissionProfile({ fullAccess: true }).id).toBe(':danger-full-access')
    expect(resolve1052PermissionProfile({ fullAccess: false }).id).toBe(':default')
  })

  it('renders a system prompt permission block from the active profile', () => {
    const text = describe1052PermissionProfile(
      resolve1052PermissionProfile({ fullAccess: true }),
    )

    expect(text).toContain('Permission profile: 1052 danger-full-access.')
    expect(text).toContain('approval_policy: never')
    expect(text).toContain('sandbox_policy: danger-full-access')
  })
})
