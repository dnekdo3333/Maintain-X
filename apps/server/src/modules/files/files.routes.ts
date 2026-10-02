import { Router } from 'express'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { ForbiddenError, NotFoundError } from '../../core/errors.js'
import { parseQuery } from '../../core/validate.js'
import { storage } from '../../storage/index.js'
import { verifyFileLink } from '../../storage/signing.js'

const fileQuerySchema = z.object({
  key: z.string().min(1).max(512),
  exp: z.coerce.number().int(),
  type: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  dl: z.enum(['0', '1']),
  sig: z.string().min(16).max(128),
})

/** Encode a filename for Content-Disposition (ASCII fallback + RFC 5987). */
function contentDisposition(kind: 'inline' | 'attachment', fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  const encoded = encodeURIComponent(fileName)
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

export const filesRouter = Router()

/**
 * Serves a file previously authorized through StorageProvider.getSignedUrl.
 * The signature covers key, expiry, content type, file name and disposition,
 * so none of them can be altered by the client.
 */
filesRouter.get('/files', async (req, res) => {
  const q = parseQuery(fileQuerySchema, req)
  if (!verifyFileLink(q, env.FILE_SIGNING_SECRET)) {
    throw new ForbiddenError('This file link is invalid or has expired.')
  }

  const info = await storage.head(q.key)
  if (!info) throw new NotFoundError('File')

  res.setHeader('Content-Type', q.type)
  res.setHeader('Content-Length', String(info.size))
  res.setHeader(
    'Content-Disposition',
    contentDisposition(q.dl === '1' ? 'attachment' : 'inline', q.name),
  )
  res.setHeader('Cache-Control', 'private, max-age=0, no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')

  const stream = await storage.getStream(q.key)
  stream.on('error', (err) => {
    if (!res.headersSent) res.status(500)
    res.destroy(err)
  })
  stream.pipe(res)
})
