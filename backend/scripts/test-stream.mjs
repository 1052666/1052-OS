import https from 'node:https'
import fs from 'node:fs'

const settings = JSON.parse(fs.readFileSync(new URL('../../data/settings.json', import.meta.url), 'utf-8'))
const { baseUrl, modelId, apiKey } = settings.llm

const url = new URL(baseUrl.replace(/\/+$/, '') + '/chat/completions')
const body = JSON.stringify({
  model: modelId,
  messages: [{ role: 'user', content: '说三个字' }],
  stream: true,
})

console.log('POST', url.toString())
console.log('body=', body)

const req = https.request(
  {
    method: 'POST',
    hostname: url.hostname,
    port: url.port || 443,
    path: url.pathname + url.search,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      Accept: 'text/event-stream',
      'Accept-Encoding': 'identity',
      'Content-Length': Buffer.byteLength(body).toString(),
    },
  },
  (res) => {
    console.log('status=', res.statusCode)
    console.log('headers=', res.headers)
    res.setEncoding('utf-8')
    let n = 0
    res.on('data', (chunk) => {
      n++
      console.log(`--- chunk ${n} bytes=${chunk.length} ---`)
      console.log(chunk)
    })
    res.on('end', () => console.log('=== END total chunks=', n))
    res.on('error', (e) => console.error('err:', e))
  },
)
req.on('error', (e) => console.error('req err:', e))
req.write(body)
req.end()
