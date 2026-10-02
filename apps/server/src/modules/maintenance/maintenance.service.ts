import {
  SYSTEM_ROLES,
  upcomingOccurrences,
  type ListPmQuery,
  type PagedResponse,
  type PmScheduleDetail,
  type PmScheduleInput,
  type PmScheduleListItem,
} from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import type { Request } from 'express'
import { recordAudit } from '../../core/audit.js'
import { canAccessRestaurant, hasPermission, restaurantScope } from '../../core/authz.js'
import { assertProcedureUsable } from '../../core/checklist.js'
import { ForbiddenError, NotFoundError, ValidationError } from '../../core/errors.js'
import { toPagedResponse, toSkipTake } from '../../core/pagination.js'
import { prisma } from '../../core/prisma.js'
import { dateKeyInZone } from '../../core/time.js'
import type { AuthContext } from '../auth/auth.context.js'
import { firstDue, generateForSchedule, loadScheduleForGeneration, ruleOf } from './pm-generator.js'

const person = { select: { id: true, firstName: true, lastName: true } } as const
const COMPLIANCE_DAYS = 90

const include = {
  restaurant: { select: { id: true, name: true, timezone: true } },
  asset: { select: { id: true, name: true, assetCode: true } },
  procedure: { select: { id: true, name: true } },
  defaultAssigneeUser: person,
  defaultAssigneeTeam: { select: { id: true, name: true } },
} satisfies Prisma.PmScheduleInclude

type Row = Prisma.PmScheduleGetPayload<{ include: typeof include }>

const visibleWhere = (auth: AuthContext): Prisma.PmScheduleWhereInput => ({
  organizationId: auth.organizationId,
  archivedAt: null,
  restaurantId: restaurantScope(auth),
})

function toListItem(s: Row, compliance: number | null): PmScheduleListItem {
  return {
    id: s.id,
    name: s.name,
    frequency: s.frequency,
    intervalDays: s.intervalDays,
    daysOfWeek: s.daysOfWeek,
    dayOfMonth: s.dayOfMonth,
    timeOfDay: s.timeOfDay,
    restaurant: { id: s.restaurant.id, name: s.restaurant.name },
    asset: s.asset,
    procedure: s.procedure,
    assignedUser: s.defaultAssigneeUser,
    assignedTeam: s.defaultAssigneeTeam,
    priority: s.priority,
    category: s.category,
    active: s.active,
    nextDueAt: s.active ? s.nextDueAt.toISOString() : null,
    compliance,
  }
}

/** On-time share of each schedule's work orders that fell due in the last 90 days. */
async function complianceFor(ids: string[], now = new Date()): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map()
  const rows = await prisma.workOrder.findMany({
    where: {
      pmScheduleId: { in: ids },
      archivedAt: null,
      dueDate: { gte: new Date(now.getTime() - COMPLIANCE_DAYS * 86_400_000), lte: now },
    },
    select: { pmScheduleId: true, dueDate: true, completedAt: true },
  })
  const tally = new Map<string, { onTime: number; total: number }>()
  for (const r of rows) {
    const t = tally.get(r.pmScheduleId!) ?? { onTime: 0, total: 0 }
    t.total++
    if (r.completedAt && r.dueDate && r.completedAt <= r.dueDate) t.onTime++
    tally.set(r.pmScheduleId!, t)
  }
  return new Map([...tally].map(([id, t]) => [id, Math.round((t.onTime / t.total) * 100)]))
}

