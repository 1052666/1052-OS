import { Router } from 'express'
import multer from 'multer'
import { httpError } from '../../http-error.js'
import {
  appendWikiLog,
  appendWikiPageSection,
  buildWikiIngestPreview,
  commitWikiIngest,
  copyAgentWorkspaceFileToRaw,
  fixWikiLint,
  getWikiSummary,
  listWikiPages,
  listWikiRawFiles,
  readWikiLog,
  readWikiPage,
  readWikiRawFile,
  rebuildWikiIndex,
  saveWikiRawUpload,
  writeWikiPage,
  writeWikiQueryBack,
} from './wiki.service.js'
import { lintWiki } from './wiki.lint.js'

export const wikiRouter: Router = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 20,
  },
})

wikiRouter.get('/summary', async (_req, res, next) => {
  try {
    res.json(await getWikiSummary())
  } catch (error) {
    next(error)
  }
})

wikiRouter.get('/raw', async (_req, res, next) => {
  try {
    res.json(await listWikiRawFiles())
  } catch (error) {
    next(error)
  }
})

wikiRouter.get('/raw/content', async (req, res, next) => {
  try {
    res.json(await readWikiRawFile(req.query.path))
  } catch (error) {
    next(error)
  }
})

wikiRouter.post('/raw/upload', upload.array('files', 20), async (req, res, next) => {
  try {
    const files = (req as typeof req & { files?: Express.Multer.File[] }).files ?? []
    if (files.length === 0) throw httpError(400, '至少需要上传一个 raw 文件')
    const overwrite = req.body?.overwrite === 'true' || req.body?.overwrite === true
    res.json({
      items: await Promise.all(
        files.map((file) =>
          saveWikiRawUpload({
            buffer: file.buffer,
            fileName: file.originalname,
            overwrite,
          }),
        ),
      ),
    })
  } catch (error) {
    next(error)
  }
})

wikiRouter.get('/pages', async (req, res, next) => {
  try {
    res.json(await listWikiPages(req.query.query))
  } catch (error) {
    next(error)
  }
})

wikiRouter.get('/pages/content', async (req, res, next) => {
  try {
    res.json(await readWikiPage(req.query.path))
  } catch (error) {
    next(error)
  }
})

wikiRouter.post('/pages', async (req, res, next) => {
  try {
    res.status(201).json(await writeWikiPage(req.body ?? {}))
  } catch (error) {
    next(error)
  }
})

wikiRouter.put('/pages', async (req, res, next) => {
  try {
    res.json(await writeWikiPage(req.body ?? {}))
  } catch (error) {
    next(error)
  }
})

wikiRouter.post('/pages/append', async (req, res, next) => {
  try {
    res.json(await appendWikiPageSection(req.body ?? {}))
  } catch (error) {
    next(error)
  }
})

wikiRouter.post('/raw/import-agent-workspace', async (req, res, next) => {
  try {
    res.status(201).json(await copyAgentWorkspaceFileToRaw(req.body ?? {}))
  } catch (error) {
    next(error)
  }
})

wikiRouter.post('/ingest-preview', async (req, res, next) => {
  try {
    res.json(await buildWikiIngestPreview(req.body ?? {}))
  } catch (error) {
    next(error)
  }
})

wikiRouter.post('/ingest-commit', async (req, res, next) => {
  try {
    res.json(await commitWikiIngest(req.body ?? {}))
  } catch (error) {
    next(error)
  }
})

wikiRouter.post('/query-writeback', async (req, res, next) => {
  try {
    res.status(201).json(await writeWikiQueryBack(req.body ?? {}))
  } catch (error) {
    next(error)
  }
})

wikiRouter.post('/lint', async (_req, res, next) => {
  try {
    res.json(await lintWiki())
  } catch (error) {
    next(error)
  }
})

wikiRouter.post('/lint/fix', async (_req, res, next) => {
  try {
    res.json(await fixWikiLint())
  } catch (error) {
    next(error)
  }
})

wikiRouter.post('/index/rebuild', async (_req, res, next) => {
  try {
    res.json(await rebuildWikiIndex())
  } catch (error) {
    next(error)
  }
})

wikiRouter.get('/logs', async (_req, res, next) => {
  try {
    res.json(await readWikiLog())
  } catch (error) {
    next(error)
  }
})

wikiRouter.post('/logs', async (req, res, next) => {
  try {
    res.status(201).json(await appendWikiLog(req.body ?? {}))
  } catch (error) {
    next(error)
  }
})
