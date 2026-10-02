import type { ChecklistItemDto, Priority } from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import type { AuthContext } from '../modules/auth/auth.context.js'
import { canAccessRestaurant } from './authz.js'
import { nextCode } from './counters.js'
import { ValidationError } from './errors.js'
import { prisma } from './prisma.js'

/*
 * Procedures are step templates. Work orders and inspections get their own
 * copy of the steps when they are created, so editing a procedure later never
 * changes work that is already under way or on record.
 */

type Tx = Prisma.TransactionClient

const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d))

/** A procedure the user may attach to work in `restaurantId` (global or same restaurant). */
export async function assertProcedureUsable(
  auth: AuthContext,
  procedureId: string,
  restaurantId: string,
  field = 'procedureId',
) {
  const p = await prisma.procedure.findFirst({
    where: { id: procedureId, organizationId: auth.organizationId, archivedAt: null },
    select: { restaurantId: true },
  })
  const ok =
    p &&
    (p.restaurantId === null || p.restaurantId === restaurantId) &&
    canAccessRestaurant(auth, restaurantId)
  if (!ok) throw new ValidationError({ [field]: ['validation.procedureNotAvailable'] })
}

async function procedureSteps(tx: Tx, procedureId: string) {
  return tx.procedureStep.findMany({ where: { procedureId }, orderBy: { position: 'asc' } })
}

const stepCopy = (s: Awaited<ReturnType<typeof procedureSteps>>[number]) => ({
  position: s.position,
  title: s.title,
  instruction: s.instruction,
  inputType: s.inputType,
  unit: s.unit,
  minValue: s.minValue,
  maxValue: s.maxValue,
  required: s.required,
})

export async function copyStepsToWorkOrder(tx: Tx, procedureId: string, workOrderId: string) {
  const steps = await procedureSteps(tx, procedureId)
  if (steps.length === 0) return
  await tx.workOrderChecklistItem.createMany({
    data: steps.map((s) => ({ ...stepCopy(s), workOrderId })),
  })
}

export async function copyStepsToInspection(tx: Tx, procedureId: string, inspectionId: string) {
  const steps = await procedureSteps(tx, procedureId)
  await tx.inspectionItem.createMany({
    data: steps.map((s) => ({ ...stepCopy(s), inspectionId })),
  })
  return steps.length
}

const person = { select: { id: true, firstName: true, lastName: true } } as const

export const checklistInclude = {
  completedBy: person,
  correctiveWorkOrder: { select: { id: true, code: true } },
} satisfies Prisma.WorkOrderChecklistItemInclude

type ItemRow = {
  id: string
  position: number
  title: string
  instruction: string | null
  inputType: ChecklistItemDto['inputType']
  unit: string | null
  minValue: Prisma.Decimal | null
  maxValue: Prisma.Decimal | null
  required: boolean
  result: ChecklistItemDto['result']
  numericValue: Prisma.Decimal | null
  textValue: string | null
  note: string | null
  completedAt: Date | null
  completedBy?: { id: string; firstName: string; lastName: string } | null
  correctiveWorkOrder: { id: string; code: string } | null
}

export function toChecklistDto(i: ItemRow): ChecklistItemDto {
  return {
    id: i.id,
    position: i.position,
    title: i.title,
    instruction: i.instruction,
    inputType: i.inputType,
    unit: i.unit,
    minValue: num(i.minValue),
    maxValue: num(i.maxValue),
    required: i.required,
    result: i.result,
    numericValue: num(i.numericValue),
    textValue: i.textValue,
    note: i.note,
    completedAt: i.completedAt?.toISOString() ?? null,
    completedBy: i.completedBy ?? null,
    correctiveWorkOrder: i.correctiveWorkOrder,
  }
}

/** Steps that still need an answer before the work can be submitted. */
export const unanswered = (items: Array<{ required: boolean; result: string | null }>) =>
  items.filter((i) => i.required && i.result === null).length

/**
 * Opens an unassigned follow-up work order for a failed step. Admins see it in
 * the "Unassigned" view and assign it like any other job.
 */
export async function createCorrectiveWorkOrder(
  tx: Tx,
  v: {
    organizationId: string
    restaurantId: string
    locationId: string | null
    assetId: string | null
    createdById: string
    stepTitle: string
    details: string
    source: string
    priority?: Priority
  },
): Promise<{ id: string; code: string; title: string }> {
  const code = await nextCode(tx, v.organizationId, 'WO', 6)
  const title = `Fix: ${v.stepTitle}`.slice(0, 120)
  const wo = await tx.workOrder.create({
    data: {
      organizationId: v.organizationId,
      code,
      title,
      description: v.details.slice(0, 5000),
      type: 'INSPECTION_FOLLOWUP',
      category: 'OTHER',
      priority: v.priority ?? 'HIGH',
      status: 'OPEN',
      restaurantId: v.restaurantId,
      locationId: v.locationId,
      assetId: v.assetId,
      createdById: v.createdById,
    },
    select: { id: true, code: true, title: true },
  })
  await tx.workOrderStatusHistory.create({
    data: { workOrderId: wo.id, toStatus: 'OPEN', actorId: v.createdById, note: v.source },
  })
  return wo
}

/** Human-readable summary of a failed answer for the corrective work order. */
export function failureDetails(i: {
  title: string
  inputType: string
  numericValue: Prisma.Decimal | number | null
  unit: string | null
  minValue: Prisma.Decimal | number | null
  maxValue: Prisma.Decimal | number | null
  note: string | null
}): string {
  const lines = [`Failed check: ${i.title}`]
  if (i.inputType === 'NUMBER' && i.numericValue !== null) {
    const range = [i.minValue, i.maxValue].map((x) => (x === null ? '–' : Number(x))).join(' to ')
    lines.push(`Reading: ${Number(i.numericValue)}${i.unit ? ` ${i.unit}` : ''} (allowed ${range})`)
  }
  if (i.note) lines.push(`Note: ${i.note}`)
  return lines.join('\n')
}