export async function listSchedules(
  auth: AuthContext,
  q: ListPmQuery,
): Promise<PagedResponse<PmScheduleListItem>> {
  if (q.restaurantId && !canAccessRestaurant(auth, q.restaurantId)) return toPagedResponse([], q, 0)
  const where: Prisma.PmScheduleWhereInput = {
    AND: [
      visibleWhere(auth),
      q.restaurantId ? { restaurantId: q.restaurantId } : {},
      q.assetId ? { assetId: q.assetId } : {},
      q.frequency ? { frequency: q.frequency } : {},
      q.active ? { active: q.active === 'true' } : {},
      q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {},
    ],
  }
  const sort = q.sort ?? { field: 'nextDueAt', direction: 'asc' as const }
  const [rows, total] = await Promise.all([
    prisma.pmSchedule.findMany({
      where,
      include,
      // Paused schedules sink to the bottom when sorting by due date.
      orderBy: [
        ...(sort.field === 'nextDueAt' ? [{ active: 'desc' as const }] : []),
        { [sort.field]: sort.direction },
        { name: 'asc' },
      ],
      ...toSkipTake(q),
    }),
    prisma.pmSchedule.count({ where }),
  ])
  const compliance = await complianceFor(rows.map((r) => r.id))
  return toPagedResponse(
    rows.map((r) => toListItem(r, compliance.get(r.id) ?? null)),
    q,
    total,
  )
}

async function load(auth: AuthContext, id: string): Promise<Row> {
  const s = await prisma.pmSchedule.findFirst({
    where: { AND: [visibleWhere(auth), { id }] },
    include,
  })
  if (!s) throw new NotFoundError('Schedule')
  return s
}

export async function getSchedule(auth: AuthContext, id: string): Promise<PmScheduleDetail> {
  const s = await load(auth, id)
  const now = new Date()
  const [compliance, recent] = await Promise.all([
    complianceFor([id], now),
    prisma.workOrder.findMany({
      where: { pmScheduleId: id, archivedAt: null },
      orderBy: { dueDate: 'desc' },
      take: 10,
      select: { id: true, code: true, status: true, dueDate: true, completedAt: true },
    }),
  ])
  const tz = s.restaurant.timezone
  const from = s.active ? dateKeyInZone(tz, s.nextDueAt) : dateKeyInZone(tz, now)
  return {
    ...toListItem(s, compliance.get(id) ?? null),
    description: s.description,
    estimatedMinutes: s.estimatedMinutes,
    leadTimeDays: s.leadTimeDays,
    startDate: s.startDate.toISOString().slice(0, 10),
    endDate: s.endDate?.toISOString().slice(0, 10) ?? null,
    lastGeneratedAt: s.lastGeneratedAt?.toISOString() ?? null,
    upcoming: s.active ? upcomingOccurrences(ruleOf(s), from, 5) : [],
    recentWorkOrders: recent.map((w) => ({
      id: w.id,
      code: w.code,
      status: w.status,
      dueDate: w.dueDate?.toISOString() ?? null,
      completedAt: w.completedAt?.toISOString() ?? null,
      onTime:
        w.completedAt && w.dueDate
          ? w.completedAt <= w.dueDate
          : w.dueDate && w.dueDate < now
            ? false
            : null,
    })),
    can: {
      edit: hasPermission(auth, 'maintenance:edit'),
      delete: hasPermission(auth, 'maintenance:delete'),
    },
  }
}

const blank = (v: string) => (v === '' ? null : v)

