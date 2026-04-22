import { Router, type RequestHandler } from 'express'
import multer from 'multer'
import { HttpError } from '../../../http-error.js'
import { setupWizardRouter } from './native-qr-auth/setup-wizard.routes.js'
import {
  createFeishuTestCard,
  getFeishuCardWebhookHandler,
  getFeishuEventWebhookHandler,
  getFeishuStatus,
  listFeishuDeliveryTargets,
  saveFeishuChannelConfig,
  sendFeishuDirectMedia,
  sendFeishuDirectMessage,
  startFeishuChannel,
  stopFeishuChannelAndReport,
} from './feishu.service.js'
import {
  createFeishuCalendar,
  createFeishuCalendarEvent,
  createFeishuExternalApprovalDefinition,
  createFeishuExternalApprovalInstance,
  createFeishuSearchDataSource,
  createFeishuTask,
  getFeishuWorkspaceStatus,
  importMarkdownDocument,
  indexFeishuSearchDataSourceItem,
  listFeishuCalendars,
  listFeishuCalendarEvents,
  listFeishuSearchDataSources,
  listFeishuTasks,
  moveDocumentToFeishuWiki,
  readFeishuDocumentRawContent,
  searchFeishuApprovalTasks,
  syncMemoryToFeishuDoc,
  syncNotesToFeishuDoc,
  syncResourcesToFeishuBitable,
  syncResourcesToFeishuDoc,
  syncResourcesToFeishuSearch,
  updateFeishuWorkspaceConfig,
} from './feishu.workspace.service.js'

export const feishuRouter: Router = Router()

// One-shot QR setup wizard (native, no external CLI)
feishuRouter.use('/setup-wizard', setupWizardRouter)

const feishuMediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 30 * 1024 * 1024,
  },
})

feishuRouter.get('/status', async (_req, res, next) => {
  try {
    res.json(await getFeishuStatus())
  } catch (error) {
    next(error)
  }
})

feishuRouter.get('/delivery-targets', async (_req, res, next) => {
  try {
    res.json(await listFeishuDeliveryTargets())
  } catch (error) {
    next(error)
  }
})

feishuRouter.get('/workspace', async (_req, res, next) => {
  try {
    res.json(await getFeishuWorkspaceStatus())
  } catch (error) {
    next(error)
  }
})

feishuRouter.post('/workspace/config', async (req, res, next) => {
  try {
    res.json(await updateFeishuWorkspaceConfig(req.body ?? {}))
  } catch (error) {
    next(error)
  }
})

feishuRouter.post('/workspace/docs/import-markdown', async (req, res, next) => {
  try {
    res.json(await importMarkdownDocument(req.body ?? {}))
  } catch (error) {
    next(error)
  }
})

feishuRouter.get('/workspace/docs/:documentId/raw', async (req, res, next) => {
  try {
    res.json(await readFeishuDocumentRawContent(req.params.documentId))
  } catch (error) {
    next(error)
  }
})

feishuRouter.post('/workspace/sync/resources-doc', async (_req, res, next) => {
  try {
    res.json(await syncResourcesToFeishuDoc())
  } catch (error) {
    next(error)
  }
})

feishuRouter.post('/workspace/sync/notes-doc', async (req, res, next) => {
  try {
    res.json(await syncNotesToFeishuDoc(req.body ?? {}))
  } catch (error) {
    next(error)
  }
})

feishuRouter.post('/workspace/sync/memory-doc', async (_req, res, next) => {
  try {
    res.json(await syncMemoryToFeishuDoc())
  } catch (error) {
    next(error)
  }
})

feishuRouter.post('/workspace/sync/resources-bitable', async (req, res, next) => {
  try {
    res.json(await syncResourcesToFeishuBitable(req.body ?? {}))
  } catch (error) {
    next(error)
  }
})

feishuRouter.post('/workspace/wiki/mount-doc', async (req, res, next) => {
  try {
    res.json(await moveDocumentToFeishuWiki(req.body ?? {}))
  } catch (error) {
    next(error)
  }
})

feishuRouter.get('/workspace/calendars', async (_req, res, next) => {
  try {
    res.json(await listFeishuCalendars())
  } catch (error) {
    next(error)
  }
})

feishuRouter.post('/workspace/calendars', async (req, res, next) => {
  try {
    res.json(await createFeishuCalendar(req.body ?? {}))
  } catch (error) {
    next(error)
  }
})

feishuRouter.get('/workspace/calendar-events', async (req, res, next) => {
  try {
    res.json(await listFeishuCalendarEvents({ calendarId: req.query.calendarId }))
  } catch (error) {
    next(error)
  }
})

feishuRouter.post('/workspace/calendar-events', async (req, res, next) => {
  try {
    res.json(await createFeishuCalendarEvent(req.body ?? {}))
  } catch (error) {
    next(error)
  }
})

