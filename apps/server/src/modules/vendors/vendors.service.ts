import {
  ERROR_CODES,
  type ListVendorsQuery,
  type PagedResponse,
  type VendorDetail,
  type VendorInput,
  type VendorInvoiceDto,
  type VendorInvoiceInput,
  type VendorListItem,
  type VendorOption,
} from '@maintainx/shared'
import type { Prisma } from '@prisma/client'
import type { Request } from 'express'
import { recordAudit } from '../../core/audit.js'
import { canAccessRestaurant, hasPermission, restaurantScope } from '../../core/authz.js'
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors.js'
import { toPagedResponse, toSkipTake } from '../../core/pagination.js'
import { prisma } from '../../core/prisma.js'
import type { AuthContext } from '../auth/auth.context.js'

/*
 * Vendors are organization-wide. A vendor either serves every restaurant (no
 * restaurant links) or a chosen set. Admins see vendors that serve at least
 * one of their restaurants and may only link vendors to their own restaurants.
 */

const OPEN_PO = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED'] as const
const blank = (v: string) => (v === '' ? null : v)

function visibleWhere(auth: AuthContext): Prisma.VendorWhereInput {
  return {
    organizationId: auth.organizationId,
    archivedAt: null,
    ...(auth.isSuperAdmin
      ? {}
      : {
          OR: [
            { vendorRestaurants: { none: {} } },
            { vendorRestaurants: { some: { restaurantId: restaurantScope(auth) } } },
          ],
        }),
  }
}

const include = {
  vendorRestaurants: { include: { restaurant: { select: { id: true, name: true } } } },
  _count: { select: { purchaseOrders: { where: { status: { in: [...OPEN_PO] } } } } },
} satisfies Prisma.VendorInclude

type Row = Prisma.VendorGetPayload<{ include: typeof include }>

const toListItem = (v: Row): VendorListItem => ({
  id: v.id,
  name: v.name,
  contactName: v.contactName,
  phone: v.phone,
  email: v.email,
  city: v.city,
  categories: v.categories,
  restaurants: v.vendorRestaurants
    .map((r) => r.restaurant)
    .sort((a, b) => a.name.localeCompare(b.name)),
  openOrders: v._count.purchaseOrders,
})

export async function listVendors(
  auth: AuthContext,
  q: ListVendorsQuery,
): Promise<PagedResponse<VendorListItem>> {
  const and: Prisma.VendorWhereInput[] = [visibleWhere(auth)]
  if (q.category) and.push({ categories: { has: q.category } })
  if (q.restaurantId)
    and.push({
      OR: [
        { vendorRestaurants: { none: {} } },
        { vendorRestaurants: { some: { restaurantId: q.restaurantId } } },
      ],
    })
  if (q.q)
    and.push({
      OR: [
        { name: { contains: q.q, mode: 'insensitive' } },
        { contactName: { contains: q.q, mode: 'insensitive' } },
        { phone: { contains: q.q } },
        { city: { contains: q.q, mode: 'insensitive' } },
      ],
    })
  const where = { AND: and }
  const sort = q.sort ?? { field: 'name', direction: 'asc' as const }
  const [rows, total] = await Promise.all([
    prisma.vendor.findMany({
      where,
      include,
      orderBy: [{ [sort.field]: sort.direction }, { id: 'asc' }],
      ...toSkipTake(q),
    }),
    prisma.vendor.count({ where }),
  ])
  return toPagedResponse(rows.map(toListItem), q, total)
}

