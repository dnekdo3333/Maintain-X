import { SYSTEM_ROLES, addDays, nextOccurrence, type RecurrenceRule } from '@maintainx/shared'
import { Prisma, type PmSchedule } from '@prisma/client'
import { copyStepsToWorkOrder } from '../../core/checklist.js'
import { nextCode } from '../../core/counters.js'
import { logger } from '../../core/logger.js'
import { notify, usersWithPermission } from '../../core/notify.js'
import { prisma } from '../../core/prisma.js'
import { dateKeyInZone, startOfDateInZone } from '../../core/time.js'

/*
 * Turns preventive-maintenance schedules into work orders.
 *
 * - A schedule's `nextDueAt` is the due instant of its next occurrence.
 * - Its work order is created `leadTimeDays` before that day starts.
 * - If the server was down and several occurrences were missed, only the most
 *   recent one is created (nobody needs five overdue "clean the filter" jobs).
 * - (pmScheduleId, pmDueDate) is unique, so a race can never double-create.
 */

export const ruleOf = (s: {
  frequency: PmSchedule['frequency']
  startDate: Date
  endDate: Date | null
  intervalDays: number | null
  daysOfWeek: number[]
  dayOfMonth: number | null
}): RecurrenceRule => ({
  frequency: s.frequency,
  startDate: s.startDate.toISOString().slice(0, 10),
  endDate: s.endDate?.toISOString().slice(0, 10) ?? null,
  intervalDays: s.intervalDays,
  daysOfWeek: s.daysOfWeek,
  dayOfMonth: s.dayOfMonth,
})

/** Due instant for a local date: the time of day, or the end of the day when none is set. */
export function dueInstant(timeZone: string, date: string, timeOfDay: string | null): Date {
  const start = startOfDateInZone(timeZone, date)
  const [h, m] = (timeOfDay ?? '23:59').split(':').map(Number) as [number, number]
  return new Date(start.getTime() + (h * 60 + m) * 60_000)
}

/** First due instant on or after `fromDate`, or null when the schedule has ended. */
export function firstDue(
  s: Parameters<typeof ruleOf>[0] & { timeOfDay: string | null },
  timeZone: string,
  fromDate: string,
): Date | null {
  const d = nextOccurrence(ruleOf(s), fromDate)
  return d ? dueInstant(timeZone, d, s.timeOfDay) : null
}

type ScheduleRow = PmSchedule & {
  restaurant: { timezone: string }
  asset: { locationId: string | null; archivedAt: Date | null } | null
}

const actorCache = new Map<string, string>()