feishuRouter.get('/workspace/tasks', async (_req, res, next) => {
  try {
    res.json(await listFeishuTasks())
  } catch (error) {
    next(error)
  }
})

feishuRouter.post('/workspace/tasks', async (req, res, next) => {
  try {
    res.json(await createFeishuTask(req.body ?? {}))
  } catch (error) {
    next(error)
  }
})

feishuRouter.post('/workspace/approvals/definitions', async (req, res, next) => {
  try {
    res.json(await createFeishuExternalApprovalDefinition(req.body ?? {}))
  } catch (error) {
    next(error)
  }
})

feishuRouter.post('/workspace/approvals/instances', async (req, res, next) => {
  try {
    res.json(await createFeishuExternalApprovalInstance(req.body ?? {}))
  } catch (error) {
    next(error)
  }
})

feishuRouter.get('/workspace/approvals/tasks', async (req, res, next) => {
  try {
    res.json(
      await searchFeishuApprovalTasks({
        approvalCode: req.query.approvalCode,
        userId: req.query.userId,
      }),
    )
  } catch (error) {
    next(error)
  }
})

feishuRouter.get('/workspace/search/data-sources', async (_req, res, next) => {
  try {
    res.json(await listFeishuSearchDataSources())
  } catch (error) {
    next(error)
  }
})

feishuRouter.post('/workspace/search/data-sources', async (req, res, next) => {
  try {
    res.json(await createFeishuSearchDataSource(req.body ?? {}))
  } catch (error) {
    next(error)
  }
})

feishuRouter.post('/workspace/search/data-sources/items', async (req, res, next) => {
  try {
    res.json(await indexFeishuSearchDataSourceItem(req.body ?? {}))
  } catch (error) {
    next(error)
  }
})

feishuRouter.post('/workspace/sync/resources-search', async (req, res, next) => {
  try {
    res.json(await syncResourcesToFeishuSearch(req.body ?? {}))
  } catch (error) {
    next(error)
  }
})

feishuRouter.post('/config', async (req, res, next) => {
  try {
    res.json(await saveFeishuChannelConfig(req.body ?? {}))
  } catch (error) {
    next(error)
  }
})

feishuRouter.post('/connect', async (_req, res, next) => {
  try {
    res.json(await startFeishuChannel())
  } catch (error) {
    next(error)
  }
})

feishuRouter.post('/disconnect', async (_req, res, next) => {
  try {
    res.json(await stopFeishuChannelAndReport())
  } catch (error) {
    next(error)
  }
})

feishuRouter.post('/send', async (req, res, next) => {
  try {
    const receiveIdType =
      typeof req.body?.receiveIdType === 'string' ? req.body.receiveIdType : 'chat_id'
    const receiveId = typeof req.body?.receiveId === 'string' ? req.body.receiveId : ''
    const text = typeof req.body?.text === 'string' ? req.body.text : undefined
    const card =
      req.body?.card === undefined
        ? req.body?.cardTemplate === 'test'
          ? createFeishuTestCard({
              title: '1052 OS x 飞书',
              content: text?.trim() || '这是一张飞书交互测试卡片。',
            })
          : undefined
        : req.body.card

    res.json(
      await sendFeishuDirectMessage({
        receiveIdType,
        receiveId,
        text,
        card,
      }),
    )
  } catch (error) {
    next(error)
  }
})

feishuRouter.post('/send-media', feishuMediaUpload.single('file'), async (req, res, next) => {
  try {
    const receiveIdType =
      typeof req.body?.receiveIdType === 'string' ? req.body.receiveIdType : 'chat_id'
    const receiveId = typeof req.body?.receiveId === 'string' ? req.body.receiveId : ''
    const text = typeof req.body?.text === 'string' ? req.body.text : undefined
    const mode =
      req.body?.mode === 'image' ||
      req.body?.mode === 'file' ||
      req.body?.mode === 'audio' ||
      req.body?.mode === 'media'
        ? req.body.mode
        : 'auto'
    const uploadFile = (req as typeof req & { file?: Express.Multer.File }).file

    if (!uploadFile?.buffer || !uploadFile.originalname) {
      throw new HttpError(400, 'A media file is required.')
    }

    res.json(
      await sendFeishuDirectMedia({
        receiveIdType,
        receiveId,
        text,
        mode,
        fileName: uploadFile.originalname,
        mimeType: uploadFile.mimetype || 'application/octet-stream',
        buffer: uploadFile.buffer,
      }),
    )
  } catch (error) {
    next(error)
  }
})

export const feishuEventWebhookHandler: RequestHandler = async (req, res, next) => {
  try {
    const handler = await getFeishuEventWebhookHandler()
    return handler(req, res, next)
  } catch (error) {
    next(error)
  }
}

export const feishuCardWebhookHandler: RequestHandler = async (req, res, next) => {
  try {
    const handler = await getFeishuCardWebhookHandler()
    return handler(req, res, next)
  } catch (error) {
    next(error)
  }
}
