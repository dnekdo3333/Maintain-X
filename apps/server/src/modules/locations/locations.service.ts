import { ERROR_CODES, type LocationDto, type LocationInput } from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import type { Request } from 'express'
import { recordAudit } from '../../core/audit.js'
import { assertRestaurantAccess, canAccessRestaurant, restaurantScope } from '../../core/authz.js'
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.js'
import { prisma } from '../../core/prisma.js'
import type { AuthContext } from '../auth/auth.context.js'

const withCount = {
  _count: { select: { assets: { where: { archivedAt: null } } } },
} satisfies Prisma.LocationInclude

type Row = Prisma.LocationGetPayload<{ include: typeof withCount }>

function toDto(l: Row): LocationDto {
  return {
    id: l.id,
    restaurantId: l.restaurantId,
    name: l.name,
    type: l.type,
    description: l.description,
    assetCount: l._count.assets,
  }
}

async function load(auth: AuthContext, id: string): Promise<Row> {
  const l = await prisma.location.findFirst({
    where: {
      id,
      organizationId: auth.organizationId,
      archivedAt: null,
      restaurantId: restaurantScope(auth),
    },
    include: withCount,
  })
  if (!l) throw new NotFoundError('Location')
  return l
}

async function assertRestaurant(auth: AuthContext, restaurantId: string) {
  if (!canAccessRestaurant(auth, restaurantId)) {
    throw new ValidationError({ restaurantId: ['validation.restaurantOutOfScope'] })
  }
  const ok = await prisma.restaurant.count({
    where: { id: restaurantId, organizationId: auth.organizationId, archivedAt: null },
  })
  if (!ok) throw new ValidationError({ restaurantId: ['validation.invalidValue'] })
}

export async function listLocations(
  auth: AuthContext,
  restaurantId?: string,
): Promise<LocationDto[]> {
  if (restaurantId && !canAccessRestaurant(auth, restaurantId)) return []
  const rows = await prisma.location.findMany({
    where: {
      organizationId: auth.organizationId,
      archivedAt: null,
      restaurantId: restaurantId ?? restaurantScope(auth),
    },
    include: withCount,
    orderBy: [{ restaurantId: 'asc' }, { name: 'asc' }],
  })
  return rows.map(toDto)
}

export async function createLocation(
  auth: AuthContext,
  input: LocationInput,
  req: Request,
): Promise<LocationDto> {
  await assertRestaurant(auth, input.restaurantId)
  const existing = await prisma.location.findFirst({
    where: { restaurantId: input.restaurantId, name: { equals: input.name, mode: 'insensitive' } },
  })
  if (existing && !existing.archivedAt)
    throw new ValidationError({ name: ['validation.alreadyInUse'] })

  const id = await prisma.$transaction(async (tx) => {
    const data = { name: input.name, type: input.type, description: input.description || null }
    // Re-adding an archived location brings it back instead of failing on the unique name.
    const loc = existing
      ? await tx.location.update({
          where: { id: existing.id },
          data: { ...data, archivedAt: null },
        })
      : await tx.location.create({
          data: { ...data, organizationId: auth.organizationId, restaurantId: input.restaurantId },
        })
    await recordAudit(
      {
        organizationId: auth.organizationId,
        restaurantId: input.restaurantId,
        actorId: auth.userId,
        action: existing ? 'location.restored' : 'location.created',
        entityType: 'LOCATION',
        entityId: loc.id,
        newValue: data,
      },
      req,
      tx,
    )
    return loc.id
  })
  return toDto(await load(auth, id))
}

export async function updateLocation(
  auth: AuthContext,
  id: string,
  input: LocationInput,
  req: Request,
): Promise<LocationDto> {
  const before = await load(auth, id)
  // A location stays in its restaurant; moving would orphan the assets inside it.
  if (input.restaurantId !== before.restaurantId) {
    throw new ValidationError({ restaurantId: ['validation.invalidValue'] })
  }
  const clash = await prisma.location.findFirst({
    where: {
      restaurantId: before.restaurantId,
      name: { equals: input.name, mode: 'insensitive' },
      NOT: { id },
    },
    select: { id: true },
  })
  if (clash) throw new ValidationError({ name: ['validation.alreadyInUse'] })

  await prisma.$transaction(async (tx) => {
    const data = { name: input.name, type: input.type, description: input.description || null }
    await tx.location.update({ where: { id }, data })
    await recordAudit(
      {
        organizationId: auth.organizationId,
        restaurantId: before.restaurantId,
        actorId: auth.userId,
        action: 'location.updated',
        entityType: 'LOCATION',
        entityId: id,
        oldValue: { name: before.name, type: before.type, description: before.description },
        newValue: data,
      },
      req,
      tx,
    )
  })
  return toDto(await load(auth, id))
}

export async function archiveLocation(auth: AuthContext, id: string, req: Request): Promise<void> {
  const before = await load(auth, id)
  assertRestaurantAccess(auth, before.restaurantId, 'Location')
  if (before._count.assets > 0) {
    throw new ConflictError(
      'Move the assets in this location first.',
      ERROR_CODES.LOCATION_IN_USE,
      {
        assetCount: before._count.assets,
      },
    )
  }
  await prisma.$transaction(async (tx) => {
    await tx.location.update({ where: { id }, data: { archivedAt: new Date() } })
    await recordAudit(
      {
        organizationId: auth.organizationId,
        restaurantId: before.restaurantId,
        actorId: auth.userId,
        action: 'location.archived',
        entityType: 'LOCATION',
        entityId: id,
        oldValue: { name: before.name },
      },
      req,
      tx,
    )
  })
}
