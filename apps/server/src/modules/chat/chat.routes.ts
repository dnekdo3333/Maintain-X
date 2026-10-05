import {
  DEFAULT_DASHBOARD_LAYOUT,
  addMembersSchema,
  chatMessageSchema,
  chatMessagesQuerySchema,
  dashboardLayoutSchema,
  idParamSchema,
  startConversationSchema,
  type DeliveryStatus,
} from '@maintainx/shared'
import { Router } from 'express'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { emailEnabled, pushEnabled } from '../../core/delivery.js'
import { sendCreated, sendData, sendNoContent } from '../../core/http.js'
import { notify } from '../../core/notify.js'
import { prisma } from '../../core/prisma.js'
import { parseBody, parseParams, parseQuery } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import { createRateLimiter } from '../../middleware/security.js'
import * as chat from './chat.service.js'

/** Team chat, the personal dashboard layout and a "send me a test" notification. */
export const chatRouter = Router()
chatRouter.use(
  ['/chats', '/me/dashboard-layout', '/notifications/delivery', '/notifications/test'],
  ...requireAuth(),
)

const messageParams = z.object({ id: z.uuid(), messageId: z.uuid() })
const peopleQuery = z.object({ q: z.string().max(60).optional() })
/** Chat sends are cheap but capped against runaway clients. */
const sendLimiter = createRateLimiter({ windowMs: 60_000, limit: 60 })

chatRouter.get('/chats', async (req, res) => {
  sendData(res, await chat.listConversations(getAuth(req)))
})
chatRouter.get('/chats/unread', async (req, res) => {
  sendData(res, { count: await chat.unreadTotal(getAuth(req)) })
})
chatRouter.get('/chats/people', async (req, res) => {
  sendData(res, await chat.chatPeople(getAuth(req), parseQuery(peopleQuery, req).q))
})
chatRouter.post('/chats', async (req, res) => {
  sendCreated(res, await chat.startConversation(getAuth(req), parseBody(startConversationSchema, req)))
})
chatRouter.get('/chats/:id/messages', async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await chat.listMessages(getAuth(req), id, parseQuery(chatMessagesQuerySchema, req)))
})
chatRouter.post('/chats/:id/messages', sendLimiter, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendCreated(res, await chat.sendMessage(getAuth(req), id, parseBody(chatMessageSchema, req)))
})
chatRouter.delete('/chats/:id/messages/:messageId', async (req, res) => {
  const { id, messageId } = parseParams(messageParams, req)
  await chat.deleteMessage(getAuth(req), id, messageId)
  sendNoContent(res)
})
chatRouter.post('/chats/:id/read', async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  await chat.markRead(getAuth(req), id)
  sendNoContent(res)
})
chatRouter.post('/chats/:id/members', async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  await chat.addMembers(getAuth(req), id, parseBody(addMembersSchema, req).userIds)
  sendNoContent(res)
})
chatRouter.post('/chats/:id/leave', async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  await chat.leaveConversation(getAuth(req), id)
  sendNoContent(res)
})

// ---------------------------------------------------------------- personal dashboard

chatRouter.get('/me/dashboard-layout', async (req, res) => {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: getAuth(req).userId },
    select: { dashboardLayout: true },
  })
  const parsed = dashboardLayoutSchema.safeParse(u.dashboardLayout)
  sendData(res, parsed.success ? parsed.data : DEFAULT_DASHBOARD_LAYOUT)
})
chatRouter.put('/me/dashboard-layout', async (req, res) => {
  const layout = parseBody(dashboardLayoutSchema, req)
  const widgets = [...new Set(layout.widgets)]
  await prisma.user.update({
    where: { id: getAuth(req).userId },
    data: { dashboardLayout: { widgets } },
  })
  sendData(res, { widgets })
})

// ---------------------------------------------------------------- notification delivery

chatRouter.get('/notifications/delivery', (_req, res) => {
  const status: DeliveryStatus = {
    email: emailEnabled(),
    push: pushEnabled(),
    vapidPublicKey: pushEnabled() ? (env.VAPID_PUBLIC_KEY ?? null) : null,
  }
  sendData(res, status)
})

const testLimiter = createRateLimiter({ windowMs: 10 * 60_000, limit: 5 })
/** Sends the caller a test notification (in-app, plus email / push if set up). */
chatRouter.post('/notifications/test', testLimiter, async (req, res) => {
  const auth = getAuth(req)
  await notify([auth.userId], {
    organizationId: auth.organizationId,
    type: 'AUTOMATION',
    title: 'Test notification',
    body: 'Notifications are working on this device.',
    entityType: 'USER',
    entityId: auth.userId,
    actionUrl: '/notifications',
  })
  sendNoContent(res)
})
