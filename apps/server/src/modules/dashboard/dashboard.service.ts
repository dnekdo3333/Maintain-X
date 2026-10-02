import {
  WORK_ORDER_ACTIVE_STATUSES,
  type DashboardActivity,
  type DashboardSummary,
  type DashboardWorkOrder,
} from '@maintainx/shared'
import { Prisma } from '@prisma/client'
import { canAccessRestaurant, hasPermission } from '../../core/authz.js'
import { prisma } from '../../core/prisma.js'
import { dayRangeInZone } from '../../core/time.js'
import type { AuthContext } from '../auth/auth.context.js'

const LIST_LIMIT = 6
const ACTIVITY_LIMIT = 10
const DAY = 86_400_000

const workOrderSelect = {
  id: true,
  code: true,
  title: true,
  priority: true,
  status: true,
  dueDate: true,
  restaurant: { select: { id: true, name: true } },
  assignedUser: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.WorkOrderSelect

type WorkOrderRow = Prisma.WorkOrderGetPayload<{ select: typeof workOrderSelect }>

function toItem(w: WorkOrderRow): DashboardWorkOrder {
  return {
    id: w.id,
    code: w.code,
    title: w.title,
    priority: w.priority,
    status: w.status,
    dueDate: w.dueDate?.toISOString() ?? null,
    restaurant: w.restaurant,
    assignee: w.assignedUser,
  }
}

/** Restaurant ids the summary covers: the requested one (if in scope) or the whole scope. */
async function resolveRestaurantIds(auth: AuthContext, restaurantId?: string): Promise<string[]> {
  if (restaurantId) return canAccessRestaurant(auth, restaurantId) ? [restaurantId] : []
  return auth.user.restaurants.map((r) => r.id)
}

/** Super Admin / audit viewers see everything; others see operational activity in their restaurants. */
function activityWhere(
  auth: AuthContext,
  restaurantIds: string[],
  oneRestaurant: boolean,
): Prisma.AuditLogWhereInput {
  const base: Prisma.AuditLogWhereInput = {
    organizationId: auth.organizationId,
    entityType: { not: 'AUTH' },
  }
  if (hasPermission(auth, 'audit_logs:view') && !oneRestaurant) return base
  return {
    ...base,
    restaurantId: { in: restaurantIds },
    entityType: { notIn: ['AUTH', 'USER', 'ROLE', 'SETTING'] },
  }
}

export async function getDashboard(
  auth: AuthContext,
  restaurantId?: string,
): Promise<DashboardSummary> {
  const restaurantIds = await resolveRestaurantIds(auth, restaurantId)
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: auth.organizationId },
    select: { timezone: true },
  })
  const now = new Date()
  const today = dayRangeInZone(org.timezone, now)
  const since30 = new Date(now.getTime() - 30 * DAY)

  const scope: Prisma.WorkOrderWhereInput = {
    organizationId: auth.organizationId,
    archivedAt: null,
    restaurantId: { in: restaurantIds },
  }
  const active: Prisma.WorkOrderWhereInput = {
    ...scope,
    status: { in: [...WORK_ORDER_ACTIVE_STATUSES] },
  }
  const overdueWhere: Prisma.WorkOrderWhereInput = { ...active, dueDate: { lt: now } }
  const criticalWhere: Prisma.WorkOrderWhereInput = { ...active, priority: 'CRITICAL' }

  const [
    open,
    overdue,
    inProgress,
    completed30d,
    critical,
    todaysTasks,
    criticalIssues,
    overdueTasks,
    pmRows,
    lowStockRows,
    restaurants,
    openBy,
    overdueBy,
    criticalBy,
    activity,
  ] = await Promise.all([
    prisma.workOrder.count({ where: active }),
    prisma.workOrder.count({ where: overdueWhere }),
    prisma.workOrder.count({ where: { ...scope, status: 'IN_PROGRESS' } }),
    prisma.workOrder.count({ where: { ...scope, completedAt: { gte: since30 } } }),
    prisma.workOrder.count({ where: criticalWhere }),
    prisma.workOrder.findMany({
      where: { ...active, dueDate: { gte: today.start, lt: today.end } },
      select: workOrderSelect,
      orderBy: [{ dueDate: 'asc' }],
      take: LIST_LIMIT,
    }),
    prisma.workOrder.findMany({
      where: criticalWhere,
      select: workOrderSelect,
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
      take: LIST_LIMIT,
    }),
    prisma.workOrder.findMany({
      where: overdueWhere,
      select: workOrderSelect,
      orderBy: { dueDate: 'asc' },
      take: LIST_LIMIT,
    }),
    prisma.workOrder.findMany({
      where: { ...scope, type: 'PREVENTIVE', dueDate: { gte: since30, lt: now } },
      select: { dueDate: true, completedAt: true },
    }),
    restaurantIds.length === 0
      ? Promise.resolve([{ count: 0n }])
      : prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::bigint AS count
          FROM inventory i
          JOIN parts p ON p.id = i.part_id
          WHERE i.organization_id = ${auth.organizationId}::uuid
            AND p.archived_at IS NULL
            AND i.restaurant_id IN (${Prisma.join(restaurantIds.map((id) => Prisma.sql`${id}::uuid`))})
            AND COALESCE(i.min_stock, p.min_stock) > 0
            AND i.quantity <= COALESCE(i.min_stock, p.min_stock)`,
    prisma.restaurant.findMany({
      where: { id: { in: restaurantIds }, archivedAt: null },
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.workOrder.groupBy({ by: ['restaurantId'], where: active, _count: { _all: true } }),
    prisma.workOrder.groupBy({ by: ['restaurantId'], where: overdueWhere, _count: { _all: true } }),
    prisma.workOrder.groupBy({
      by: ['restaurantId'],
      where: criticalWhere,
      _count: { _all: true },
    }),
    prisma.auditLog.findMany({
      where: activityWhere(auth, restaurantIds, !!restaurantId),
      select: {
        id: true,
        action: true,
        entityType: true,
        createdAt: true,
        actor: { select: { id: true, firstName: true, lastName: true } },
        restaurant: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: ACTIVITY_LIMIT,
    }),
  ])

  const pmCompliant = pmRows.filter(
    (r) => r.completedAt && r.dueDate && r.completedAt <= r.dueDate,
  ).length
  const countBy = (rows: Array<{ restaurantId: string; _count: { _all: number } }>) =>
    new Map(rows.map((r) => [r.restaurantId, r._count._all]))
  const openMap = countBy(openBy)
  const overdueMap = countBy(overdueBy)
  const criticalMap = countBy(criticalBy)

  return {
    generatedAt: now.toISOString(),
    counts: {
      restaurants: restaurants.length,
      open,
      overdue,
      inProgress,
      completed30d,
      critical,
      lowStock: Number(lowStockRows[0]?.count ?? 0n),
    },
    pmCompliance: pmRows.length === 0 ? null : Math.round((pmCompliant / pmRows.length) * 100),
    todaysTasks: todaysTasks.map(toItem),
    criticalIssues: criticalIssues.map(toItem),
    overdueTasks: overdueTasks.map(toItem),
    recentActivity: activity.map((a): DashboardActivity => ({
      id: a.id,
      action: a.action,
      entityType: a.entityType,
      actor: a.actor,
      restaurant: a.restaurant,
      createdAt: a.createdAt.toISOString(),
    })),
    restaurants: restaurants.map((r) => ({
      ...r,
      open: openMap.get(r.id) ?? 0,
      overdue: overdueMap.get(r.id) ?? 0,
      critical: criticalMap.get(r.id) ?? 0,
    })),
  }
}
