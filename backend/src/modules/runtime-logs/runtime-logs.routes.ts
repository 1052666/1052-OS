import { Router } from 'express'
import { appendFrontendRuntimeLogs } from '../../runtime-logs.js'

export const runtimeLogsRouter: Router = Router()

runtimeLogsRouter.post('/frontend', async (req, res, next) => {
  try {
    await appendFrontendRuntimeLogs(req.body)
    res.status(204).end()
  } catch (error) {
    next(error)
  }
})
