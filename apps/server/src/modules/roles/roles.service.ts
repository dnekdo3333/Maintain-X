import {
  ERROR_CODES,
  LOCKED_SYSTEM_ROLES,
  SUPER_ADMIN_ONLY_RESOURCES,
  SYSTEM_ROLES,
  WORKER_PERMISSION_FLOOR,
  isPermission,
  parsePermission,
  type Permission,
  type RoleDto,
  type RoleInput,
} from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import type { Request } from 'express'
import { recordAudit } from '../../core/audit.js'
import { withinActorPermissions } from '../../core/authz.js'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../core/errors.js'
import { prisma } from '../../core/prisma.js'
import type { AuthContext } from '../auth/auth.context.js'

/** Super Admin (everything), Worker and Requester (fixed, minimal sets) cannot be edited or deleted. */
const LOCKED_ROLES: ReadonlySet<string> = new Set(LOCKED_SYSTEM_ROLES)

const roleWithCounts = {
  rolePermissions: { include: { permission: { select: { key: true } } } },
  _count: { select: { userRoles: { where: { user: { archivedAt: null } } } } },
} satisfies Prisma.RoleInclude

type RoleRow = Prisma.RoleGetPayload<{ include: typeof roleWithCounts }>

export function rolePermissions(role: {
  rolePermissions: Array<{ permission: { key: string } }>
}): Permission[] {
  return role.rolePermissions
    .map((rp) => rp.permission.key)
    .filter(isPermission)
    .sort()
}

function toRoleDto(role: RoleRow): RoleDto {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    kind: role.kind,
    isSystem: role.isSystem,
    systemKey: role.systemKey,
    locked: role.systemKey !== null && LOCKED_ROLES.has(role.systemKey),
    permissions: rolePermissions(role),
    userCount: role._count.userRoles,
  }
}

const lockedError = () =>
  new ForbiddenError('This built-in role can’t be changed.', ERROR_CODES.ROLE_LOCKED)

/**
 * Rules for what a non-Super-Admin role may contain:
 *  - never the Super-Admin-only resources (roles, settings)
 *  - worker-kind roles stay within the worker set (no administration modules)
 */
function validatePermissions(kind: RoleInput['kind'], permissions: Permission[]): void {
  const superOnly = permissions.filter((p) =>
    SUPER_ADMIN_ONLY_RESOURCES.includes(parsePermission(p)!.resource),
  )
  if (superOnly.length > 0)
    throw new ValidationError({ permissions: ['validation.superAdminOnlyPermission'] })
  if (kind === 'WORKER') {
    const floor = new Set<string>(WORKER_PERMISSION_FLOOR)
    if (permissions.some((p) => !floor.has(p))) {
      throw new ValidationError({ permissions: ['validation.workerRolePermission'] })
    }
  }
}

