import {
  ERROR_CODES,
  WORK_ORDER_ACTIVE_STATUSES,
  WORK_ORDER_REOPENABLE_STATUSES,
  canTransitionWorkOrder,
  evaluateAnswer,
  type AssignWorkOrderInput,
  type CloseWorkOrderInput,
  type CompleteWorkOrderInput,
  type CreateWorkOrderInput,
  type HoldWorkOrderInput,
  type ListWorkOrdersQuery,
  type MessageInput,
  type PagedResponse,
  type Priority,
  type ReopenWorkOrderInput,
  type StepAnswerInput,
  type UseWorkOrderPartInput,
  type UpdateWorkOrderInput,
  type WorkOrderActions,
  type WorkOrderDetail,
  type WorkOrderListItem,
  type WorkOrderStatus,
} from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import type { Request } from 'express'
import { attachmentsOf, listAttachments, saveAttachments } from '../../core/attachments.js'
import { recordAudit } from '../../core/audit.js'
import {
  assertProcedureUsable,
  checklistInclude,
  copyStepsToWorkOrder,
  createCorrectiveWorkOrder,
  failureDetails,
  toChecklistDto,
  unanswered,
} from '../../core/checklist.js'
import { applyStockChange, notifyLowStock, round3 } from '../../core/stock.js'
import { canAccessRestaurant, hasPermission, restaurantScope } from '../../core/authz.js'
import { nextCode } from '../../core/counters.js'
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../core/errors.js'
import { notify, usersWithPermission } from '../../core/notify.js'
import { toPagedResponse, toSkipTake } from '../../core/pagination.js'
import { prisma } from '../../core/prisma.js'
import type { AuthContext } from '../auth/auth.context.js'
import { changeAssetStatus } from '../assets/assets.service.js'

type Tx = Prisma.TransactionClient

const person = { select: { id: true, firstName: true, lastName: true } } as const

const listInclude = {
  restaurant: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
  asset: { select: { id: true, name: true, assetCode: true, status: true, publicId: true } },
  assignedUser: person,
  assignedTeam: { select: { id: true, name: true } },
} satisfies Prisma.WorkOrderInclude

type ListRow = Prisma.WorkOrderGetPayload<{ include: typeof listInclude }>

const blank = (v: string) => (v === '' ? null : v)

function toListItem(w: ListRow): WorkOrderListItem {
  return {
    id: w.id,
    code: w.code,
    title: w.title,
    type: w.type,
    category: w.category,
    priority: w.priority,
    status: w.status,
    dueDate: w.dueDate?.toISOString() ?? null,
    restaurant: w.restaurant,
    location: w.location,
    asset: w.asset ? { id: w.asset.id, name: w.asset.name, assetCode: w.asset.assetCode } : null,
    assignedUser: w.assignedUser,
    assignedTeam: w.assignedTeam,
    createdAt: w.createdAt.toISOString(),
  }
}

async function myTeamIds(userId: string): Promise<string[]> {
  const rows = await prisma.teamMember.findMany({
    where: { userId, team: { archivedAt: null } },
    select: { teamId: true },
  })
  return rows.map((r) => r.teamId)
}

/**
 * What the user may see: admins see every work order in their restaurants;
 * workers only see work assigned to them or (when unclaimed) to their teams.
 */
async function visibleWhere(auth: AuthContext): Promise<Prisma.WorkOrderWhereInput> {
  const base: Prisma.WorkOrderWhereInput = {
    organizationId: auth.organizationId,
    archivedAt: null,
    restaurantId: restaurantScope(auth),
  }
  if (auth.user.roleKind !== 'WORKER') return base
  const teams = await myTeamIds(auth.userId)
  return {
    ...base,
    OR: [
      { assignedUserId: auth.userId },
      ...(teams.length ? [{ assignedUserId: null, assignedTeamId: { in: teams } }] : []),
    ],
  }
}

async function loadVisible(auth: AuthContext, id: string): Promise<ListRow> {
  const w = await prisma.workOrder.findFirst({
    where: { AND: [await visibleWhere(auth), { id }] },
    include: listInclude,
  })
  if (!w) throw new NotFoundError('Work order')
  return w
}

async function isOwner(
  auth: AuthContext,
  w: { assignedUserId: string | null; assignedTeamId: string | null },
) {
  if (w.assignedUserId === auth.userId) return true
  if (w.assignedUserId === null && w.assignedTeamId)
    return (await myTeamIds(auth.userId)).includes(w.assignedTeamId)
  return false
}

