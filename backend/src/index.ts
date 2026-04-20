import { createApp } from './app.js'
import { config } from './config.js'
import { startScheduledTaskRunner } from './modules/calendar/calendar.schedule.service.js'
import { ensureAgentWorkspace } from './modules/agent/agent.workspace.service.js'
import { startAllEnabledWechatAccounts } from './modules/channels/wechat/wechat.service.js'

const app = createApp()

async function bootstrap() {
  const agentWorkspace = await ensureAgentWorkspace()

  app.listen(config.port, () => {
    console.log(`[agent-backend] listening on http://localhost:${config.port}`)
    console.log(`[agent-backend] data dir: ${config.dataDir}`)
    console.log(`[agent-backend] agent workspace: ${agentWorkspace}`)
    startScheduledTaskRunner()
    void startAllEnabledWechatAccounts()
  })
}

bootstrap().catch((error) => {
  console.error('[agent-backend] failed to start', error)
  process.exit(1)
})
