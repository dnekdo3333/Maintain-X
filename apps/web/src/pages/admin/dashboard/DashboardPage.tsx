import {
  fullName,
  type ApiResponse,
  type DashboardActivity,
  type DashboardSummary,
  type DashboardWorkOrder,
} from '@maintainx/shared'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  CalendarClock,
  CheckCheck,
  Clock,
  History,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { PageHeader } from '@/components/common/PageHeader'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Panel, PanelHeader, PanelTitle } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useRestaurantScope } from '@/contexts/RestaurantScopeContext'
import { http } from '@/services/http'
import { cn } from '@/utils/cn'
import {
  DUE_TONE_CLASS,
  describeDue,
  formatNumber,
  formatRelative,
  formatTime,
} from '@/utils/format'
import { looseT } from '@/utils/i18n'

const REFRESH_MS = 60_000

function useDashboard(restaurantId: string | null) {
  return useQuery({
    queryKey: ['dashboard', restaurantId ?? 'all'],
    queryFn: ({ signal }) =>
      http
        .get<ApiResponse<DashboardSummary>>('/dashboard', { query: { restaurantId }, signal })
        .then((r) => r.data),
    refetchInterval: REFRESH_MS,
    staleTime: 15_000,
  })
}

// ---------------------------------------------------------------------------

interface KpiProps {
  label: string
  value: ReactNode
  hint?: string
  /** Status only when it needs attention; shown as icon + text, never colour alone. */
  alert?: string
}

function Kpi({ label, value, hint, alert }: KpiProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-4 py-3">
      <dt className="truncate text-13 text-muted-foreground">{label}</dt>
      <dd className="flex flex-col gap-1">
        <span className="text-2xl leading-tight font-semibold tabular text-foreground">
          {value}
        </span>
        {alert ? (
          <span className="flex items-center gap-1 text-xs font-medium text-danger-fg">
            <AlertTriangle className="size-3" aria-hidden /> {alert}
          </span>
        ) : hint ? (
          <span className="truncate text-xs text-muted-foreground">{hint}</span>
        ) : null}
      </dd>
    </div>
  )
}

function KpiStrip({ data }: { data: DashboardSummary }) {
  const { t } = useTranslation()
  const c = data.counts
  const n = (v: number) => formatNumber(v)
  return (
    <Panel>
      <dl className="grid grid-cols-2 divide-y sm:grid-cols-4 sm:divide-y-0 lg:grid-cols-8 [&>*]:border-border sm:[&>*:nth-child(n+5)]:border-t lg:[&>*:nth-child(n+5)]:border-t-0 lg:divide-x">
        <Kpi label={t('dashboard.kpiRestaurants')} value={n(c.restaurants)} />
        <Kpi label={t('dashboard.kpiOpen')} value={n(c.open)} />
        <Kpi
          label={t('dashboard.kpiOverdue')}
          value={n(c.overdue)}
          alert={c.overdue > 0 ? t('dashboard.needsAttention') : undefined}
        />
        <Kpi label={t('dashboard.kpiInProgress')} value={n(c.inProgress)} />
        <Kpi
          label={t('dashboard.kpiCompleted')}
          value={n(c.completed30d)}
          hint={t('dashboard.kpiCompletedHint')}
        />
        <Kpi
          label={t('dashboard.kpiCritical')}
          value={n(c.critical)}
          alert={c.critical > 0 ? t('dashboard.needsAttention') : undefined}
        />
        <Kpi
          label={t('dashboard.kpiLowStock')}
          value={n(c.lowStock)}
          alert={c.lowStock > 0 ? t('dashboard.needsAttention') : undefined}
        />
        <Kpi
          label={t('dashboard.kpiPm')}
          value={data.pmCompliance === null ? '—' : `${data.pmCompliance}%`}
          hint={data.pmCompliance === null ? t('dashboard.kpiPmNone') : t('dashboard.kpiPmHint')}
        />
      </dl>
    </Panel>
  )
}