async function computeActions(auth: AuthContext, w: ListRow): Promise<WorkOrderActions> {
  const owner = await isOwner(auth, w)
  const manager = auth.user.roleKind !== 'WORKER' && hasPermission(auth, 'work_orders:edit')
  const doer = owner || manager
  const canAssign = hasPermission(auth, 'work_orders:assign') && auth.user.roleKind !== 'WORKER'
  const approver = hasPermission(auth, 'work_orders:approve') && auth.user.roleKind !== 'WORKER'
  const s = w.status
  return {
    edit: manager && s !== 'CLOSED',
    assign: canAssign && (WORK_ORDER_ACTIVE_STATUSES as readonly string[]).includes(s),
    unassign: canAssign && s === 'ASSIGNED',
    start: doer && s === 'ASSIGNED',
    hold: doer && s === 'IN_PROGRESS',
    resume: doer && s === 'ON_HOLD',
    complete: doer && s === 'IN_PROGRESS',
    close: approver && s === 'REVIEW',
    reopen: approver && (WORK_ORDER_REOPENABLE_STATUSES as readonly string[]).includes(s),
    upload: (doer || hasPermission(auth, 'work_orders:edit')) && s !== 'CLOSED',
    message: s !== 'CLOSED',
    checklist: doer && s === 'IN_PROGRESS',
    // Workers record parts while working; managers can also correct them during review.
    parts:
      hasPermission(auth, 'parts:view') &&
      ((owner && (s === 'IN_PROGRESS' || s === 'ON_HOLD')) ||
        (manager && s !== 'OPEN' && s !== 'CLOSED')),
  }
}

const invalidTransition = () =>
  new ConflictError(
    'That action isn’t available in the current status.',
    ERROR_CODES.INVALID_TRANSITION,
  )

function assertTransition(from: WorkOrderStatus, to: WorkOrderStatus) {
  if (!canTransitionWorkOrder(from, to)) throw invalidTransition()
}

/** Validates restaurant scope, location/asset belong to the restaurant, assignee can work there. */
async function validateRefs(
  auth: AuthContext,
  v: {
    restaurantId: string
    locationId: string | null
    assetId: string | null
    assignedUserId?: string | null
    assignedTeamId?: string | null
  },
) {
  if (!canAccessRestaurant(auth, v.restaurantId)) {
    throw new ValidationError({ restaurantId: ['validation.restaurantOutOfScope'] })
  }
  const errors: Record<string, string[]> = {}
  const [restaurant, location, asset, user, team] = await Promise.all([
    prisma.restaurant.count({
      where: { id: v.restaurantId, organizationId: auth.organizationId, archivedAt: null },
    }),
    v.locationId
      ? prisma.location.findFirst({
          where: { id: v.locationId, archivedAt: null },
          select: { restaurantId: true },
        })
      : null,
    v.assetId
      ? prisma.asset.findFirst({
          where: { id: v.assetId, archivedAt: null },
          select: { restaurantId: true },
        })
      : null,
    v.assignedUserId
      ? prisma.user.findFirst({
          where: {
            id: v.assignedUserId,
            organizationId: auth.organizationId,
            archivedAt: null,
            status: 'ACTIVE',
          },
          select: {
            userRestaurants: { select: { restaurantId: true } },
            userRoles: { select: { role: { select: { systemKey: true } } } },
          },
        })
      : null,
    v.assignedTeamId
      ? prisma.team.findFirst({
          where: { id: v.assignedTeamId, organizationId: auth.organizationId, archivedAt: null },
          select: { restaurantId: true },
        })
      : null,
  ])
  if (!restaurant) errors.restaurantId = ['validation.invalidValue']
  if (v.locationId && location?.restaurantId !== v.restaurantId)
    errors.locationId = ['validation.locationNotInRestaurant']
  if (v.assetId && asset?.restaurantId !== v.restaurantId)
    errors.assetId = ['validation.assetNotInRestaurant']
  if (v.assignedUserId) {
    const works =
      user &&
      (user.userRoles.some((r) => r.role.systemKey === 'SUPER_ADMIN') ||
        user.userRestaurants.some((r) => r.restaurantId === v.restaurantId))
    if (!works) errors.assignedUserId = ['validation.assigneeNotInRestaurant']
  }
  if (
    v.assignedTeamId &&
    (!team || (team.restaurantId !== null && team.restaurantId !== v.restaurantId))
  ) {
    errors.assignedTeamId = ['validation.teamNotInRestaurant']
  }
  if (Object.keys(errors).length) throw new ValidationError(errors)
}

async function writeHistory(
  tx: Tx,
  workOrderId: string,
  from: WorkOrderStatus | null,
  to: WorkOrderStatus,
  actorId: string,
  note?: string | null,
) {
  await tx.workOrderStatusHistory.create({
    data: { workOrderId, fromStatus: from, toStatus: to, actorId, note: note ?? null },
  })
}

