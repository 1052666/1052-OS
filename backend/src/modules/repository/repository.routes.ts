import { Router } from 'express'
import fs from 'node:fs/promises'
import {
  addManualRepository,
  createRepositoryArchive,
  getRepositoryFileContent,
  getRepositoryFileResource,
  getRepositoryConfig,
  getRepositoryDetail,
  listRepositories,
  removeManualRepository,
  updateRepositoryConfig,
  updateRepositoryDescription,
} from './repository.service.js'

export const repositoryRouter: Router = Router()

repositoryRouter.get('/config', async (_req, res, next) => {
  try {
    res.json(await getRepositoryConfig())
  } catch (e) {
    next(e)
  }
})

repositoryRouter.put('/config', async (req, res, next) => {
  try {
    res.json(await updateRepositoryConfig(req.body ?? {}))
  } catch (e) {
    next(e)
  }
})

repositoryRouter.get('/repos', async (_req, res, next) => {
  try {
    res.json(await listRepositories())
  } catch (e) {
    next(e)
  }
})

repositoryRouter.get('/repos/:id/file', async (req, res, next) => {
  try {
    res.json(await getRepositoryFileContent(req.params.id, req.query.path))
  } catch (e) {
    next(e)
  }
})

repositoryRouter.get('/repos/:id/raw', async (req, res, next) => {
  try {
    const file = await getRepositoryFileResource(req.params.id, req.query.path)
    res.type(file.mime)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.fileName)}"`)
    res.send(await fs.readFile(file.filePath))
  } catch (e) {
    next(e)
  }
})

repositoryRouter.get('/repos/:id/archive', async (req, res, next) => {
  try {
    const archive = await createRepositoryArchive(req.params.id)
    res.download(archive.filePath, archive.fileName, (err) => {
      fs.unlink(archive.filePath).catch(() => undefined)
      if (err && !res.headersSent) next(err)
    })
  } catch (e) {
    next(e)
  }
})

repositoryRouter.put('/repos/:id/description', async (req, res, next) => {
  try {
    res.json(await updateRepositoryDescription(req.params.id, req.body ?? {}))
  } catch (e) {
    next(e)
  }
})

repositoryRouter.get('/repos/:id', async (req, res, next) => {
  try {
    res.json(await getRepositoryDetail(req.params.id))
  } catch (e) {
    next(e)
  }
})

repositoryRouter.post('/repos', async (req, res, next) => {
  try {
    res.status(201).json(await addManualRepository(req.body ?? {}))
  } catch (e) {
    next(e)
  }
})

repositoryRouter.delete('/repos/:id', async (req, res, next) => {
  try {
    res.json(await removeManualRepository(req.params.id))
  } catch (e) {
    next(e)
  }
})
