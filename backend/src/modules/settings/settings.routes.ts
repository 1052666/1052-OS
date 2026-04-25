import { Router } from 'express'
import { httpError } from '../../http-error.js'
import { discoverLocalModels } from './local-llm-discovery.service.js'
import {
  activateLlmProfile,
  getPublicSettings,
  updateLlmTaskRoutes,
  updateSettings,
  upsertLlmProfile,
} from './settings.service.js'

export const settingsRouter: Router = Router()

settingsRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await getPublicSettings())
  } catch (e) {
    next(e)
  }
})

settingsRouter.put('/', async (req, res, next) => {
  try {
    const patch = req.body ?? {}
    res.json(await updateSettings(patch))
  } catch (e) {
    next(e)
  }
})

settingsRouter.get('/llm/local-discovery', async (_req, res, next) => {
  try {
    res.json(await discoverLocalModels())
  } catch (e) {
    next(e)
  }
})

settingsRouter.post('/llm/profiles', async (req, res, next) => {
  try {
    const body = req.body ?? {}
    if (!body.profile || typeof body.profile !== 'object') {
      throw httpError(400, 'profile 必填')
    }
    res.json(await upsertLlmProfile(body.profile, { activate: body.activate === true }))
  } catch (e) {
    next(e)
  }
})

settingsRouter.post('/llm/profiles/:id/activate', async (req, res, next) => {
  try {
    res.json(await activateLlmProfile(req.params.id))
  } catch (e) {
    next(e)
  }
})

settingsRouter.put('/llm/task-routes', async (req, res, next) => {
  try {
    res.json(await updateLlmTaskRoutes(req.body?.routes ?? []))
  } catch (e) {
    next(e)
  }
})
