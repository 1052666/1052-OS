import fs from 'node:fs'
import { defineConfig, devices, type Project } from '@playwright/test'

const chromiumPath = [
  process.env.PW_CHROMIUM_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe` : '',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean).find((candidate) => fs.existsSync(candidate))
const chromiumLaunch: Project['use'] = chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:10052',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], ...chromiumLaunch, viewport: { width: 1440, height: 900 } } },
    { name: 'chromium-wide', use: { ...devices['Desktop Chrome'], ...chromiumLaunch, viewport: { width: 1920, height: 1080 } } },
    { name: 'webkit-desktop', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
    { name: 'chromium-mobile', use: { ...devices['Pixel 7'], ...chromiumLaunch, viewport: { width: 390, height: 844 } } },
  ],
})
