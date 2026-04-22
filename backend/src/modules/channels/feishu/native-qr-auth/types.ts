/**
 * Native QR Auth — shared types for the feishu app-registration device flow.
 *
 * These types model the three-step POST flow against
 * https://accounts.feishu.cn/oauth/v1/app/registration
 * and the credential-validation call to the standard tenant_access_token API.
 */

// ---------------------------------------------------------------------------
// Request / response shapes for accounts.feishu.cn
// ---------------------------------------------------------------------------

/** Brands supported by the Feishu / Lark platform. */
export type FeishuBrand = 'feishu' | 'lark'

/**
 * Response from action=init.
 * Confirms the server supports the device-registration flow.
 */
export interface InitResponse {
  /** List of supported auth methods, e.g. ["client_secret"]. */
  auth_methods: string[]
  /** Raw HTTP status was 200 and response had no error code. */
  ok: true
}

/**
 * Response from action=begin.
 * Contains the QR code URL and the device_code needed for polling.
 */
export interface BeginResponse {
  /** Opaque token used in subsequent poll calls. */
  device_code: string
  /**
   * Full URL the user should scan (encode as QR).
   * Example: https://accounts.feishu.cn/login/qrcode/...
   */
  verification_uri_complete: string
  /** Seconds until device_code expires (typically 600). */
  expires_in: number
  /** Recommended polling interval in seconds (typically 5). */
  interval: number
}

/**
 * Terminal success payload from action=poll.
 * Returned only when the user has completed the scan-and-authorise flow.
 */
export interface PollSuccessResponse {
  /** Feishu App ID (client_id). Written to app config as appId. */
  client_id: string
  /** Feishu App Secret (client_secret). Written to app config as appSecret. */
  client_secret: string
  user_info?: {
    open_id?: string
    tenant_brand?: FeishuBrand
  }
}

/**
 * Non-terminal status returned while the user has not yet scanned / approved.
 * Callers should continue polling until status is 'authorised' or the device_code expires.
 */
export type PollPendingStatus = 'authorization_pending' | 'slow_down' | 'expired' | 'access_denied'

export interface PollPendingResponse {
  error: PollPendingStatus
}

export type PollResponse = PollSuccessResponse | PollPendingResponse

// ---------------------------------------------------------------------------
// Public domain objects exposed to callers
// ---------------------------------------------------------------------------

/**
 * Represents an active QR authorisation session.
 * Created by `beginQrAuth()`, consumed by `pollQrStatus()`.
 */
export interface QrSession {
  /** Opaque server-assigned token. Pass to `pollQrStatus()`. */
  deviceCode: string
  /**
   * The URL to encode as a QR image on the frontend.
   * Scanning this URL in the Feishu / Lark mobile app triggers authorisation.
   */
  verificationUriComplete: string
  /** UNIX timestamp (seconds) when the session expires. */
  expiresAt: number
  /** Suggested polling interval in seconds. */
  interval: number
  /** Which brand domain was used to generate this session. */
  brand: FeishuBrand
}

/**
 * Resolved credentials after a successful QR scan.
 * Suitable for persisting to the app's Feishu channel config.
 */
export interface FeishuCredentialPayload {
  /** Feishu App ID. */
  appId: string
  /** Feishu App Secret. */
  appSecret: string
  /** open_id of the user who authorised (may be used for allowFrom filtering). */
  openId?: string
  /** Brand of the authorising organisation. */
  brand: FeishuBrand
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/**
 * Thrown by all functions in feishu-accounts-client.ts on unrecoverable errors.
 * Callers should catch `FeishuQrAuthError` specifically to distinguish
 * auth-flow errors from unexpected network / programming errors.
 */
export class FeishuQrAuthError extends Error {
  constructor(
    message: string,
    /** HTTP status code if available, or a symbolic code such as 'EXPIRED'. */
    public readonly code: number | string,
  ) {
    super(message)
    this.name = 'FeishuQrAuthError'
  }
}