/** Generated work orders are "created by" an active Super Admin of the organization. */
async function systemActor(organizationId: string): Promise<string | null> {
  const cached = actorCache.get(organizationId)
  if (cached) return cached
  const u = await prisma.user.findFirst({
    where: {
      organizationId,
      archivedAt: null,
      status: 'ACTIVE',
      userRoles: { some: { role: { systemKey: SYSTEM_ROLES.SUPER_ADMIN } } },
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  if (u) actorCache.set(organizationId, u.id)
  return u?.id ?? null
}

/** Default assignee if they can still do the work there; otherwise the job stays unassigned. */
async function usableAssignee(s: ScheduleRow) {
  if (s.defaultAssigneeUserId) {
    const ok = await prisma.user.count({
      where: {
        id: s.defaultAssigneeUserId,
        archivedAt: null,
        status: 'ACTIVE',
        OR: [
          { userRestaurants: { some: { restaurantId: s.restaurantId } } },
          { userRoles: { some: { role: { systemKey: SYSTEM_ROLES.SUPER_ADMIN } } } },
        ],
      },
    })
    if (ok) return { assignedUserId: s.defaultAssigneeUserId, assignedTeamId: null }
  }
  if (s.defaultAssigneeTeamId) {
    const ok = await prisma.team.count({ where: { id: s.defaultAssigneeTeamId, archivedAt: null } })
    if (ok) return { assignedUserId: null, assignedTeamId: s.defaultAssigneeTeamId }
  }
  return { assignedUserId: null, assignedTeamId: null }
}

/** Creates the work order for one occurrence. Returns null if it already exists. */
async function createOccurrence(s: ScheduleRow, dueDate: string, dueAt: Date) {
  const actor = await systemActor(s.organizationId)
  if (!actor) {
    logger.warn({ scheduleId: s.id }, 'PM: no active Super Admin to own generated work orders')
    return null
  }
  const assignee = await usableAssignee(s)
  const status = assignee.assignedUserId || assignee.assignedTeamId ? 'ASSIGNED' : 'OPEN'
  try {
    return await prisma.$transaction(async (tx) => {
      const code = await nextCode(tx, s.organizationId, 'WO', 6)
      const wo = await tx.workOrder.create({
        data: {
          organizationId: s.organizationId,
          code,
          title: s.name,
          description: s.description,
          type: 'PREVENTIVE',
          category: s.category,
          priority: s.priority,
          status,
          restaurantId: s.restaurantId,
          assetId: s.asset && !s.asset.archivedAt ? s.assetId : null,
          locationId: s.asset && !s.asset.archivedAt ? s.asset.locationId : null,
          dueDate: dueAt,
          estimatedMinutes: s.estimatedMinutes,
          procedureId: s.procedureId,
          pmScheduleId: s.id,
          pmDueDate: new Date(`${dueDate}T00:00:00Z`),
          createdById: actor,
          ...assignee,
        },
      })
      if (s.procedureId) await copyStepsToWorkOrder(tx, s.procedureId, wo.id)
      await tx.workOrderStatusHistory.create({
        data: { workOrderId: wo.id, toStatus: 'OPEN', actorId: null, note: `PM: ${s.name}` },
      })
      if (status === 'ASSIGNED') {
        await tx.workOrderStatusHistory.create({
          data: { workOrderId: wo.id, fromStatus: 'OPEN', toStatus: 'ASSIGNED', actorId: null },
        })
      }
      return { wo, assignee }
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null
    throw err
  }
}

async function notifyGenerated(
  s: ScheduleRow,
  wo: { id: string; code: string; title: string; priority: PmSchedule['priority'] },
  assignee: { assignedUserId: string | null; assignedTeamId: string | null },
) {
  let recipients: string[] = []
  let url = `/w/tasks/${wo.id}`
  if (assignee.assignedUserId) recipients = [assignee.assignedUserId]
  else if (assignee.assignedTeamId) {
    const members = await prisma.teamMember.findMany({
      where: { teamId: assignee.assignedTeamId },
      select: { userId: true },
    })
    recipients = members.map((m) => m.userId)
  } else {
    recipients = await usersWithPermission(s.organizationId, s.restaurantId, 'work_orders:assign')
    url = `/work-orders/${wo.id}`
  }
  await notify(recipients, {
    organizationId: s.organizationId,
    type: 'PM_DUE',
    title: `${wo.code} · ${wo.title}`,
    entityType: 'WORK_ORDER',
    entityId: wo.id,
    actionUrl: url,
    priority: wo.priority,
  })
}

/**
 * Generates the current occurrence of one schedule and moves it to the next.
 * `force` ignores the lead time ("create the next one now").
 */
export async function generateForSchedule(
  s: ScheduleRow,
  now: Date,
  force = false,
): Promise<{ created: number }> {
  let created = 0
  let current = s.nextDueAt
  const tz = s.restaurant.timezone
  for (let guard = 0; guard < 400; guard++) {
    const dueDate = dateKeyInZone(tz, current)
    const generateAt = startOfDateInZone(tz, addDays(dueDate, -s.leadTimeDays))
    if (!force && generateAt > now) break

    const following = firstDue(s, tz, addDays(dueDate, 1))
    // Missed occurrence with a newer one already due: skip it.
    const skip = !force && following !== null && following <= now
    if (!skip) {
      const result = await createOccurrence(s, dueDate, current)
      if (result) {
        created++
        await notifyGenerated(s, result.wo, result.assignee)
      }
    }
    const moved = await prisma.pmSchedule.updateMany({
      where: { id: s.id, nextDueAt: current, active: true },
      data: {
        nextDueAt: following ?? current,
        active: following !== null,
        ...(skip ? {} : { lastGeneratedAt: now }),
      },
    })
    if (moved.count === 0 || following === null) break
    // Forced: stop once one new work order exists (skip occurrences already created).
    if (force && created > 0) break
    current = following
  }
  return { created }
}

const scheduleInclude = {
  restaurant: { select: { timezone: true } },
  asset: { select: { locationId: true, archivedAt: true } },
} satisfies Prisma.PmScheduleInclude

/** One pass over every active schedule whose next work order is due to be created. */
export async function runPmGenerator(now = new Date()): Promise<{ created: number }> {
  // Lead times are at most 30 days, so nothing further out can be due yet.
  const horizon = new Date(now.getTime() + 32 * 86_400_000)
  const schedules = await prisma.pmSchedule.findMany({
    where: { active: true, archivedAt: null, nextDueAt: { lte: horizon } },
    include: scheduleInclude,
    orderBy: { nextDueAt: 'asc' },
  })
  let created = 0
  for (const s of schedules) {
    try {
      created += (await generateForSchedule(s, now)).created
    } catch (err) {
      logger.error({ err, scheduleId: s.id }, 'PM: generation failed for schedule')
    }
  }
  if (created) logger.info({ created }, 'PM: work orders generated')
  return { created }
}

export async function loadScheduleForGeneration(id: string) {
  return prisma.pmSchedule.findUniqueOrThrow({ where: { id }, include: scheduleInclude })
}
