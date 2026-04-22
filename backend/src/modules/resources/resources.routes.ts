import { Router } from 'express'
import {
  createResource,
  deleteResource,
  getResource,
  listResources,
  strikeResource,
  updateResource,
} from './resources.service.js'

export const resourcesRouter: Router = Router()

resourcesRouter.get('/', async (req, res, next) => {
  try {
    res.json(await listResources(req.query.query, req.query.status, req.query.limit ? Number(req.query.limit) : undefined))
  } catch (e) {
    next(e)
  }
})

resourcesRouter.post('/', async (req, res, next) => {
  try {
    res.status(201).json(await createResource(req.body ?? {}))
  } catch (e) {
    next(e)
  }
})

resourcesRouter.get('/:id', async (req, res, next) => {
  try {
    res.json(await getResource(req.params.id))
  } catch (e) {
    next(e)
  }
})

resourcesRouter.put('/:id', async (req, res, next) => {
  try {
    res.json(await updateResource(req.params.id, req.body ?? {}))
  } catch (e) {
    next(e)
  }
})

resourcesRouter.put('/:id/strike', async (req, res, next) => {
  try {
    res.json(await strikeResource(req.params.id, req.body?.struck !== false))
  } catch (e) {
    next(e)
  }
})

resourcesRouter.delete('/:id', async (req, res, next) => {
  try {
    res.json(await deleteResource(req.params.id))
  } catch (e) {
    next(e)
  }
})
