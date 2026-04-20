import { Router } from 'express'
import {
  createCalendarEvent,
  deleteCalendarEvent,
  listCalendarEvents,
  updateCalendarEvent,
} from './calendar.service.js'
import {
  createScheduledTask,
  deleteScheduledTask,
  listScheduledTaskRuns,
  listScheduledTasks,
  setScheduledTaskEnabled,
  triggerScheduledTaskNow,
  updateScheduledTask,
} from './calendar.schedule.service.js'

export const calendarRouter: Router = Router()

calendarRouter.get('/events', async (_req, res, next) => {
  try {
    res.json(await listCalendarEvents())
  } catch (e) {
    next(e)
  }
})

calendarRouter.post('/events', async (req, res, next) => {
  try {
    res.status(201).json(await createCalendarEvent(req.body ?? {}))
  } catch (e) {
    next(e)
  }
})

calendarRouter.put('/events/:id', async (req, res, next) => {
  try {
    res.json(await updateCalendarEvent(req.params.id, req.body ?? {}))
  } catch (e) {
    next(e)
  }
})

calendarRouter.delete('/events/:id', async (req, res, next) => {
  try {
    await deleteCalendarEvent(req.params.id)
    res.status(204).end()
  } catch (e) {
    next(e)
  }
})

calendarRouter.get('/tasks', async (req, res, next) => {
  try {
    res.json(
      await listScheduledTasks({
        target: req.query.target,
        enabled: req.query.enabled,
        limit:
          typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
      }),
    )
  } catch (e) {
    next(e)
  }
})

calendarRouter.post('/tasks', async (req, res, next) => {
  try {
    res.status(201).json(await createScheduledTask(req.body ?? {}))
  } catch (e) {
    next(e)
  }
})

calendarRouter.put('/tasks/:id', async (req, res, next) => {
  try {
    res.json(await updateScheduledTask(req.params.id, req.body ?? {}))
  } catch (e) {
    next(e)
  }
})

calendarRouter.delete('/tasks/:id', async (req, res, next) => {
  try {
    await deleteScheduledTask(req.params.id)
    res.status(204).end()
  } catch (e) {
    next(e)
  }
})

calendarRouter.post('/tasks/:id/run', async (req, res, next) => {
  try {
    res.json(await triggerScheduledTaskNow(req.params.id))
  } catch (e) {
    next(e)
  }
})

calendarRouter.post('/tasks/:id/pause', async (req, res, next) => {
  try {
    res.json(await setScheduledTaskEnabled(req.params.id, false))
  } catch (e) {
    next(e)
  }
})

calendarRouter.post('/tasks/:id/resume', async (req, res, next) => {
  try {
    res.json(await setScheduledTaskEnabled(req.params.id, true))
  } catch (e) {
    next(e)
  }
})

calendarRouter.get('/task-runs', async (req, res, next) => {
  try {
    res.json(
      await listScheduledTaskRuns(
        typeof req.query.taskId === 'string' ? req.query.taskId : undefined,
        typeof req.query.limit === 'string' ? Number(req.query.limit) : 50,
      ),
    )
  } catch (e) {
    next(e)
  }
})
