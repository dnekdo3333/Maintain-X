import {
  assignWorkOrderSchema,
  closeWorkOrderSchema,
  completeWorkOrderSchema,
  createWorkOrderSchema,
  holdWorkOrderSchema,
  idParamSchema,
  listWorkOrdersQuerySchema,
  messageSchema,
  reopenWorkOrderSchema,
  stepAnswerSchema,
  useWorkOrderPartSchema,
  updateWorkOrderSchema,
} from '@maintainx/shared'
import { Router } from 'express'
import { z } from 'zod'
import { parseUploads } from '../../core/attachments.js'
import { requirePermission } from '../../core/authz.js'
import { sendCreated, sendData } from '../../core/http.js'
import { parseBody, parseParams, parseQuery } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import { createRateLimiter } from '../../middleware/security.js'
import * as service from './work-orders.service.js'

const uploadLimiter = createRateLimiter({ windowMs: 60_000, limit: 30 })

/*
 * Every action route re-checks permission, restaurant scope and ownership in
 * the service (computeActions), so the UI's buttons are never the only guard.
 */
export const workOrdersRouter = Router()
workOrdersRouter.use('/work-orders', ...requireAuth())

const checklistParamsSchema = z.object({ id: z.uuid(), itemId: z.uuid() })

const view = requirePermission('work_orders:view')

workOrdersRouter.get('/work-orders', view, async (req, res) => {
  res.json(await service.listWorkOrders(getAuth(req), parseQuery(listWorkOrdersQuerySchema, req)))
})

workOrdersRouter.get('/work-orders/:id', view, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.getWorkOrder(getAuth(req), id))
})

workOrdersRouter.post('/work-orders', requirePermission('work_orders:create'), async (req, res) => {
  sendCreated(
    res,
    await service.createWorkOrder(getAuth(req), parseBody(createWorkOrderSchema, req), req),
  )
})

workOrdersRouter.put(
  '/work-orders/:id',
  requirePermission('work_orders:edit'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    sendData(
      res,
      await service.updateWorkOrder(getAuth(req), id, parseBody(updateWorkOrderSchema, req), req),
    )
  },
)

workOrdersRouter.post(
  '/work-orders/:id/assign',
  requirePermission('work_orders:assign'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    sendData(
      res,
      await service.assignWorkOrder(getAuth(req), id, parseBody(assignWorkOrderSchema, req), req),
    )
  },
)

workOrdersRouter.post(
  '/work-orders/:id/unassign',
  requirePermission('work_orders:assign'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    sendData(res, await service.unassignWorkOrder(getAuth(req), id, req))
  },
)

workOrdersRouter.post('/work-orders/:id/start', view, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.startWorkOrder(getAuth(req), id, req))
})

workOrdersRouter.post('/work-orders/:id/hold', view, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(
    res,
    await service.holdWorkOrder(getAuth(req), id, parseBody(holdWorkOrderSchema, req), req),
  )
})

workOrdersRouter.post('/work-orders/:id/resume', view, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.resumeWorkOrder(getAuth(req), id, req))
})

workOrdersRouter.post('/work-orders/:id/complete', view, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(
    res,
    await service.completeWorkOrder(getAuth(req), id, parseBody(completeWorkOrderSchema, req), req),
  )
})

workOrdersRouter.post(
  '/work-orders/:id/close',
  requirePermission('work_orders:approve'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    sendData(
      res,
      await service.closeWorkOrder(getAuth(req), id, parseBody(closeWorkOrderSchema, req), req),
    )
  },
)

workOrdersRouter.post(
  '/work-orders/:id/reopen',
  requirePermission('work_orders:approve'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    sendData(
      res,
      await service.reopenWorkOrder(getAuth(req), id, parseBody(reopenWorkOrderSchema, req), req),
    )
  },
)

workOrdersRouter.post(
  '/work-orders/:id/messages',
  requirePermission('messages:create'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    sendData(res, await service.addMessage(getAuth(req), id, parseBody(messageSchema, req), req))
  },
)

workOrdersRouter.post(
  '/work-orders/:id/attachments',
  uploadLimiter,
  view,
  parseUploads,
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    sendData(
      res,
      await service.uploadAttachments(getAuth(req), id, req.files as Express.Multer.File[], req),
    )
  },
)

workOrdersRouter.put('/work-orders/:id/checklist/:itemId', view, async (req, res) => {
  const { id, itemId } = parseParams(checklistParamsSchema, req)
  sendData(
    res,
    await service.answerChecklistItem(getAuth(req), id, itemId, parseBody(stepAnswerSchema, req)),
  )
})

workOrdersRouter.post('/work-orders/:id/parts', view, async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(
    res,
    await service.useWorkOrderPart(getAuth(req), id, parseBody(useWorkOrderPartSchema, req), req),
  )
})

workOrdersRouter.delete('/work-orders/:id/parts/:lineId', view, async (req, res) => {
  const { id, lineId } = parseParams(z.object({ id: z.uuid(), lineId: z.uuid() }), req)
  sendData(res, await service.removeWorkOrderPart(getAuth(req), id, lineId, req))
})
