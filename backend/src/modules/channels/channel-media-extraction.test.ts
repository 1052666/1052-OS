import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { extractOutboundFeishuMedia } from './feishu/feishu.media.js'
import { extractOutboundWechatMedia } from './wechat/wechat.media.js'

const tempDirs: string[] = []

async function makeTempMedia(ext = '.png') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), '1052-channel-media-'))
  tempDirs.push(dir)
  const filePath = path.join(dir, `desktop shot${ext}`)
  await fs.writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  return filePath
}

async function expectBothChannelsExtract(text: string, filePath: string) {
  const wechat = await extractOutboundWechatMedia(text)
  const feishu = await extractOutboundFeishuMedia(text)

  expect(wechat.files).toEqual([filePath])
  expect(feishu.files).toEqual([filePath])
  expect(wechat.warnings).toEqual([])
  expect(feishu.warnings).toEqual([])
  expect(wechat.text).not.toContain(filePath)
  expect(feishu.text).not.toContain(filePath)
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('channel outbound media extraction', () => {
  it.runIf(process.platform === 'win32')('extracts inline Windows paths from natural language replies', async () => {
    const filePath = await makeTempMedia()

    await expectBothChannelsExtract(`截图保存到了 ${filePath}，请查看。`, filePath)
  })

  it.runIf(process.platform === 'win32')('extracts Windows paths from Markdown links and preserves the label as text', async () => {
    const filePath = await makeTempMedia()
    const wechat = await extractOutboundWechatMedia(`这是 [桌面截图](${filePath})。`)
    const feishu = await extractOutboundFeishuMedia(`这是 [桌面截图](${filePath})。`)

    expect(wechat.files).toEqual([filePath])
    expect(feishu.files).toEqual([filePath])
    expect(wechat.text).toBe('这是 桌面截图。')
    expect(feishu.text).toBe('这是 桌面截图。')
  })

  it.runIf(process.platform === 'win32')('extracts angle-bracket file URLs from Markdown images', async () => {
    const filePath = await makeTempMedia()
    const fileUrl = pathToFileURL(filePath).href

    await expectBothChannelsExtract(`![桌面截图](<${fileUrl}>)`, filePath)
  })
})