async function stopTimer(tx: Tx, workOrderId: string, at: Date) {
  const open = await tx.workOrderTimeEntry.findMany({ where: { workOrderId, endedAt: null } })
  for (const e of open) {
    const minutes = Math.max(0, Math.round((at.getTime() - e.startedAt.getTime()) / 60_000))
    await tx.workOrderTimeEntry.update({ where: { id: e.id }, data: { endedAt: at, minutes } })
  }
}

function audit(
  auth: AuthContext,
  w: { id: string; restaurantId: string },
  action: string,
  extra: Partial<Parameters<typeof recordAudit>[0]> = {},
) {
  return {
    organizationId: auth.organizationId,
    restaurantId: w.restaurantId,
    actorId: auth.userId,
    action,
    entityType: 'WORK_ORDER' as const,
    entityId: w.id,
    ...extra,
  }
}

const woUrl = (id: string, forWorker: boolean) =>
  forWorker ? `/w/tasks/${id}` : `/work-orders/${id}`

async function notifyAssignment(
  auth: AuthContext,
  w: { id: string; code: string; title: string; organizationId: string; priority: Priority },
  userId: string | null,
  teamId: string | null,
) {
  const recipients = new Set<string>()
  if (userId) recipients.add(userId)
  else if (teamId) {
    const members = await prisma.teamMember.findMany({
      where: { teamId },
      select: { userId: true },
    })
    members.forEach((m) => recipients.add(m.userId))
  }
  await notify(
    recipients,
    {
      organizationId: w.organizationId,
      type: 'TASK_ASSIGNED',
      title: `${w.code} · ${w.title}`,
      entityType: 'WORK_ORDER',
      entityId: w.id,
      actionUrl: woUrl(w.id, true),
      priority: w.priority,
    },
    { exclude: auth.userId },
  )
}

// ---------------------------------------------------------------------------

const SORT: Record<string, (d: Prisma.SortOrder) => Prisma.WorkOrderOrderByWithRelationInput> = {
  code: (d) => ({ code: d }),
  dueDate: (d) => ({ dueDate: { sort: d, nulls: 'last' } }),
  priority: (d) => ({ priority: d }),
  createdAt: (d) => ({ createdAt: d }),
  status: (d) => ({ status: d }),
}

export async function listWorkOrders(
  auth: AuthContext,
  q: ListWorkOrdersQuery,
): Promise<PagedResponse<WorkOrderListItem>> {
  if (q.restaurantId && !canAccessRestaurant(auth, q.restaurantId)) return toPagedResponse([], q, 0)
  const and: Prisma.WorkOrderWhereInput[] = [await visibleWhere(auth)]
  if (q.restaurantId) and.push({ restaurantId: q.restaurantId })
  if (q.status) and.push({ status: q.status })
  if (q.priority) and.push({ priority: q.priority })
  if (q.category) and.push({ category: q.category })
  if (q.assetId) and.push({ assetId: q.assetId })
  if (q.assignedUserId) and.push({ assignedUserId: q.assignedUserId })
  const active = { status: { in: [...WORK_ORDER_ACTIVE_STATUSES] } }
  if (q.view === 'active') and.push(active)
  if (q.view === 'overdue') and.push({ ...active, dueDate: { lt: new Date() } })
  if (q.view === 'review') and.push({ status: 'REVIEW' })
  if (q.view === 'unassigned')
    and.push({ status: 'OPEN', assignedUserId: null, assignedTeamId: null })
  if (q.q) {
    and.push({
      OR: [
        { title: { contains: q.q, mode: 'insensitive' } },
        { code: { contains: q.q, mode: 'insensitive' } },
        { asset: { name: { contains: q.q, mode: 'insensitive' } } },
      ],
    })
  }
  const where = { AND: and }
  // Priority enum order is LOW…CRITICAL, so "desc" puts critical first.
  const sort = q.sort ?? { field: 'createdAt', direction: 'desc' as const }
  const [rows, total] = await Promise.all([
    prisma.workOrder.findMany({
      where,
      include: listInclude,
      orderBy: [SORT[sort.field]!(sort.direction), { createdAt: 'desc' }],
      ...toSkipTake(q),
    }),
    prisma.workOrder.count({ where }),
  ])
  return toPagedResponse(rows.map(toListItem), q, total)
}

