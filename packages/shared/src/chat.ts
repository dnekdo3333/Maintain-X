import { z } from 'zod'
import type { ConversationType } from './enums.js'

// ---------------------------------------------------------------- team chat

export const startConversationSchema = z
  .object({
    /** Other people in the chat (the creator is added automatically). */
    userIds: z.array(z.uuid()).min(1).max(50),
    /** Group name; required for groups (more than one other person). */
    name: z.string().trim().max(60).default(''),
  })
  .refine((v) => v.userIds.length === 1 || v.name.length >= 2, {
    path: ['name'],
    message: 'validation.required',
  })
export type StartConversationInput = z.infer<typeof startConversationSchema>

export const chatMessageSchema = z.object({
  body: z.string().trim().min(1).max(2000),
  /** Link a work order (its card shows in the chat). */
  workOrderId: z.uuid().or(z.literal('')).default(''),
})
export type ChatMessageInput = z.infer<typeof chatMessageSchema>

export const chatMessagesQuerySchema = z.object({
  /** Messages created before this message id (older page). */
  before: z.uuid().optional(),
  /** Messages created after this message id (polling for new ones). */
  after: z.uuid().optional(),
})

export const addMembersSchema = z.object({ userIds: z.array(z.uuid()).min(1).max(50) })

export interface ChatPerson {
  id: string
  firstName: string
  lastName: string
  role: string | null
}

export interface ConversationListItem {
  id: string
  type: ConversationType
  /** Group name, or the other person's name for a direct chat. */
  title: string
  members: ChatPerson[]
  lastMessage: { body: string; authorName: string; createdAt: string } | null
  unread: number
  lastMessageAt: string
}

export interface ChatMessageDto {
  id: string
  body: string
  author: { id: string; firstName: string; lastName: string }
  workOrder: { id: string; code: string; title: string } | null
  createdAt: string
  mine: boolean
  deleted: boolean
}

export interface ChatMessagesPage {
  messages: ChatMessageDto[]
  /** More older messages exist. */
  hasMore: boolean
}

// ---------------------------------------------------------------- dashboard layout

/** Admin dashboard blocks a person can show, hide and reorder. */
export const DASHBOARD_WIDGETS = [
  'today',
  'kpis',
  'secondary',
  'trend',
  'cost',
  'mix',
  'priority',
  'status',
  'workload',
  'lists',
  'restaurants',
  'activity',
] as const
export type DashboardWidget = (typeof DASHBOARD_WIDGETS)[number]

export const dashboardLayoutSchema = z.object({
  /** Shown widgets in order; anything missing is hidden. */
  widgets: z.array(z.enum(DASHBOARD_WIDGETS)).max(DASHBOARD_WIDGETS.length),
})
export type DashboardLayout = z.infer<typeof dashboardLayoutSchema>

export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayout = { widgets: [...DASHBOARD_WIDGETS] }
