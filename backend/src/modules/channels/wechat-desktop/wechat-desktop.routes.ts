import { Router } from 'express'
import {
  createWechatDesktopGroupMemoryView,
  getWechatDesktopStatus,
  listWechatDesktopGroupMemoriesView,
  listWechatDesktopGroupsView,
  listWechatDesktopSessionsView,
  refreshWechatDesktopSessions,
  saveWechatDesktopChannelConfig,
  sendWechatDesktopDirectMessage,
  startWechatDesktopChannel,
  stopWechatDesktopChannel,
  updateWechatDesktopGroup,
  updateWechatDesktopSession,
} from './wechat-desktop.service.js'

export const wechatDesktopRouter = Router()

wechatDesktopRouter.get('/status', async (_req, res, next) => {
  try {
    res.json(await getWechatDesktopStatus())
  } catch (error) {
    next(error)
  }
})

wechatDesktopRouter.post('/config', async (req, res, next) => {
  try {
    res.json(await saveWechatDesktopChannelConfig(req.body ?? {}))
  } catch (error) {
    next(error)
  }
})

wechatDesktopRouter.post('/start', async (_req, res, next) => {
  try {
    res.json(await startWechatDesktopChannel())
  } catch (error) {
    next(error)
  }
})

wechatDesktopRouter.post('/stop', async (_req, res, next) => {
  try {
    res.json(await stopWechatDesktopChannel())
  } catch (error) {
    next(error)
  }
})

wechatDesktopRouter.get('/sessions', async (_req, res, next) => {
  try {
    res.json(await listWechatDesktopSessionsView())
  } catch (error) {
    next(error)
  }
})

wechatDesktopRouter.post('/sessions/refresh', async (_req, res, next) => {
  try {
    res.json(await refreshWechatDesktopSessions())
  } catch (error) {
    next(error)
  }
})

wechatDesktopRouter.patch('/sessions/:sessionId', async (req, res, next) => {
  try {
    res.json(await updateWechatDesktopSession(req.params.sessionId, req.body ?? {}))
  } catch (error) {
    next(error)
  }
})

wechatDesktopRouter.get('/groups', async (_req, res, next) => {
  try {
    res.json(await listWechatDesktopGroupsView())
  } catch (error) {
    next(error)
  }
})

wechatDesktopRouter.patch('/groups/:groupId', async (req, res, next) => {
  try {
    res.json(await updateWechatDesktopGroup(req.params.groupId, req.body ?? {}))
  } catch (error) {
    next(error)
  }
})

wechatDesktopRouter.post('/send', async (req, res, next) => {
  try {
    const sessionName = typeof req.body?.sessionName === 'string' ? req.body.sessionName : ''
    const text = typeof req.body?.text === 'string' ? req.body.text : ''
    res.json(await sendWechatDesktopDirectMessage({ sessionName, text }))
  } catch (error) {
    next(error)
  }
})

wechatDesktopRouter.get('/group-memory', async (req, res, next) => {
  try {
    res.json(await listWechatDesktopGroupMemoriesView(req.query.groupId))
  } catch (error) {
    next(error)
  }
})

wechatDesktopRouter.post('/group-memory', async (req, res, next) => {
  try {
    res.json(
      await createWechatDesktopGroupMemoryView({
        groupId: typeof req.body?.groupId === 'string' ? req.body.groupId : '',
        title: typeof req.body?.title === 'string' ? req.body.title : '',
        content: typeof req.body?.content === 'string' ? req.body.content : '',
        source: req.body?.source,
      }),
    )
  } catch (error) {
    next(error)
  }
})
