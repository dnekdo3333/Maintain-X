import { randomUUID } from 'node:crypto'
import {
  ERROR_CODES,
  UPLOAD_ALLOWED_TYPES,
  UPLOAD_IMAGE_TYPES,
  UPLOAD_MAX_FILES,
  UPLOAD_MAX_IMAGE_MB,
  type AttachmentDto,
  type AttachmentOwnerType,
  type EvidenceStage,
} from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import type { RequestHandler } from 'express'
import { fileTypeFromBuffer } from 'file-type'
import multer from 'multer'
import { env } from '../config/env.js'
import { storage } from '../storage/index.js'
import { AppError, PayloadTooLargeError, ValidationError } from './errors.js'
import { optimizePhoto } from './images.js'
import { prisma } from './prisma.js'

const MB = 1024 * 1024
const SIGNED_URL_SECONDS = 3600

/** Multipart parser: files stay in memory (bounded by count and size) until validated. */
const parser = multer({
  storage: multer.memoryStorage(),
  limits: { files: UPLOAD_MAX_FILES, fileSize: env.MAX_UPLOAD_MB * MB, fields: 10 },
}).array('files', UPLOAD_MAX_FILES)

/** Express middleware that parses `files` and maps multer limits to friendly errors. */
export const parseUploads: RequestHandler = (req, res, next) => {
  parser(req, res, (err: unknown) => {
    if (!err) return next()
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE')
        return next(new PayloadTooLargeError('This file is too large.'))
      return next(new ValidationError({ files: ['validation.tooManyFiles'] }))
    }
    next(err)
  })
}

const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/webm': 'weba',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/aac': 'aac',
}

/** Removes path parts and odd characters; keeps something readable for downloads. */
function safeFileName(name: string, ext: string): string {
  const base = name
    .replace(/^.*[\\/]/, '')
    .replace(/\.[^.]*$/, '')
    .replace(/[^\w.\- ]+/g, '_')
    .slice(0, 80)
  return `${base || 'file'}.${ext}`
}

/**
 * Validates by content (magic bytes), not by the name or the browser-supplied
 * type, then writes to private storage and records the attachment rows.
 */
export async function saveAttachments(
  files: Express.Multer.File[] | undefined,
  owner: { type: AttachmentOwnerType; id: string },
  uploadedById: string | null,
  db: Prisma.TransactionClient | typeof prisma = prisma,
  /** Evidence stage and caption for work-order photos. */
  meta: { stage?: EvidenceStage | null; caption?: string | null } = {},
): Promise<string[]> {
  if (!files || files.length === 0) throw new ValidationError({ files: ['validation.required'] })

  const checked = await Promise.all(
    files.map(async (f) => {
      const detected = await fileTypeFromBuffer(f.buffer)
      if (!detected || !UPLOAD_ALLOWED_TYPES.includes(detected.mime)) {
        throw new AppError(
          415,
          ERROR_CODES.FILE_TYPE_NOT_ALLOWED,
          'Only photos, videos and voice notes can be uploaded.',
        )
      }
      const isImage = (UPLOAD_IMAGE_TYPES as readonly string[]).includes(detected.mime)
      if (isImage && f.size > UPLOAD_MAX_IMAGE_MB * MB) {
        throw new AppError(413, ERROR_CODES.FILE_TOO_LARGE, 'This photo is too large.')
      }
      // webm/mp4 containers look the same with or without a picture; a voice
      // note recorded in the browser says so in its declared type.
      const audio =
        detected.mime.startsWith('audio/') ||
        (f.mimetype.startsWith('audio/') && /^video\/(webm|mp4)$/.test(detected.mime))
      const mime = audio ? detected.mime.replace(/^video\//, 'audio/') : detected.mime
      return {
        file: f,
        mime,
        kind: isImage ? ('PHOTO' as const) : audio ? ('AUDIO' as const) : ('VIDEO' as const),
      }
    }),
  )

  const now = new Date()
  const folder = `attachments/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const ids: string[] = []
  for (const c of checked) {
    // Photos are re-encoded small (WebP) with a thumbnail for lists.
    const photo = c.kind === 'PHOTO' ? await optimizePhoto(c.file.buffer) : null
    const optimized = !!photo && photo.main !== c.file.buffer
    const mime = optimized ? 'image/webp' : c.mime
    const ext = EXTENSION[mime]!
    const id = randomUUID()
    const key = `${folder}/${id}.${ext}`
    const body = optimized ? photo.main : c.file.buffer
    await storage.put(key, body, { mimeType: mime })
    const thumbKey = photo ? `${folder}/${id}-thumb.webp` : null
    if (photo && thumbKey) await storage.put(thumbKey, photo.thumb, { mimeType: 'image/webp' })
    const row = await db.attachment.create({
      data: {
        ownerType: owner.type,
        ownerId: owner.id,
        kind: c.kind,
        storageKey: key,
        thumbKey,
        width: photo?.width ?? null,
        height: photo?.height ?? null,
        fileName: safeFileName(c.file.originalname, ext),
        mimeType: mime,
        sizeBytes: body.length + (photo?.thumb.length ?? 0),
        stage: meta.stage ?? null,
        caption: meta.caption || null,
        uploadedById,
      },
      select: { id: true },
    })
    ids.push(row.id)
  }
  return ids
}

/** Attachments of one or more owners, each with a short-lived signed link. */
export async function listAttachments(
  owners: Array<{ type: AttachmentOwnerType; id: string }>,
): Promise<Map<string, AttachmentDto[]>> {
  const out = new Map<string, AttachmentDto[]>()
  if (owners.length === 0) return out
  const rows = await prisma.attachment.findMany({
    where: { OR: owners.map((o) => ({ ownerType: o.type, ownerId: o.id })) },
    include: { uploadedBy: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: 'asc' },
  })
  for (const r of rows) {
    const dto: AttachmentDto = {
      id: r.id,
      kind: r.kind,
      stage: r.stage,
      caption: r.caption,
      fileName: r.fileName,
      mimeType: r.mimeType,
      sizeBytes: r.sizeBytes,
      url: r.fileRemovedAt
        ? ''
        : await storage.getSignedUrl(r.storageKey, {
            expiresInSeconds: SIGNED_URL_SECONDS,
            mimeType: r.mimeType,
            fileName: r.fileName,
            disposition: 'inline',
          }),
      thumbUrl:
        r.thumbKey && !r.fileRemovedAt
          ? await storage.getSignedUrl(r.thumbKey, {
              expiresInSeconds: SIGNED_URL_SECONDS,
              mimeType: 'image/webp',
              fileName: r.fileName,
              disposition: 'inline',
            })
          : null,
      removed: !!r.fileRemovedAt,
      uploadedBy: r.uploadedBy,
      createdAt: r.createdAt.toISOString(),
    }
    const key = `${r.ownerType}:${r.ownerId}`
    out.set(key, [...(out.get(key) ?? []), dto])
  }
  return out
}

export function attachmentsOf(
  map: Map<string, AttachmentDto[]>,
  type: AttachmentOwnerType,
  id: string,
) {
  return map.get(`${type}:${id}`) ?? []
}