async function validate(auth: AuthContext, input: PmScheduleInput) {
  if (!canAccessRestaurant(auth, input.restaurantId))
    throw new ValidationError({ restaurantId: ['validation.restaurantOutOfScope'] })
  if ((input.assignedUserId || input.assignedTeamId) && !hasPermission(auth, 'maintenance:assign'))
    throw new ForbiddenError()
  const errors: Record<string, string[]> = {}
  const [restaurant, asset, user, team] = await Promise.all([
    prisma.restaurant.findFirst({
      where: { id: input.restaurantId, organizationId: auth.organizationId, archivedAt: null },
      select: { timezone: true },
    }),
    input.assetId
      ? prisma.asset.findFirst({
          where: { id: input.assetId, archivedAt: null },
          select: { restaurantId: true },
        })
      : null,
    input.assignedUserId
      ? prisma.user.findFirst({
          where: {
            id: input.assignedUserId,
            organizationId: auth.organizationId,
            archivedAt: null,
            status: 'ACTIVE',
            OR: [
              { userRestaurants: { some: { restaurantId: input.restaurantId } } },
              { userRoles: { some: { role: { systemKey: SYSTEM_ROLES.SUPER_ADMIN } } } },
            ],
          },
          select: { id: true },
        })
      : null,
    input.assignedTeamId
      ? prisma.team.findFirst({
          where: {
            id: input.assignedTeamId,
            organizationId: auth.organizationId,
            archivedAt: null,
          },
          select: { restaurantId: true },
        })
      : null,
  ])
  if (!restaurant) errors.restaurantId = ['validation.invalidValue']
  if (input.assetId && asset?.restaurantId !== input.restaurantId)
    errors.assetId = ['validation.assetNotInRestaurant']
  if (input.assignedUserId && !user) errors.assignedUserId = ['validation.assigneeNotInRestaurant']
  if (
    input.assignedTeamId &&
    (!team || (team.restaurantId !== null && team.restaurantId !== input.restaurantId))
  )
    errors.assignedTeamId = ['validation.teamNotInRestaurant']
  if (Object.keys(errors).length) throw new ValidationError(errors)
  if (input.procedureId) await assertProcedureUsable(auth, input.procedureId, input.restaurantId)
  return restaurant!.timezone
}

function toData(input: PmScheduleInput) {
  const f = input.frequency
  return {
    name: input.name,
    description: blank(input.description),
    restaurantId: input.restaurantId,
    assetId: blank(input.assetId),
    frequency: f,
    // Only the fields that matter for this frequency are kept.
    intervalDays: f === 'CUSTOM' ? (input.intervalDays ?? null) : null,
    daysOfWeek: f === 'WEEKLY' ? [...new Set(input.daysOfWeek)].sort() : [],
    dayOfMonth: f === 'MONTHLY' || f === 'QUARTERLY' ? (input.dayOfMonth ?? null) : null,
    timeOfDay: blank(input.timeOfDay),
    procedureId: blank(input.procedureId),
    category: input.category,
    priority: input.priority,
    defaultAssigneeUserId: blank(input.assignedUserId),
    defaultAssigneeTeamId: blank(input.assignedTeamId),
    estimatedMinutes: input.estimatedMinutes ?? null,
    leadTimeDays: input.leadTimeDays,
    startDate: new Date(`${input.startDate}T00:00:00Z`),
    endDate: input.endDate ? new Date(`${input.endDate}T00:00:00Z`) : null,
  }
}

/** Next due instant from today (restaurant time) or the start date, whichever is later. */
function computeNextDue(data: ReturnType<typeof toData>, tz: string) {
  const today = dateKeyInZone(tz, new Date())
  const next = firstDue(data, tz, today)
  if (!next) throw new ValidationError({ endDate: ['validation.scheduleEnded'] })
  return next
}

export async function createSchedule(
  auth: AuthContext,
  input: PmScheduleInput,
  req: Request,
): Promise<PmScheduleDetail> {
  const tz = await validate(auth, input)
  const data = toData(input)
  const nextDueAt = computeNextDue(data, tz)
  const s = await prisma.pmSchedule.create({
    data: { ...data, organizationId: auth.organizationId, nextDueAt },
  })
  await recordAudit(
    {
      organizationId: auth.organizationId,
      restaurantId: s.restaurantId,
      actorId: auth.userId,
      action: 'pm_schedule.created',
      entityType: 'PM_SCHEDULE',
      entityId: s.id,
      newValue: { name: s.name, frequency: s.frequency, nextDueAt },
    },
    req,
  )
  return getSchedule(auth, s.id)
}