export async function getWorkOrder(auth: AuthContext, id: string): Promise<WorkOrderDetail> {
  const base = await loadVisible(auth, id)
  const w = await prisma.workOrder.findUniqueOrThrow({
    where: { id },
    include: {
      ...listInclude,
      createdBy: person,
      closedBy: person,
      sourceRequest: { select: { id: true, code: true, description: true, requestedBy: person } },
      messages: {
        where: { deletedAt: null },
        include: { author: person },
        orderBy: { createdAt: 'asc' },
      },
      statusHistory: { include: { actor: person }, orderBy: { createdAt: 'desc' } },
      timeEntries: { select: { startedAt: true, endedAt: true, minutes: true } },
      procedure: { select: { id: true, name: true } },
      pmSchedule: { select: { id: true, name: true } },
      checklistItems: { include: checklistInclude, orderBy: { position: 'asc' } },
      parts: {
        include: { part: { select: { id: true, name: true, partNumber: true, unit: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  const files = await listAttachments([
    { type: 'WORK_ORDER', id },
    ...(w.sourceRequest ? [{ type: 'REQUEST' as const, id: w.sourceRequest.id }] : []),
  ])
  const now = Date.now()
  const minutesWorked = w.timeEntries.reduce(
    (sum, e) =>
      sum + (e.endedAt ? (e.minutes ?? 0) : Math.round((now - e.startedAt.getTime()) / 60_000)),
    0,
  )
  return {
    ...toListItem(w),
    description: w.description,
    estimatedMinutes: w.estimatedMinutes,
    minutesWorked,
    timerRunning: w.timeEntries.some((e) => e.endedAt === null),
    startedAt: w.startedAt?.toISOString() ?? null,
    completedAt: w.completedAt?.toISOString() ?? null,
    closedAt: w.closedAt?.toISOString() ?? null,
    holdReason: w.holdReason,
    completionNotes: w.completionNotes,
    reopenCount: w.reopenCount,
    createdBy: w.createdBy,
    closedBy: w.closedBy,
    asset: w.asset,
    procedure: w.procedure,
    pmSchedule: w.pmSchedule,
    checklist: w.checklistItems.map(toChecklistDto),
    parts: w.parts.map((p) => ({
      id: p.id,
      part: p.part,
      qtyUsed: Number(p.qtyUsed),
      unitCost: p.unitCostSnapshot === null ? null : Number(p.unitCostSnapshot),
    })),
    sourceRequest: w.sourceRequest
      ? { ...w.sourceRequest, attachments: attachmentsOf(files, 'REQUEST', w.sourceRequest.id) }
      : null,
    attachments: attachmentsOf(files, 'WORK_ORDER', id),
    messages: w.messages.map((m) => ({
      id: m.id,
      body: m.body,
      author: m.author,
      createdAt: m.createdAt.toISOString(),
      mine: m.authorId === auth.userId,
    })),
    history: w.statusHistory.map((h) => ({
      id: h.id,
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      actor: h.actor,
      note: h.note,
      createdAt: h.createdAt.toISOString(),
    })),
    actions: await computeActions(auth, base),
  }
}

export async function createWorkOrder(
  auth: AuthContext,
  input: CreateWorkOrderInput,
  req: Request,
): Promise<WorkOrderDetail> {
  const data = {
    title: input.title,
    description: blank(input.description),
    category: input.category,
    priority: input.priority,
    restaurantId: input.restaurantId,
    locationId: blank(input.locationId),
    assetId: blank(input.assetId),
    dueDate: input.dueDate ? new Date(input.dueDate) : null,
    estimatedMinutes: input.estimatedMinutes ?? null,
    assignedUserId: blank(input.assignedUserId),
    assignedTeamId: blank(input.assignedTeamId),
  }
  if ((data.assignedUserId || data.assignedTeamId) && !hasPermission(auth, 'work_orders:assign'))
    throw new ForbiddenError()
  await validateRefs(auth, data)
  const procedureId = input.procedureId || null
  if (procedureId) await assertProcedureUsable(auth, procedureId, data.restaurantId)

  const request = input.requestId
    ? await prisma.request.findFirst({
        where: {
          id: input.requestId,
          organizationId: auth.organizationId,
          restaurantId: restaurantScope(auth),
        },
      })
    : null
  if (input.requestId) {
    if (!request) throw new NotFoundError('Request')
    if (!hasPermission(auth, 'requests:approve')) throw new ForbiddenError()
    if (request.status !== 'NEW') {
      throw new ConflictError(
        'This request has already been handled.',
        ERROR_CODES.ALREADY_CONVERTED,
      )
    }
  }

  const status: WorkOrderStatus = data.assignedUserId || data.assignedTeamId ? 'ASSIGNED' : 'OPEN'
  const wo = await prisma.$transaction(async (tx) => {
    const code = await nextCode(tx, auth.organizationId, 'WO', 6)
    const created = await tx.workOrder.create({
      data: {
        ...data,
        procedureId,
        organizationId: auth.organizationId,
        code,
        status,
        createdById: auth.userId,
      },
    })
    if (procedureId) await copyStepsToWorkOrder(tx, procedureId, created.id)
    await writeHistory(tx, created.id, null, 'OPEN', auth.userId, request ? request.code : null)
    if (status === 'ASSIGNED') await writeHistory(tx, created.id, 'OPEN', 'ASSIGNED', auth.userId)
    if (request) {
      // Guarded update: a concurrent conversion can't create a second work order.
      const done = await tx.request.updateMany({
        where: { id: request.id, status: 'NEW' },
        data: {
          status: 'CONVERTED',
          convertedWorkOrderId: created.id,
          reviewedById: auth.userId,
          reviewedAt: new Date(),
        },
      })
      if (done.count === 0)
        throw new ConflictError(
          'This request has already been handled.',
          ERROR_CODES.ALREADY_CONVERTED,
        )
    }
    await recordAudit(
      audit(auth, created, 'work_order.created', {
        newValue: {
          code,
          title: data.title,
          priority: data.priority,
          status,
          fromRequest: request?.code ?? null,
        },
      }),
      req,
      tx,
    )
    return created
  })

  await notifyAssignment(auth, wo, wo.assignedUserId, wo.assignedTeamId)
  if (wo.priority === 'CRITICAL') {
    await notify(
      await usersWithPermission(auth.organizationId, wo.restaurantId, 'work_orders:assign'),
      {
        organizationId: auth.organizationId,
        type: 'CRITICAL_ISSUE',
        title: `${wo.code} · ${wo.title}`,
        entityType: 'WORK_ORDER',
        entityId: wo.id,
        actionUrl: woUrl(wo.id, false),
        priority: 'CRITICAL',
      },
      { exclude: auth.userId },
    )
  }
  return getWorkOrder(auth, wo.id)
}

export async function updateWorkOrder(
  auth: AuthContext,
  id: string,
  input: UpdateWorkOrderInput,
  req: Request,
): Promise<WorkOrderDetail> {
  const before = await loadVisible(auth, id)
  if (!(await computeActions(auth, before)).edit) throw new ForbiddenError()
  const data = {
    title: input.title,
    description: blank(input.description),
    category: input.category,
    priority: input.priority,
    restaurantId: input.restaurantId,
    locationId: blank(input.locationId),
    assetId: blank(input.assetId),
    dueDate: input.dueDate ? new Date(input.dueDate) : null,
    estimatedMinutes: input.estimatedMinutes ?? null,
  }
  // Moving restaurants would invalidate the assignee; reassign instead.
  if (
    data.restaurantId !== before.restaurantId &&
    (before.assignedUserId || before.assignedTeamId)
  ) {
    throw new ValidationError({ restaurantId: ['validation.unassignBeforeMove'] })
  }
  await validateRefs(auth, data)
  await prisma.$transaction(async (tx) => {
    await tx.workOrder.update({ where: { id }, data })
    await recordAudit(
      audit(auth, { id, restaurantId: data.restaurantId }, 'work_order.updated', {
        oldValue: {
          title: before.title,
          priority: before.priority,
          dueDate: before.dueDate?.toISOString() ?? null,
        },
        newValue: {
          title: data.title,
          priority: data.priority,
          dueDate: data.dueDate?.toISOString() ?? null,
        },
      }),
      req,
      tx,
    )
  })
  return getWorkOrder(auth, id)
}

export async function assignWorkOrder(
  auth: AuthContext,
  id: string,
  input: AssignWorkOrderInput,
  req: Request,
): Promise<WorkOrderDetail> {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).assign) throw new ForbiddenError()
  const assignedUserId = blank(input.assignedUserId)
  const assignedTeamId = blank(input.assignedTeamId)
  await validateRefs(auth, {
    restaurantId: w.restaurantId,
    locationId: null,
    assetId: null,
    assignedUserId,
    assignedTeamId,
  })
  const next: WorkOrderStatus = w.status === 'OPEN' ? 'ASSIGNED' : w.status

  await prisma.$transaction(async (tx) => {
    await tx.workOrder.update({
      where: { id },
      data: { assignedUserId, assignedTeamId, status: next },
    })
    if (next !== w.status) await writeHistory(tx, id, w.status, next, auth.userId)
    await recordAudit(
      audit(auth, w, 'work_order.assigned', {
        oldValue: {
          assignedUserId: w.assignedUser?.id ?? null,
          assignedTeamId: w.assignedTeam?.id ?? null,
        },
        newValue: { assignedUserId, assignedTeamId },
      }),
      req,
      tx,
    )
  })
  await notifyAssignment(
    auth,
    { ...w, organizationId: auth.organizationId },
    assignedUserId,
    assignedTeamId,
  )
  return getWorkOrder(auth, id)
}

export async function unassignWorkOrder(
  auth: AuthContext,
  id: string,
  req: Request,
): Promise<WorkOrderDetail> {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).unassign) throw new ForbiddenError()
  assertTransition(w.status, 'OPEN')
  await prisma.$transaction(async (tx) => {
    await tx.workOrder.update({
      where: { id },
      data: { assignedUserId: null, assignedTeamId: null, status: 'OPEN' },
    })
    await writeHistory(tx, id, w.status, 'OPEN', auth.userId)
    await recordAudit(audit(auth, w, 'work_order.unassigned'), req, tx)
  })
  return getWorkOrder(auth, id)
}

/**
 * Applies a status change with its side effects. The update is guarded on the
 * current status, so two people pressing a button at once can't both win.
 */
async function transition(
  auth: AuthContext,
  w: ListRow,
  to: WorkOrderStatus,
  req: Request,
  opts: {
    data?: Prisma.WorkOrderUncheckedUpdateInput
    note?: string | null
    action: string
    effects?: (tx: Tx, at: Date) => Promise<void>
  },
) {
  assertTransition(w.status, to)
  const at = new Date()
  await prisma.$transaction(async (tx) => {
    const done = await tx.workOrder.updateMany({
      where: { id: w.id, status: w.status },
      data: { status: to, ...opts.data },
    })
    if (done.count === 0) throw invalidTransition()
    await writeHistory(tx, w.id, w.status, to, auth.userId, opts.note)
    await opts.effects?.(tx, at)
    await recordAudit(
      audit(auth, w, opts.action, {
        oldValue: { status: w.status },
        newValue: { status: to },
        metadata: opts.note ? { note: opts.note } : undefined,
      }),
      req,
      tx,
    )
  })
}

export async function startWorkOrder(auth: AuthContext, id: string, req: Request) {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).start) throw new ForbiddenError()
  // A team member who starts an unclaimed team task takes it over.
  const claim =
    w.assignedUserId === null && auth.user.roleKind === 'WORKER'
      ? { assignedUserId: auth.userId }
      : {}
  await transition(auth, w, 'IN_PROGRESS', req, {
    action: 'work_order.started',
    data: {
      ...claim,
      startedAt: w.status === 'ASSIGNED' ? new Date() : undefined,
      holdReason: null,
    },
    effects: async (tx, at) => {
      await tx.workOrderTimeEntry.create({
        data: { workOrderId: id, userId: auth.userId, startedAt: at },
      })
    },
  })
  return getWorkOrder(auth, id)
}

export async function holdWorkOrder(
  auth: AuthContext,
  id: string,
  input: HoldWorkOrderInput,
  req: Request,
) {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).hold) throw new ForbiddenError()
  await transition(auth, w, 'ON_HOLD', req, {
    action: 'work_order.on_hold',
    note: input.reason,
    data: { holdReason: input.reason },
    effects: (tx, at) => stopTimer(tx, id, at),
  })
  return getWorkOrder(auth, id)
}

