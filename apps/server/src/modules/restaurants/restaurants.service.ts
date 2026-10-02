import type { RestaurantDto, RestaurantInput } from '@maintainx/shared'
import type { Prisma, Restaurant } from '@prisma/client'
import type { Request } from 'express'
import { recordAudit } from '../../core/audit.js'
import { assertRestaurantAccess, restaurantScope } from '../../core/authz.js'
import { NotFoundError, ValidationError } from '../../core/errors.js'
import { prisma } from '../../core/prisma.js'
import type { AuthContext } from '../auth/auth.context.js'

const blank = (v: string) => (v === '' ? null : v)

export function toRestaurantDto(r: Restaurant): RestaurantDto {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    addressLine1: r.addressLine1,
    addressLine2: r.addressLine2,
    city: r.city,
    state: r.state,
    postalCode: r.postalCode,
    phone: r.phone,
    email: r.email,
    opensAt: r.opensAt,
    closesAt: r.closesAt,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  }
}

function toData(input: RestaurantInput) {
  return {
    code: input.code,
    name: input.name,
    addressLine1: blank(input.addressLine1),
    addressLine2: blank(input.addressLine2),
    city: blank(input.city),
    state: blank(input.state),
    postalCode: blank(input.postalCode),
    phone: blank(input.phone),
    email: blank(input.email),
    opensAt: blank(input.opensAt),
    closesAt: blank(input.closesAt),
    status: input.status,
  } satisfies Prisma.RestaurantUncheckedUpdateInput
}

async function assertCodeFree(organizationId: string, code: string, exceptId?: string) {
  const clash = await prisma.restaurant.findFirst({
    where: { organizationId, code, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { id: true },
  })
  if (clash) throw new ValidationError({ code: ['validation.alreadyInUse'] })
}

export async function listRestaurants(
  auth: AuthContext,
  query: { q?: string; status?: 'ACTIVE' | 'INACTIVE' },
): Promise<RestaurantDto[]> {
  const rows = await prisma.restaurant.findMany({
    where: {
      organizationId: auth.organizationId,
      archivedAt: null,
      id: restaurantScope(auth),
      status: query.status,
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { code: { contains: query.q, mode: 'insensitive' } },
              { city: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: { name: 'asc' },
  })
  return rows.map(toRestaurantDto)
}

export async function getRestaurant(auth: AuthContext, id: string): Promise<RestaurantDto> {
  assertRestaurantAccess(auth, id, 'Restaurant')
  const r = await prisma.restaurant.findFirst({
    where: { id, organizationId: auth.organizationId, archivedAt: null },
  })
  if (!r) throw new NotFoundError('Restaurant')
  return toRestaurantDto(r)
}

export async function createRestaurant(
  auth: AuthContext,
  input: RestaurantInput,
  req: Request,
): Promise<RestaurantDto> {
  await assertCodeFree(auth.organizationId, input.code)
  const created = await prisma.$transaction(async (tx) => {
    const r = await tx.restaurant.create({
      data: { organizationId: auth.organizationId, ...toData(input) },
    })
    await recordAudit(
      {
        organizationId: auth.organizationId,
        restaurantId: r.id,
        actorId: auth.userId,
        action: 'restaurant.created',
        entityType: 'RESTAURANT',
        entityId: r.id,
        newValue: toRestaurantDto(r) as unknown as Prisma.InputJsonValue,
      },
      req,
      tx,
    )
    return r
  })
  return toRestaurantDto(created)
}

export async function updateRestaurant(
  auth: AuthContext,
  id: string,
  input: RestaurantInput,
  req: Request,
): Promise<RestaurantDto> {
  const before = await getRestaurant(auth, id)
  await assertCodeFree(auth.organizationId, input.code, id)
  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.restaurant.update({ where: { id }, data: toData(input) })
    await recordAudit(
      {
        organizationId: auth.organizationId,
        restaurantId: id,
        actorId: auth.userId,
        action: 'restaurant.updated',
        entityType: 'RESTAURANT',
        entityId: id,
        oldValue: before as unknown as Prisma.InputJsonValue,
        newValue: toRestaurantDto(r) as unknown as Prisma.InputJsonValue,
      },
      req,
      tx,
    )
    return r
  })
  return toRestaurantDto(updated)
}