export async function updateSchedule(
  auth: AuthContext,
  id: string,
  input: PmScheduleInput,
  req: Request,
): Promise<PmScheduleDetail> {
  const before = await load(auth, id)
  const tz = await validate(auth, input)
  const data = toData(input)
  const nextDueAt = computeNextDue(data, tz)
  await prisma.pmSchedule.update({
    where: { id },
    // Paused stays paused; Resume recalculates from today.
    data: { ...data, nextDueAt },
  })
  await recordAudit(
    {
      organizationId: auth.organizationId,
      restaurantId: data.restaurantId,
      actorId: auth.userId,
      action: 'pm_schedule.updated',
      entityType: 'PM_SCHEDULE',
      entityId: id,
      oldValue: { name: before.name, frequency: before.frequency },
      newValue: { name: data.name, frequency: data.frequency, nextDueAt },
    },
    req,
  )
  return getSchedule(auth, id)
}

export async function setScheduleActive(
  auth: AuthContext,
  id: string,
  active: boolean,
  req: Request,
): Promise<PmScheduleDetail> {
  const s = await load(auth, id)
  // Resuming starts again from today: missed occurrences while paused aren't created.
  const nextDueAt = active
    ? computeNextDue(toData(scheduleAsInput(s)), s.restaurant.timezone)
    : s.nextDueAt
  await prisma.pmSchedule.update({ where: { id }, data: { active, nextDueAt } })
  await recordAudit(
    {
      organizationId: auth.organizationId,
      restaurantId: s.restaurantId,
      actorId: auth.userId,
      action: active ? 'pm_schedule.resumed' : 'pm_schedule.paused',
      entityType: 'PM_SCHEDULE',
      entityId: id,
    },
    req,
  )
  return getSchedule(auth, id)
}

function scheduleAsInput(s: Row): PmScheduleInput {
  return {
    name: s.name,
    description: s.description ?? '',
    restaurantId: s.restaurantId,
    assetId: s.assetId ?? '',
    frequency: s.frequency,
    intervalDays: s.intervalDays ?? undefined,
    daysOfWeek: s.daysOfWeek,
    dayOfMonth: s.dayOfMonth ?? undefined,
    timeOfDay: s.timeOfDay ?? '',
    procedureId: s.procedureId ?? '',
    category: s.category,
    priority: s.priority,
    assignedUserId: s.defaultAssigneeUserId ?? '',
    assignedTeamId: s.defaultAssigneeTeamId ?? '',
    estimatedMinutes: s.estimatedMinutes ?? undefined,
    leadTimeDays: s.leadTimeDays,
    startDate: s.startDate.toISOString().slice(0, 10),
    endDate: s.endDate?.toISOString().slice(0, 10) ?? '',
  }
}

export async function archiveSchedule(auth: AuthContext, id: string, req: Request) {
  const s = await load(auth, id)
  await prisma.pmSchedule.update({ where: { id }, data: { archivedAt: new Date(), active: false } })
  await recordAudit(
    {
      organizationId: auth.organizationId,
      restaurantId: s.restaurantId,
      actorId: auth.userId,
      action: 'pm_schedule.archived',
      entityType: 'PM_SCHEDULE',
      entityId: id,
      oldValue: { name: s.name },
    },
    req,
  )
}

/** "Create the next work order now" — ignores the lead time for the next occurrence. */
export async function generateNow(
  auth: AuthContext,
  id: string,
  req: Request,
): Promise<PmScheduleDetail> {
  const s = await load(auth, id)
  if (!s.active) throw new ValidationError({ active: ['validation.schedulePaused'] })
  const full = await loadScheduleForGeneration(id)
  const { created } = await generateForSchedule(full, new Date(), true)
  await recordAudit(
    {
      organizationId: auth.organizationId,
      restaurantId: s.restaurantId,
      actorId: auth.userId,
      action: 'pm_schedule.generated',
      entityType: 'PM_SCHEDULE',
      entityId: id,
      metadata: { created },
    },
    req,
  )
  return getSchedule(auth, id)
}
