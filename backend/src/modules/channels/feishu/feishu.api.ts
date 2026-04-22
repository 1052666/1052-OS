import { randomUUID } from 'node:crypto'
import * as Lark from '@larksuiteoapi/node-sdk'
import { HttpError } from '../../../http-error.js'
import type {
  FeishuAppConfigRecord,
  FeishuMessageSendResult,
  FeishuMessageType,
  FeishuReceiveIdType,
} from './feishu.types.js'

let cachedSignature = ''
let cachedClient: Lark.Client | null = null

function configSignature(config: FeishuAppConfigRecord) {
  return [config.appId ?? '', config.appSecret ?? ''].join(':')
}

export function isFeishuConfigured(config: FeishuAppConfigRecord) {
  return Boolean(config.appId?.trim() && config.appSecret?.trim())
}

function assertConfigured(config: FeishuAppConfigRecord) {
  if (!isFeishuConfigured(config)) {
    throw new HttpError(400, 'Feishu appId and appSecret are required before connecting.')
  }
}

export function createFeishuClient(config: FeishuAppConfigRecord) {
  assertConfigured(config)
  const signature = configSignature(config)
  if (!cachedClient || cachedSignature !== signature) {
    cachedSignature = signature
    cachedClient = new Lark.Client({
      appId: config.appId!,
      appSecret: config.appSecret!,
      appType: Lark.AppType.SelfBuild,
      domain: Lark.Domain.Feishu,
      loggerLevel: Lark.LoggerLevel.info,
    })
  }
  return cachedClient
}

export function createFeishuWsClient(config: FeishuAppConfigRecord) {
  assertConfigured(config)
  return new Lark.WSClient({
    appId: config.appId!,
    appSecret: config.appSecret!,
    domain: Lark.Domain.Feishu,
    loggerLevel: Lark.LoggerLevel.info,
  })
}

function assertSendResult(result: any) {
  if (!result || result.code !== 0) {
    throw new HttpError(502, result?.msg || 'Feishu message send failed.')
  }
  return result
}

export async function sendFeishuMessage(params: {
  config: FeishuAppConfigRecord
  receiveIdType: FeishuReceiveIdType
  receiveId: string
  msgType: FeishuMessageType
  content: string
}) {
  const client = createFeishuClient(params.config)
  const response = await client.im.message.create({
    params: {
      receive_id_type: params.receiveIdType,
    },
    data: {
      receive_id: params.receiveId,
      content: params.content,
      msg_type: params.msgType as any,
      uuid: randomUUID().slice(0, 50),
    } as any,
  } as any)
  const result = assertSendResult(response)
  return {
    ok: true,
    msgType: params.msgType,
    receiveIdType: params.receiveIdType,
    receiveId: params.receiveId,
    messageId: result.data?.message_id,
    chatId: result.data?.chat_id,
  } satisfies FeishuMessageSendResult
}

export async function sendFeishuText(params: {
  config: FeishuAppConfigRecord
  receiveIdType: FeishuReceiveIdType
  receiveId: string
  text: string
}): Promise<FeishuMessageSendResult> {
  return sendFeishuMessage({
    config: params.config,
    receiveIdType: params.receiveIdType,
    receiveId: params.receiveId,
    msgType: 'text',
    content: JSON.stringify({ text: params.text }),
  })
}

export async function sendFeishuCard(params: {
  config: FeishuAppConfigRecord
  receiveIdType: FeishuReceiveIdType
  receiveId: string
  card: unknown
}): Promise<FeishuMessageSendResult> {
  return sendFeishuMessage({
    config: params.config,
    receiveIdType: params.receiveIdType,
    receiveId: params.receiveId,
    msgType: 'interactive',
    content:
      typeof params.card === 'string' ? params.card : JSON.stringify(params.card ?? {}),
  })
}

export async function updateFeishuMessageCard(params: {
  config: FeishuAppConfigRecord
  messageId: string
  card: unknown
}) {
  const client = createFeishuClient(params.config)
  const response = await client.request({
    method: 'PATCH',
    url: `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(
      params.messageId,
    )}`,
    data: {
      content:
        typeof params.card === 'string' ? params.card : JSON.stringify(params.card ?? {}),
    },
  })
  return assertSendResult(response)
}
