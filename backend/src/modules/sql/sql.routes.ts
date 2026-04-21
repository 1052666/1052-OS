import { Router } from 'express'
import {
  listDataSources,
  createDataSource,
  updateDataSource,
  deleteDataSource,
  testDataSource,
  listSqlFiles,
  createSqlFile,
  updateSqlFile,
  deleteSqlFile,
  executeQuery,
  listVariables,
  createVariable,
  updateVariable,
  deleteVariable,
} from './sql.service.js'

export const sqlRouter: Router = Router()

// ─── Data Sources ──────────────────────────────────────────

sqlRouter.get('/datasources', async (_req, res, next) => {
  try {
    res.json(await listDataSources())
  } catch (e) {
    next(e)
  }
})

sqlRouter.post('/datasources', async (req, res, next) => {
  try {
    res.status(201).json(await createDataSource(req.body ?? {}))
  } catch (e) {
    next(e)
  }
})

sqlRouter.put('/datasources/:id', async (req, res, next) => {
  try {
    res.json(await updateDataSource(req.params.id, req.body ?? {}))
  } catch (e) {
    next(e)
  }
})

sqlRouter.delete('/datasources/:id', async (req, res, next) => {
  try {
    res.json(await deleteDataSource(req.params.id))
  } catch (e) {
    next(e)
  }
})

sqlRouter.post('/datasources/:id/test', async (req, res, next) => {
  try {
    res.json(await testDataSource(req.params.id))
  } catch (e) {
    next(e)
  }
})

// ─── SQL Files ─────────────────────────────────────────────

sqlRouter.get('/files', async (_req, res, next) => {
  try {
    res.json(await listSqlFiles())
  } catch (e) {
    next(e)
  }
})

sqlRouter.post('/files', async (req, res, next) => {
  try {
    res.status(201).json(await createSqlFile(req.body ?? {}))
  } catch (e) {
    next(e)
  }
})

sqlRouter.put('/files/:id', async (req, res, next) => {
  try {
    res.json(await updateSqlFile(req.params.id, req.body ?? {}))
  } catch (e) {
    next(e)
  }
})

sqlRouter.delete('/files/:id', async (req, res, next) => {
  try {
    res.json(await deleteSqlFile(req.params.id))
  } catch (e) {
    next(e)
  }
})

// ─── Query Execution ───────────────────────────────────────

sqlRouter.post('/query', async (req, res, next) => {
  try {
    res.json(await executeQuery(req.body ?? {}))
  } catch (e) {
    next(e)
  }
})

// ─── Variables ────────────────────────────────────────────

sqlRouter.get('/variables', async (_req, res, next) => {
  try {
    res.json(await listVariables())
  } catch (e) {
    next(e)
  }
})

sqlRouter.post('/variables', async (req, res, next) => {
  try {
    res.status(201).json(await createVariable(req.body ?? {}))
  } catch (e) {
    next(e)
  }
})

sqlRouter.put('/variables/:id', async (req, res, next) => {
  try {
    res.json(await updateVariable(req.params.id, req.body ?? {}))
  } catch (e) {
    next(e)
  }
})

sqlRouter.delete('/variables/:id', async (req, res, next) => {
  try {
    res.json(await deleteVariable(req.params.id))
  } catch (e) {
    next(e)
  }
})
