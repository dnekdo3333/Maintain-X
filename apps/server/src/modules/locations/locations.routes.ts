import { idParamSchema, listLocationsQuerySchema, locationSchema } from '@maintainx/shared'
import { Router } from 'express'
import { requirePermission } from '../../core/authz.js'
import { sendCreated, sendData, sendNoContent } from '../../core/http.js'
import { parseBody, parseParams, parseQuery } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import * as service from './locations.service.js'

export const locationsRouter = Router()
locationsRouter.use('/locations', ...requireAuth())

locationsRouter.get('/locations', requirePermission('locations:view'), async (req, res) => {
  const { restaurantId } = parseQuery(listLocationsQuerySchema, req)
  sendData(res, await service.listLocations(getAuth(req), restaurantId))
})

locationsRouter.post('/locations', requirePermission('locations:create'), async (req, res) => {
  sendCreated(res, await service.createLocation(getAuth(req), parseBody(locationSchema, req), req))
})

locationsRouter.put('/locations/:id', requirePermission('locations:edit'), async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.updateLocation(getAuth(req), id, parseBody(locationSchema, req), req))
})

locationsRouter.delete(
  '/locations/:id',
  requirePermission('locations:delete'),
  async (req, res) => {
    const { id } = parseParams(idParamSchema, req)
    await service.archiveLocation(getAuth(req), id, req)
    sendNoContent(res)
  },
)
