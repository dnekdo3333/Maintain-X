import {
  SYSTEM_ROLES,
  isLocale,
  isPermission,
  type AuthRestaurant,
  type AuthUser,
  type Permission,
} from '@maintainx/shared'
import type { Prisma, User } from '@prisma/client'
import { prisma } from '../../core/prisma.js'

const userWithAccess = {
  userRoles: {
    include: {
      role: {
        include: { rolePermissions: { include: { permission: { select: { key: true } } } } },
      },
    },
  },
  userRestaurants: {
    include: {
      restaurant: { select: { id: true, code: true, name: true, status: true, archivedAt: true } },
    },
  },
} satisfies Prisma.UserInclude

type UserWithAccess = Prisma.UserGetPayload<{ include: typeof userWithAccess }>

export interface LoadedUser {
  record: User
  authUser: AuthUser
}

async function toAuthUser(u: UserWithAccess): Promise<AuthUser> {
  const roles = u.userRoles.map((ur) => ur.role)
  const isSuperAdmin = roles.some((r) => r.systemKey === SYSTEM_ROLES.SUPER_ADMIN)

  const permissions = new Set<Permission>()
  for (const role of roles) {
    for (const rp of role.rolePermissions) {
      if (isPermission(rp.permission.key)) permissions.add(rp.permission.key)
    }
  }

  let restaurants: AuthRestaurant[]
  if (isSuperAdmin) {
    restaurants = await prisma.restaurant.findMany({
      where: { organizationId: u.organizationId, archivedAt: null, status: 'ACTIVE' },
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    })
  } else {
    restaurants = u.userRestaurants
      .map((ur) => ur.restaurant)
      .filter((r) => r.archivedAt === null && r.status === 'ACTIVE')
      .map(({ id, code, name }) => ({ id, code, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  return {
    id: u.id,
    organizationId: u.organizationId,
    email: u.email,
    username: u.username,
    phone: u.phone,
    firstName: u.firstName,
    lastName: u.lastName,
    preferredLocale: isLocale(u.preferredLocale) ? u.preferredLocale : 'en',
    mustChangePassword: u.mustChangePassword,
    roleKind: roles.some((r) => r.kind === 'ADMIN') ? 'ADMIN' : 'WORKER',
    isSuperAdmin,
    roles: roles.map((r) => ({ id: r.id, name: r.name, systemKey: r.systemKey })),
    permissions: [...permissions].sort(),
    restaurants,
  }
}

/** User + roles + permissions + restaurant scope, or null if the user doesn't exist. */
export async function loadUser(userId: string): Promise<LoadedUser | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, include: userWithAccess })
  if (!u) return null
  const { userRoles: _roles, userRestaurants: _restaurants, ...record } = u
  return { record, authUser: await toAuthUser(u) }
}

/** Login lookup. Returns up to 2 matches so ambiguous identifiers can be rejected. */
export function findUsersByIdentifier(field: 'email' | 'username' | 'phone', value: string) {
  return prisma.user.findMany({
    where: { [field]: { equals: value, mode: 'insensitive' }, archivedAt: null },
    take: 2,
  })
}
