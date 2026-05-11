import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const APPLY_MIRROR_API = '/api/appearance/themes/builtin%3Amirror-dark/apply'

async function applyMirrorProfile(page: Page): Promise<void> {
  await page.evaluate(async (apiPath: string) => {
    await fetch(apiPath, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmed: true }),
    })
  }, APPLY_MIRROR_API)
}

test.describe('mirror a11y', () => {
  test('mirror /settings has no AA contrast violations', async ({ page }) => {
    await page.goto('/')
    await applyMirrorProfile(page)
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    const results = await new AxeBuilder({ page }).withTags(['wcag2aa']).analyze()
    const violations = results.violations.filter((v) => v.id === 'color-contrast')

    if (violations.length > 0) {
      console.log('Contrast violations on /settings:', JSON.stringify(violations, null, 2))
    }
    expect(violations).toHaveLength(0)
  })

  test('mirror /chat has no AA contrast violations', async ({ page }) => {
    await page.goto('/')
    await applyMirrorProfile(page)
    await page.goto('/chat', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.mr-sidebar')).toBeVisible()
    await page.waitForTimeout(500)

    const results = await new AxeBuilder({ page }).withTags(['wcag2aa']).analyze()
    const violations = results.violations.filter((v) => v.id === 'color-contrast')

    if (violations.length > 0) {
      console.log('Contrast violations on /chat:', JSON.stringify(violations, null, 2))
    }
    expect(violations).toHaveLength(0)
  })

  test('keyboard nav reaches save button on /settings', async ({ page }) => {
    await page.goto('/')
    await applyMirrorProfile(page)
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    // Tab through page; focus must eventually land on the save button.
    let tabs = 0
    let onSaveButton = false
    while (tabs < 80) {
      await page.keyboard.press('Tab')
      tabs++
      const active = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        return el?.textContent?.includes('保存设置') ?? false
      })
      if (active) {
        onSaveButton = true
        break
      }
    }
    expect(onSaveButton).toBe(true)
  })
})
