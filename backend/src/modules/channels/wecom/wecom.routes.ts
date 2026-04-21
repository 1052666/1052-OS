import { Router } from 'express'
import {
  createWecomWebhook,
  deleteWecomWebhook,
  getWecomStatus,
  listWecomChannelWebhooks,
  testWecomWebhook,
  updateWecomWebhook,
} from './wecom.service.js'

export const wecomRouter: Router = Router()

wecomRouter.get('/status', async (_req, res, next) => {
  try {
    res.json(await getWecomStatus())
  } catch (error) {
    next(error)
  }
})

wecomRouter.get('/webhooks', async (_req, res, next) => {
  try {
    res.json(await listWecomChannelWebhooks())
  } catch (error) {
    next(error)
  }
})

wecomRouter.post('/webhooks', async (req, res, next) => {
  try {
    res.json(await createWecomWebhook(req.body ?? {}))
  } catch (error) {
    next(error)
  }
})

wecomRouter.patch('/webhooks/:id', async (req, res, next) => {
  try {
    res.json(await updateWecomWebhook(req.params.id, req.body ?? {}))
  } catch (error) {
    next(error)
  }
})

wecomRouter.delete('/webhooks/:id', async (req, res, next) => {
  try {
    res.json(await deleteWecomWebhook(req.params.id))
  } catch (error) {
    next(error)
  }
})

wecomRouter.post('/webhooks/:id/test', async (req, res, next) => {
  try {
    res.json(await testWecomWebhook(req.params.id))
  } catch (error) {
    next(error)
  }
})
