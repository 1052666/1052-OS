import { Router } from 'express'
import { getPublicSettings, updateSettings } from './settings.service.js'

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
