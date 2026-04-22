/**
 * native-qr-auth — public entry point.
 *
 * Re-exports all types and the four client functions so consumers can import
 * from the directory without knowing its internal layout:
 *
 *   import { beginQrAuth, pollQrStatus, verifyTenantToken, FeishuQrAuthError }
 *     from '../native-qr-auth/index.js'
 */

export type {
  BeginResponse,
  FeishuBrand,
  FeishuCredentialPayload,
  InitResponse,
  PollPendingResponse,
  PollPendingStatus,
  PollResponse,
  PollSuccessResponse,
  QrSession,
} from './types.js'

export { FeishuQrAuthError } from './types.js'

export {
  beginQrAuth,
  initRegistration,
  pollQrStatus,
  verifyTenantToken,
} from './feishu-accounts-client.js'

export type { WizardEvent, WizardStartResult, WizardStatus } from './setup-wizard.service.js'
export { cancelWizardSession, startWizardSession, subscribeToSession } from './setup-wizard.service.js'

export { hasExistingFeishuEnvKeys, writeEnvCredentials } from './env-writer.js'

export { setupWizardRouter } from './setup-wizard.routes.js'
