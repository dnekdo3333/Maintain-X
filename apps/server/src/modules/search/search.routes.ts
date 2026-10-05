import {
  createSavedViewSchema,
  globalSearchQuerySchema,
  idParamSchema,
  savedViewQuerySchema,
} from '@maintainx/shared'
import { Router } from 'express'
import { sendCreated, sendData } from '../../core/http.js'
import { parseBody, parseParams, parseQuery } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import { globalSearch } from './search.service.js'
import * as views from './saved-views.service.js'

/** Global search and saved list views (each result is still permission-checked). */
export const searchRouter = Router()
searchRouter.use(['/search', '/saved-views'], ...requireAuth())

searchRouter.get('/search', async (req, res) => {
  const { q } = parseQuery(globalSearchQuerySchema, req)
  sendData(res, await globalSearch(getAuth(req), q))
})

searchRouter.get('/saved-views', async (req, res) => {
  const { resource } = parseQuery(savedViewQuerySchema, req)
  sendData(res, await views.listSavedViews(getAuth(req), resource))
})

searchRouter.post('/saved-views', async (req, res) => {
  sendCreated(res, await views.createSavedView(getAuth(req), parseBody(createSavedViewSchema, req), req))
})

searchRouter.delete('/saved-views/:id', async (req, res) => {
  const { id } = parseParams(idParamSchema, req)
  sendData(res, await views.deleteSavedView(getAuth(req), id))
})
