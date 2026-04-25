import { Router } from 'express'
import {
  getUpdateRun,
  getUpdateStatus,
  scheduleUpdateRestart,
  startUpdateInstall,
} from './updates.service.js'

export const updatesRouter: Router = Router()

updatesRouter.get('/status', async (_req, res, next) => {
  try {
    res.json(await getUpdateStatus(false))
  } catch (error) {
    next(error)
  }
})

updatesRouter.post('/check', async (_req, res, next) => {
  try {
    res.json(await getUpdateStatus(true))
  } catch (error) {
    next(error)
  }
})

updatesRouter.post('/install', async (_req, res, next) => {
  try {
    res.status(202).json({ run: await startUpdateInstall() })
  } catch (error) {
    next(error)
  }
})

updatesRouter.get('/runs/:id', async (req, res, next) => {
  try {
    res.json(await getUpdateRun(req.params.id))
  } catch (error) {
    next(error)
  }
})

updatesRouter.post('/restart', async (_req, res, next) => {
  try {
    res.json(await scheduleUpdateRestart())
  } catch (error) {
    next(error)
  }
})
