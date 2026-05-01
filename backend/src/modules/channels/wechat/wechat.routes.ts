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
import {
  bindWechatUiBridgeChatWindows,
  checkWechatUiBridgeMentions,
  checkWechatUiBridgeNewMessages,
  getWechatUiBridgeListenerStatus,
  getWechatUiBridgeStatus,
  listWechatUiBridgeGroups,
  processWechatUiBridgeMention,
  saveWechatUiBridgeConfig,
  sendWechatUiBridgeText,
  startWechatUiBridgeListener,
  stopWechatUiBridgeListener,
} from './wechat-ui-bridge.service.js'

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

wechatRouter.get('/ui/status', async (req, res, next) => {
  try {
    res.json(
      await getWechatUiBridgeStatus({
        includeProfile: req.query.includeProfile === 'true',
        probeDesktop: req.query.probeDesktop === 'true',
        pywechatRoot: req.query.pywechatRoot,
      }),
    )
  } catch (error) {
    next(error)
  }
})

wechatRouter.post('/ui/config', async (req, res, next) => {
  try {
    res.json(
      await saveWechatUiBridgeConfig({
        pywechatRoot: req.body?.pywechatRoot,
        botNames: req.body?.botNames,
        chatNames: req.body?.chatNames,
        searchPages: req.body?.searchPages,
        listenerEnabled: req.body?.listenerEnabled,
      }),
    )
  } catch (error) {
    next(error)
  }
})

wechatRouter.post('/ui/send-text', async (req, res, next) => {
  try {
    res.json(
      await sendWechatUiBridgeText({
        friend: req.body?.friend,
        text: req.body?.text,
        confirmed: req.body?.confirmed,
        pywechatRoot: req.body?.pywechatRoot,
        requireBoundWindow: req.body?.requireBoundWindow,
      }),
    )
  } catch (error) {
    next(error)
  }
})

wechatRouter.post('/ui/groups', async (req, res, next) => {
  try {
    res.json(
      await listWechatUiBridgeGroups({
        confirmed: req.body?.confirmed,
        recent: req.body?.recent,
        pywechatRoot: req.body?.pywechatRoot,
      }),
    )
  } catch (error) {
    next(error)
  }
})

wechatRouter.post('/ui/bind-chat-windows', async (req, res, next) => {
  try {
    res.json(
      await bindWechatUiBridgeChatWindows({
        confirmed: req.body?.confirmed,
        chatNames: req.body?.chatNames,
        minimize: req.body?.minimize,
        pywechatRoot: req.body?.pywechatRoot,
      }),
    )
  } catch (error) {
    next(error)
  }
})

wechatRouter.get('/ui/listener', async (_req, res, next) => {
  try {
    res.json({ ok: true, listener: getWechatUiBridgeListenerStatus() })
  } catch (error) {
    next(error)
  }
})

wechatRouter.post('/ui/listener/start', async (req, res, next) => {
  try {
    res.json(
      await startWechatUiBridgeListener({
        confirmed: req.body?.confirmed,
        pywechatRoot: req.body?.pywechatRoot,
        botNames: req.body?.botNames,
        chatNames: req.body?.chatNames,
        searchPages: req.body?.searchPages,
      }),
    )
  } catch (error) {
    next(error)
  }
})

wechatRouter.post('/ui/listener/stop', async (req, res, next) => {
  try {
    res.json(await stopWechatUiBridgeListener({ confirmed: req.body?.confirmed }))
  } catch (error) {
    next(error)
  }
})

wechatRouter.post('/ui/check-new-messages', async (req, res, next) => {
  try {
    res.json(
      await checkWechatUiBridgeNewMessages({
        confirmed: req.body?.confirmed,
        searchPages: req.body?.searchPages,
        botNames: req.body?.botNames,
        chatNames: req.body?.chatNames,
        pywechatRoot: req.body?.pywechatRoot,
      }),
    )
  } catch (error) {
    next(error)
  }
})

wechatRouter.post('/ui/check-mentions', async (req, res, next) => {
  try {
    res.json(
      await checkWechatUiBridgeMentions({
        confirmed: req.body?.confirmed,
        searchPages: req.body?.searchPages,
        botNames: req.body?.botNames,
        chatNames: req.body?.chatNames,
        resetPosition: req.body?.resetPosition,
        ensureBottom: req.body?.ensureBottom,
        focusWindow: req.body?.focusWindow,
        pywechatRoot: req.body?.pywechatRoot,
      }),
    )
  } catch (error) {
    next(error)
  }
})

wechatRouter.post('/ui/process-mention', async (req, res, next) => {
  try {
    res.json(
      await processWechatUiBridgeMention({
        chat: req.body?.chat,
        sender: req.body?.sender,
        text: req.body?.text,
        raw: req.body?.raw,
        confirmed: req.body?.confirmed,
        pywechatRoot: req.body?.pywechatRoot,
      }),
    )
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