/** Compact list for pickers; `restaurantId` keeps vendors that serve it. */
export async function vendorOptions(
  auth: AuthContext,
  restaurantId?: string,
): Promise<VendorOption[]> {
  return prisma.vendor.findMany({
    where: {
      AND: [
        visibleWhere(auth),
        restaurantId
          ? {
              OR: [
                { vendorRestaurants: { none: {} } },
                { vendorRestaurants: { some: { restaurantId } } },
              ],
            }
          : {},
      ],
    },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
}

async function load(auth: AuthContext, id: string): Promise<Row> {
  const v = await prisma.vendor.findFirst({ where: { AND: [visibleWhere(auth), { id }] }, include })
  if (!v) throw new NotFoundError('Vendor')
  return v
}

/** Invoices limited to restaurants the user can see (unlinked ones are shared). */
const invoiceScope = (auth: AuthContext): Prisma.VendorInvoiceWhereInput =>
  auth.isSuperAdmin ? {} : { OR: [{ restaurantId: null }, { restaurantId: restaurantScope(auth) }] }

/** Admins can manage a vendor only when it isn't shared with restaurants they can't see. */
function canManage(auth: AuthContext, v: Row) {
  if (auth.isSuperAdmin) return true
  return (
    v.vendorRestaurants.length > 0 &&
    v.vendorRestaurants.every((r) => canAccessRestaurant(auth, r.restaurantId))
  )
}

export async function getVendor(auth: AuthContext, id: string): Promise<VendorDetail> {
  const v = await load(auth, id)
  const since = new Date(Date.now() - 365 * 86_400_000)
  const [spend, unpaid, partCount, assetCount] = await Promise.all([
    prisma.vendorInvoice.aggregate({
      where: { vendorId: id, invoiceDate: { gte: since }, ...invoiceScope(auth) },
      _sum: { amount: true },
    }),
    prisma.vendorInvoice.aggregate({
      where: { vendorId: id, paidAt: null, ...invoiceScope(auth) },
      _sum: { amount: true },
    }),
    prisma.part.count({ where: { preferredVendorId: id, archivedAt: null } }),
    prisma.asset.count({
      where: { vendorId: id, archivedAt: null, restaurantId: restaurantScope(auth) },
    }),
  ])
  const manage = canManage(auth, v)
  return {
    ...toListItem(v),
    altPhone: v.altPhone,
    address: v.address,
    taxId: v.taxId,
    notes: v.notes,
    spend12m: Number(spend._sum.amount ?? 0),
    unpaidAmount: Number(unpaid._sum.amount ?? 0),
    partCount,
    assetCount,
    can: {
      edit: manage && hasPermission(auth, 'vendors:edit'),
      delete: manage && hasPermission(auth, 'vendors:delete'),
    },
  }
}

async function validate(auth: AuthContext, input: VendorInput, exceptId?: string) {
  const errors: Record<string, string[]> = {}
  if (!auth.isSuperAdmin) {
    if (input.restaurantIds.length === 0) errors.restaurantIds = ['validation.restaurantRequired']
    else if (input.restaurantIds.some((r) => !canAccessRestaurant(auth, r)))
      errors.restaurantIds = ['validation.restaurantOutOfScope']
  }
  const clash = await prisma.vendor.findFirst({
    where: {
      organizationId: auth.organizationId,
      name: { equals: input.name, mode: 'insensitive' },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  })
  if (clash) errors.name = ['validation.alreadyInUse']
  if (input.restaurantIds.length) {
    const found = await prisma.restaurant.count({
      where: {
        id: { in: input.restaurantIds },
        organizationId: auth.organizationId,
        archivedAt: null,
      },
    })
    if (found !== new Set(input.restaurantIds).size)
      errors.restaurantIds = ['validation.invalidValue']
  }
  if (Object.keys(errors).length) throw new ValidationError(errors)
}

const vendorData = (input: VendorInput) => ({
  name: input.name,
  contactName: blank(input.contactName),
  email: blank(input.email),
  phone: blank(input.phone),
  altPhone: blank(input.altPhone),
  address: blank(input.address),
  city: blank(input.city),
  categories: [...new Set(input.categories)],
  taxId: blank(input.taxId),
  notes: blank(input.notes),
})

const auditVendor = (auth: AuthContext, id: string, action: string, extra: object = {}) => ({
  organizationId: auth.organizationId,
  restaurantId: null,
  actorId: auth.userId,
  action,
  entityType: 'VENDOR' as const,
  entityId: id,
  ...extra,
})

export async function createVendor(auth: AuthContext, input: VendorInput, req: Request) {
  await validate(auth, input)
  const v = await prisma.vendor.create({
    data: {
      ...vendorData(input),
      organizationId: auth.organizationId,
      vendorRestaurants: {
        create: [...new Set(input.restaurantIds)].map((restaurantId) => ({ restaurantId })),
      },
    },
  })
  await recordAudit(auditVendor(auth, v.id, 'vendor.created', { newValue: { name: v.name } }), req)
  return getVendor(auth, v.id)
}

export async function updateVendor(
  auth: AuthContext,
  id: string,
  input: VendorInput,
  req: Request,
) {
  const before = await getVendor(auth, id)
  if (!before.can.edit) throw new NotFoundError('Vendor')
  await validate(auth, input, id)
  await prisma.$transaction(async (tx) => {
    await tx.vendorRestaurant.deleteMany({ where: { vendorId: id } })
    await tx.vendor.update({
      where: { id },
      data: {
        ...vendorData(input),
        vendorRestaurants: {
          create: [...new Set(input.restaurantIds)].map((restaurantId) => ({ restaurantId })),
        },
      },
    })
  })
  await recordAudit(
    auditVendor(auth, id, 'vendor.updated', {
      oldValue: { name: before.name },
      newValue: { name: input.name, restaurants: input.restaurantIds.length },
    }),
    req,
  )
  return getVendor(auth, id)
}

export async function archiveVendor(auth: AuthContext, id: string, req: Request) {
  const v = await getVendor(auth, id)
  if (!v.can.delete) throw new NotFoundError('Vendor')
  if (v.openOrders > 0) {
    throw new ConflictError('This vendor has open purchase orders.', ERROR_CODES.VENDOR_IN_USE)
  }
  await prisma.$transaction([
    prisma.vendor.update({
      where: { id },
      data: { archivedAt: new Date(), name: `${v.name} (archived ${id.slice(0, 8)})` },
    }),
    prisma.part.updateMany({ where: { preferredVendorId: id }, data: { preferredVendorId: null } }),
  ])
  await recordAudit(auditVendor(auth, id, 'vendor.archived', { oldValue: { name: v.name } }), req)
}

// ---------------------------------------------------------------- invoices

const invoiceInclude = {
  restaurant: { select: { id: true, name: true } },
  purchaseOrder: { select: { id: true, code: true } },
} satisfies Prisma.VendorInvoiceInclude

type InvoiceRow = Prisma.VendorInvoiceGetPayload<{ include: typeof invoiceInclude }>

function toInvoice(i: InvoiceRow): VendorInvoiceDto {
  const due = i.dueDate?.toISOString().slice(0, 10) ?? null
  return {
    id: i.id,
    invoiceNumber: i.invoiceNumber,
    amount: Number(i.amount),
    invoiceDate: i.invoiceDate.toISOString().slice(0, 10),
    dueDate: due,
    paidAt: i.paidAt?.toISOString() ?? null,
    overdue: !i.paidAt && due !== null && due < new Date().toISOString().slice(0, 10),
    restaurant: i.restaurant,
    purchaseOrder: i.purchaseOrder,
    notes: i.notes,
  }
}

export async function listInvoices(
  auth: AuthContext,
  vendorId: string,
): Promise<VendorInvoiceDto[]> {
  await load(auth, vendorId)
  const rows = await prisma.vendorInvoice.findMany({
    where: { vendorId, ...invoiceScope(auth) },
    include: invoiceInclude,
    orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }],
    take: 200,
  })
  return rows.map(toInvoice)
}

export async function createInvoice(
  auth: AuthContext,
  vendorId: string,
  input: VendorInvoiceInput,
  req: Request,
): Promise<VendorInvoiceDto> {
  await load(auth, vendorId)
  const errors: Record<string, string[]> = {}
  if (input.restaurantId && !canAccessRestaurant(auth, input.restaurantId))
    errors.restaurantId = ['validation.restaurantOutOfScope']
  if (!input.restaurantId && !auth.isSuperAdmin) errors.restaurantId = ['validation.selectOption']
  if (input.purchaseOrderId) {
    const po = await prisma.purchaseOrder.findFirst({
      where: { id: input.purchaseOrderId, vendorId, organizationId: auth.organizationId },
      select: { restaurantId: true },
    })
    if (!po || (input.restaurantId && po.restaurantId !== input.restaurantId))
      errors.purchaseOrderId = ['validation.invalidValue']
  }
  const dup = await prisma.vendorInvoice.count({
    where: { vendorId, invoiceNumber: { equals: input.invoiceNumber, mode: 'insensitive' } },
  })
  if (dup) errors.invoiceNumber = ['validation.alreadyInUse']
  if (Object.keys(errors).length) throw new ValidationError(errors)

  const inv = await prisma.vendorInvoice.create({
    data: {
      organizationId: auth.organizationId,
      vendorId,
      invoiceNumber: input.invoiceNumber,
      amount: input.amount,
      invoiceDate: new Date(`${input.invoiceDate}T00:00:00Z`),
      dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00Z`) : null,
      restaurantId: blank(input.restaurantId),
      purchaseOrderId: blank(input.purchaseOrderId),
      notes: blank(input.notes),
    },
    include: invoiceInclude,
  })
  await recordAudit(
    auditVendor(auth, vendorId, 'vendor.invoice_added', {
      restaurantId: inv.restaurantId,
      newValue: { invoiceNumber: inv.invoiceNumber, amount: input.amount },
    }),
    req,
  )
  return toInvoice(inv)
}

async function loadInvoice(auth: AuthContext, vendorId: string, invoiceId: string) {
  await load(auth, vendorId)
  const inv = await prisma.vendorInvoice.findFirst({
    where: { id: invoiceId, vendorId, ...invoiceScope(auth) },
  })
  if (!inv) throw new NotFoundError('Invoice')
  return inv
}

export async function setInvoicePaid(
  auth: AuthContext,
  vendorId: string,
  invoiceId: string,
  paid: boolean,
  req: Request,
): Promise<VendorInvoiceDto> {
  const inv = await loadInvoice(auth, vendorId, invoiceId)
  const updated = await prisma.vendorInvoice.update({
    where: { id: inv.id },
    data: { paidAt: paid ? (inv.paidAt ?? new Date()) : null },
    include: invoiceInclude,
  })
  await recordAudit(
    auditVendor(auth, vendorId, paid ? 'vendor.invoice_paid' : 'vendor.invoice_unpaid', {
      restaurantId: inv.restaurantId,
      metadata: { invoiceNumber: inv.invoiceNumber },
    }),
    req,
  )
  return toInvoice(updated)
}

export async function deleteInvoice(
  auth: AuthContext,
  vendorId: string,
  invoiceId: string,
  req: Request,
) {
  const inv = await loadInvoice(auth, vendorId, invoiceId)
  await prisma.vendorInvoice.delete({ where: { id: inv.id } })
  await recordAudit(
    auditVendor(auth, vendorId, 'vendor.invoice_deleted', {
      restaurantId: inv.restaurantId,
      oldValue: { invoiceNumber: inv.invoiceNumber, amount: Number(inv.amount) },
    }),
    req,
  )
}
