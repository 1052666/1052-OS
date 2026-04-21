import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import path from 'node:path'
import cors from 'cors'
import { HttpError } from './http-error.js'
import { config } from './config.js'
import { settingsRouter } from './modules/settings/settings.routes.js'
import { agentRouter } from './modules/agent/agent.routes.js'
import { calendarRouter } from './modules/calendar/calendar.routes.js'
import { repositoryRouter } from './modules/repository/repository.routes.js'
import { notesRouter } from './modules/notes/notes.routes.js'
import { resourcesRouter } from './modules/resources/resources.routes.js'
import { websearchRouter } from './modules/websearch/websearch.routes.js'
import { notificationsRouter } from './modules/notifications/notifications.routes.js'
import { skillsRouter } from './modules/skills/skills.routes.js'
import { memoryRouter } from './modules/memory/memory.routes.js'
import { wechatRouter } from './modules/channels/wechat/wechat.routes.js'
import { sqlRouter } from './modules/sql/sql.routes.js'
import { orchestrationRouter } from './modules/orchestration/orchestration.routes.js'
import { wecomRouter } from './modules/channels/wecom/wecom.routes.js'

export function createApp(): Express {
  const app = express()

  app.use(cors())
  app.use(express.json({ limit: '2mb' }))
  app.use(
    '/api/generated-images',
    express.static(path.join(config.dataDir, 'generated-images')),
  )
  app.use(
    '/api/channels/wechat/media',
    express.static(path.join(config.dataDir, 'channels', 'wechat', 'media')),
  )

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, ts: Date.now() })
  })

  app.use('/api/settings', settingsRouter)
  app.use('/api/agent', agentRouter)
  app.use('/api/calendar', calendarRouter)
  app.use('/api/repository', repositoryRouter)
  app.use('/api/notes', notesRouter)
  app.use('/api/resources', resourcesRouter)
  app.use('/api/websearch', websearchRouter)
  app.use('/api/notifications', notificationsRouter)
  app.use('/api/skills', skillsRouter)
  app.use('/api/memory', memoryRouter)
  app.use('/api/channels/wechat', wechatRouter)
  app.use('/api/sql', sqlRouter)
  app.use('/api/orchestration', orchestrationRouter)
  app.use('/api/channels/wecom', wecomRouter)

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not Found' })
  })

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message })
      return
    }
    console.error('[unhandled]', err)
    const message = err instanceof Error ? err.message : 'Internal Server Error'
    res.status(500).json({ error: message })
  })

  return app
}
