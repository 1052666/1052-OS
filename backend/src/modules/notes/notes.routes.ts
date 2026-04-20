import { Router } from 'express'
import {
  createNoteFile,
  createNoteFolder,
  deleteNoteFile,
  deleteNoteFolder,
  getNoteFile,
  getNotesConfig,
  getNotesTree,
  moveNoteEntry,
  updateNoteFile,
  updateNotesConfig,
  useDefaultNotesConfig,
} from './notes.service.js'

export const notesRouter: Router = Router()

notesRouter.get('/config', async (_req, res, next) => {
  try {
    res.json(await getNotesConfig())
  } catch (e) {
    next(e)
  }
})

notesRouter.put('/config', async (req, res, next) => {
  try {
    res.json(await updateNotesConfig(req.body ?? {}))
  } catch (e) {
    next(e)
  }
})

notesRouter.post('/config/default', async (_req, res, next) => {
  try {
    res.status(201).json(await useDefaultNotesConfig())
  } catch (e) {
    next(e)
  }
})

notesRouter.get('/tree', async (req, res, next) => {
  try {
    res.json(await getNotesTree(req.query.query))
  } catch (e) {
    next(e)
  }
})

notesRouter.get('/file', async (req, res, next) => {
  try {
    res.json(await getNoteFile(req.query.path))
  } catch (e) {
    next(e)
  }
})

notesRouter.post('/file', async (req, res, next) => {
  try {
    res.status(201).json(await createNoteFile(req.body ?? {}))
  } catch (e) {
    next(e)
  }
})

notesRouter.put('/file', async (req, res, next) => {
  try {
    res.json(await updateNoteFile(req.body ?? {}))
  } catch (e) {
    next(e)
  }
})

notesRouter.delete('/file', async (req, res, next) => {
  try {
    res.json(await deleteNoteFile(req.query.path))
  } catch (e) {
    next(e)
  }
})

notesRouter.post('/folder', async (req, res, next) => {
  try {
    res.status(201).json(await createNoteFolder(req.body ?? {}))
  } catch (e) {
    next(e)
  }
})

notesRouter.delete('/folder', async (req, res, next) => {
  try {
    res.json(await deleteNoteFolder(req.query.path))
  } catch (e) {
    next(e)
  }
})

notesRouter.put('/move', async (req, res, next) => {
  try {
    res.json(await moveNoteEntry(req.body ?? {}))
  } catch (e) {
    next(e)
  }
})
