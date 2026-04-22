import { createApp } from './app.js'
import { config } from './config.js'
import { startScheduledTaskRunner } from './modules/calendar/calendar.schedule.service.js'
import { ensureAgentWorkspace } from './modules/agent/agent.workspace.service.js'
import { startAllEnabledWechatAccounts } from './modules/channels/wechat/wechat.service.js'
import { startAllEnabledFeishuChannels } from './modules/channels/feishu/feishu.service.js'
import { ensureBundledSkillsInstalled } from './modules/skills/skills.service.js'
import { installBackendRuntimeLogging } from './runtime-logs.js'

installBackendRuntimeLogging()
const app = createApp()

async function bootstrap() {
  const agentWorkspace = await ensureAgentWorkspace()
  const bundledSkills = await ensureBundledSkillsInstalled()

  app.listen(config.port, () => {
    console.log(`[agent-backend] listening on http://localhost:${config.port}`)
    console.log(`[agent-backend] data dir: ${config.dataDir}`)
    console.log(`[agent-backend] agent workspace: ${agentWorkspace}`)
    if (bundledSkills.installed.length > 0) {
      console.log(`[agent-backend] bundled skills installed: ${bundledSkills.installed.join(', ')}`)
    }
    startScheduledTaskRunner()
    void startAllEnabledWechatAccounts()
    void startAllEnabledFeishuChannels()
  })
}

bootstrap().catch((error) => {
  console.error('[agent-backend] failed to start', error)
  process.exit(1)
})
