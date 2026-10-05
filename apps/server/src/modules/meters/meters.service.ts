import type {
  AssetMeterDto,
  MeterInput,
  MeterReadingDto,
  MeterReadingInput,
  RootCauseDto,
} from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import type { Request } from 'express'
import { recordAudit } from '../../core/audit.js'
import { hasPermission, restaurantScope } from '../../core/authz.js'
import { runAutomations } from '../../core/automations.js'
import { NotFoundError, ValidationError } from '../../core/errors.js'
import { prisma } from '../../core/prisma.js'
import type { AuthContext } from '../auth/auth.context.js'

/*
 * Meters on an asset (runtime hours, temperature, pressure …) and their
 * readings. Every reading keeps the previous value, so history and
 * threshold rules ("every 500 h", "above 8 °C") can be evaluated exactly.
 */

const person = { select: { id: true, firstName: true, lastName: true } } as const
const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d))
const round3 = (n: number) => Math.round(n * 1000) / 1000

async function loadAsset(auth: AuthContext, assetId: string) {
  const a = await prisma.asset.findFirst({
    where: {
      id: assetId,
      organizationId: auth.organizationId,
      archivedAt: null,
      restaurantId: restaurantScope(auth),
    },
    select: { id: true, name: true, restaurantId: true },
  })
  if (!a) throw new NotFoundError('Asset')
  return a
}

const readingInclude = {
  user: person,
  workOrder: { select: { id: true, code: true } },
} satisfies Prisma.MeterReadingInclude
type ReadingRow = Prisma.MeterReadingGetPayload<{ include: typeof readingInclude }>

const toReading = (r: ReadingRow): MeterReadingDto => {
  const value = Number(r.value)
  const previous = num(r.previousValue)
  return {
    id: r.id,
    value,
    previousValue: previous,
    delta: previous === null ? null : round3(value - previous),
    readAt: r.readAt.toISOString(),
    user: r.user,
    note: r.note,
    workOrder: r.workOrder,
  }
}

export async function listMeters(auth: AuthContext, assetId: string): Promise<AssetMeterDto[]> {
  await loadAsset(auth, assetId)
  const meters = await prisma.assetMeter.findMany({
    where: { assetId, archivedAt: null },
    include: { readings: { include: readingInclude, orderBy: { readAt: 'desc' }, take: 20 } },
    orderBy: { createdAt: 'asc' },
  })
  const can = {
    read: hasPermission(auth, 'meters:create'),
    manage: hasPermission(auth, 'meters:edit'),
  }
  return meters.map((m) => ({
    id: m.id,
    name: m.name,
    type: m.type,
    unit: m.unit,
    currentValue: num(m.currentValue),
    previousValue: num(m.previousValue),
    lastReadingAt: m.lastReadingAt?.toISOString() ?? null,
    readings: m.readings.map(toReading),
    can,
  }))
}

const auditMeter = (
  auth: AuthContext,
  restaurantId: string,
  id: string,
  action: string,
  extra: object = {},
) => ({
  organizationId: auth.organizationId,
  restaurantId,
  actorId: auth.userId,
  action,
  entityType: 'METER' as const,
  entityId: id,
  ...extra,
})

export async function createMeter(
  auth: AuthContext,
  assetId: string,
  input: MeterInput,
  req: Request,
) {
  const a = await loadAsset(auth, assetId)
  const m = await prisma.assetMeter.create({
    data: { ...input, organizationId: auth.organizationId, assetId },
  })
  await recordAudit(
    auditMeter(auth, a.restaurantId, m.id, 'meter.created', {
      newValue: { asset: a.name, ...input },
    }),
    req,
  )
  return listMeters(auth, assetId)
}

async function loadMeter(auth: AuthContext, assetId: string, meterId: string) {
  const a = await loadAsset(auth, assetId)
  const m = await prisma.assetMeter.findFirst({
    where: { id: meterId, assetId, archivedAt: null },
  })
  if (!m) throw new NotFoundError('Meter')
  return { a, m }
}

export async function updateMeter(
  auth: AuthContext,
  assetId: string,
  meterId: string,
  input: MeterInput,
  req: Request,
) {
  const { a, m } = await loadMeter(auth, assetId, meterId)
  await prisma.assetMeter.update({ where: { id: meterId }, data: input })
  await recordAudit(
    auditMeter(auth, a.restaurantId, meterId, 'meter.updated', {
      oldValue: { name: m.name, type: m.type, unit: m.unit },
      newValue: input,
    }),
    req,
  )
  return listMeters(auth, assetId)
}

export async function archiveMeter(
  auth: AuthContext,
  assetId: string,
  meterId: string,
  req: Request,
) {
  const { a, m } = await loadMeter(auth, assetId, meterId)
  await prisma.assetMeter.update({ where: { id: meterId }, data: { archivedAt: new Date() } })
  await recordAudit(
    auditMeter(auth, a.restaurantId, meterId, 'meter.archived', { oldValue: { name: m.name } }),
    req,
  )
  return listMeters(auth, assetId)
}

/** Records a reading, keeps the previous value, and runs meter automations. */
export async function addReading(
  auth: AuthContext,
  assetId: string,
  meterId: string,
  input: MeterReadingInput,
  req: Request,
) {
  const { a, m } = await loadMeter(auth, assetId, meterId)
  const workOrderId = input.workOrderId || null
  if (workOrderId) {
    const ok = await prisma.workOrder.count({
      where: { id: workOrderId, organizationId: auth.organizationId, restaurantId: a.restaurantId },
    })
    if (!ok) throw new ValidationError({ workOrderId: ['validation.invalidValue'] })
  }
  const previous = num(m.currentValue)
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.meterReading.create({
      data: {
        meterId,
        value: input.value,
        previousValue: previous,
        readAt: now,
        userId: auth.userId,
        workOrderId,
        note: input.note || null,
      },
    })
    await tx.assetMeter.update({
      where: { id: meterId },
      data: { currentValue: input.value, previousValue: previous, lastReadingAt: now },
    })
    await recordAudit(
      auditMeter(auth, a.restaurantId, meterId, 'meter.reading', {
        oldValue: { value: previous },
        newValue: { value: input.value },
        metadata: { asset: a.name, meter: m.name, unit: m.unit },
      }),
      req,
      tx,
    )
  })
  await runAutomations('METER_READING', {
    organizationId: auth.organizationId,
    restaurantId: a.restaurantId,
    assetId,
    meter: { id: meterId, name: m.name, unit: m.unit, previous, value: input.value },
    label: `${a.name} · ${m.name}: ${input.value} ${m.unit}`,
  })
  return listMeters(auth, assetId)
}

/** Root cause analyses recorded against this asset's work orders. */
export async function assetRootCauses(auth: AuthContext, assetId: string): Promise<RootCauseDto[]> {
  const a = await loadAsset(auth, assetId)
  const rows = await prisma.rootCauseAnalysis.findMany({
    where: { assetId },
    include: {
      createdBy: person,
      workOrder: { select: { id: true, code: true, title: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  return rows.map((r) => ({
    id: r.id,
    failure: r.failure,
    cause: r.cause,
    rootCause: r.rootCause,
    category: r.category,
    correctiveAction: r.correctiveAction,
    preventiveAction: r.preventiveAction,
    createdBy: r.createdBy,
    updatedAt: r.updatedAt.toISOString(),
    workOrder: r.workOrder,
    asset: { id: a.id, name: a.name },
  }))
}
