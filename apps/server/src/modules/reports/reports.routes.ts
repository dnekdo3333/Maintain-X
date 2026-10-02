import { REPORT_KEYS, reportQuerySchema, toCsv } from '@maintainx/shared'
import { Router } from 'express'
import { z } from 'zod'
import { recordAudit } from '../../core/audit.js'
import { requirePermission } from '../../core/authz.js'
import { sendData } from '../../core/http.js'
import { parseParams, parseQuery } from '../../core/validate.js'
import { getAuth, requireAuth } from '../../middleware/authenticate.js'
import { createRateLimiter } from '../../middleware/security.js'
import { runReport } from './reports.service.js'

/** Reports scan a lot of rows: keep bursts in check. */
const reportLimiter = createRateLimiter({ windowMs: 60_000, limit: 60 })
const keyParam = z.object({ key: z.enum(REPORT_KEYS) })

export const reportsRouter = Router()
reportsRouter.use('/reports', ...requireAuth(), reportLimiter)

reportsRouter.get('/reports/:key', requirePermission('reports:view'), async (req, res) => {
  const { key } = parseParams(keyParam, req)
  sendData(res, await runReport(getAuth(req), key, parseQuery(reportQuerySchema, req)))
})

/** CSV for Excel: column keys as headers (the app translates them on screen). */
reportsRouter.get(
  '/reports/:key/csv',
  requirePermission('reports:view', 'reports:export'),
  async (req, res) => {
    const auth = getAuth(req)
    const { key } = parseParams(keyParam, req)
    const q = parseQuery(reportQuerySchema, req)
    const result = await runReport(auth, key, q)
    await recordAudit(
      {
        organizationId: auth.organizationId,
        restaurantId: q.restaurantId ?? null,
        actorId: auth.userId,
        action: 'report.exported',
        entityType: 'REPORT',
        metadata: { report: key, from: q.from, to: q.to, rows: result.rows.length },
      },
      req,
    )
    const csv = toCsv(
      result.columns.map((c) => c.key),
      result.rows.map((r) => result.columns.map((c) => r[c.key])),
    )
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${key}_${q.from}_${q.to}.csv"`)
    res.setHeader('Cache-Control', 'no-store')
    res.send(csv)
  },
)
