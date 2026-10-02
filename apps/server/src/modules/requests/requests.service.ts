import {
  ERROR_CODES,
  type CreateRequestInput,
  type ListRequestsQuery,
  type PagedResponse,
  type RejectRequestInput,
  type RequestDetail,
  type RequestListItem,
} from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import type { Request as HttpRequest } from 'express'
import { attachmentsOf, listAttachments, saveAttachments } from '../../core/attachments.js'
import { recordAudit } from '../../core/audit.js'
import { canAccessRestaurant, hasPermission, restaurantScope } from '../../core/authz.js'
import { nextCode } from '../../core/counters.js'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../core/errors.js'
import { notify, usersWithPermission } from '../../core/notify.js'
import { toPagedResponse, toSkipTake } from '../../core/pagination.js'
import { prisma } from '../../core/prisma.js'
import type { AuthContext } from '../auth/auth.context.js'

const person = { select: { id: true, firstName: true, lastName: true } } as const

const include = {
  restaurant: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
  asset: { select: { id: true, name: true, assetCode: true } },
  requestedBy: person,
  reviewedBy: person,
  convertedWorkOrder: { select: { id: true, code: true, status: true } },
} satisfies Prisma.RequestInclude

type Row = Prisma.RequestGetPayload<{ include: typeof include }>

/** Reviewers see every request in their restaurants; everyone else sees their own reports. */
const isReviewer = (auth: AuthContext) =>
  auth.user.roleKind !== 'WORKER' && hasPermission(auth, 'requests:view')

function visibleWhere(auth: AuthContext, mineOnly = false): Prisma.RequestWhereInput {
  return {
    organizationId: auth.organizationId,
    restaurantId: restaurantScope(auth),
    ...(mineOnly || !isReviewer(auth) ? { requestedById: auth.userId } : {}),
  }
}

function toListItem(r: Row, photoCount: number): RequestListItem {
  return {
    id: r.id,
    code: r.code,
    title: r.title,
    category: r.category,
    priority: r.priority,
    status: r.status,
    restaurant: r.restaurant,
    location: r.location,
    asset: r.asset,
    requestedBy: r.requestedBy,
    photoCount,
    createdAt: r.createdAt.toISOString(),
  }
}

async function photoCounts(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map()
  const rows = await prisma.attachment.groupBy({
    by: ['ownerId'],
    where: { ownerType: 'REQUEST', ownerId: { in: ids } },
    _count: { _all: true },
  })
  return new Map(rows.map((r) => [r.ownerId, r._count._all]))
}

/** "Fridge not cooling, ice on the back wall…" → a short title for lists. */
export function deriveTitle(description: string): string {
  const firstLine = description.split(/\r?\n/)[0]!.trim()
  return firstLine.length <= 80 ? firstLine : `${firstLine.slice(0, 77).trimEnd()}…`
}

async function load(auth: AuthContext, id: string): Promise<Row> {
  const r = await prisma.request.findFirst({ where: { ...visibleWhere(auth), id }, include })
  if (!r) throw new NotFoundError('Request')
  return r
}

