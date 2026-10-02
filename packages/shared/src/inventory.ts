import { z } from 'zod'
import {
  PURCHASE_ORDER_STATUS,
  VENDOR_CATEGORY,
  type InventoryTxnType,
  type PurchaseOrderStatus,
  type VendorCategory,
} from './enums.js'
import { paginationQuerySchema, sortQuerySchema } from './schemas/common.js'
import type { PersonRef } from './work-orders.js'

/*
 * Inventory (parts, per-restaurant stock, ledger), vendors and purchase
 * orders. Money is rupees with 2 decimals; quantities allow 3 decimals
 * (litres, metres). Custom messages are i18n keys.
 */

const optionalText = (max: number) => z.string().trim().max(max)
const optionalUuid = z.uuid().or(z.literal(''))
const optionalDate = z.iso.date().or(z.literal(''))
const money = z.number().min(0).max(1_000_000_000).multipleOf(0.01, 'validation.twoDecimals')
const qty = z.number().max(1_000_000).multipleOf(0.001, 'validation.threeDecimals')

type Ref = { id: string; name: string }

// ---------------------------------------------------------------- parts

export const partSchema = z.object({
  name: z.string().trim().min(2).max(120),
  partNumber: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, 'validation.partNumber'),
  category: optionalText(60),
  unit: z.string().trim().min(1).max(20),
  unitCost: money,
  minStock: qty.min(0),
  preferredVendorId: optionalUuid,
  storageLocation: optionalText(80),
  description: optionalText(2000),
})
export type PartInput = z.infer<typeof partSchema>

export const PART_SORT_FIELDS = ['name', 'partNumber', 'createdAt'] as const
export const listPartsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(200).optional(),
  sort: sortQuerySchema(PART_SORT_FIELDS),
  category: z.string().trim().max(60).optional(),
  /** Show stock for this restaurant (and filter "low" there). */
  restaurantId: z.uuid().optional(),
  low: z.enum(['1']).optional(),
  vendorId: z.uuid().optional(),
})
export type ListPartsQuery = z.infer<typeof listPartsQuerySchema>

export interface StockLevel {
  restaurant: Ref
  quantity: number
  /** Effective minimum (restaurant override or the part default). */
  minStock: number
  minOverride: number | null
  storageLocation: string | null
  low: boolean
}

export interface PartListItem {
  id: string
  name: string
  partNumber: string
  category: string | null
  unit: string
  unitCost: number
  minStock: number
  preferredVendor: Ref | null
  /** Stock across the restaurants the user can see. */
  totalQuantity: number
  /** Restaurants (visible to the user) where it is at or below minimum. */
  lowCount: number
  /** Present when the list is for one restaurant. */
  stock: StockLevel | null
}

export interface StockTransactionDto {
  id: string
  type: InventoryTxnType
  quantityDelta: number
  balanceAfter: number
  unitCost: number | null
  restaurant: Ref
  reference: { type: string; id: string; code: string | null } | null
  actor: PersonRef | null
  reason: string | null
  createdAt: string
}

export interface PartDetail extends PartListItem {
  description: string | null
  storageLocation: string | null
  stockLevels: StockLevel[]
  transactions: StockTransactionDto[]
  can: { edit: boolean; delete: boolean; adjust: boolean }
}

/** Stock movement typed in by a person (deliveries without a PO, counts, write-offs). */
export const stockAdjustmentSchema = z
  .object({
    restaurantId: z.uuid(),
    /** RECEIVE adds, REMOVE takes away, COUNT sets the counted quantity. */
    mode: z.enum(['RECEIVE', 'REMOVE', 'COUNT']),
    quantity: qty.min(0),
    unitCost: money.optional(),
    reason: z.string().trim().min(3).max(300),
  })
  .refine((v) => v.mode === 'COUNT' || v.quantity > 0, {
    message: 'validation.positiveQuantity',
    path: ['quantity'],
  })
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>

export const stockSettingsSchema = z.object({
  restaurantId: z.uuid(),
  /** Empty = use the part's default minimum. */
  minStock: qty.min(0).optional(),
  storageLocation: optionalText(80),
})
export type StockSettingsInput = z.infer<typeof stockSettingsSchema>

/** low: quantity at or below a minimum greater than zero. */
export const isLowStock = (quantity: number, minStock: number) =>
  minStock > 0 && quantity <= minStock

// ---------------------------------------------------------------- parts on work orders

export const useWorkOrderPartSchema = z.object({
  partId: z.uuid(),
  quantity: qty.positive('validation.positiveQuantity'),
})
export type UseWorkOrderPartInput = z.infer<typeof useWorkOrderPartSchema>

export interface WorkOrderPartDto {
  id: string
  part: { id: string; name: string; partNumber: string; unit: string }
  qtyUsed: number
  unitCost: number | null
}

// ---------------------------------------------------------------- vendors

export const vendorSchema = z.object({
  name: z.string().trim().min(2).max(120),
  contactName: optionalText(80),
  email: z.email('validation.invalidEmail').or(z.literal('')),
  phone: optionalText(20),
  altPhone: optionalText(20),
  address: optionalText(300),
  city: optionalText(80),
  categories: z.array(z.enum(VENDOR_CATEGORY)).max(VENDOR_CATEGORY.length),
  taxId: optionalText(30),
  notes: optionalText(2000),
  /** Restaurants this vendor serves; empty = all. */
  restaurantIds: z.array(z.uuid()).max(100),
})
export type VendorInput = z.infer<typeof vendorSchema>

