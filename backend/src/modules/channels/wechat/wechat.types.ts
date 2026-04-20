export type WechatAccountRecord = {
  accountId: string
  token?: string
  baseUrl: string
  userId?: string
  name?: string
  enabled: boolean
  savedAt?: string
}

export type WechatAccountSummary = Omit<WechatAccountRecord, 'token'> & {
  configured: boolean
  running: boolean
  lastInboundAt?: number
  lastOutboundAt?: number
  lastError?: string
}

export type WechatLoginStart = {
  sessionKey: string
  qrcodeUrl?: string
  message: string
  expiresAt: number
}

export type WechatLoginWait = {
  connected: boolean
  message: string
  account?: WechatAccountSummary
}

export type WechatCdnMedia = {
  encrypt_query_param?: string
  aes_key?: string
  encrypt_type?: number
  full_url?: string
}

export type WechatImageItem = {
  media?: WechatCdnMedia
  thumb_media?: WechatCdnMedia
  aeskey?: string
  url?: string
  mid_size?: number
  thumb_size?: number
}

export type WechatVoiceItem = {
  media?: WechatCdnMedia
  encode_type?: number
  sample_rate?: number
  playtime?: number
  text?: string
}

export type WechatFileItem = {
  media?: WechatCdnMedia
  file_name?: string
  md5?: string
  len?: number | string
}

export type WechatVideoItem = {
  media?: WechatCdnMedia
  thumb_media?: WechatCdnMedia
  video_size?: number
  play_length?: number
  video_md5?: string
}

export type WechatMessageItem = {
  type?: number
  text_item?: { text?: string }
  image_item?: WechatImageItem
  voice_item?: WechatVoiceItem
  file_item?: WechatFileItem
  video_item?: WechatVideoItem
  ref_msg?: { message_item?: WechatMessageItem[] }
}

export type WechatMessage = {
  seq?: number
  message_id?: number
  from_user_id?: string
  to_user_id?: string
  create_time_ms?: number
  message_type?: number
  item_list?: WechatMessageItem[]
  context_token?: string
}

export type WechatGetUpdatesResponse = {
  ret?: number
  errcode?: number
  errmsg?: string
  msgs?: WechatMessage[]
  get_updates_buf?: string
  longpolling_timeout_ms?: number
}
