import { Router } from 'express'
import {
  confirmMemorySuggestion,
  createMemory,
  createMemorySuggestion,
  createSecureMemory,
  deleteMemory,
  deleteSecureMemory,
  getMemory,
  getMemoryRuntimePreview,
  getMemorySummary,
  getSecureMemory,
  listMemories,
  listMemorySuggestions,
  listSecureMemories,
  readMemoryProfile,
  readSecureMemoryProfile,
  rejectMemorySuggestion,
  updateMemory,
  updateSecureMemory,
} from './memory.service.js'

export const memoryRouter: Router = Router()

memoryRouter.get('/summary', async (_req, res, next) => {
  try {
    res.json(await getMemorySummary())
  } catch (error) {
    next(error)
  }
})

memoryRouter.get('/runtime-preview', async (req, res, next) => {
  try {
    res.json(await getMemoryRuntimePreview(req.query.q))
  } catch (error) {
    next(error)
  }
})

memoryRouter.get('/profile', async (_req, res, next) => {
  try {
    res.json({
      profile: await readMemoryProfile(),
      secureProfile: await readSecureMemoryProfile(),
    })
  } catch (error) {
    next(error)
  }
})

memoryRouter.get('/suggestions', async (req, res, next) => {
  try {
    res.json(await listMemorySuggestions({ query: req.query.query, limit: req.query.limit }))
  } catch (error) {
    next(error)
  }
})

memoryRouter.post('/suggestions', async (req, res, next) => {
  try {
    res.status(201).json(await createMemorySuggestion(req.body ?? {}))
  } catch (error) {
    next(error)
  }
})

memoryRouter.post('/suggestions/:id/confirm', async (req, res, next) => {
  try {
    res.json(await confirmMemorySuggestion(req.params.id, req.body ?? {}))
  } catch (error) {
    next(error)
  }
})

memoryRouter.delete('/suggestions/:id', async (req, res, next) => {
  try {
    res.json(await rejectMemorySuggestion(req.params.id))
  } catch (error) {
    next(error)
  }
})

memoryRouter.get('/secure', async (req, res, next) => {
  try {
    res.json(await listSecureMemories({ query: req.query.query, limit: req.query.limit }))
  } catch (error) {
    next(error)
  }
})

memoryRouter.post('/secure', async (req, res, next) => {
  try {
    res.status(201).json(await createSecureMemory(req.body ?? {}))
  } catch (error) {
    next(error)
  }
})

memoryRouter.get('/secure/:id', async (req, res, next) => {
  try {
    res.json(await getSecureMemory(req.params.id))
  } catch (error) {
    next(error)
  }
})

memoryRouter.put('/secure/:id', async (req, res, next) => {
  try {
    res.json(await updateSecureMemory(req.params.id, req.body ?? {}))
  } catch (error) {
    next(error)
  }
})

memoryRouter.delete('/secure/:id', async (req, res, next) => {
  try {
    res.json(await deleteSecureMemory(req.params.id))
  } catch (error) {
    next(error)
  }
})

memoryRouter.get('/', async (req, res, next) => {
  try {
    res.json(
      await listMemories({
        query: req.query.query,
        category: req.query.category,
        scope: req.query.scope,
        priority: req.query.priority,
        active: req.query.active,
        limit: req.query.limit,
      }),
    )
  } catch (error) {
    next(error)
  }
})

memoryRouter.post('/', async (req, res, next) => {
  try {
    res.status(201).json(await createMemory(req.body ?? {}))
  } catch (error) {
    next(error)
  }
})

memoryRouter.get('/:id', async (req, res, next) => {
  try {
    res.json(await getMemory(req.params.id))
  } catch (error) {
    next(error)
  }
})

memoryRouter.put('/:id', async (req, res, next) => {
  try {
    res.json(await updateMemory(req.params.id, req.body ?? {}))
  } catch (error) {
    next(error)
  }
})

memoryRouter.delete('/:id', async (req, res, next) => {
  try {
    res.json(await deleteMemory(req.params.id))
  } catch (error) {
    next(error)
  }
})
