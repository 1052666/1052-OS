import fs from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tempDir = ''

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), '1052-appearance-'))
  process.env.DATA_DIR = tempDir
  vi.resetModules()
})

afterEach(async () => {
  delete process.env.DATA_DIR
  await fs.rm(tempDir, { recursive: true, force: true })
})

function validTheme(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    name: 'Calm workspace',
    mode: 'dark',
    scope: 'workspace',
    coreTokens: {
      bg: '#08111f',
      surface: '#f8fafc',
      fg: '#f8fafc',
      accent: '#38bdf8',
      success: '#34d399',
      danger: '#fb7185',
    },
    ...overrides,
  }
}

function experimentalTheme(overrides: Record<string, unknown> = {}) {
  return validTheme({
    name: 'Neon workspace',
    coreTokens: {
      ...validTheme().coreTokens,
      accent: '#ff00ff',
    },
    ...overrides,
  })
}

describe('appearance theme profiles', () => {
  it('creates, applies, resets, and records recent apply history with confirmation gates', async () => {
    const service = await import('../appearance.service.js')
    const created = await service.createAppearanceTheme(validTheme())
    const profile = created.profiles[0]

    expect(profile.theme.safetyLevel).toBe('safe')
    expect(profile.theme.tokens.accentSoft).toMatch(/^rgba/)
    expect(profile.theme.tokens.hairline).toMatch(/^rgba/)
    expect(profile.review.passed).toBe(true)
    await expect(service.applyAppearanceTheme(profile.id)).rejects.toThrow(/确认/)

    const applied = await service.applyAppearanceTheme(profile.id, { confirmed: true })
    expect(applied.activeProfileId).toBe(profile.id)
    expect(applied.activeProfile?.theme.coreTokens.accent).toBe('#38bdf8')
    expect(applied.applyHistory).toHaveLength(1)
    expect(applied.applyHistory[0]).toMatchObject({
      profileId: profile.id,
      themeName: 'Calm workspace',
      safetyLevel: 'safe',
    })

    await expect(service.resetAppearanceTheme()).rejects.toThrow(/确认/)
    const reset = await service.resetAppearanceTheme({ confirmed: true })
    expect(reset.activeProfileId).toBe('')
    expect(reset.applyHistory).toHaveLength(1)
  })

  it('rejects low-contrast profiles before they can be saved', async () => {
    const service = await import('../appearance.service.js')
    const theme = validTheme({
      coreTokens: {
        ...validTheme().coreTokens,
        fg: '#0b1220',
      },
    })

    const review = service.reviewAppearanceTheme(theme)
    expect(review.review.safetyLevel).toBe('rejected')
    expect(review.review.blockingIssues.some((item) => item.code === 'contrast-too-low')).toBe(true)
    await expect(service.createAppearanceTheme(theme)).rejects.toThrow(/兼容性检查/)
  })

  it('rejects raw css, selectors, background, and layout fields', async () => {
    const service = await import('../appearance.service.js')
    const review = service.reviewAppearanceTheme({
      ...validTheme(),
      css: 'body { display: none }',
      selector: '.app',
      className: 'hidden',
      style: { color: 'red' },
      display: 'none',
      position: 'fixed',
      margin: 0,
      padding: 0,
      width: '100vw',
      height: '100vh',
      background: { type: 'image', imageUrl: '/x.png' },
      coreTokens: {
        ...validTheme().coreTokens,
        zIndex: '9999',
      },
    })

    expect(review.review.safetyLevel).toBe('rejected')
    expect(review.review.blockingIssues.map((item) => item.path)).toEqual(
      expect.arrayContaining([
        'theme.css',
        'theme.selector',
        'theme.className',
        'theme.style',
        'theme.display',
        'theme.position',
        'theme.margin',
        'theme.padding',
        'theme.width',
        'theme.height',
        'theme.background',
        'coreTokens.zIndex',
      ]),
    )
  })

  it('ignores user-provided derived tokens and regenerates them from core tokens', async () => {
    const service = await import('../appearance.service.js')
    const created = await service.createAppearanceTheme(
      validTheme({
        tokens: {
          accentSoft: 'url(javascript:alert(1))',
          hairline: '999px solid red',
        },
      }),
    )

    expect(created.profiles[0].theme.tokens.accentSoft).toMatch(/^rgba/)
    expect(created.profiles[0].theme.tokens.hairline).toMatch(/^rgba/)
    expect(created.profiles[0].theme.tokens.accentSoft).not.toContain('javascript')
  })

  it('requires stronger confirmation before applying experimental profiles', async () => {
    const service = await import('../appearance.service.js')
    const created = await service.createAppearanceTheme(experimentalTheme())
    const profile = created.profiles[0]

    expect(profile.review.safetyLevel).toBe('experimental')
    expect(profile.review.warnings.some((item) => item.code === 'strong-style-token')).toBe(true)
    await expect(
      service.applyAppearanceTheme(profile.id, { confirmed: true }),
    ).rejects.toThrow(/experimental/)

    const applied = await service.applyAppearanceTheme(profile.id, {
      confirmed: true,
      allowExperimental: true,
    })
    expect(applied.activeProfileId).toBe(profile.id)
  })

  it('does not expose a stored rejected profile as the active theme', async () => {
    const service = await import('../appearance.service.js')
    const created = await service.createAppearanceTheme(validTheme())
    const profile = created.profiles[0]
    await service.applyAppearanceTheme(profile.id, { confirmed: true })

    const storeFile = path.join(tempDir, 'appearance', 'theme-profiles.json')
    const stored = JSON.parse(await fs.readFile(storeFile, 'utf-8')) as {
      profiles: Array<{ id: string; theme: { coreTokens: Record<string, string> } }>
    }
    stored.profiles[0].theme.coreTokens.fg = stored.profiles[0].theme.coreTokens.bg
    await fs.writeFile(storeFile, JSON.stringify(stored), 'utf-8')

    const themes = await service.listAppearanceThemes()
    expect(themes.profiles[0].review.safetyLevel).toBe('rejected')
    expect(themes.activeProfileId).toBe('')
    expect(themes.activeProfile).toBeNull()
  })

  it('keeps only the latest five applied profiles in history', async () => {
    const service = await import('../appearance.service.js')

    for (let index = 0; index < 6; index += 1) {
      const created = await service.createAppearanceTheme(
        validTheme({
          name: `Theme ${index}`,
          coreTokens: {
            ...validTheme().coreTokens,
            accent: index % 2 === 0 ? '#38bdf8' : '#a78bfa',
          },
        }),
      )
      await service.applyAppearanceTheme(created.profiles[0].id, { confirmed: true })
    }

    const themes = await service.listAppearanceThemes()
    expect(themes.applyHistory).toHaveLength(5)
    expect(themes.applyHistory[0].themeName).toBe('Theme 5')
    expect(themes.applyHistory.at(-1)?.themeName).toBe('Theme 1')
  })

  it('keeps route-level apply and reset confirmation gates fail-closed', async () => {
    const service = await import('../appearance.service.js')
    await fs.mkdir(path.join(tempDir, 'pkm'), { recursive: true })
    await fs.writeFile(path.join(tempDir, 'pkm', 'index.json'), '[]', 'utf-8')
    const { createApp } = await import('../../../app.js')
    const created = await service.createAppearanceTheme(validTheme())
    const profile = created.profiles[0]
    const server = createApp().listen(0)

    try {
      const { port } = server.address() as AddressInfo
      const baseUrl = `http://127.0.0.1:${port}/api/appearance`
      const applyWithoutConfirmation = await fetch(`${baseUrl}/themes/${profile.id}/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(applyWithoutConfirmation.status).toBe(400)

      const applyWithConfirmation = await fetch(`${baseUrl}/themes/${profile.id}/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmed: true }),
      })
      expect(applyWithConfirmation.status).toBe(200)

      const resetWithoutConfirmation = await fetch(`${baseUrl}/themes/reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(resetWithoutConfirmation.status).toBe(400)
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })
})
