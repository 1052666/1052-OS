import { Router } from 'express'
import { HttpError } from '../../http-error.js'
import {
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  resolveNotificationContext,
} from './notifications.service.js'

export const notificationsRouter: Router = Router()

notificationsRouter.get('/', async (req, res, next) => {
  try {
    const limit =
      typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined
    res.json(await listNotifications(limit))
  } catch (error) {
    next(error)
  }
})

notificationsRouter.get('/unread-count', async (_req, res, next) => {
  try {
    res.json({ unread: await getUnreadNotificationCount() })
  } catch (error) {
    next(error)
  }
})

notificationsRouter.get('/:id/context', async (req, res, next) => {
  try {
    res.json(await resolveNotificationContext(req.params.id))
  } catch (error) {
    next(error instanceof Error ? new HttpError(404, error.message) : error)
  }
})

notificationsRouter.post('/read-all', async (_req, res, next) => {
  try {
    res.json(await markAllNotificationsRead())
  } catch (error) {
    next(error)
  }
})

notificationsRouter.post('/:id/read', async (req, res, next) => {
  try {
    res.json(await markNotificationRead(req.params.id, true))
  } catch (error) {
    next(error instanceof Error ? new HttpError(404, error.message) : error)
  }
})