export const VENDOR_SORT_FIELDS = ['name', 'createdAt'] as const
export const listVendorsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(200).optional(),
  sort: sortQuerySchema(VENDOR_SORT_FIELDS),
  category: z.enum(VENDOR_CATEGORY).optional(),
  restaurantId: z.uuid().optional(),
})
export type ListVendorsQuery = z.infer<typeof listVendorsQuerySchema>

export interface VendorListItem {
  id: string
  name: string
  contactName: string | null
  phone: string | null
  email: string | null
  city: string | null
  categories: VendorCategory[]
  /** Empty = serves every restaurant. */
  restaurants: Ref[]
  openOrders: number
}

export interface VendorDetail extends VendorListItem {
  altPhone: string | null
  address: string | null
  taxId: string | null
  notes: string | null
  /** Invoiced amount in the last 12 months (visible restaurants). */
  spend12m: number
  unpaidAmount: number
  partCount: number
  assetCount: number
  can: { edit: boolean; delete: boolean }
}

export interface VendorOption {
  id: string
  name: string
}

export const vendorInvoiceSchema = z
  .object({
    invoiceNumber: z.string().trim().min(1).max(60),
    amount: money.positive('validation.positiveAmount'),
    invoiceDate: z.iso.date(),
    dueDate: optionalDate,
    restaurantId: optionalUuid,
    purchaseOrderId: optionalUuid,
    notes: optionalText(1000),
  })
  .refine((v) => !v.dueDate || v.dueDate >= v.invoiceDate, {
    message: 'validation.endBeforeStart',
    path: ['dueDate'],
  })
export type VendorInvoiceInput = z.infer<typeof vendorInvoiceSchema>

export const invoicePaidSchema = z.object({ paid: z.boolean() })

export interface VendorInvoiceDto {
  id: string
  invoiceNumber: string
  amount: number
  invoiceDate: string
  dueDate: string | null
  paidAt: string | null
  overdue: boolean
  restaurant: Ref | null
  purchaseOrder: { id: string; code: string } | null
  notes: string | null
}

// ---------------------------------------------------------------- purchase orders

export const purchaseOrderSchema = z
  .object({
    vendorId: z.uuid(),
    restaurantId: z.uuid(),
    expectedAt: optionalDate,
    tax: money,
    notes: optionalText(2000),
    items: z
      .array(
        z.object({
          partId: z.uuid(),
          qtyOrdered: qty.positive('validation.positiveQuantity'),
          unitCost: money,
          description: optionalText(200),
        }),
      )
      .min(1, 'validation.itemsRequired')
      .max(100),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>()
    v.items.forEach((it, i) => {
      if (seen.has(it.partId))
        ctx.addIssue({
          code: 'custom',
          path: ['items', i, 'partId'],
          message: 'validation.duplicatePart',
        })
      seen.add(it.partId)
    })
  })
export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>

export const reasonSchema = z.object({ reason: z.string().trim().min(3).max(500) })
export type ReasonInput = z.infer<typeof reasonSchema>

export const receivePoSchema = z
  .object({
    lines: z
      .array(z.object({ itemId: z.uuid(), quantity: qty.min(0) }))
      .min(1)
      .max(100),
    notes: optionalText(500),
  })
  .refine((v) => v.lines.some((l) => l.quantity > 0), {
    message: 'validation.receiveSomething',
    path: ['lines'],
  })
export type ReceivePoInput = z.infer<typeof receivePoSchema>

export const PO_SORT_FIELDS = ['code', 'createdAt', 'total', 'expectedAt'] as const
export const listPurchaseOrdersQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(200).optional(),
  sort: sortQuerySchema(PO_SORT_FIELDS),
  status: z.enum(PURCHASE_ORDER_STATUS).optional(),
  /** Shortcut: waiting for my approval / still to be received. */
  view: z.enum(['approval', 'open']).optional(),
  restaurantId: z.uuid().optional(),
  vendorId: z.uuid().optional(),
})
export type ListPurchaseOrdersQuery = z.infer<typeof listPurchaseOrdersQuerySchema>

export interface PurchaseOrderListItem {
  id: string
  code: string
  status: PurchaseOrderStatus
  vendor: Ref
  restaurant: Ref
  total: number
  itemCount: number
  requestedBy: PersonRef
  expectedAt: string | null
  createdAt: string
}

export interface PurchaseOrderItemDto {
  id: string
  part: { id: string; name: string; partNumber: string; unit: string }
  description: string | null
  qtyOrdered: number
  qtyReceived: number
  unitCost: number
  lineTotal: number
}

export interface PurchaseOrderActions {
  edit: boolean
  submit: boolean
  approve: boolean
  reject: boolean
  order: boolean
  receive: boolean
  cancel: boolean
}

export interface PurchaseOrderDetail extends PurchaseOrderListItem {
  notes: string | null
  subtotal: number
  tax: number
  approvedBy: PersonRef | null
  submittedAt: string | null
  approvedAt: string | null
  orderedAt: string | null
  receivedAt: string | null
  cancelledAt: string | null
  cancellationReason: string | null
  items: PurchaseOrderItemDto[]
  receipts: Array<{
    id: string
    receivedBy: PersonRef
    receivedAt: string
    notes: string | null
    lines: Array<{ itemId: string; partName: string; quantity: number }>
  }>
  /** Why the approve button is missing for the requester. */
  selfApprovalBlocked: boolean
  actions: PurchaseOrderActions
}

/** Line total rounded to paise. */
export const lineTotal = (qtyOrdered: number, unitCost: number) =>
  Math.round(qtyOrdered * unitCost * 100) / 100
