import { z } from 'zod'
import {
  AUDIT_ENTITY_TYPE,
  DOCUMENT_OWNER_TYPE,
  DOCUMENT_TYPE,
  NOTIFICATION_TYPE,
  type AuditEntityType,
  type DocumentOwnerType,
  type DocumentType,
  type NotificationType,
  type Priority,
} from './enums.js'
import { paginationQuerySchema } from './schemas/common.js'
import type { PersonRef } from './work-orders.js'

/*
 * Notifications, documents, reports and the audit log.
 */

type Ref = { id: string; name: string }
const optionalDate = z.iso.date().or(z.literal(''))

// ---------------------------------------------------------------- notifications

export const listNotificationsQuerySchema = paginationQuerySchema.extend({
  unread: z.enum(['1']).optional(),
})
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>

export interface NotificationDto {
  id: string
  type: NotificationType
  title: string
  body: string | null
  actionUrl: string | null
  priority: Priority
  readAt: string | null
  createdAt: string
}

export const notificationPreferencesSchema = z.object({
  /** Types the user does NOT want in the app. */
  muted: z.array(z.enum(NOTIFICATION_TYPE)).max(NOTIFICATION_TYPE.length),
})
export type NotificationPreferencesInput = z.infer<typeof notificationPreferencesSchema>

/** Critical alerts can't be muted. */
export const UNMUTABLE_NOTIFICATIONS: readonly NotificationType[] = ['CRITICAL_ISSUE']

/** Admin links (/work-orders/…) become worker links (/w/tasks/…) for workers. */
export function notificationLinkFor(url: string | null, isWorker: boolean): string | null {
  if (!url || !isWorker) return url
  const wo = url.match(/^\/work-orders\/([0-9a-f-]{36})/)
  if (wo) return `/w/tasks/${wo[1]}`
  if (url.startsWith('/requests')) return '/w/reports'
  if (url.startsWith('/inspections/')) return url.replace('/inspections/', '/w/inspections/')
  if (url.startsWith('/w/')) return url
  return null
}

// ---------------------------------------------------------------- documents

/** PDFs, photos and Office files. Checked by content on the server. */
export const DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const

export const documentMetaSchema = z
  .object({
    title: z.string().trim().min(2).max(160),
    docType: z.enum(DOCUMENT_TYPE),
    issuedAt: optionalDate,
    expiresAt: optionalDate,
  })
  .refine((v) => !v.issuedAt || !v.expiresAt || v.expiresAt >= v.issuedAt, {
    message: 'validation.endBeforeStart',
    path: ['expiresAt'],
  })
export type DocumentMetaInput = z.infer<typeof documentMetaSchema>

/** Multipart form fields sent with the file. */
export const uploadDocumentSchema = z
  .object({
    ownerType: z.enum(DOCUMENT_OWNER_TYPE),
    ownerId: z.uuid(),
    title: z.string().trim().min(2).max(160),
    docType: z.enum(DOCUMENT_TYPE),
    issuedAt: optionalDate,
    expiresAt: optionalDate,
  })
  .refine((v) => !v.issuedAt || !v.expiresAt || v.expiresAt >= v.issuedAt, {
    message: 'validation.endBeforeStart',
    path: ['expiresAt'],
  })
export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>

export const listDocumentsQuerySchema = paginationQuerySchema.extend({
  ownerType: z.enum(DOCUMENT_OWNER_TYPE).optional(),
  ownerId: z.uuid().optional(),
  restaurantId: z.uuid().optional(),
  docType: z.enum(DOCUMENT_TYPE).optional(),
  /** expiring = within 30 days; expired = already past. */
  expiry: z.enum(['expiring', 'expired']).optional(),
  q: z.string().trim().max(200).optional(),
})
export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>

export const DOCUMENT_EXPIRING_DAYS = 30

export interface DocumentDto {
  id: string
  title: string
  docType: DocumentType
  ownerType: DocumentOwnerType
  owner: { id: string; name: string }
  restaurant: Ref | null
  fileName: string
  mimeType: string
  sizeBytes: number
  issuedAt: string | null
  expiresAt: string | null
  expiry: 'none' | 'valid' | 'expiring' | 'expired'
  uploadedBy: PersonRef
  createdAt: string
  url: string
  downloadUrl: string
  can: { edit: boolean; delete: boolean }
}

