import { ERROR_CODES, isLowStock, type InventoryTxnType } from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import { AppError } from './errors.js'
import { notify, usersWithPermission } from './notify.js'
import { prisma } from './prisma.js'

/*
 * Every stock change goes through applyStockChange():
 *  - one atomic UPDATE … WHERE quantity + delta >= 0, so concurrent use can
 *    never take stock below zero;
 *  - one ledger row with the balance after the change, so the ledger always
 *    explains the current quantity.
 */

type Tx = Prisma.TransactionClient

export const round3 = (n: number) => Math.round(n * 1000) / 1000

export interface StockChange {
  organizationId: string
  partId: string
  restaurantId: string
  delta: number
  type: InventoryTxnType
  actorId: string
  unitCost?: number | null
  referenceType?: 'WORK_ORDER' | 'PURCHASE_ORDER' | 'MANUAL'
  referenceId?: string | null
  reason?: string | null
}

export interface StockResult {
  partId: string
  restaurantId: string
  before: number
  after: number
  minStock: number
}

export async function applyStockChange(tx: Tx, c: StockChange): Promise<StockResult> {
  const delta = round3(c.delta)
  const inv = await tx.inventory.upsert({
    where: { partId_restaurantId: { partId: c.partId, restaurantId: c.restaurantId } },
    create: { organizationId: c.organizationId, partId: c.partId, restaurantId: c.restaurantId },
    update: {},
    select: { id: true, minStock: true, part: { select: { minStock: true, unit: true } } },
  })
  const rows = await tx.$queryRaw<Array<{ quantity: Prisma.Decimal }>>`
    UPDATE inventory
       SET quantity = quantity + ${delta}::numeric, updated_at = now()
     WHERE id = ${inv.id}::uuid AND quantity + ${delta}::numeric >= 0
 RETURNING quantity`
  if (rows.length === 0) {
    const current = await tx.inventory.findUniqueOrThrow({
      where: { id: inv.id },
      select: { quantity: true },
    })
    throw new AppError(409, ERROR_CODES.INSUFFICIENT_STOCK, 'Not enough stock for this part.', {
      fieldErrors: { quantity: ['validation.notEnoughStock'] },
      details: { available: Number(current.quantity), unit: inv.part.unit },
    })
  }
  const after = Number(rows[0]!.quantity)
  await tx.inventoryTransaction.create({
    data: {
      organizationId: c.organizationId,
      partId: c.partId,
      restaurantId: c.restaurantId,
      type: c.type,
      quantityDelta: delta,
      balanceAfter: after,
      unitCost: c.unitCost ?? null,
      referenceType: c.referenceType ?? 'MANUAL',
      referenceId: c.referenceId ?? null,
      actorId: c.actorId,
      reason: c.reason ?? null,
    },
  })
  return {
    partId: c.partId,
    restaurantId: c.restaurantId,
    before: round3(after - delta),
    after,
    minStock: Number(inv.minStock ?? inv.part.minStock),
  }
}

/** After commit: tells stock managers when a part has just dropped to its minimum. */
export async function notifyLowStock(
  organizationId: string,
  results: StockResult[],
  actorId: string,
) {
  const crossed = results.filter(
    (r) => !isLowStock(r.before, r.minStock) && isLowStock(r.after, r.minStock),
  )
  for (const r of crossed) {
    const part = await prisma.part.findUnique({
      where: { id: r.partId },
      select: { name: true, partNumber: true, unit: true },
    })
    if (!part) continue
    await notify(
      await usersWithPermission(organizationId, r.restaurantId, 'inventory:edit'),
      {
        organizationId,
        type: 'LOW_STOCK',
        title: `${part.name} (${part.partNumber})`,
        body: `${r.after} ${part.unit} left · minimum ${r.minStock}`,
        entityType: 'PART',
        entityId: r.partId,
        actionUrl: `/inventory/parts/${r.partId}`,
        priority: r.after === 0 ? 'HIGH' : 'MEDIUM',
      },
      { exclude: actorId },
    )
  }
}