export async function resumeWorkOrder(auth: AuthContext, id: string, req: Request) {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).resume) throw new ForbiddenError()
  await transition(auth, w, 'IN_PROGRESS', req, {
    action: 'work_order.resumed',
    data: { holdReason: null },
    effects: async (tx, at) => {
      await tx.workOrderTimeEntry.create({
        data: { workOrderId: id, userId: auth.userId, startedAt: at },
      })
    },
  })
  return getWorkOrder(auth, id)
}

/** Worker submits the job: COMPLETED, then straight into REVIEW for an admin. */
export async function completeWorkOrder(
  auth: AuthContext,
  id: string,
  input: CompleteWorkOrderInput,
  req: Request,
) {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).complete) throw new ForbiddenError()
  if (input.assetStatus && !w.asset)
    throw new ValidationError({ assetStatus: ['validation.invalidValue'] })
  const items = await prisma.workOrderChecklistItem.findMany({ where: { workOrderId: id } })
  if (unanswered(items) > 0) {
    throw new AppError(
      409,
      ERROR_CODES.CHECKLIST_INCOMPLETE,
      'Finish all required checklist steps first.',
    )
  }
  const corrective: Array<{ id: string; code: string; title: string }> = []

  await transition(auth, w, 'COMPLETED', req, {
    action: 'work_order.completed',
    note: input.notes,
    data: { completedAt: new Date(), completionNotes: input.notes },
    effects: async (tx, at) => {
      await stopTimer(tx, id, at)
      const entries = await tx.workOrderTimeEntry.findMany({
        where: { workOrderId: id },
        select: { minutes: true },
      })
      await tx.workOrder.update({
        where: { id },
        data: {
          status: 'REVIEW',
          actualMinutes: entries.reduce((s, e) => s + (e.minutes ?? 0), 0),
        },
      })
      await writeHistory(tx, id, 'COMPLETED', 'REVIEW', auth.userId)
      // Every failed step gets its own follow-up job.
      for (const item of items.filter((i) => i.result === 'FAIL' && !i.correctiveWorkOrderId)) {
        const fix = await createCorrectiveWorkOrder(tx, {
          organizationId: auth.organizationId,
          restaurantId: w.restaurantId,
          locationId: w.locationId,
          assetId: w.assetId,
          createdById: auth.userId,
          stepTitle: item.title,
          details: `${failureDetails(item)}
From ${w.code} · ${w.title}`,
          source: w.code,
        })
        await tx.workOrderChecklistItem.update({
          where: { id: item.id },
          data: { correctiveWorkOrderId: fix.id },
        })
        corrective.push(fix)
      }
      if (w.asset) {
        await tx.assetHistory.create({
          data: {
            assetId: w.asset.id,
            eventType: 'WORK_ORDER_COMPLETED',
            workOrderId: id,
            actorId: auth.userId,
            newValue: { code: w.code, title: w.title },
            note: input.notes,
          },
        })
      }
    },
  })

  if (input.assetStatus && w.asset && input.assetStatus !== w.asset.status) {
    await changeAssetStatus(
      auth,
      w.asset.id,
      { status: input.assetStatus, note: `${w.code}: ${input.notes}`.slice(0, 500) },
      req,
      id,
    )
  }
  await notify(
    await usersWithPermission(auth.organizationId, w.restaurantId, 'work_orders:approve'),
    {
      organizationId: auth.organizationId,
      type: 'TASK_COMPLETED',
      title: `${w.code} · ${w.title}`,
      body: input.notes,
      entityType: 'WORK_ORDER',
      entityId: id,
      actionUrl: woUrl(id, false),
    },
    { exclude: auth.userId },
  )
  if (corrective.length > 0) {
    const admins = await usersWithPermission(
      auth.organizationId,
      w.restaurantId,
      'work_orders:assign',
    )
    for (const fix of corrective) {
      await notify(
        admins,
        {
          organizationId: auth.organizationId,
          type: 'INSPECTION_FAILED',
          title: `${fix.code} · ${fix.title}`,
          body: `${w.code} · ${w.title}`,
          entityType: 'WORK_ORDER',
          entityId: fix.id,
          actionUrl: woUrl(fix.id, false),
          priority: 'HIGH',
        },
        { exclude: auth.userId },
      )
    }
  }
  return getWorkOrder(auth, id)
}

