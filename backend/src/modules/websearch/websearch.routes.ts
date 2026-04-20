import { Router } from 'express'
import { listSearchEngines, listSearchSourceGroups } from './websearch.service.js'

export const websearchRouter = Router()

websearchRouter.get('/engines', (_req, res) => {
  res.json({
    engines: listSearchEngines(),
    sourceGroups: listSearchSourceGroups(),
  })
})
