import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // serial: each test needs known profile state
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:10052',
    trace: 'on-first-retry',
    viewport: { width: 1440, height: 900 },
    // Force reduced-motion for screenshot stability (animations disabled)
    reducedMotion: 'reduce',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
})
