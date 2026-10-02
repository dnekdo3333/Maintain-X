import { z } from 'zod'
import {
  ASSET_STATUS,
  PRIORITY,
  REQUEST_STATUS,
  WORK_ORDER_CATEGORY,
  WORK_ORDER_STATUS,
  type AssetStatus,
  type AttachmentKind,
  type Priority,
  type RequestStatus,
  type WorkOrderCategory,
  type WorkOrderStatus,
  type WorkOrderType,
} from './enums.js'
import type { WorkOrderPartDto } from './inventory.js'
import type { ChecklistItemDto } from './maintenance.js'
import { paginationQuerySchema, sortQuerySchema } from './schemas/common.js'

/*
 * Requests (problem reports), work orders, messages and attachments.
 * Custom messages are i18n keys. Optional text accepts '' from forms.
 */

const optionalText = (max: number) => z.string().trim().max(max)
const optionalUuid = z.uuid().or(z.literal(''))

// ---------------------------------------------------------------- uploads

export const UPLOAD_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const UPLOAD_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'] as const
export const UPLOAD_ALLOWED_TYPES: readonly string[] = [
  ...UPLOAD_IMAGE_TYPES,
  ...UPLOAD_VIDEO_TYPES,
]
/** Photos are resized on the device before upload; this is the safety limit. */
export const UPLOAD_MAX_IMAGE_MB = 10
export const UPLOAD_MAX_FILES = 6

export interface AttachmentDto {
  id: string
  kind: AttachmentKind
  fileName: string
  mimeType: string
  sizeBytes: number
  /** Short-lived signed link (valid ~1 hour). */
  url: string
  uploadedBy: { id: string; firstName: string; lastName: string }
  createdAt: string
}

// ---------------------------------------------------------------- requests

export const createRequestSchema = z.object({
  restaurantId: z.uuid(),
  locationId: optionalUuid,
  assetId: optionalUuid,
  category: z.enum(WORK_ORDER_CATEGORY),
  /** Optional; derived from the description when empty. */
  title: optionalText(120),
  description: z.string().trim().min(5).max(2000),
  priority: z.enum(PRIORITY),
})
export type CreateRequestInput = z.infer<typeof createRequestSchema>

export const rejectRequestSchema = z.object({
  reason: z.string().trim().min(3).max(500),
})
export type RejectRequestInput = z.infer<typeof rejectRequestSchema>

export const REQUEST_SORT_FIELDS = ['createdAt', 'priority'] as const

export const listRequestsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(200).optional(),
  sort: sortQuerySchema(REQUEST_SORT_FIELDS),
  status: z.enum(REQUEST_STATUS).optional(),
  restaurantId: z.uuid().optional(),
  /** Only requests I reported (workers always get this). */
  mine: z.enum(['1']).optional(),
})
export type ListRequestsQuery = z.infer<typeof listRequestsQuerySchema>

export interface PersonRef {
  id: string
  firstName: string
  lastName: string
}

export interface RequestListItem {
  id: string
  code: string
  title: string
  category: WorkOrderCategory
  priority: Priority
  status: RequestStatus
  restaurant: { id: string; name: string }
  location: { id: string; name: string } | null
  asset: { id: string; name: string; assetCode: string } | null
  requestedBy: PersonRef
  photoCount: number
  createdAt: string
}

export interface RequestDetail extends RequestListItem {
  description: string
  reviewedBy: PersonRef | null
  reviewedAt: string | null
  rejectionReason: string | null
  workOrder: { id: string; code: string; status: WorkOrderStatus } | null
  attachments: AttachmentDto[]
  can: { convert: boolean; reject: boolean }
}

// ---------------------------------------------------------------- work orders

const workOrderFields = {
  title: z.string().trim().min(3).max(120),
  description: optionalText(5000),
  category: z.enum(WORK_ORDER_CATEGORY),
  priority: z.enum(PRIORITY),
  restaurantId: z.uuid(),
  locationId: optionalUuid,
  assetId: optionalUuid,
  /** ISO date-time or ''. */
  dueDate: z.iso.datetime({ offset: true }).or(z.literal('')),
  estimatedMinutes: z.number().int().min(5).max(10_080).optional(),
}

export const createWorkOrderSchema = z.object({
  ...workOrderFields,
  assignedUserId: optionalUuid,
  assignedTeamId: optionalUuid,
  /** Set when converting a request. */
  requestId: optionalUuid,
  /** Copies the procedure's steps into the work order's checklist. */
  procedureId: optionalUuid.optional(),
})
export type CreateWorkOrderInput = z.infer<typeof createWorkOrderSchema>

