import type { ToolRuntime1052Metadata } from './1052-tool-runtime.js'

export type ApprovalPolicy1052 = 'on-request' | 'unless-trusted' | 'never'

export type SandboxPolicy1052 =
  | { type: 'read-only'; networkAccess: boolean }
  | { type: 'workspace-write'; networkAccess: boolean; writableRoots: string[] }
  | { type: 'danger-full-access' }

export type PermissionProfile1052 = {
  id: ':read-only' | ':default' | ':danger-full-access'
  approvalPolicy: ApprovalPolicy1052
  sandboxPolicy: SandboxPolicy1052
}

export type PermissionSource1052 = {
  permissionProfile?: 'read-only' | 'default' | 'danger-full-access'
  fullAccess?: boolean
}

export function resolve1052PermissionProfile(
  source: PermissionSource1052,
): PermissionProfile1052 {
  const selected =
    source.permissionProfile ?? (source.fullAccess === true ? 'danger-full-access' : 'default')

  if (selected === 'danger-full-access') {
    return {
      id: ':danger-full-access',
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'danger-full-access' },
    }
  }

  if (selected === 'read-only') {
    return {
      id: ':read-only',
      approvalPolicy: 'on-request',
      sandboxPolicy: { type: 'read-only', networkAccess: false },
    }
  }

  return {
    id: ':default',
    approvalPolicy: 'on-request',
    sandboxPolicy: {
      type: 'workspace-write',
      networkAccess: true,
      writableRoots: [],
    },
  }
}

export function shouldAutoConfirm1052Tool(
  profile: PermissionProfile1052,
  tool: Pick<ToolRuntime1052Metadata, 'requiresConfirmation'>,
): boolean {
  return tool.requiresConfirmation && profile.approvalPolicy === 'never'
}

export function describe1052PermissionProfile(profile: PermissionProfile1052): string {
  const sandbox =
    profile.sandboxPolicy.type === 'workspace-write'
      ? `${profile.sandboxPolicy.type}, network=${profile.sandboxPolicy.networkAccess ? 'enabled' : 'restricted'}`
      : profile.sandboxPolicy.type

  if (profile.approvalPolicy === 'never') {
    return [
      'Permission profile: 1052 danger-full-access.',
      `- approval_policy: ${profile.approvalPolicy}`,
      `- sandbox_policy: ${sandbox}`,
      '- Side-effecting tools may run without another confirmation, but must still be deliberate, scoped, and reported.',
    ].join('\n')
  }

  if (profile.sandboxPolicy.type === 'read-only') {
    return [
      'Permission profile: 1052 read-only.',
      `- approval_policy: ${profile.approvalPolicy}`,
      `- sandbox_policy: ${sandbox}, network=${profile.sandboxPolicy.networkAccess ? 'enabled' : 'restricted'}`,
      '- Read-only inspection tools may run directly.',
      '- Side-effecting tools are blocked by the runtime.',
    ].join('\n')
  }

  return [
    'Permission profile: 1052 default.',
    `- approval_policy: ${profile.approvalPolicy}`,
    `- sandbox_policy: ${sandbox}`,
    '- Read-only tools may run directly.',
    '- Side-effecting tools require explicit user confirmation before execution.',
  ].join('\n')
}
