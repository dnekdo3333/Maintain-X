import { z } from 'zod'
import type { Priority, WorkOrderStatus } from './enums.js'

export const dashboardQuerySchema = z.object({
  /** Limit to one restaurant (must be in the user's scope); omitted = all of them. */
  restaurantId: z.uuid().optional(),
})
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>

export interface DashboardWorkOrder {
  id: string
  code: string
  title: string
  priority: Priority
  status: WorkOrderStatus
  dueDate: string | null
  restaurant: { id: string; name: string }
  assignee: { id: string; firstName: string; lastName: string } | null
}

export interface DashboardActivity {
  id: string
  /** dot.separated audit action, e.g. "user.created" */
  action: string
  entityType: string
  actor: { id: string; firstName: string; lastName: string } | null
  restaurant: { id: string; name: string } | null
  createdAt: string
}

export interface DashboardRestaurantRow {
  id: string
  code: string
  name: string
  open: number
  overdue: number
  critical: number
}

export interface DashboardSummary {
  generatedAt: string
  counts: {
    restaurants: number
    open: number
    overdue: number
    inProgress: number
    /** Completed or closed in the last 30 days. */
    completed30d: number
    critical: number
    lowStock: number
  }
  /** Preventive work orders due in the last 30 days completed on time (0–100), or null if none were due. */
  pmCompliance: number | null
  todaysTasks: DashboardWorkOrder[]
  criticalIssues: DashboardWorkOrder[]
  overdueTasks: DashboardWorkOrder[]
  /** Audit viewers: all activity; others: operational activity in their restaurants. */
  recentActivity: DashboardActivity[]
  restaurants: DashboardRestaurantRow[]
}
