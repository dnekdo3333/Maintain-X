/**
 * Domain enums. These MUST stay in sync with the Prisma enums in
 * apps/server/prisma/schema.prisma — the server has a test that asserts this.
 *
 * Plain `as const` objects (not TS enums) so they are erasable, tree-shakeable
 * and usable as Zod enum sources on both sides.
 */

export const USER_STATUS = ['ACTIVE', 'INVITED', 'DISABLED'] as const
export type UserStatus = (typeof USER_STATUS)[number]

/** Which application shell a role lands in. */
export const ROLE_KIND = ['ADMIN', 'WORKER'] as const
export type RoleKind = (typeof ROLE_KIND)[number]

export const RESTAURANT_STATUS = ['ACTIVE', 'INACTIVE'] as const
export type RestaurantStatus = (typeof RESTAURANT_STATUS)[number]

export const LOCATION_TYPE = [
  'KITCHEN',
  'HOT_KITCHEN',
  'COLD_KITCHEN',
  'PREPARATION',
  'DISHWASHING',
  'DINING',
  'STORAGE',
  'BAR',
  'UTILITY',
  'OFFICE',
  'OTHER',
] as const
export type LocationType = (typeof LOCATION_TYPE)[number]

export const ASSET_STATUS = [
  'OPERATIONAL',
  'UNDER_MAINTENANCE',
  'BROKEN',
  'INACTIVE',
  'RETIRED',
] as const
export type AssetStatus = (typeof ASSET_STATUS)[number]

export const ASSET_EVENT_TYPE = [
  'CREATED',
  'UPDATED',
  'STATUS_CHANGED',
  'MOVED',
  'WORK_ORDER_COMPLETED',
  'PART_REPLACED',
  'DOCUMENT_ADDED',
  'NOTE',
] as const
export type AssetEventType = (typeof ASSET_EVENT_TYPE)[number]

export const PRIORITY = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
export type Priority = (typeof PRIORITY)[number]

export const WORK_ORDER_STATUS = [
  'OPEN',
  'ASSIGNED',
  'IN_PROGRESS',
  'ON_HOLD',
  'COMPLETED',
  'REVIEW',
  'CLOSED',
] as const
export type WorkOrderStatus = (typeof WORK_ORDER_STATUS)[number]

export const WORK_ORDER_TYPE = ['REACTIVE', 'PREVENTIVE', 'INSPECTION_FOLLOWUP'] as const
export type WorkOrderType = (typeof WORK_ORDER_TYPE)[number]

export const WORK_ORDER_CATEGORY = [
  'REFRIGERATION',
  'AC',
  'ELECTRICAL',
  'PLUMBING',
  'GAS',
  'FIRE_SAFETY',
  'KITCHEN_EQUIPMENT',
  'PEST_CONTROL',
  'CLEANING',
  'IT_POS',
  'CIVIL',
  'OTHER',
] as const
export type WorkOrderCategory = (typeof WORK_ORDER_CATEGORY)[number]

export const REQUEST_STATUS = ['NEW', 'CONVERTED', 'REJECTED'] as const
export type RequestStatus = (typeof REQUEST_STATUS)[number]

export const STEP_INPUT_TYPE = ['PASS_FAIL_NA', 'NUMBER', 'TEXT'] as const
export type StepInputType = (typeof STEP_INPUT_TYPE)[number]

export const STEP_RESULT = ['PASS', 'FAIL', 'NA'] as const
export type StepResult = (typeof STEP_RESULT)[number]

export const ATTACHMENT_OWNER_TYPE = [
  'WORK_ORDER',
  'REQUEST',
  'CHECKLIST_ITEM',
  'INSPECTION_ITEM',
  'MESSAGE',
] as const
export type AttachmentOwnerType = (typeof ATTACHMENT_OWNER_TYPE)[number]

export const ATTACHMENT_KIND = ['PHOTO', 'VIDEO', 'FILE'] as const
export type AttachmentKind = (typeof ATTACHMENT_KIND)[number]

export const FREQUENCY = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'CUSTOM'] as const
export type Frequency = (typeof FREQUENCY)[number]

export const INSPECTION_TYPE = ['OPENING', 'CLOSING', 'SAFETY', 'ASSET'] as const
export type InspectionType = (typeof INSPECTION_TYPE)[number]

export const INSPECTION_STATUS = ['IN_PROGRESS', 'SUBMITTED'] as const
export type InspectionStatus = (typeof INSPECTION_STATUS)[number]

export const INVENTORY_TXN_TYPE = [
  'RECEIPT',
  'CONSUMPTION',
  'ADJUSTMENT',
  'RETURN',
  'TRANSFER',
] as const
export type InventoryTxnType = (typeof INVENTORY_TXN_TYPE)[number]

export const PURCHASE_ORDER_STATUS = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'ORDERED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
] as const
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUS)[number]

export const VENDOR_CATEGORY = [
  'REFRIGERATION',
  'AC',
  'ELECTRICAL',
  'PLUMBING',
  'GAS',
  'FIRE_SAFETY',
  'KITCHEN_EQUIPMENT',
  'PEST_CONTROL',
  'OTHER',
] as const
export type VendorCategory = (typeof VENDOR_CATEGORY)[number]

export const DOCUMENT_OWNER_TYPE = ['RESTAURANT', 'ASSET', 'VENDOR', 'WORK_ORDER'] as const
export type DocumentOwnerType = (typeof DOCUMENT_OWNER_TYPE)[number]

export const DOCUMENT_TYPE = [
  'LICENSE',
  'CERTIFICATE',
  'AMC',
  'CONTRACT',
  'MANUAL',
  'WARRANTY',
  'INVOICE',
  'SERVICE',
  'OTHER',
] as const
export type DocumentType = (typeof DOCUMENT_TYPE)[number]

export const NOTIFICATION_TYPE = [
  'NEW_REQUEST',
  'TASK_ASSIGNED',
  'TASK_OVERDUE',
  'PM_DUE',
  'CRITICAL_ISSUE',
  'LOW_STOCK',
  'PO_APPROVAL',
  'WARRANTY_EXPIRY',
  'TASK_COMPLETED',
  'INSPECTION_FAILED',
  'NEW_MESSAGE',
  'DOCUMENT_EXPIRY',
] as const
export type NotificationType = (typeof NOTIFICATION_TYPE)[number]

export const SETTING_SCOPE = ['ORGANIZATION', 'RESTAURANT'] as const
export type SettingScope = (typeof SETTING_SCOPE)[number]

export const AUDIT_ENTITY_TYPE = [
  'USER',
  'ROLE',
  'TEAM',
  'RESTAURANT',
  'LOCATION',
  'ASSET',
  'REQUEST',
  'WORK_ORDER',
  'PROCEDURE',
  'PM_SCHEDULE',
  'INSPECTION',
  'PART',
  'INVENTORY',
  'VENDOR',
  'PURCHASE_ORDER',
  'DOCUMENT',
  'SETTING',
  'AUTH',
  'REPORT',
] as const
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPE)[number]
