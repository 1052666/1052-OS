import { Router } from 'express'
import {
  applyBundledSkillUpdate,
  createSkill,
  deleteSkill,
  installSkillFromMarketplace,
  installSkillFromUrl,
  inspectSkillMarketplaceInstall,
  listBundledSkillUpdates,
  listSkills,
  previewSkillMarketplaceFile,
  readSkill,
  searchSkillMarketplace,
} from './skills.service.js'

export const skillsRouter: Router = Router()

skillsRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await listSkills())
  } catch (e) {
    next(e)
  }
})

skillsRouter.post('/', async (req, res, next) => {
  try {
    res.status(201).json(await createSkill(req.body ?? {}))
  } catch (e) {
    next(e)
  }
})

skillsRouter.post('/install', async (req, res, next) => {
  try {
    res.status(201).json(await installSkillFromUrl(req.body ?? {}))
  } catch (e) {
    next(e)
  }
})

skillsRouter.get('/bundled/updates', async (_req, res, next) => {
  try {
    res.json(await listBundledSkillUpdates())
  } catch (e) {
    next(e)
  }
})

skillsRouter.post('/bundled/:id/apply', async (req, res, next) => {
  try {
    res.json(await applyBundledSkillUpdate(req.params.id, req.body ?? {}))
  } catch (e) {
    next(e)
  }
})

skillsRouter.get('/marketplace/search', async (req, res, next) => {
  try {
    res.json(await searchSkillMarketplace({ query: req.query.q, limit: req.query.limit }))
  } catch (e) {
    next(e)
  }
})

skillsRouter.post('/marketplace/install', async (req, res, next) => {
  try {
    res.status(201).json(await installSkillFromMarketplace(req.body ?? {}))
  } catch (e) {
    next(e)
  }
})

skillsRouter.get('/marketplace/inspect', async (req, res, next) => {
  try {
    res.json(await inspectSkillMarketplaceInstall({ id: req.query.id }))
  } catch (e) {
    next(e)
  }
})

skillsRouter.get('/marketplace/preview', async (req, res, next) => {
  try {
    res.json(await previewSkillMarketplaceFile({ id: req.query.id, path: req.query.path }))
  } catch (e) {
    next(e)
  }
})

skillsRouter.get('/:id', async (req, res, next) => {
  try {
    res.json(await readSkill(req.params.id))
  } catch (e) {
    next(e)
  }
})

skillsRouter.delete('/:id', async (req, res, next) => {
  try {
    res.json(await deleteSkill(req.params.id))
  } catch (e) {
    next(e)
  }
})
