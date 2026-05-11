import { test, expect, type Page, type TestInfo } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const BASELINE_DIR = path.join(__dirname, 'baseline')
const APPLY_MIRROR_API = '/api/appearance/themes/builtin%3Amirror-dark/apply'

function baselinePath(testInfo: TestInfo, name: string): string {
  // Per-project baselines so chromium and webkit don't fight over the same file.
  return path.join(BASELINE_DIR, `${testInfo.project.name}-${name}`)
}

// Match threshold: per-pixel similarity tolerance (smaller is stricter).
// 0.15 tolerates minor anti-aliasing / font hinting drift.
const PIXEL_DIFF_THRESHOLD = 0.15
// Spec gate: overall ratio of matching pixels must be ≥ 85%.
const OVERALL_MATCH_FLOOR = 0.85

async function applyMirrorProfile(page: Page): Promise<void> {
  // Apply via server API (already-loaded page provides same-origin cookie/proxy).
  // Then reload so React ThemeProvider re-reads activeProfile on mount.
  await page.evaluate(async (apiPath: string) => {
    await fetch(apiPath, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmed: true }),
    })
  }, APPLY_MIRROR_API)
}

async function pixelmatchScreenshot(
  actual: Buffer,
  baselinePath: string,
): Promise<number> {
  if (!fs.existsSync(baselinePath)) {
    fs.writeFileSync(baselinePath, actual)
    console.log(`Created baseline: ${baselinePath}`)
    return 1
  }
  const baseline = PNG.sync.read(fs.readFileSync(baselinePath))
  const current = PNG.sync.read(actual)
  if (current.width !== baseline.width || current.height !== baseline.height) {
    throw new Error(
      `Size mismatch for ${path.basename(baselinePath)}: baseline ${baseline.width}x${baseline.height} vs current ${current.width}x${current.height}`,
    )
  }
  const diff = new PNG({ width: current.width, height: current.height })
  const diffCount = pixelmatch(
    current.data,
    baseline.data,
    diff.data,
    current.width,
    current.height,
    { threshold: PIXEL_DIFF_THRESHOLD },
  )
  // Persist diff overlay for offline triage; not committed (only baselines are).
  fs.writeFileSync(
    baselinePath.replace(/\.png$/, '.diff.png'),
    PNG.sync.write(diff),
  )
  return 1 - diffCount / (current.width * current.height)
}

test.beforeAll(async () => {
  if (!fs.existsSync(BASELINE_DIR)) {
    fs.mkdirSync(BASELINE_DIR, { recursive: true })
  }
})

test.describe('mirror visual regression', () => {
  test('mirror /settings matches baseline', async ({ page }, testInfo) => {
    await page.goto('/')
    await applyMirrorProfile(page)
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    const screenshot = await page.screenshot({ fullPage: false })
    const ratio = await pixelmatchScreenshot(
      screenshot,
      baselinePath(testInfo, 'mirror-settings.png'),
    )
    expect(ratio).toBeGreaterThanOrEqual(OVERALL_MATCH_FLOOR)
  })

  test('mirror /chat matches baseline', async ({ page }, testInfo) => {
    await page.goto('/')
    await applyMirrorProfile(page)
    // /chat keeps long-lived connections open (streaming/SSE), so `networkidle`
    // never resolves. Use domcontentloaded + sidebar visibility as readiness.
    await page.goto('/chat', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.mr-sidebar')).toBeVisible()
    await page.waitForTimeout(800)
    const screenshot = await page.screenshot({ fullPage: false })
    const ratio = await pixelmatchScreenshot(
      screenshot,
      baselinePath(testInfo, 'mirror-chat.png'),
    )
    expect(ratio).toBeGreaterThanOrEqual(OVERALL_MATCH_FLOOR)
  })

  test('mirror sidebar matches baseline (cropped)', async ({ page }, testInfo) => {
    await page.goto('/')
    await applyMirrorProfile(page)
    await page.goto('/chat', { waitUntil: 'domcontentloaded' })
    const sidebarLocator = page.locator('.mr-sidebar')
    await expect(sidebarLocator).toBeVisible()
    await page.waitForTimeout(800)
    const sidebar = await sidebarLocator.screenshot()
    const ratio = await pixelmatchScreenshot(
      sidebar,
      baselinePath(testInfo, 'mirror-sidebar.png'),
    )
    expect(ratio).toBeGreaterThanOrEqual(OVERALL_MATCH_FLOOR)
  })
})
