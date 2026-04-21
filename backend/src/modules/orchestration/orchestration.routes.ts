import { Router } from 'express'
import {
  listOrchestrations,
  createOrchestration,
  updateOrchestration,
  deleteOrchestration,
  startExecution,
  stopOrchestration,
  getExecutionProgress,
  listExecutionLogs,
  getExecutionLog,
} from './orchestration.service.js'

export const orchestrationRouter: Router = Router()

orchestrationRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await listOrchestrations())
  } catch (e) {
    next(e)
  }
})

orchestrationRouter.post('/', async (req, res, next) => {
  try {
    res.status(201).json(await createOrchestration(req.body ?? {}))
  } catch (e) {
    next(e)
  }
})

orchestrationRouter.put('/:id', async (req, res, next) => {
  try {
    res.json(await updateOrchestration(req.params.id, req.body ?? {}))
  } catch (e) {
    next(e)
  }
})

orchestrationRouter.delete('/:id', async (req, res, next) => {
  try {
    res.json(await deleteOrchestration(req.params.id))
  } catch (e) {
    next(e)
  }
})

orchestrationRouter.post('/:id/execute', async (req, res, next) => {
  try {
    const execId = await startExecution(req.params.id)
    res.json({ executionId: execId })
  } catch (e) {
    next(e)
  }
})

orchestrationRouter.get('/:id/progress/:execId', async (req, res, next) => {
  try {
    const progress = getExecutionProgress(req.params.execId)
    if (!progress) { res.status(404).json({ error: '执行不存在' }); return }
    res.json(progress)
  } catch (e) {
    next(e)
  }
})

orchestrationRouter.post('/:id/stop', async (req, res, next) => {
  try {
    const stopped = stopOrchestration(req.params.id)
    res.json({ ok: true, stopped })
  } catch (e) {
    next(e)
  }
})

orchestrationRouter.get('/:id/logs', async (req, res, next) => {
  try {
    res.json(await listExecutionLogs(req.params.id))
  } catch (e) {
    next(e)
  }
})

orchestrationRouter.get('/:id/logs/:logId', async (req, res, next) => {
  try {
    res.json(await getExecutionLog(req.params.id, req.params.logId))
  } catch (e) {
    next(e)
  }
})
