import { Router } from 'express'
import {
  listSearchEngines,
  listSearchSourceGroups,
  setSearchSourceEnabled,
} from './websearch.service.js'

export const websearchRouter = Router()

websearchRouter.get('/engines', async (_req, res, next) => {
  try {
    res.json({
      engines: await listSearchEngines(),
      sourceGroups: await listSearchSourceGroups(),
    })
  } catch (e) {
    next(e)
  }
})

websearchRouter.patch('/sources/:family/:id', async (req, res, next) => {
  try {
    await setSearchSourceEnabled({
      family: String(req.params.family) as 'web-search' | 'skill-marketplace' | 'uapis',
      id: String(req.params.id),
      enabled: req.body?.enabled as boolean,
    })
    res.json({
      engines: await listSearchEngines(),
      sourceGroups: await listSearchSourceGroups(),
    })
  } catch (e) {
    next(e)
  }
})
