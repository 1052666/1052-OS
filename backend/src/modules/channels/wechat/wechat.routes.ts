import { Router } from 'express'
import multer from 'multer'
import { HttpError } from '../../../http-error.js'
import {
  deleteWechatAccount,
  listWechatChannelAccounts,
  listWechatDeliveryTargets,
  sendWechatDirectMedia,
  sendWechatDirectMessage,
  startWechatAccount,
  startWechatLogin,
  stopWechatAccount,
  waitWechatLogin,
} from './wechat.service.js'

export const wechatRouter: Router = Router()
const wechatMediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024,
  },
})

wechatRouter.get('/accounts', async (_req, res, next) => {
  try {
    res.json(await listWechatChannelAccounts())
  } catch (error) {
    next(error)
  }
})

wechatRouter.get('/status', async (_req, res, next) => {
  try {
    const accounts = await listWechatChannelAccounts()
    res.json({
      available: true,
      accounts,
      running: accounts.some((account) => account.running),
    })
  } catch (error) {
    next(error)
  }
})

wechatRouter.get('/delivery-targets', async (_req, res, next) => {
  try {
    res.json(await listWechatDeliveryTargets())
  } catch (error) {
    next(error)
  }
})

wechatRouter.post('/send', async (req, res, next) => {
  try {
    const accountId = typeof req.body?.accountId === 'string' ? req.body.accountId : ''
    const peerId = typeof req.body?.peerId === 'string' ? req.body.peerId : ''
    const text = typeof req.body?.text === 'string' ? req.body.text : ''
    res.json(await sendWechatDirectMessage({ accountId, peerId, text }))
  } catch (error) {
    next(error)
  }
})

wechatRouter.post('/send-media', wechatMediaUpload.single('file'), async (req, res, next) => {
  try {
    const accountId = typeof req.body?.accountId === 'string' ? req.body.accountId : ''
    const peerId = typeof req.body?.peerId === 'string' ? req.body.peerId : ''
    const text = typeof req.body?.text === 'string' ? req.body.text : undefined
    const uploadFile = (req as typeof req & { file?: Express.Multer.File }).file

    if (!uploadFile?.buffer || !uploadFile.originalname) {
      throw new HttpError(400, 'A media file is required.')
    }

    res.json(
      await sendWechatDirectMedia({
        accountId,
        peerId,
        text,
        fileName: uploadFile.originalname,
        mimeType: uploadFile.mimetype || 'application/octet-stream',
        buffer: uploadFile.buffer,
      }),
    )
  } catch (error) {
    next(error)
  }
})

wechatRouter.post('/login/start', async (_req, res, next) => {
  try {
    res.json(await startWechatLogin())
  } catch (error) {
    next(error)
  }
})

wechatRouter.post('/login/wait', async (req, res, next) => {
  try {
    res.json(await waitWechatLogin(req.body?.sessionKey, req.body?.timeoutMs))
  } catch (error) {
    next(error)
  }
})

wechatRouter.post('/accounts/:accountId/start', async (req, res, next) => {
  try {
    res.json(await startWechatAccount(req.params.accountId))
  } catch (error) {
    next(error)
  }
})

wechatRouter.post('/accounts/:accountId/stop', async (req, res, next) => {
  try {
    res.json(await stopWechatAccount(req.params.accountId))
  } catch (error) {
    next(error)
  }
})

wechatRouter.delete('/accounts/:accountId', async (req, res, next) => {
  try {
    res.json(await deleteWechatAccount(req.params.accountId))
  } catch (error) {
    next(error)
  }
})
