import {
  WORK_ORDER_ACTIVE_STATUSES,
  type AssetDetail,
  type AssetInput,
  type AssetListItem,
  type AssetStatusChangeInput,
  type ListAssetsQuery,
  type PagedResponse,
} from '@maintainx/shared'
import type { AssetStatus, Prisma } from '@prisma/client'
import type { Request } from 'express'
import { recordAudit } from '../../core/audit.js'
import { canAccessRestaurant, hasPermission, restaurantScope } from '../../core/authz.js'
import { nextCode } from '../../core/counters.js'
import { NotFoundError, ValidationError } from '../../core/errors.js'
import { generatePublicId } from '../../core/ids.js'
import { toPagedResponse, toSkipTake } from '../../core/pagination.js'
import { prisma } from '../../core/prisma.js'
import type { AuthContext } from '../auth/auth.context.js'

/** An asset in one of these states isn't doing its job: downtime is counted. */
const DOWN_STATUSES: ReadonlySet<AssetStatus> = new Set(['BROKEN', 'UNDER_MAINTENANCE'])
const HISTORY_LIMIT = 50
const DAY = 86_400_000

const listInclude = {
  category: { select: { id: true, name: true } },
  restaurant: { select: { id: true, code: true, name: true } },
  location: { select: { id: true, name: true } },
} satisfies Prisma.AssetInclude

type ListRow = Prisma.AssetGetPayload<{ include: typeof listInclude }>

const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)
const toDate = (v: string) => (v ? new Date(`${v}T00:00:00Z`) : null)
const blank = (v: string) => (v === '' ? null : v)

function toListItem(a: ListRow): AssetListItem {
  return {
    id: a.id,
    publicId: a.publicId,
    assetCode: a.assetCode,
    name: a.name,
    status: a.status,
    category: a.category,
    restaurant: a.restaurant,
    location: a.location,
    manufacturer: a.manufacturer,
    model: a.model,
    serialNumber: a.serialNumber,
    warrantyEnd: dateOnly(a.warrantyEnd),
  }
}

/** Plain field values used for create/update and for history diffs. */
function toData(input: AssetInput) {
  return {
    name: input.name,
    categoryId: input.categoryId,
    restaurantId: input.restaurantId,
    locationId: input.locationId || null,
    manufacturer: blank(input.manufacturer),
    model: blank(input.model),
    serialNumber: blank(input.serialNumber),
    purchaseDate: toDate(input.purchaseDate),
    purchaseCost: input.purchaseCost === '' ? null : input.purchaseCost,
    warrantyStart: toDate(input.warrantyStart),
    warrantyEnd: toDate(input.warrantyEnd),
    notes: blank(input.notes),
    // Omitted = unchanged (older clients don't send it).
    ...(input.vendorId !== undefined ? { vendorId: input.vendorId || null } : {}),
  }
}

type AssetData = ReturnType<typeof toData>

function comparable(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v)
}

/** Validates category, restaurant scope and that the location belongs to the restaurant. */
async function validateRefs(auth: AuthContext, data: AssetData) {
  if (!canAccessRestaurant(auth, data.restaurantId)) {
    throw new ValidationError({ restaurantId: ['validation.restaurantOutOfScope'] })
  }
  const [category, restaurant, location] = await Promise.all([
    prisma.assetCategory.count({
      where: { id: data.categoryId, organizationId: auth.organizationId, archivedAt: null },
    }),
    prisma.restaurant.count({
      where: { id: data.restaurantId, organizationId: auth.organizationId, archivedAt: null },
    }),
    data.locationId
      ? prisma.location.findFirst({
          where: { id: data.locationId, organizationId: auth.organizationId, archivedAt: null },
          select: { restaurantId: true },
        })
      : Promise.resolve(null),
  ])
  const errors: Record<string, string[]> = {}
  if (!category) errors.categoryId = ['validation.selectOption']
  if (!restaurant) errors.restaurantId = ['validation.invalidValue']
  if (data.locationId && location?.restaurantId !== data.restaurantId) {
    errors.locationId = ['validation.locationNotInRestaurant']
  }
  if (data.vendorId) {
    const vendor = await prisma.vendor.count({
      where: { id: data.vendorId, organizationId: auth.organizationId, archivedAt: null },
    })
    if (!vendor) errors.vendorId = ['validation.invalidValue']
  }
  if (Object.keys(errors).length) throw new ValidationError(errors)
}

function scopedWhere(auth: AuthContext): Prisma.AssetWhereInput {
  return {
    organizationId: auth.organizationId,
    archivedAt: null,
    restaurantId: restaurantScope(auth),
  }
}

// ---------------------------------------------------------------------------

const SORT: Record<string, (d: Prisma.SortOrder) => Prisma.AssetOrderByWithRelationInput> = {
  name: (d) => ({ name: d }),
  assetCode: (d) => ({ assetCode: d }),
  warrantyEnd: (d) => ({ warrantyEnd: { sort: d, nulls: 'last' } }),
  createdAt: (d) => ({ createdAt: d }),
}

