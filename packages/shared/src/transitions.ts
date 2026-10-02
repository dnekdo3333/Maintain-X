import type { PurchaseOrderStatus, WorkOrderStatus } from './enums.js'

/**
 * Pure state-machine definitions. Services call `canTransition` before writing;
 * the UI uses the same maps to decide which action buttons to render.
 */

export const WORK_ORDER_TRANSITIONS: Record<WorkOrderStatus, readonly WorkOrderStatus[]> = {
  OPEN: ['ASSIGNED'],
  ASSIGNED: ['IN_PROGRESS', 'OPEN'],
  IN_PROGRESS: ['ON_HOLD', 'COMPLETED'],
  ON_HOLD: ['IN_PROGRESS'],
  // COMPLETED → REVIEW happens automatically on worker submission; ASSIGNED is "reopen".
  COMPLETED: ['REVIEW', 'ASSIGNED'],
  REVIEW: ['CLOSED', 'ASSIGNED'],
  CLOSED: ['ASSIGNED'],
}

/** Statuses that count as "open work" for dashboards and overdue scans. */
export const WORK_ORDER_ACTIVE_STATUSES: readonly WorkOrderStatus[] = [
  'OPEN',
  'ASSIGNED',
  'IN_PROGRESS',
  'ON_HOLD',
]

/** Statuses from which an admin may reopen. */
export const WORK_ORDER_REOPENABLE_STATUSES: readonly WorkOrderStatus[] = [
  'COMPLETED',
  'REVIEW',
  'CLOSED',
]

export const PURCHASE_ORDER_TRANSITIONS: Record<
  PurchaseOrderStatus,
  readonly PurchaseOrderStatus[]
> = {
  DRAFT: ['PENDING_APPROVAL', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'DRAFT', 'CANCELLED'],
  APPROVED: ['ORDERED', 'CANCELLED'],
  ORDERED: ['PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
  PARTIALLY_RECEIVED: ['PARTIALLY_RECEIVED', 'RECEIVED'],
  RECEIVED: [],
  CANCELLED: [],
}

export function canTransition<S extends string>(
  map: Record<S, readonly S[]>,
  from: S,
  to: S,
): boolean {
  return map[from].includes(to)
}

export function canTransitionWorkOrder(from: WorkOrderStatus, to: WorkOrderStatus): boolean {
  return canTransition(WORK_ORDER_TRANSITIONS, from, to)
}

export function canTransitionPurchaseOrder(
  from: PurchaseOrderStatus,
  to: PurchaseOrderStatus,
): boolean {
  return canTransition(PURCHASE_ORDER_TRANSITIONS, from, to)
}