export async function closeWorkOrder(
  auth: AuthContext,
  id: string,
  input: CloseWorkOrderInput,
  req: Request,
) {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).close) throw new ForbiddenError()
  await transition(auth, w, 'CLOSED', req, {
    action: 'work_order.closed',
    note: input.note || null,
    data: { closedAt: new Date(), closedById: auth.userId },
  })
  return getWorkOrder(auth, id)
}

export async function reopenWorkOrder(
  auth: AuthContext,
  id: string,
  input: ReopenWorkOrderInput,
  req: Request,
) {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).reopen) throw new ForbiddenError()
  if (!w.assignedUser && !w.assignedTeam) {
    throw new AppError(409, ERROR_CODES.INVALID_TRANSITION, 'Assign someone before reopening.')
  }
  await transition(auth, w, 'ASSIGNED', req, {
    action: 'work_order.reopened',
    note: input.reason,
    data: { reopenCount: { increment: 1 }, completedAt: null, closedAt: null, closedById: null },
  })
  await notifyAssignment(
    auth,
    { ...w, organizationId: auth.organizationId },
    w.assignedUser?.id ?? null,
    w.assignedTeam?.id ?? null,
  )
  return getWorkOrder(auth, id)
}

export async function addMessage(auth: AuthContext, id: string, input: MessageInput, req: Request) {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).message) throw new ForbiddenError()
  await prisma.$transaction(async (tx) => {
    const m = await tx.message.create({
      data: { workOrderId: id, authorId: auth.userId, body: input.body },
    })
    await recordAudit(
      audit(auth, w, 'work_order.message', { metadata: { messageId: m.id } }),
      req,
      tx,
    )
  })
  await notifyMessage(auth, w, input.body)
  return getWorkOrder(auth, id)
}