export const updateWorkOrderSchema = z.object(workOrderFields)
export type UpdateWorkOrderInput = z.infer<typeof updateWorkOrderSchema>

export const assignWorkOrderSchema = z
  .object({ assignedUserId: optionalUuid, assignedTeamId: optionalUuid })
  .refine((v) => v.assignedUserId !== '' || v.assignedTeamId !== '', {
    message: 'validation.assigneeRequired',
    path: ['assignedUserId'],
  })
export type AssignWorkOrderInput = z.infer<typeof assignWorkOrderSchema>

export const holdWorkOrderSchema = z.object({ reason: z.string().trim().min(3).max(500) })
export type HoldWorkOrderInput = z.infer<typeof holdWorkOrderSchema>

export const completeWorkOrderSchema = z.object({
  notes: z.string().trim().min(3).max(5000),
  /** Optionally set the asset's status (e.g. back to OPERATIONAL). */
  assetStatus: z.enum(ASSET_STATUS).or(z.literal('')),
})
export type CompleteWorkOrderInput = z.infer<typeof completeWorkOrderSchema>

export const reopenWorkOrderSchema = z.object({ reason: z.string().trim().min(3).max(500) })
export type ReopenWorkOrderInput = z.infer<typeof reopenWorkOrderSchema>

export const closeWorkOrderSchema = z.object({ note: optionalText(500) })
export type CloseWorkOrderInput = z.infer<typeof closeWorkOrderSchema>

export const messageSchema = z.object({ body: z.string().trim().min(1).max(2000) })
export type MessageInput = z.infer<typeof messageSchema>

export const WORK_ORDER_SORT_FIELDS = [
  'code',
  'dueDate',
  'priority',
  'createdAt',
  'status',
] as const

export const listWorkOrdersQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(200).optional(),
  sort: sortQuerySchema(WORK_ORDER_SORT_FIELDS),
  status: z.enum(WORK_ORDER_STATUS).optional(),
  /** Shortcut views. */
  view: z.enum(['active', 'overdue', 'review', 'unassigned']).optional(),
  priority: z.enum(PRIORITY).optional(),
  category: z.enum(WORK_ORDER_CATEGORY).optional(),
  restaurantId: z.uuid().optional(),
  assetId: z.uuid().optional(),
  assignedUserId: z.uuid().optional(),
})
export type ListWorkOrdersQuery = z.infer<typeof listWorkOrdersQuerySchema>

export interface WorkOrderListItem {
  id: string
  code: string
  title: string
  type: WorkOrderType
  category: WorkOrderCategory
  priority: Priority
  status: WorkOrderStatus
  dueDate: string | null
  restaurant: { id: string; name: string }
  location: { id: string; name: string } | null
  asset: { id: string; name: string; assetCode: string } | null
  assignedUser: PersonRef | null
  assignedTeam: { id: string; name: string } | null
  createdAt: string
}

export interface WorkOrderMessage {
  id: string
  body: string
  author: PersonRef
  createdAt: string
  mine: boolean
}

export interface WorkOrderEvent {
  id: string
  fromStatus: WorkOrderStatus | null
  toStatus: WorkOrderStatus
  actor: PersonRef | null
  note: string | null
  createdAt: string
}

/** Actions the current user may take right now (server-computed). */
export interface WorkOrderActions {
  edit: boolean
  assign: boolean
  start: boolean
  hold: boolean
  resume: boolean
  complete: boolean
  close: boolean
  reopen: boolean
  unassign: boolean
  upload: boolean
  message: boolean
  /** Answer checklist steps (owner while in progress). */
  checklist: boolean
  /** Record parts used (deducted from the restaurant's stock). */
  parts: boolean
}

export interface WorkOrderDetail extends WorkOrderListItem {
  description: string | null
  estimatedMinutes: number | null
  /** Minutes worked so far (closed time entries + the running one). */
  minutesWorked: number
  timerRunning: boolean
  startedAt: string | null
  completedAt: string | null
  closedAt: string | null
  holdReason: string | null
  completionNotes: string | null
  reopenCount: number
  createdBy: PersonRef
  closedBy: PersonRef | null
  asset: (WorkOrderListItem['asset'] & { status: AssetStatus; publicId: string }) | null
  procedure: { id: string; name: string } | null
  pmSchedule: { id: string; name: string } | null
  checklist: ChecklistItemDto[]
  parts: WorkOrderPartDto[]
  sourceRequest: {
    id: string
    code: string
    description: string
    requestedBy: PersonRef
    attachments: AttachmentDto[]
  } | null
  attachments: AttachmentDto[]
  messages: WorkOrderMessage[]
  history: WorkOrderEvent[]
  actions: WorkOrderActions
}
