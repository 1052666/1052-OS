import { Router } from 'express'
import express from 'express'
import path from 'node:path'
import { config } from '../../config.js'
import {
  callUapis,
  getUapisCatalog,
  readUapisApi,
  setUapisApiEnabled,
  setUapisApisEnabled,
} from './uapis.service.js'

export const uapisRouter: Router = Router()

uapisRouter.use(
  '/files',
  express.static(path.join(config.dataDir, 'uapis', 'files'), {
    fallthrough: false,
  }),
)

uapisRouter.get('/catalog', async (_req, res, next) => {
  try {
    res.json(await getUapisCatalog())
  } catch (e) {
    next(e)
  }
})

uapisRouter.get('/apis/:id', async (req, res, next) => {
  try {
    res.json(await readUapisApi(req.params.id))
  } catch (e) {
    next(e)
  }
})

uapisRouter.patch('/apis/:id', async (req, res, next) => {
  try {
    res.json(await setUapisApiEnabled(req.params.id, req.body ?? {}))
  } catch (e) {
    next(e)
  }
})

uapisRouter.post('/bulk-toggle', async (req, res, next) => {
  try {
    res.json(await setUapisApisEnabled(req.body ?? {}))
  } catch (e) {
    next(e)
  }
})

uapisRouter.post('/call', async (req, res, next) => {
  try {
    res.json(await callUapis(req.body ?? {}))
  } catch (e) {
    next(e)
  }
})
