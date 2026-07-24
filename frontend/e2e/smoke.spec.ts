import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const routes = ['/today', '/chat', '/automations/orchestrations', '/capabilities/skills', '/settings/models']

test.setTimeout(120_000)

test.describe('1052 OS shell', () => {
  for (const route of routes) {
    test(`renders ${route}`, async ({ page }, testInfo) => {
      const pageErrors: string[] = []
      const consoleErrors: string[] = []
      page.on('pageerror', (error) => pageErrors.push(error.message))
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text())
      })
      await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      await expect(page.locator('h1')).toBeVisible({ timeout: 30_000 })
      await page.waitForTimeout(900)
      await page.screenshot({ path: testInfo.outputPath(`${route.replace(/\W+/g, '-').replace(/^-/, '')}.png`), fullPage: false })

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow).toBeLessThanOrEqual(2)
      expect(pageErrors).toEqual([])
      expect(consoleErrors).toEqual([])
    })
  }

  test('draws the dynamic system field and passes critical accessibility checks', async ({ page }, testInfo) => {
    const consoleErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    await page.goto('/today', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForTimeout(1200)
    const canvasStats = await page.locator('[data-testid="system-field"]').evaluate((canvas) => {
      const element = canvas as HTMLCanvasElement
      const context = element.getContext('2d')
      if (!context) return { width: element.width, height: element.height, pixels: 0 }
      const sample = context.getImageData(0, 0, Math.min(element.width, 220), Math.min(element.height, 160)).data
      let pixels = 0
      for (let index = 3; index < sample.length; index += 4) {
        if (sample[index] > 0) pixels += 1
      }
      return { width: element.width, height: element.height, pixels }
    })
    expect(canvasStats.width).toBeGreaterThan(0)
    expect(canvasStats.height).toBeGreaterThan(0)
    await expect
      .poll(async () => {
        return page.locator('[data-testid="system-field"]').evaluate((canvas) => {
          const element = canvas as HTMLCanvasElement
          const context = element.getContext('2d')
          if (!context) return 0
          const sample = context.getImageData(0, 0, Math.min(element.width, 220), Math.min(element.height, 160)).data
          let pixels = 0
          for (let index = 3; index < sample.length; index += 4) {
            if (sample[index] > 0) pixels += 1
          }
          return pixels
        })
      }, { timeout: 15_000 })
      .toBeGreaterThan(50)

    const results = await new AxeBuilder({ page }).disableRules(['color-contrast']).analyze()
    expect(results.violations).toEqual([])
    expect(consoleErrors).toEqual([])
    await page.screenshot({ path: testInfo.outputPath('today-a11y.png'), fullPage: false })
  })
})