export async function listRequests(
  auth: AuthContext,
  q: ListRequestsQuery,
): Promise<PagedResponse<RequestListItem>> {
  if (q.restaurantId && !canAccessRestaurant(auth, q.restaurantId)) return toPagedResponse([], q, 0)
  const where: Prisma.RequestWhereInput = {
    ...visibleWhere(auth, q.mine === '1'),
    ...(q.restaurantId ? { restaurantId: q.restaurantId } : {}),
    status: q.status,
    ...(q.q
      ? {
          OR: [
            { title: { contains: q.q, mode: 'insensitive' } },
            { code: { contains: q.q, mode: 'insensitive' } },
            { description: { contains: q.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  }
  const sort = q.sort ?? { field: 'createdAt', direction: 'desc' as const }
  const [rows, total] = await Promise.all([
    prisma.request.findMany({
      where,
      include,
      orderBy: [{ [sort.field]: sort.direction }, { createdAt: 'desc' }],
      ...toSkipTake(q),
    }),
    prisma.request.count({ where }),
  ])
  const counts = await photoCounts(rows.map((r) => r.id))
  return toPagedResponse(
    rows.map((r) => toListItem(r, counts.get(r.id) ?? 0)),
    q,
    total,
  )
}

export async function getRequest(auth: AuthContext, id: string): Promise<RequestDetail> {
  const r = await load(auth, id)
  const files = await listAttachments([{ type: 'REQUEST', id }])
  const attachments = attachmentsOf(files, 'REQUEST', id)
  const canDecide =
    r.status === 'NEW' && auth.user.roleKind !== 'WORKER' && hasPermission(auth, 'requests:approve')
  return {
    ...toListItem(r, attachments.length),
    description: r.description,
    reviewedBy: r.reviewedBy,
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    rejectionReason: r.rejectionReason,
    workOrder: r.convertedWorkOrder,
    attachments,
    can: { convert: canDecide && hasPermission(auth, 'work_orders:create'), reject: canDecide },
  }
}

export async function createRequest(
  auth: AuthContext,
  input: CreateRequestInput,
  req: HttpRequest,
): Promise<RequestDetail> {
  if (!canAccessRestaurant(auth, input.restaurantId)) {
    throw new ValidationError({ restaurantId: ['validation.restaurantOutOfScope'] })
  }
  const asset = input.assetId
    ? await prisma.asset.findFirst({
        where: { id: input.assetId, organizationId: auth.organizationId, archivedAt: null },
        select: { restaurantId: true, locationId: true },
      })
    : null
  if (input.assetId && asset?.restaurantId !== input.restaurantId) {
    throw new ValidationError({ assetId: ['validation.assetNotInRestaurant'] })
  }
  let locationId = input.locationId || asset?.locationId || null
  if (input.locationId) {
    const loc = await prisma.location.findFirst({
      where: { id: input.locationId, archivedAt: null },
      select: { restaurantId: true },
    })
    if (loc?.restaurantId !== input.restaurantId)
      throw new ValidationError({ locationId: ['validation.locationNotInRestaurant'] })
    locationId = input.locationId
  }
  const title = input.title || deriveTitle(input.description)

  const created = await prisma.$transaction(async (tx) => {
    const code = await nextCode(tx, auth.organizationId, 'REQ', 6)
    const r = await tx.request.create({
      data: {
        organizationId: auth.organizationId,
        code,
        restaurantId: input.restaurantId,
        locationId,
        assetId: input.assetId || null,
        category: input.category,
        title,
        description: input.description,
        priority: input.priority,
        requestedById: auth.userId,
      },
    })
    await recordAudit(
      {
        organizationId: auth.organizationId,
        restaurantId: r.restaurantId,
        actorId: auth.userId,
        action: 'request.created',
        entityType: 'REQUEST',
        entityId: r.id,
        newValue: { code, title, priority: r.priority, category: r.category },
      },
      req,
      tx,
    )
    return r
  })

  const reviewers = await usersWithPermission(
    auth.organizationId,
    created.restaurantId,
    'requests:approve',
  )
  const message = {
    organizationId: auth.organizationId,
    title: `${created.code} · ${created.title}`,
    body: created.description.slice(0, 300),
    entityType: 'REQUEST',
    entityId: created.id,
    actionUrl: `/requests?open=${created.id}`,
    priority: created.priority,
  }
  await notify(reviewers, { ...message, type: 'NEW_REQUEST' }, { exclude: auth.userId })
  if (created.priority === 'CRITICAL') {
    await notify(reviewers, { ...message, type: 'CRITICAL_ISSUE' }, { exclude: auth.userId })
  }
  return getRequest(auth, created.id)
}

export async function addRequestPhotos(
  auth: AuthContext,
  id: string,
  files: Express.Multer.File[] | undefined,
  req: HttpRequest,
): Promise<RequestDetail> {
  const r = await load(auth, id)
  // The reporter adds photos while the request is open; reviewers may too.
  if (r.status !== 'NEW' || (r.requestedBy.id !== auth.userId && !isReviewer(auth)))
    throw new ForbiddenError()
  const ids = await saveAttachments(files, { type: 'REQUEST', id }, auth.userId)
  await recordAudit(
    {
      organizationId: auth.organizationId,
      restaurantId: r.restaurant.id,
      actorId: auth.userId,
      action: 'request.photo_added',
      entityType: 'REQUEST',
      entityId: id,
      metadata: { attachmentIds: ids },
    },
    req,
  )
  return getRequest(auth, id)
}

export async function rejectRequest(
  auth: AuthContext,
  id: string,
  input: RejectRequestInput,
  req: HttpRequest,
): Promise<RequestDetail> {
  const r = await load(auth, id)
  if (!(await getRequest(auth, id)).can.reject) throw new ForbiddenError()
  await prisma.$transaction(async (tx) => {
    const done = await tx.request.updateMany({
      where: { id, status: 'NEW' },
      data: {
        status: 'REJECTED',
        rejectionReason: input.reason,
        reviewedById: auth.userId,
        reviewedAt: new Date(),
      },
    })
    if (done.count === 0)
      throw new ConflictError(
        'This request has already been handled.',
        ERROR_CODES.ALREADY_CONVERTED,
      )
    await recordAudit(
      {
        organizationId: auth.organizationId,
        restaurantId: r.restaurant.id,
        actorId: auth.userId,
        action: 'request.rejected',
        entityType: 'REQUEST',
        entityId: id,
        metadata: { reason: input.reason },
      },
      req,
      tx,
    )
  })
  return getRequest(auth, id)
}
