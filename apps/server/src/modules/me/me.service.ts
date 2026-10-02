import {
  WORK_ORDER_ACTIVE_STATUSES,
  type PagedResponse,
  type WorkerHome,
  type WorkerRestaurant,
  type WorkerSchedule,
  type WorkerScheduleQuery,
  type WorkerTask,
  type WorkerTasksQuery,
} from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import { toPagedResponse, toSkipTake } from '../../core/pagination.js'
import { prisma } from '../../core/prisma.js'
import { dateKeyInZone, dayRangeInZone, startOfDateInZone } from '../../core/time.js'
import type { AuthContext } from '../auth/auth.context.js'

const DAY = 86_400_000
const NEXT_LIMIT = 5
const DONE_STATUSES = ['COMPLETED', 'REVIEW', 'CLOSED'] as const

const taskSelect = {
  id: true,
  code: true,
  title: true,
  priority: true,
  status: true,
  dueDate: true,
  completedAt: true,
  assignedUserId: true,
  restaurant: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
  asset: { select: { id: true, name: true } },
  assignedTeam: { select: { id: true, name: true } },
} satisfies Prisma.WorkOrderSelect

type TaskRow = Prisma.WorkOrderGetPayload<{ select: typeof taskSelect }>

function toTask(auth: AuthContext, w: TaskRow): WorkerTask {
  return {
    id: w.id,
    code: w.code,
    title: w.title,
    priority: w.priority,
    status: w.status,
    dueDate: w.dueDate?.toISOString() ?? null,
    completedAt: w.completedAt?.toISOString() ?? null,
    restaurant: w.restaurant,
    location: w.location,
    asset: w.asset,
    team: w.assignedUserId === auth.userId ? null : w.assignedTeam,
  }
}

/**
 * "My work": assigned to me, or to a team I'm in — and only in my restaurants
 * (a task left in a restaurant I was removed from no longer shows up).
 */
async function mineWhere(auth: AuthContext): Promise<Prisma.WorkOrderWhereInput> {
  const teams = await prisma.teamMember.findMany({
    where: { userId: auth.userId, team: { archivedAt: null } },
    select: { teamId: true },
  })
  const teamIds = teams.map((t) => t.teamId)
  return {
    organizationId: auth.organizationId,
    archivedAt: null,
    restaurantId: { in: auth.user.restaurants.map((r) => r.id) },
    OR: [
      { assignedUserId: auth.userId },
      ...(teamIds.length ? [{ assignedUserId: null, assignedTeamId: { in: teamIds } }] : []),
    ],
  }
}

async function orgTimeZone(auth: AuthContext): Promise<string> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: auth.organizationId },
    select: { timezone: true },
  })
  return org.timezone
}

const active = { status: { in: [...WORK_ORDER_ACTIVE_STATUSES] } }
const activeOrder: Prisma.WorkOrderOrderByWithRelationInput[] = [
  { dueDate: { sort: 'asc', nulls: 'last' } },
  { createdAt: 'asc' },
]

export async function getHome(auth: AuthContext): Promise<WorkerHome> {
  const [mine, tz] = await Promise.all([mineWhere(auth), orgTimeZone(auth)])
  const now = new Date()
  const today = dayRangeInZone(tz, now)

  const [todayCount, overdue, inProgress, doneThisWeek, next] = await Promise.all([
    prisma.workOrder.count({ where: { AND: [mine, active, { dueDate: { lt: today.end } }] } }),
    prisma.workOrder.count({ where: { AND: [mine, active, { dueDate: { lt: now } }] } }),
    prisma.workOrder.count({ where: { AND: [mine, { status: 'IN_PROGRESS' }] } }),
    prisma.workOrder.count({
      where: { AND: [mine, { completedAt: { gte: new Date(now.getTime() - 7 * DAY) } }] },
    }),
    prisma.workOrder.findMany({
      // In-progress work first: it's what the worker is in the middle of.
      where: { AND: [mine, active] },
      select: taskSelect,
      orderBy: activeOrder,
      take: 50,
    }),
  ])

  const sorted = [...next].sort(
    (a, b) => Number(b.status === 'IN_PROGRESS') - Number(a.status === 'IN_PROGRESS'),
  )
  return {
    counts: { today: todayCount, overdue, inProgress, doneThisWeek },
    next: sorted.slice(0, NEXT_LIMIT).map((w) => toTask(auth, w)),
  }
}

