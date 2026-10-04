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
  Building2,
  CalendarCheck2,
  CalendarClock,
  CheckCheck,
  ClipboardList,
  Clock,
  History,
  Package,
  ShieldCheck,
  Timer,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
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
import { useCurrentUser } from '@/contexts/AuthContext'
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

function greetingKey(hour: number) {
  if (hour < 12) return 'worker.greetingMorning' as const
  if (hour < 17) return 'worker.greetingAfternoon' as const
  return 'worker.greetingEvening' as const
}

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

type KpiTone = 'neutral' | 'info' | 'danger' | 'warning' | 'success' | 'review'

const KPI_TONE: Record<KpiTone, string> = {
  neutral: 'bg-neutral-soft text-neutral-fg',
  info: 'bg-info-soft text-info-fg',
  danger: 'bg-danger-soft text-danger-fg',
  warning: 'bg-warning-soft text-warning-fg',
  success: 'bg-success-soft text-success-fg',
  review: 'bg-review-soft text-review-fg',
}

interface KpiProps {
  label: string
  value: ReactNode
  icon: LucideIcon
  tone: KpiTone
  hint?: string
  /** Status only when it needs attention; shown as icon + text, never colour alone. */
  alert?: string
  /** Where the number leads. */
  to?: string
}

function Kpi({ label, value, icon: Icon, tone, hint, alert, to }: KpiProps) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className={cn('flex size-10 items-center justify-center rounded-xl', KPI_TONE[tone])}>
          <Icon className="size-5" aria-hidden />
        </span>
        {alert && (
          <span className="relative mt-1 flex size-2.5" aria-hidden>
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-danger opacity-60" />
            <span className="relative inline-flex size-2.5 rounded-full bg-danger" />
          </span>
        )}
      </div>
      <span className="mt-4 truncate text-13 text-muted-foreground">{label}</span>
      <span className="flex flex-col gap-1">
        <span className="text-3xl leading-tight font-semibold tracking-tight tabular text-foreground">
          {value}
        </span>
        {alert ? (
          <span className="flex items-center gap-1 text-xs font-medium text-danger-fg">
            <AlertTriangle className="size-3" aria-hidden /> {alert}
          </span>
        ) : hint ? (
          <span className="truncate text-xs text-muted-foreground">{hint}</span>
        ) : (
          <span className="text-xs">&nbsp;</span>
        )}
      </span>
    </>
  )
  const classes = cn(
    'flex h-full flex-col rounded-xl border bg-card p-4 shadow-card',
    alert && 'border-danger/30',
  )
  return (
    <li className="min-w-0">
      {to ? (
        <Link
          to={to}
          className={cn(classes, 'card-lift focus-visible:outline-2 focus-visible:outline-ring')}
        >
          {body}
        </Link>
      ) : (
        <div className={classes}>{body}</div>
      )}
    </li>
  )
}

function KpiStrip({ data }: { data: DashboardSummary }) {
  const { t } = useTranslation()
  const c = data.counts
  const n = (v: number) => formatNumber(v)
  return (
    <ul className="stagger grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
      <Kpi
        label={t('dashboard.kpiRestaurants')}
        value={n(c.restaurants)}
        icon={Building2}
        tone="neutral"
        to="/restaurants"
      />
      <Kpi
        label={t('dashboard.kpiOpen')}
        value={n(c.open)}
        icon={ClipboardList}
        tone="info"
        to="/work-orders?view=active"
      />
      <Kpi
        label={t('dashboard.kpiOverdue')}
        value={n(c.overdue)}
        icon={Clock}
        tone="danger"
        alert={c.overdue > 0 ? t('dashboard.needsAttention') : undefined}
        to="/work-orders?view=overdue"
      />
      <Kpi
        label={t('dashboard.kpiInProgress')}
        value={n(c.inProgress)}
        icon={Timer}
        tone="warning"
        to="/work-orders?status=IN_PROGRESS"
      />
      <Kpi
        label={t('dashboard.kpiCompleted')}
        value={n(c.completed30d)}
        icon={CheckCheck}
        tone="success"
        hint={t('dashboard.kpiCompletedHint')}
      />
      <Kpi
        label={t('dashboard.kpiCritical')}
        value={n(c.critical)}
        icon={AlertTriangle}
        tone="danger"
        alert={c.critical > 0 ? t('dashboard.needsAttention') : undefined}
        to="/work-orders?priority=CRITICAL"
      />
      <Kpi
        label={t('dashboard.kpiLowStock')}
        value={n(c.lowStock)}
        icon={Package}
        tone="warning"
        alert={c.lowStock > 0 ? t('dashboard.needsAttention') : undefined}
        to="/inventory?low=1"
      />
      <Kpi
        label={t('dashboard.kpiPm')}
        value={data.pmCompliance === null ? '—' : `${data.pmCompliance}%`}
        icon={CalendarCheck2}
        tone="review"
        hint={data.pmCompliance === null ? t('dashboard.kpiPmNone') : t('dashboard.kpiPmHint')}
      />
    </ul>
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
  const user = useCurrentUser()

  return (
    <>
      <section className="bg-brand animate-rise relative mb-6 overflow-hidden rounded-2xl px-6 py-6 shadow-[0_12px_32px_-12px_oklch(0.42_0.17_262/0.55)] sm:px-8">
        <span
          aria-hidden
          className="absolute -top-12 -right-12 size-48 rounded-full bg-white/10 blur-2xl"
        />
        <span
          aria-hidden
          className="absolute -bottom-20 left-1/4 size-56 rounded-full bg-white/5"
        />
        <p className="relative text-sm font-medium text-white/85">
          {t(greetingKey(new Date().getHours()), { name: user.firstName })}
        </p>
        <h1 className="relative mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
          {t('dashboard.title')}
        </h1>
        <p className="relative mt-1 text-sm text-white/85">
          {query.data ? t('dashboard.updated', { time: formatTime(query.data.generatedAt) }) : ' '}
        </p>
      </section>
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
