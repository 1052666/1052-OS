import { describe, expect, it } from 'vitest'
import {
  assertPublicWebUrl,
  isPublicWebAddress,
} from './websearch.service.js'

describe('public web URL safety', () => {
  it('blocks local, private, link-local and reserved addresses', async () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.1',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '198.51.100.8',
      '203.0.113.8',
      '0.0.0.0',
      '::1',
      '::ffff:127.0.0.1',
      'fc00::1',
      'fe80::1',
    ]) {
      expect(isPublicWebAddress(address), address).toBe(false)
    }
    await expect(assertPublicWebUrl('http://127.0.0.1/private')).rejects.toThrow(
      '私有网络',
    )
    await expect(assertPublicWebUrl('http://localhost/private')).rejects.toThrow(
      '私有网络',
    )
  })

  it('accepts public address literals and rejects credentialed URLs', async () => {
    expect(isPublicWebAddress('1.1.1.1')).toBe(true)
    await expect(assertPublicWebUrl('https://1.1.1.1/docs')).resolves.toBeInstanceOf(URL)
    await expect(assertPublicWebUrl('https://user:pass@1.1.1.1/docs')).rejects.toThrow(
      '用户名或密码',
    )
  })
})