export async function listTasks(
  auth: AuthContext,
  query: WorkerTasksQuery,
): Promise<PagedResponse<WorkerTask>> {
  const [mine, tz] = await Promise.all([mineWhere(auth), orgTimeZone(auth)])
  const now = new Date()
  const today = dayRangeInZone(tz, now)

  let where: Prisma.WorkOrderWhereInput
  let orderBy: Prisma.WorkOrderOrderByWithRelationInput[]
  switch (query.view) {
    case 'today':
      where = { AND: [mine, active, { dueDate: { lt: today.end } }] }
      orderBy = activeOrder
      break
    case 'upcoming':
      where = { AND: [mine, active, { OR: [{ dueDate: { gte: today.end } }, { dueDate: null }] }] }
      orderBy = activeOrder
      break
    case 'done':
      where = {
        AND: [
          mine,
          { status: { in: [...DONE_STATUSES] } },
          { completedAt: { gte: new Date(now.getTime() - 30 * DAY) } },
        ],
      }
      orderBy = [{ completedAt: 'desc' }]
      break
  }

  const [rows, total] = await Promise.all([
    prisma.workOrder.findMany({ where, select: taskSelect, orderBy, ...toSkipTake(query) }),
    prisma.workOrder.count({ where }),
  ])
  return toPagedResponse(
    rows.map((w) => toTask(auth, w)),
    query,
    total,
  )
}

export async function getSchedule(
  auth: AuthContext,
  query: WorkerScheduleQuery,
): Promise<WorkerSchedule> {
  const [mine, tz] = await Promise.all([mineWhere(auth), orgTimeZone(auth)])
  const fromKey = query.from ?? dateKeyInZone(tz, new Date())
  const start = startOfDateInZone(tz, fromKey)
  // Walk day by day (not +24h) so day keys stay right across any DST zone.
  const keys: string[] = []
  for (let i = 0; i < query.days; i++)
    keys.push(dateKeyInZone(tz, new Date(start.getTime() + i * DAY + 12 * 3_600_000)))
  const end = new Date(startOfDateInZone(tz, keys[keys.length - 1]!).getTime() + DAY)

  const rows = await prisma.workOrder.findMany({
    where: {
      AND: [
        mine,
        { dueDate: { gte: start, lt: end } },
        { status: { in: [...WORK_ORDER_ACTIVE_STATUSES, ...DONE_STATUSES] } },
      ],
    },
    select: taskSelect,
    orderBy: [{ dueDate: 'asc' }],
    take: 500,
  })

  const byDay = new Map<string, WorkerTask[]>(keys.map((k) => [k, []]))
  for (const w of rows) byDay.get(dateKeyInZone(tz, w.dueDate!))?.push(toTask(auth, w))
  return { timeZone: tz, days: keys.map((date) => ({ date, tasks: byDay.get(date)! })) }
}

export async function listMyRestaurants(auth: AuthContext): Promise<WorkerRestaurant[]> {
  const mine = await mineWhere(auth)
  const ids = auth.user.restaurants.map((r) => r.id)
  const [restaurants, open] = await Promise.all([
    prisma.restaurant.findMany({
      where: { id: { in: ids }, archivedAt: null },
      select: {
        id: true,
        code: true,
        name: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        phone: true,
        opensAt: true,
        closesAt: true,
      },
      orderBy: { name: 'asc' },
    }),
    prisma.workOrder.groupBy({
      by: ['restaurantId'],
      where: { AND: [mine, active] },
      _count: { _all: true },
    }),
  ])
  const openMap = new Map(open.map((o) => [o.restaurantId, o._count._all]))
  return restaurants.map((r) => ({ ...r, openTasks: openMap.get(r.id) ?? 0 }))
}
