import {
  DOCUMENT_EXPIRING_DAYS,
  WARRANTY_EXPIRING_DAYS,
  WORK_ORDER_ACTIVE_STATUSES,
  type NotificationType,
} from '@maintainx/shared'
import { notify, usersWithPermission } from '../core/notify.js'
import { prisma } from '../core/prisma.js'

/*
 * Time-based alerts. Each alert is sent once per record: before notifying we
 * check whether that record already produced the same type of notification
 * (within `windowDays`), so running the job every hour never repeats itself.
 */

const DAY = 86_400_000

async function alreadySent(
  type: NotificationType,
  entityType: string,
  entityIds: string[],
  sinceDays: number,
  now: Date,
): Promise<Set<string>> {
  if (entityIds.length === 0) return new Set()
  const rows = await prisma.notification.findMany({
    where: {
      type,
      entityType,
      entityId: { in: entityIds },
      createdAt: { gte: new Date(now.getTime() - sinceDays * DAY) },
    },
    select: { entityId: true },
    distinct: ['entityId'],
  })
  return new Set(rows.map((r) => r.entityId!))
}

/** Active work orders past their due date: the assignee (or team) and the admins. */
export async function overdueWorkOrderAlerts(now = new Date()): Promise<number> {
  const rows = await prisma.workOrder.findMany({
    where: {
      archivedAt: null,
      status: { in: [...WORK_ORDER_ACTIVE_STATUSES] },
      dueDate: { lt: now },
    },
    select: {
      id: true,
      code: true,
      title: true,
      organizationId: true,
      restaurantId: true,
      priority: true,
      assignedUserId: true,
      assignedTeamId: true,
    },
    take: 500,
  })
  // A work order is reported overdue once (a long-overdue job doesn't repeat every hour).
  const sent = await alreadySent(
    'TASK_OVERDUE',
    'WORK_ORDER',
    rows.map((r) => r.id),
    365,
    now,
  )
  let count = 0
  for (const w of rows.filter((r) => !sent.has(r.id))) {
    const doers = w.assignedUserId
      ? [w.assignedUserId]
      : w.assignedTeamId
        ? (
            await prisma.teamMember.findMany({
              where: { teamId: w.assignedTeamId },
              select: { userId: true },
            })
          ).map((m) => m.userId)
        : []
    const admins = await usersWithPermission(w.organizationId, w.restaurantId, 'work_orders:assign')
    const base = {
      organizationId: w.organizationId,
      type: 'TASK_OVERDUE' as const,
      title: `${w.code} · ${w.title}`,
      entityType: 'WORK_ORDER',
      entityId: w.id,
      priority: w.priority,
    }
    // Workers get their task link; admins get the admin page.
    await notify(doers, { ...base, actionUrl: `/w/tasks/${w.id}` })
    await notify(
      admins.filter((a) => !doers.includes(a)),
      { ...base, actionUrl: `/work-orders/${w.id}` },
    )
    count++
  }
  return count
}

/** Asset warranties ending within 30 days, once per asset per warranty period. */
export async function warrantyAlerts(now = new Date()): Promise<number> {
  const today = new Date(now.toISOString().slice(0, 10) + 'T00:00:00Z')
  const rows = await prisma.asset.findMany({
    where: {
      archivedAt: null,
      warrantyEnd: { gte: today, lte: new Date(today.getTime() + WARRANTY_EXPIRING_DAYS * DAY) },
    },
    select: {
      id: true,
      name: true,
      assetCode: true,
      organizationId: true,
      restaurantId: true,
      warrantyEnd: true,
    },
    take: 500,
  })
  const sent = await alreadySent(
    'WARRANTY_EXPIRY',
    'ASSET',
    rows.map((r) => r.id),
    WARRANTY_EXPIRING_DAYS + 5,
    now,
  )
  let count = 0
  for (const a of rows.filter((r) => !sent.has(r.id))) {
    await notify(await usersWithPermission(a.organizationId, a.restaurantId, 'assets:edit'), {
      organizationId: a.organizationId,
      type: 'WARRANTY_EXPIRY',
      title: `${a.name} (${a.assetCode})`,
      body: `Warranty ends ${a.warrantyEnd!.toISOString().slice(0, 10)}`,
      entityType: 'ASSET',
      entityId: a.id,
      actionUrl: `/assets/${a.id}`,
    })
    count++
  }
  return count
}

/** Licenses, AMCs, certificates… expiring within 30 days. */
export async function documentExpiryAlerts(now = new Date()): Promise<number> {
  const today = new Date(now.toISOString().slice(0, 10) + 'T00:00:00Z')
  const rows = await prisma.document.findMany({
    where: {
      archivedAt: null,
      expiresAt: { gte: today, lte: new Date(today.getTime() + DOCUMENT_EXPIRING_DAYS * DAY) },
    },
    select: {
      id: true,
      title: true,
      organizationId: true,
      restaurantId: true,
      expiresAt: true,
      ownerType: true,
      ownerId: true,
    },
    take: 500,
  })
  const sent = await alreadySent(
    'DOCUMENT_EXPIRY',
    'DOCUMENT',
    rows.map((r) => r.id),
    DOCUMENT_EXPIRING_DAYS + 5,
    now,
  )
  let count = 0
  for (const d of rows.filter((r) => !sent.has(r.id))) {
    const recipients = d.restaurantId
      ? await usersWithPermission(d.organizationId, d.restaurantId, 'documents:edit')
      : (
          await prisma.user.findMany({
            where: {
              organizationId: d.organizationId,
              archivedAt: null,
              status: 'ACTIVE',
              userRoles: { some: { role: { systemKey: 'SUPER_ADMIN' } } },
            },
            select: { id: true },
          })
        ).map((u) => u.id)
    await notify(recipients, {
      organizationId: d.organizationId,
      type: 'DOCUMENT_EXPIRY',
      title: d.title,
      body: `Expires ${d.expiresAt!.toISOString().slice(0, 10)}`,
      entityType: 'DOCUMENT',
      entityId: d.id,
      actionUrl: `/documents?highlight=${d.id}`,
      priority: 'HIGH',
    })
    count++
  }
  return count
}

export async function runAlerts(now = new Date()) {
  return {
    overdue: await overdueWorkOrderAlerts(now),
    warranty: await warrantyAlerts(now),
    documents: await documentExpiryAlerts(now),
  }
}
