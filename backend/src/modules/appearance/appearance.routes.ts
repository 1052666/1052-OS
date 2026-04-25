import { Router } from 'express'
import {
  applyAppearanceTheme,
  createAppearanceTheme,
  deleteAppearanceTheme,
  listAppearanceThemes,
  resetAppearanceTheme,
  reviewAppearanceTheme,
} from './appearance.service.js'

export const appearanceRouter: Router = Router()

appearanceRouter.get('/themes', async (_req, res, next) => {
  try {
    res.json(await listAppearanceThemes())
  } catch (error) {
    next(error)
  }
})

appearanceRouter.post('/themes/review', (req, res, next) => {
  try {
    res.json(reviewAppearanceTheme(req.body?.theme ?? req.body))
  } catch (error) {
    next(error)
  }
})

appearanceRouter.post('/themes', async (req, res, next) => {
  try {
    res.json(await createAppearanceTheme(req.body?.theme ?? req.body))
  } catch (error) {
    next(error)
  }
})

appearanceRouter.post('/themes/:id/apply', async (req, res, next) => {
  try {
    res.json(
      await applyAppearanceTheme(req.params.id, {
        confirmed: req.body?.confirmed === true,
        allowExperimental: req.body?.allowExperimental === true,
      }),
    )
  } catch (error) {
    next(error)
  }
})

appearanceRouter.post('/themes/reset', async (req, res, next) => {
  try {
    res.json(await resetAppearanceTheme({ confirmed: req.body?.confirmed === true }))
  } catch (error) {
    next(error)
  }
})

appearanceRouter.delete('/themes/:id', async (req, res, next) => {
  try {
    res.json(await deleteAppearanceTheme(req.params.id))
  } catch (error) {
    next(error)
  }
})
