import {
  idParamSchema,
  listNotificationsQuerySchema,
  notificationPreferencesSchema,
} from '@maintainx/shared'
import { Router } from 'express'
import { sendData } from '../../core/http.js'
import { parseBody, parseParams, parseQuery } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import * as service from './notifications.service.js'

/* Personal inbox: every signed-in user has one, so no permission check beyond sign-in. */
export const notificationsRouter = Router()
notificationsRouter.use('/notifications', ...requireAuth())

notificationsRouter.get('/notifications', async (req, res) => {
  res.json(
    await service.listNotifications(getAuth(req), parseQuery(listNotificationsQuerySchema, req)),
  )
})

notificationsRouter.get('/notifications/unread-count', async (req, res) => {
  sendData(res, { count: await service.unreadCount(getAuth(req)) })
})

notificationsRouter.post('/notifications/read-all', async (req, res) => {
  sendData(res, await service.markAllRead(getAuth(req)))
})

notificationsRouter.get('/notifications/preferences', async (req, res) => {
  sendData(res, await service.getPreferences(getAuth(req)))
})

notificationsRouter.put('/notifications/preferences', async (req, res) => {
  sendData(
    res,
    await service.setPreferences(getAuth(req), parseBody(notificationPreferencesSchema, req)),
  )
})

notificationsRouter.post('/notifications/:id/read', async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.markRead(getAuth(req), id))
})
