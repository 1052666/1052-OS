import crypto from 'node:crypto'
import type { WechatGetUpdatesResponse, WechatMessageItem } from './wechat.types.js'

const CHANNEL_VERSION = '2.1.8'
const ILINK_APP_ID = 'bot'
const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000

type QrCodeResponse = {
  qrcode?: string
  qrcode_img_content?: string
}

type QrStatusResponse = {
  status?: 'wait' | 'scaned' | 'confirmed' | 'expired' | 'scaned_but_redirect'
  bot_token?: string
  ilink_bot_id?: string
  ilink_user_id?: string
  baseurl?: string
  redirect_host?: string
}

type WechatApiStatusResponse = {
  ret?: number
  errcode?: number
  errmsg?: string
}

function buildClientVersion(version: string) {
  const [major = 0, minor = 0, patch = 0] = version
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0)
  return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff)
}

function ensureTrailingSlash(url: string) {
  return url.endsWith('/') ? url : `${url}/`
}

function randomWechatUin() {
  const value = crypto.randomBytes(4).readUInt32BE(0)
  return Buffer.from(String(value), 'utf-8').toString('base64')
}

function baseInfo() {
  return { channel_version: CHANNEL_VERSION }
}

function commonHeaders() {
  return {
    'iLink-App-Id': ILINK_APP_ID,
    'iLink-App-ClientVersion': String(buildClientVersion(CHANNEL_VERSION)),
  }
}

function postHeaders(body: string, token?: string) {
  return {
    ...commonHeaders(),
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'Content-Length': String(Buffer.byteLength(body, 'utf-8')),
    'X-WECHAT-UIN': randomWechatUin(),
    ...(token?.trim() ? { Authorization: `Bearer ${token.trim()}` } : {}),
  }
}

async function fetchText(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`微信接口请求失败 ${response.status}: ${text}`)
    }
    return text
  } finally {
    clearTimeout(timer)
  }
}

async function getJson<T>(baseUrl: string, endpoint: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const url = new URL(endpoint, ensureTrailingSlash(baseUrl))
  const text = await fetchText(url.toString(), { method: 'GET', headers: commonHeaders() }, timeoutMs)
  return JSON.parse(text) as T
}

async function postJson<T>(
  baseUrl: string,
  endpoint: string,
  payload: Record<string, unknown>,
  token?: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
) {
  const url = new URL(endpoint, ensureTrailingSlash(baseUrl))
  const body = JSON.stringify(payload)
  const text = await fetchText(url.toString(), { method: 'POST', headers: postHeaders(body, token), body }, timeoutMs)
  return JSON.parse(text) as T
}

function assertWechatApiOk(response: WechatApiStatusResponse, label: string) {
  const failed =
    (response.ret !== undefined && response.ret !== 0) ||
    (response.errcode !== undefined && response.errcode !== 0)
  if (failed) {
    throw new Error(
      `${label} failed: ${response.errmsg ?? response.errcode ?? response.ret}`,
    )
  }
}

export const WECHAT_DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com'

export async function fetchWechatQrCode() {
  return getJson<QrCodeResponse>(
    WECHAT_DEFAULT_BASE_URL,
    'ilink/bot/get_bot_qrcode?bot_type=3',
    DEFAULT_TIMEOUT_MS,
  )
}

export async function pollWechatQrStatus(baseUrl: string, qrcode: string) {
  return getJson<QrStatusResponse>(
    baseUrl,
    `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
    DEFAULT_LONG_POLL_TIMEOUT_MS,
  )
}

export async function getWechatUpdates(params: {
  baseUrl: string
  token?: string
  getUpdatesBuf?: string
  timeoutMs?: number
}) {
  return postJson<WechatGetUpdatesResponse>(
    params.baseUrl,
    'ilink/bot/getupdates',
    {
      get_updates_buf: params.getUpdatesBuf ?? '',
      base_info: baseInfo(),
    },
    params.token,
    params.timeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS,
  )
}

export async function sendWechatText(params: {
  baseUrl: string
  token?: string
  to: string
  text: string
  contextToken?: string
}) {
  const clientId = `1052os-wechat-${Date.now().toString(36)}-${crypto
    .randomBytes(4)
    .toString('hex')}`
  const response = await postJson<WechatApiStatusResponse>(
    params.baseUrl,
    'ilink/bot/sendmessage',
    {
      msg: {
        from_user_id: '',
        to_user_id: params.to,
        client_id: clientId,
        message_type: 2,
        message_state: 2,
        item_list: params.text ? [{ type: 1, text_item: { text: params.text } }] : undefined,
        context_token: params.contextToken,
      },
      base_info: baseInfo(),
    },
    params.token,
  )
  assertWechatApiOk(response, 'Wechat sendmessage')
  return clientId
}

export type WechatUploadUrlResponse = {
  ret?: number
  errcode?: number
  errmsg?: string
  encrypted_query_param?: string
  encrypt_query_param?: string
  upload_param?: string
  upload_full_url?: string
  full_url?: string
}

export async function getWechatUploadUrl(params: {
  baseUrl: string
  token?: string
  filekey: string
  mediaType: number
  to: string
  rawsize: number
  rawfilemd5: string
  filesize: number
  aeskey: string
}) {
  return postJson<WechatUploadUrlResponse>(
    params.baseUrl,
    'ilink/bot/getuploadurl',
    {
      filekey: params.filekey,
      media_type: params.mediaType,
      to_user_id: params.to,
      rawsize: params.rawsize,
      rawfilemd5: params.rawfilemd5,
      filesize: params.filesize,
      no_need_thumb: true,
      aeskey: params.aeskey,
      base_info: baseInfo(),
    },
    params.token,
  )
}

export async function sendWechatMessageItem(params: {
  baseUrl: string
  token?: string
  to: string
  item: WechatMessageItem
  contextToken?: string
}) {
  const clientId = `1052os-wechat-${Date.now().toString(36)}-${crypto
    .randomBytes(4)
    .toString('hex')}`
  const response = await postJson<WechatApiStatusResponse>(
    params.baseUrl,
    'ilink/bot/sendmessage',
    {
      msg: {
        from_user_id: '',
        to_user_id: params.to,
        client_id: clientId,
        message_type: 2,
        message_state: 2,
        item_list: [params.item],
        context_token: params.contextToken,
      },
      base_info: baseInfo(),
    },
    params.token,
  )
  assertWechatApiOk(response, 'Wechat sendmessage')
  return clientId
}