function WorkOrderList({
  title,
  icon,
  items,
  empty,
  emptyIcon,
}: {
  title: string
  icon: LucideIcon
  items: DashboardWorkOrder[]
  empty: string
  emptyIcon: LucideIcon
}) {
  const { t } = useTranslation()
  const Icon = icon
  return (
    <Panel className="flex flex-col">
      <PanelHeader>
        <PanelTitle className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" aria-hidden /> {title}
        </PanelTitle>
      </PanelHeader>
      {items.length === 0 ? (
        <EmptyState compact icon={emptyIcon} title={empty} />
      ) : (
        <ul className="divide-y">
          {items.map((w) => {
            const due = w.dueDate ? describeDue(w.dueDate, t) : null
            return (
              <li key={w.id} className="relative grid gap-1 px-4 py-2.5 hover:bg-muted/50">
                <div className="flex items-start justify-between gap-3">
                  <Link
                    to={`/work-orders/${w.id}`}
                    className="min-w-0 truncate text-sm font-medium after:absolute after:inset-0 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {w.title}
                  </Link>
                  <StatusBadge kind="priority" value={w.priority} />
                </div>
                <p className="flex flex-wrap gap-x-2 text-13 text-muted-foreground">
                  <span className="tabular">{w.code}</span>
                  <span aria-hidden>·</span>
                  <span>{w.restaurant.name}</span>
                  <span aria-hidden>·</span>
                  <span>{w.assignee ? fullName(w.assignee) : t('dashboard.unassigned')}</span>
                </p>
                <p
                  className={cn(
                    'text-13 font-medium',
                    due ? DUE_TONE_CLASS[due.tone] : 'text-muted-foreground',
                  )}
                >
                  {due ? due.label : t('dashboard.noDue')}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

function ActivityFeed({ items }: { items: DashboardActivity[] }) {
  const { t } = useTranslation()
  const tl = looseT(t)
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle className="flex items-center gap-2">
          <History className="size-4 text-muted-foreground" aria-hidden /> {t('dashboard.activity')}
        </PanelTitle>
      </PanelHeader>
      {items.length === 0 ? (
        <EmptyState compact icon={History} title={t('dashboard.activityEmpty')} />
      ) : (
        <ol className="divide-y">
          {items.map((a) => (
            <li
              key={a.id}
              className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-sm"
            >
              <p className="min-w-0">
                <span className="font-medium">
                  {a.actor ? fullName(a.actor) : t('dashboard.someone')}
                </span>{' '}
                <span className="text-muted-foreground">
                  {tl(`activity.${a.action.replace(/\./g, '_')}`, {
                    defaultValue: t('activity.unknown'),
                  })}
                </span>
                {a.restaurant && (
                  <span className="text-muted-foreground"> · {a.restaurant.name}</span>
                )}
              </p>
              <time dateTime={a.createdAt} className="shrink-0 text-xs text-muted-foreground">
                {formatRelative(a.createdAt)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}

function RestaurantTable({ rows }: { rows: DashboardSummary['restaurants'] }) {
  const { t } = useTranslation()
  const cell = (v: number, alert = false) => (
    <TableCell className={cn('text-right tabular', alert && v > 0 && 'font-semibold')}>
      {alert && v > 0 && (
        <AlertTriangle className="mr-1 inline size-3 text-danger-fg" aria-hidden />
      )}
      {formatNumber(v)}
    </TableCell>
  )
  return (
    <Panel className="overflow-hidden">
      <PanelHeader>
        <PanelTitle>{t('dashboard.byRestaurant')}</PanelTitle>
      </PanelHeader>
      <Table aria-label={t('dashboard.byRestaurant')}>
        <TableHeader>
          <TableRow>
            <TableHead>{t('dashboard.colRestaurant')}</TableHead>
            <TableHead className="text-right">{t('dashboard.colOpen')}</TableHead>
            <TableHead className="text-right">{t('dashboard.colOverdue')}</TableHead>
            <TableHead className="text-right">{t('dashboard.colCritical')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <span className="font-medium">{r.name}</span>{' '}
                <span className="text-13 text-muted-foreground tabular">{r.code}</span>
              </TableCell>
              {cell(r.open)}
              {cell(r.overdue, true)}
              {cell(r.critical, true)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  )
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true">
      <Skeleton className="h-24 w-full" />
      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-56 w-full" />
        ))}
      </div>
    </div>
  )
}

export function DashboardPage() {
  const { t } = useTranslation()
  const { restaurantId } = useRestaurantScope()
  const query = useDashboard(restaurantId)

  return (
    <>
      <PageHeader
        title={t('dashboard.title')}
        description={
          query.data
            ? t('dashboard.updated', { time: formatTime(query.data.generatedAt) })
            : undefined
        }
      />
      {query.isPending ? (
        <DashboardSkeleton />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <div className={cn('grid gap-4 transition-opacity', query.isFetching && 'opacity-80')}>
          <KpiStrip data={query.data} />
          <div className="grid gap-4 lg:grid-cols-3">
            <WorkOrderList
              title={t('dashboard.today')}
              icon={CalendarClock}
              items={query.data.todaysTasks}
              empty={t('dashboard.todayEmpty')}
              emptyIcon={CheckCheck}
            />
            <WorkOrderList
              title={t('dashboard.critical')}
              icon={AlertTriangle}
              items={query.data.criticalIssues}
              empty={t('dashboard.criticalEmpty')}
              emptyIcon={ShieldCheck}
            />
            <WorkOrderList
              title={t('dashboard.overdue')}
              icon={Clock}
              items={query.data.overdueTasks}
              empty={t('dashboard.overdueEmpty')}
              emptyIcon={CheckCheck}
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {query.data.restaurants.length > 1 && <RestaurantTable rows={query.data.restaurants} />}
            <ActivityFeed items={query.data.recentActivity} />
          </div>
        </div>
      )}
    </>
  )
}
