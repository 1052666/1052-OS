import { test, expect } from '@playwright/test'

test('app loads', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/Agent|1052/i)
})
