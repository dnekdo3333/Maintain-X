import { idParamSchema, roleSchema } from '@maintainx/shared'
import { Router } from 'express'
import { hasPermission, requirePermission } from '../../core/authz.js'
import { ForbiddenError } from '../../core/errors.js'
import { sendCreated, sendData, sendNoContent } from '../../core/http.js'
import { parseBody, parseParams } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import * as service from './roles.service.js'

export const rolesRouter = Router()
rolesRouter.use('/roles', ...requireAuth())

/** Roles the caller may give to users — used by the user forms (needs users:create or users:assign). */
rolesRouter.get('/roles/assignable', async (req, res) => {
  const auth = getAuth(req)
  if (!hasPermission(auth, 'users:create') && !hasPermission(auth, 'users:assign')) {
    throw new ForbiddenError()
  }
  sendData(res, await service.listAssignableRoles(auth))
})

rolesRouter.get('/roles', requirePermission('roles:view'), async (req, res) => {
  sendData(res, await service.listRoles(getAuth(req)))
})

rolesRouter.get('/roles/:id', requirePermission('roles:view'), async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await service.getRole(getAuth(req), id))
})

rolesRouter.post('/roles', requirePermission('roles:create'), async (req, res) => {
  const input = parseBody(roleSchema, req)
  sendCreated(res, await service.createRole(getAuth(req), input, req))
})

rolesRouter.put('/roles/:id', requirePermission('roles:edit'), async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  const input = parseBody(roleSchema, req)
  sendData(res, await service.updateRole(getAuth(req), id, input, req))
})

rolesRouter.delete('/roles/:id', requirePermission('roles:delete'), async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  await service.deleteRole(getAuth(req), id, req)
  sendNoContent(res)
})