export function documentExpiry(
  expiresAt: string | null,
  today = new Date(),
): DocumentDto['expiry'] {
  if (!expiresAt) return 'none'
  const todayKey = today.toISOString().slice(0, 10)
  if (expiresAt < todayKey) return 'expired'
  const soon = new Date(today.getTime() + DOCUMENT_EXPIRING_DAYS * 86_400_000)
  return expiresAt <= soon.toISOString().slice(0, 10) ? 'expiring' : 'valid'
}

// ---------------------------------------------------------------- reports

export const REPORT_KEYS = [
  'work-order-summary',
  'work-orders-completed',
  'overdue-work-orders',
  'repair-time',
  'technician-performance',
  'pm-compliance',
  'asset-downtime',
  'asset-cost',
  'requests-summary',
  'inspection-results',
  'failed-checks',
  'inventory-valuation',
  'low-stock',
  'parts-consumption',
  'vendor-spend',
  'unpaid-invoices',
] as const
export type ReportKey = (typeof REPORT_KEYS)[number]

export const REPORT_GROUPS: Record<
  'work' | 'assets' | 'quality' | 'inventory' | 'purchasing',
  readonly ReportKey[]
> = {
  work: [
    'work-order-summary',
    'work-orders-completed',
    'overdue-work-orders',
    'repair-time',
    'technician-performance',
    'requests-summary',
  ],
  assets: ['pm-compliance', 'asset-downtime', 'asset-cost'],
  quality: ['inspection-results', 'failed-checks'],
  inventory: ['inventory-valuation', 'low-stock', 'parts-consumption'],
  purchasing: ['vendor-spend', 'unpaid-invoices'],
}

/** Reports that describe "now" ignore the date range. */
export const SNAPSHOT_REPORTS: readonly ReportKey[] = [
  'overdue-work-orders',
  'inventory-valuation',
  'low-stock',
  'unpaid-invoices',
]

export const reportQuerySchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    restaurantId: z.uuid().optional(),
  })
  .refine((v) => v.from <= v.to, { message: 'validation.endBeforeStart', path: ['to'] })
  .refine((v) => Date.parse(v.to) - Date.parse(v.from) <= 366 * 86_400_000, {
    message: 'validation.rangeTooLong',
    path: ['from'],
  })
export type ReportQuery = z.infer<typeof reportQuerySchema>

export type ReportColumnType =
  'text' | 'number' | 'money' | 'percent' | 'hours' | 'date' | 'datetime'

export interface ReportColumn {
  key: string
  /** i18n key under reports.col.* */
  label: string
  type: ReportColumnType
}

export type ReportCell = string | number | null

export interface ReportResult {
  key: ReportKey
  columns: ReportColumn[]
  rows: Array<Record<string, ReportCell>>
  /** Headline numbers shown above the table. */
  summary: Array<{ label: string; value: number; type: ReportColumnType }>
  /** Rows were cut at this many (CSV has everything up to the same cap). */
  truncated: boolean
  generatedAt: string
}

// ---------------------------------------------------------------- audit log

export const listAuditQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  entityType: z.enum(AUDIT_ENTITY_TYPE).optional(),
  entityId: z.uuid().optional(),
  actorId: z.uuid().optional(),
  restaurantId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
})
export type ListAuditQuery = z.infer<typeof listAuditQuerySchema>

export interface AuditLogDto {
  id: string
  action: string
  entityType: AuditEntityType
  entityId: string | null
  actor: PersonRef | null
  restaurant: Ref | null
  oldValue: unknown
  newValue: unknown
  metadata: unknown
  ip: string | null
  userAgent: string | null
  requestId: string | null
  createdAt: string
}

/**
 * Neutralises spreadsheet formulas in CSV cells (=, +, -, @, tab, CR), so an
 * exported value like "=HYPERLINK(…)" can't run when opened in Excel.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  let s = typeof value === 'string' ? value : String(value)
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  // BOM so Excel opens UTF-8 (Hindi/Gujarati names) correctly.
  return (
    '﻿' +
    [headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n') +
    '\r\n'
  )
}
