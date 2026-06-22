/**
 * Gateway API Routes - 1052 OS 配置网关管理
 */

import { Router, type Request, type Response } from 'express'
import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import ini from 'ini'

const execAsync = promisify(exec)
const router = Router()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '../../../..')
const CONFIG_FILE = path.join(PROJECT_ROOT, 'data/gateway/config.ini')

function readConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return ini.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
    }
  } catch {}
  return null
}

function writeConfig(config: Record<string, any>) {
  const content = ini.stringify(config)
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
  fs.writeFileSync(CONFIG_FILE, content, 'utf-8')
}

router.post('/start', async (_req: Request, res: Response) => {
  try {
    await execAsync('bash scripts/start.sh', { cwd: PROJECT_ROOT })
    res.json({ success: true, message: 'Gateway started' })
  } catch (error: any) {
    res.json({ success: false, error: error.message })
  }
})

router.post('/stop', async (_req: Request, res: Response) => {
  try {
    await execAsync('bash scripts/stop.sh', { cwd: PROJECT_ROOT })
    res.json({ success: true, message: 'Gateway stopped' })
  } catch (error: any) {
    res.json({ success: false, error: error.message })
  }
})

router.get('/config', (_req: Request, res: Response) => {
  const config = readConfig()
  res.json({ success: true, config })
})

router.post('/config', (req: Request, res: Response) => {
  try {
    const currentConfig = readConfig() || { gateway: {}, logging: {} }
    const newConfig = {
      gateway: { ...currentConfig.gateway, ...req.body },
      logging: currentConfig.logging,
    }
    writeConfig(newConfig)
    res.json({ success: true, message: 'Config saved' })
  } catch (error: any) {
    res.json({ success: false, error: error.message })
  }
})

export { router as gatewayRouter }
