export async function sendWecomWebhookText(webhookUrl: string, content: string) {
  const body = { msgtype: 'text', text: { content } }
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`企业微信 Webhook 发送失败 (${res.status}): ${text}`)
  }
  const data = await res.json().catch(() => ({})) as { errcode?: number; errmsg?: string }
  if (data.errcode && data.errcode !== 0) {
    throw new Error(`企业微信 Webhook 错误 (${data.errcode}): ${data.errmsg ?? 'unknown'}`)
  }
  return data
}

export async function sendWecomWebhookMarkdown(webhookUrl: string, content: string) {
  const body = { msgtype: 'markdown', markdown: { content } }
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`企业微信 Webhook 发送失败 (${res.status}): ${text}`)
  }
  const data = await res.json().catch(() => ({})) as { errcode?: number; errmsg?: string }
  if (data.errcode && data.errcode !== 0) {
    throw new Error(`企业微信 Webhook 错误 (${data.errcode}): ${data.errmsg ?? 'unknown'}`)
  }
  return data
}