export async function listAssets(
  auth: AuthContext,
  query: ListAssetsQuery,
): Promise<PagedResponse<AssetListItem>> {
  if (query.restaurantId && !canAccessRestaurant(auth, query.restaurantId))
    return toPagedResponse([], query, 0)
  const where: Prisma.AssetWhereInput = {
    ...scopedWhere(auth),
    ...(query.restaurantId ? { restaurantId: query.restaurantId } : {}),
    locationId: query.locationId,
    categoryId: query.categoryId,
    status: query.status,
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' } },
            { assetCode: { contains: query.q, mode: 'insensitive' } },
            { serialNumber: { contains: query.q, mode: 'insensitive' } },
            { manufacturer: { contains: query.q, mode: 'insensitive' } },
            { model: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  }
  const sort = query.sort ?? { field: 'name', direction: 'asc' as const }
  const [rows, total] = await Promise.all([
    prisma.asset.findMany({
      where,
      include: listInclude,
      orderBy: [SORT[sort.field]!(sort.direction), { id: 'asc' }],
      ...toSkipTake(query),
    }),
    prisma.asset.count({ where }),
  ])
  return toPagedResponse(rows.map(toListItem), query, total)
}

async function buildDetail(auth: AuthContext, where: Prisma.AssetWhereInput): Promise<AssetDetail> {
  const a = await prisma.asset.findFirst({
    where: { ...scopedWhere(auth), ...where },
    include: {
      ...listInclude,
      vendor: { select: { id: true, name: true, phone: true } },
      history: {
        orderBy: { occurredAt: 'desc' },
        take: HISTORY_LIMIT,
        include: { actor: { select: { id: true, firstName: true, lastName: true } } },
      },
      workOrders: {
        where: { archivedAt: null, status: { in: [...WORK_ORDER_ACTIVE_STATUSES] } },
        select: { id: true, code: true, title: true, status: true, priority: true, dueDate: true },
        orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }],
        take: 20,
      },
      downtimes: {
        where: { OR: [{ endedAt: null }, { endedAt: { gte: new Date(Date.now() - 90 * DAY) } }] },
        select: { startedAt: true, endedAt: true },
      },
    },
  })
  if (!a) throw new NotFoundError('Asset')

  const now = Date.now()
  const windowStart = now - 90 * DAY
  const downMs = a.downtimes.reduce((sum, d) => {
    const start = Math.max(d.startedAt.getTime(), windowStart)
    const end = d.endedAt ? d.endedAt.getTime() : now
    return sum + Math.max(0, end - start)
  }, 0)
  const open = a.downtimes.find((d) => d.endedAt === null)

  return {
    ...toListItem(a),
    purchaseDate: dateOnly(a.purchaseDate),
    purchaseCost: a.purchaseCost?.toString() ?? null,
    vendor: a.vendor,
    warrantyStart: dateOnly(a.warrantyStart),
    notes: a.notes,
    createdAt: a.createdAt.toISOString(),
    downtimeHours90d: Math.round((downMs / 3_600_000) * 10) / 10,
    downSince: open?.startedAt.toISOString() ?? null,
    openWorkOrders: a.workOrders.map((w) => ({ ...w, dueDate: w.dueDate?.toISOString() ?? null })),
    history: a.history.map((h) => ({
      id: h.id,
      eventType: h.eventType,
      actor: h.actor,
      oldValue: h.oldValue,
      newValue: h.newValue,
      note: h.note,
      occurredAt: h.occurredAt.toISOString(),
    })),
    can: { edit: hasPermission(auth, 'assets:edit'), delete: hasPermission(auth, 'assets:delete') },
  }
}

export const getAsset = (auth: AuthContext, id: string) => buildDetail(auth, { id })

/** QR landing: out-of-scope or unknown codes look the same (404). */
export const getAssetByPublicId = (auth: AuthContext, publicId: string) =>
  buildDetail(auth, { publicId })

export async function createAsset(
  auth: AuthContext,
  input: AssetInput,
  req: Request,
): Promise<AssetDetail> {
  const data = toData(input)
  await validateRefs(auth, data)

  const id = await prisma.$transaction(async (tx) => {
    const assetCode = await nextCode(tx, auth.organizationId, 'AST', 4)
    const asset = await tx.asset.create({
      data: {
        ...data,
        organizationId: auth.organizationId,
        assetCode,
        publicId: generatePublicId(),
      },
    })
    await tx.assetHistory.create({
      data: {
        assetId: asset.id,
        eventType: 'CREATED',
        actorId: auth.userId,
        newValue: { assetCode, name: data.name },
      },
    })
    await recordAudit(
      {
        organizationId: auth.organizationId,
        restaurantId: data.restaurantId,
        actorId: auth.userId,
        action: 'asset.created',
        entityType: 'ASSET',
        entityId: asset.id,
        newValue: { assetCode, name: data.name },
      },
      req,
      tx,
    )
    return asset.id
  })
  return getAsset(auth, id)
}

