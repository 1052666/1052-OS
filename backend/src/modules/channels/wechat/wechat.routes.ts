import { Router } from 'express'
import {
  deleteWechatAccount,
  listWechatChannelAccounts,
  listWechatDeliveryTargets,
  startWechatAccount,
  startWechatLogin,
  stopWechatAccount,
  waitWechatLogin,
} from './wechat.service.js'

export const wechatRouter: Router = Router()

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