/**
 * A note from the person doing the job goes to the restaurant's admins; a note
 * from an admin goes to whoever is doing it (or the team, if nobody claimed it).
 */
async function notifyMessage(auth: AuthContext, w: ListRow, body: string) {
  const fromDoer = await isOwner(auth, w)
  let recipients: string[]
  if (fromDoer) {
    recipients = await usersWithPermission(
      auth.organizationId,
      w.restaurantId,
      'work_orders:assign',
    )
  } else if (w.assignedUserId) {
    recipients = [w.assignedUserId]
  } else if (w.assignedTeamId) {
    const members = await prisma.teamMember.findMany({
      where: { teamId: w.assignedTeamId },
      select: { userId: true },
    })
    recipients = members.map((m) => m.userId)
  } else {
    recipients = []
  }
  await notify(
    recipients,
    {
      organizationId: auth.organizationId,
      type: 'NEW_MESSAGE',
      title: `${w.code} · ${auth.user.firstName} ${auth.user.lastName}`,
      body: body.slice(0, 300),
      entityType: 'WORK_ORDER',
      entityId: w.id,
      actionUrl: woUrl(w.id, false),
    },
    { exclude: auth.userId },
  )
}

export async function uploadAttachments(
  auth: AuthContext,
  id: string,
  files: Express.Multer.File[] | undefined,
  req: Request,
) {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).upload) throw new ForbiddenError()
  const ids = await saveAttachments(files, { type: 'WORK_ORDER', id }, auth.userId)
  await recordAudit(
    audit(auth, w, 'work_order.attachment_added', { metadata: { attachmentIds: ids } }),
    req,
  )
  return getWorkOrder(auth, id)
}