export async function updateAsset(
  auth: AuthContext,
  id: string,
  input: AssetInput,
  req: Request,
): Promise<AssetDetail> {
  const before = await prisma.asset.findFirst({
    where: { ...scopedWhere(auth), id },
    include: listInclude,
  })
  if (!before) throw new NotFoundError('Asset')
  const data = toData(input)
  await validateRefs(auth, data)

  const changed: Record<string, { from: string | null; to: string | null }> = {}
  for (const key of Object.keys(data) as Array<keyof AssetData>) {
    const from = comparable(before[key])
    const to = comparable(data[key])
    if (from !== to) changed[key] = { from, to }
  }
  if (Object.keys(changed).length === 0) return getAsset(auth, id)

  const moved = 'restaurantId' in changed || 'locationId' in changed
  const otherChanges = Object.keys(changed).filter(
    (k) => k !== 'restaurantId' && k !== 'locationId',
  )

  await prisma.$transaction(async (tx) => {
    await tx.asset.update({ where: { id }, data })
    if (moved) {
      const [restaurant, location] = await Promise.all([
        tx.restaurant.findUnique({ where: { id: data.restaurantId }, select: { name: true } }),
        data.locationId
          ? tx.location.findUnique({ where: { id: data.locationId }, select: { name: true } })
          : null,
      ])
      await tx.assetHistory.create({
        data: {
          assetId: id,
          eventType: 'MOVED',
          actorId: auth.userId,
          oldValue: { restaurant: before.restaurant.name, location: before.location?.name ?? null },
          newValue: { restaurant: restaurant?.name ?? null, location: location?.name ?? null },
        },
      })
    }
    if (otherChanges.length > 0) {
      await tx.assetHistory.create({
        data: {
          assetId: id,
          eventType: 'UPDATED',
          actorId: auth.userId,
          newValue: { fields: otherChanges },
        },
      })
    }
    await recordAudit(
      {
        organizationId: auth.organizationId,
        restaurantId: data.restaurantId,
        actorId: auth.userId,
        action: 'asset.updated',
        entityType: 'ASSET',
        entityId: id,
        oldValue: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.from])),
        newValue: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.to])),
      },
      req,
      tx,
    )
  })
  return getAsset(auth, id)
}

export async function changeAssetStatus(
  auth: AuthContext,
  id: string,
  input: AssetStatusChangeInput,
  req: Request,
  /** Set when the change comes from a work order (Phase 9). */
  workOrderId?: string,
): Promise<AssetDetail> {
  const before = await prisma.asset.findFirst({ where: { ...scopedWhere(auth), id } })
  if (!before) throw new NotFoundError('Asset')
  if (before.status === input.status) return getAsset(auth, id)

  const now = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.asset.update({ where: { id }, data: { status: input.status } })
    await tx.assetHistory.create({
      data: {
        assetId: id,
        eventType: 'STATUS_CHANGED',
        actorId: auth.userId,
        workOrderId,
        oldValue: { status: before.status },
        newValue: { status: input.status },
        note: input.note || null,
      },
    })
    const wasDown = DOWN_STATUSES.has(before.status)
    const isDown = DOWN_STATUSES.has(input.status)
    if (!wasDown && isDown) {
      await tx.assetDowntime.create({
        data: { assetId: id, workOrderId, startedAt: now, reason: input.note || input.status },
      })
    } else if (wasDown && !isDown) {
      await tx.assetDowntime.updateMany({
        where: { assetId: id, endedAt: null },
        data: { endedAt: now },
      })
    }
    await recordAudit(
      {
        organizationId: auth.organizationId,
        restaurantId: before.restaurantId,
        actorId: auth.userId,
        action: 'asset.status_changed',
        entityType: 'ASSET',
        entityId: id,
        oldValue: { status: before.status },
        newValue: { status: input.status },
        metadata: input.note ? { note: input.note } : undefined,
      },
      req,
      tx,
    )
  })
  return getAsset(auth, id)
}

export async function archiveAsset(auth: AuthContext, id: string, req: Request): Promise<void> {
  const before = await prisma.asset.findFirst({ where: { ...scopedWhere(auth), id } })
  if (!before) throw new NotFoundError('Asset')
  await prisma.$transaction(async (tx) => {
    await tx.asset.update({ where: { id }, data: { archivedAt: new Date() } })
    await tx.assetDowntime.updateMany({
      where: { assetId: id, endedAt: null },
      data: { endedAt: new Date() },
    })
    await recordAudit(
      {
        organizationId: auth.organizationId,
        restaurantId: before.restaurantId,
        actorId: auth.userId,
        action: 'asset.archived',
        entityType: 'ASSET',
        entityId: id,
        oldValue: { assetCode: before.assetCode, name: before.name },
      },
      req,
      tx,
    )
  })
}
