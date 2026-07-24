import fs from 'node:fs/promises'
import path from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { chromium } from 'playwright'
import { resolveChromiumExecutablePath } from './browser-executable.mjs'

const baseUrl = process.env.PW_BASE_URL ?? 'http://127.0.0.1:10052'
const executablePath = resolveChromiumExecutablePath()
const outputDir = path.resolve('test-results', 'visual-smoke')
const routes = ['/today', '/chat', '/automations/orchestrations', '/capabilities/skills', '/settings/models']
const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'wide', width: 1920, height: 1080 },
  { name: 'mobile', width: 390, height: 844 },
]

await fs.mkdir(outputDir, { recursive: true })

const browser = await chromium.launch({ executablePath, headless: true })
const failures = []

for (const viewport of viewports) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  for (const route of routes) {
    const slug = `${viewport.name}-${route.replace(/\W+/g, '-').replace(/^-|-$/g, '')}`
    try {
      await page.goto(baseUrl + route, { waitUntil: 'domcontentloaded', timeout: 35_000 })
      await page.locator('h1').first().waitFor({ state: 'visible', timeout: 15_000 })
      await page.waitForTimeout(900)
      await page.screenshot({ path: path.join(outputDir, `${slug}.png`), fullPage: false })
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      if (overflow > 2) failures.push(`${viewport.name} ${route}: horizontal overflow ${overflow}px`)
    } catch (error) {
      failures.push(`${viewport.name} ${route}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (pageErrors.length) failures.push(`${viewport.name}: page errors ${pageErrors.join(' | ')}`)
  await context.close()
}

const context = await browser.newContext({ viewport: viewports[0] })
const page = await context.newPage()
await page.goto(baseUrl + '/today', { waitUntil: 'domcontentloaded', timeout: 35_000 })
await page.waitForTimeout(1_200)
const canvasStats = await page.locator('[data-testid="system-field"]').evaluate((canvas) => {
  const element = canvas
  const context = element.getContext('2d')
  if (!context) return { width: element.width, height: element.height, pixels: 0 }
  const sample = context.getImageData(0, 0, Math.min(element.width, 220), Math.min(element.height, 160)).data
  let pixels = 0
  for (let index = 3; index < sample.length; index += 4) {
    if (sample[index] > 0) pixels += 1
  }
  return { width: element.width, height: element.height, pixels }
})
if (canvasStats.width <= 0 || canvasStats.height <= 0 || canvasStats.pixels <= 50) {
  failures.push(`system field canvas is blank: ${JSON.stringify(canvasStats)}`)
}

const axeResults = await new AxeBuilder({ page }).analyze()
if (axeResults.violations.length) {
  failures.push(`axe violations: ${axeResults.violations.map((item) => `${item.id}(${item.nodes.length})`).join(', ')}`)
}
await page.screenshot({ path: path.join(outputDir, 'desktop-today-a11y.png'), fullPage: false })
await context.close()

await browser.close()

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log(`visual smoke passed; screenshots: ${outputDir}`)
