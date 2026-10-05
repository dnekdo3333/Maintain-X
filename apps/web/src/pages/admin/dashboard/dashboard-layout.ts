import {
  DEFAULT_DASHBOARD_LAYOUT,
  dashboardLayoutSchema,
  type ApiResponse,
  type DashboardLayout,
} from '@maintainx/shared'
import { useQuery } from '@tanstack/react-query'
import { http } from '@/services/http'

export const DASHBOARD_LAYOUT_KEY = ['me', 'dashboard-layout'] as const

/** This person's dashboard: which blocks show, in which order (default = everything). */
export function useDashboardLayout(): DashboardLayout {
  const query = useQuery({
    queryKey: DASHBOARD_LAYOUT_KEY,
    queryFn: ({ signal }) =>
      http
        .get<ApiResponse<DashboardLayout>>('/me/dashboard-layout', { signal })
        .then((r) => r.data),
    staleTime: Infinity,
  })
  // Anything unexpected falls back to the full dashboard.
  const parsed = dashboardLayoutSchema.safeParse(query.data)
  return parsed.success ? parsed.data : DEFAULT_DASHBOARD_LAYOUT
}