/** Records one checklist answer. Numbers are judged against the step's range on the server. */
export async function answerChecklistItem(
  auth: AuthContext,
  id: string,
  itemId: string,
  input: StepAnswerInput,
): Promise<WorkOrderDetail> {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).checklist) throw new ForbiddenError()
  const item = await prisma.workOrderChecklistItem.findFirst({
    where: { id: itemId, workOrderId: id },
  })
  if (!item) throw new NotFoundError('Checklist step')
  const v = evaluateAnswer(
    {
      inputType: item.inputType,
      minValue: item.minValue === null ? null : Number(item.minValue),
      maxValue: item.maxValue === null ? null : Number(item.maxValue),
    },
    input,
  )
  await prisma.workOrderChecklistItem.update({
    where: { id: itemId },
    data: {
      result: v.result,
      numericValue: v.numericValue,
      textValue: v.textValue,
      note: input.note || null,
      completedById: v.result ? auth.userId : null,
      completedAt: v.result ? new Date() : null,
    },
  })
  return getWorkOrder(auth, id)
}

/**
 * Records parts used on the job. Stock at the work order's restaurant goes
 * down straight away; using the same part again adds to the line.
 */
export async function useWorkOrderPart(
  auth: AuthContext,
  id: string,
  input: UseWorkOrderPartInput,
  req: Request,
): Promise<WorkOrderDetail> {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).parts) throw new ForbiddenError()
  const part = await prisma.part.findFirst({
    where: { id: input.partId, organizationId: auth.organizationId, archivedAt: null },
    select: { id: true, unitCost: true, name: true },
  })
  if (!part) throw new ValidationError({ partId: ['validation.invalidValue'] })
  const result = await prisma.$transaction(async (tx) => {
    const line = await tx.workOrderPart.upsert({
      where: { workOrderId_partId: { workOrderId: id, partId: part.id } },
      create: {
        workOrderId: id,
        partId: part.id,
        qtyUsed: input.quantity,
        unitCostSnapshot: part.unitCost,
      },
      update: { qtyUsed: { increment: input.quantity } },
    })
    const stock = await applyStockChange(tx, {
      organizationId: auth.organizationId,
      partId: part.id,
      restaurantId: w.restaurantId,
      delta: -input.quantity,
      type: 'CONSUMPTION',
      unitCost: Number(part.unitCost),
      referenceType: 'WORK_ORDER',
      referenceId: id,
      actorId: auth.userId,
      reason: w.code,
    })
    await recordAudit(
      audit(auth, w, 'work_order.part_used', {
        metadata: { part: part.name, quantity: input.quantity, lineQty: Number(line.qtyUsed) },
      }),
      req,
      tx,
    )
    return stock
  })
  await notifyLowStock(auth.organizationId, [result], auth.userId)
  return getWorkOrder(auth, id)
}

/** Removes a part line and puts the quantity back into stock. */
export async function removeWorkOrderPart(
  auth: AuthContext,
  id: string,
  lineId: string,
  req: Request,
): Promise<WorkOrderDetail> {
  const w = await loadVisible(auth, id)
  if (!(await computeActions(auth, w)).parts) throw new ForbiddenError()
  const line = await prisma.workOrderPart.findFirst({
    where: { id: lineId, workOrderId: id },
    include: { part: { select: { name: true } } },
  })
  if (!line) throw new NotFoundError('Part line')
  await prisma.$transaction(async (tx) => {
    const qtyBack = round3(Number(line.qtyUsed))
    await tx.workOrderPart.delete({ where: { id: lineId } })
    if (qtyBack > 0) {
      await applyStockChange(tx, {
        organizationId: auth.organizationId,
        partId: line.partId,
        restaurantId: w.restaurantId,
        delta: qtyBack,
        type: 'RETURN',
        unitCost: line.unitCostSnapshot === null ? null : Number(line.unitCostSnapshot),
        referenceType: 'WORK_ORDER',
        referenceId: id,
        actorId: auth.userId,
        reason: w.code,
      })
    }
    await recordAudit(
      audit(auth, w, 'work_order.part_returned', {
        metadata: { part: line.part.name, quantity: qtyBack },
      }),
      req,
      tx,
    )
  })
  return getWorkOrder(auth, id)
}