async function assertNameFree(organizationId: string, name: string, exceptId?: string) {
  const clash = await prisma.role.findFirst({
    where: {
      organizationId,
      name: { equals: name, mode: 'insensitive' },
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
    select: { id: true },
  })
  if (clash) throw new ValidationError({ name: ['validation.alreadyInUse'] })
}

async function permissionIds(keys: Permission[]): Promise<string[]> {
  const rows = await prisma.permission.findMany({
    where: { key: { in: keys } },
    select: { id: true },
  })
  return rows.map((r) => r.id)
}

export async function listRoles(auth: AuthContext): Promise<RoleDto[]> {
  const roles = await prisma.role.findMany({
    where: { organizationId: auth.organizationId },
    include: roleWithCounts,
    orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
  })
  return roles.map(toRoleDto)
}

/**
 * Roles the actor may give to other users: never Super Admin unless they are one,
 * and never a role carrying permissions the actor doesn't have themselves.
 */
export async function listAssignableRoles(auth: AuthContext): Promise<RoleDto[]> {
  return (await listRoles(auth)).filter((r) => canGrantRole(auth, r))
}

export function canGrantRole(
  auth: AuthContext,
  role: { systemKey: string | null; permissions: Permission[] },
): boolean {
  if (auth.isSuperAdmin) return true
  if (role.systemKey === SYSTEM_ROLES.SUPER_ADMIN) return false
  return withinActorPermissions(auth, role.permissions)
}

export async function getRole(auth: AuthContext, id: string): Promise<RoleDto> {
  const role = await prisma.role.findFirst({
    where: { id, organizationId: auth.organizationId },
    include: roleWithCounts,
  })
  if (!role) throw new NotFoundError('Role')
  return toRoleDto(role)
}

export async function createRole(
  auth: AuthContext,
  input: RoleInput,
  req: Request,
): Promise<RoleDto> {
  validatePermissions(input.kind, input.permissions)
  await assertNameFree(auth.organizationId, input.name)
  const ids = await permissionIds(input.permissions)

  const id = await prisma.$transaction(async (tx) => {
    const role = await tx.role.create({
      data: {
        organizationId: auth.organizationId,
        name: input.name,
        description: input.description || null,
        kind: input.kind,
        rolePermissions: { create: ids.map((permissionId) => ({ permissionId })) },
      },
    })
    await recordAudit(
      {
        organizationId: auth.organizationId,
        actorId: auth.userId,
        action: 'role.created',
        entityType: 'ROLE',
        entityId: role.id,
        newValue: { name: input.name, kind: input.kind, permissions: input.permissions },
      },
      req,
      tx,
    )
    return role.id
  })
  return getRole(auth, id)
}

export async function updateRole(
  auth: AuthContext,
  id: string,
  input: RoleInput,
  req: Request,
): Promise<RoleDto> {
  const before = await getRole(auth, id)
  if (before.locked) throw lockedError()
  // Built-in roles keep their name and kind; only description and permissions change.
  const name = before.isSystem ? before.name : input.name
  const kind = before.isSystem ? before.kind : input.kind
  validatePermissions(kind, input.permissions)
  if (!before.isSystem) await assertNameFree(auth.organizationId, name, id)
  const ids = await permissionIds(input.permissions)

  const added = input.permissions.filter((p) => !before.permissions.includes(p))
  const removed = before.permissions.filter((p) => !input.permissions.includes(p))

  await prisma.$transaction(async (tx) => {
    await tx.role.update({
      where: { id },
      data: { name, kind, description: input.description || null },
    })
    await tx.rolePermission.deleteMany({ where: { roleId: id } })
    await tx.rolePermission.createMany({
      data: ids.map((permissionId) => ({ roleId: id, permissionId })),
    })
    await recordAudit(
      {
        organizationId: auth.organizationId,
        actorId: auth.userId,
        action: 'role.updated',
        entityType: 'ROLE',
        entityId: id,
        oldValue: {
          name: before.name,
          description: before.description,
          permissions: before.permissions,
        },
        newValue: { name, description: input.description || null, permissions: input.permissions },
        metadata: { added, removed },
      },
      req,
      tx,
    )
  })
  return getRole(auth, id)
}

export async function deleteRole(auth: AuthContext, id: string, req: Request): Promise<void> {
  const role = await getRole(auth, id)
  if (role.isSystem) throw lockedError()
  if (role.userCount > 0) {
    throw new ConflictError('Move its users to another role first.', ERROR_CODES.ROLE_IN_USE, {
      userCount: role.userCount,
    })
  }
  await prisma.$transaction(async (tx) => {
    // Archived users may still reference the role; detach them so history stays intact.
    await tx.userRole.deleteMany({ where: { roleId: id } })
    await tx.role.delete({ where: { id } })
    await recordAudit(
      {
        organizationId: auth.organizationId,
        actorId: auth.userId,
        action: 'role.deleted',
        entityType: 'ROLE',
        entityId: id,
        oldValue: { name: role.name, permissions: role.permissions },
      },
      req,
      tx,
    )
  })
}
