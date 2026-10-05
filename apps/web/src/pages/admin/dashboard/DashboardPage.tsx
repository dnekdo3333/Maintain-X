import {
  PRIORITY,
  WORK_ORDER_TYPE,
  fullName,
  type ApiResponse,
  type DashboardActivity,
  type DashboardSummary,
  type DashboardWorkOrder,
  type Priority,
  type WorkOrderType,
} from '@maintainx/shared'
import { useQuery } from '@tanstack/react-query'
import {
  AlarmClock,
  AlertTriangle,
  Building2,
  CalendarCheck2,
  CalendarClock,
  CheckCheck,
  ClipboardList,
  Clock,
  Gauge,
  History,
  Inbox,
  IndianRupee,
  Package,
  PackageX,
  PlusCircle,
  SearchX,
  ShieldCheck,
  ThumbsUp,
  Timer,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import { BarList } from '@/components/charts/BarList'
import { TrendChart } from '@/components/charts/TrendChart'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { StatusBadge } from '@/components/common/StatusBadge'
import { FilterSelect } from '@/components/tables'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CostBreakdownView } from '@/components/work-orders/CostPanel'
import { useCurrentUser } from '@/contexts/AuthContext'
import { useRestaurantScope } from '@/contexts/RestaurantScopeContext'
import { http } from '@/services/http'
import { cn } from '@/utils/cn'
import {
  DUE_TONE_CLASS,
  describeDue,
  formatCurrency,
  formatNumber,
  formatRelative,
  formatTime,
} from '@/utils/format'
import { enumLabel, looseT } from '@/utils/i18n'

const REFRESH_MS = 60_000
const PERIODS = ['7', '30', '90', '365'] as const
type Period = (typeof PERIODS)[number]

function greetingKey(hour: number) {
  if (hour < 12) return 'worker.greetingMorning' as const
  if (hour < 17) return 'worker.greetingAfternoon' as const
  return 'worker.greetingEvening' as const
}

const pad = (n: number) => String(n).padStart(2, '0')
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

interface Filters {
  period: Period
  priority?: Priority
  type?: WorkOrderType
}

function useDashboard(restaurantId: string | null, f: Filters) {
  const days = Number(f.period)
  const to = new Date()
  const from = new Date(to.getTime() - (days - 1) * 86_400_000)
  const query = {
    restaurantId,
    from: localDate(from),
    to: localDate(to),
    priority: f.priority,
    type: f.type,
  }
  return useQuery({
    queryKey: ['dashboard', query],
    queryFn: ({ signal }) =>
      http.get<ApiResponse<DashboardSummary>>('/dashboard', { query, signal }).then((r) => r.data),
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

function KpiStrip({ data, periodHint }: { data: DashboardSummary; periodHint: string }) {
  const { t } = useTranslation()
  const c = data.counts
  const n = (v: number) => formatNumber(v)
  const attention = t('dashboard.needsAttention')
  return (
    <ul className="stagger grid grid-cols-2 gap-3 sm:grid-cols-4">
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
        alert={c.overdue > 0 ? attention : undefined}
        to="/work-orders?view=overdue"
      />
      <Kpi
        label={t('dashboard.kpiCritical')}
        value={n(c.critical)}
        icon={AlertTriangle}
        tone="danger"
        alert={c.critical > 0 ? attention : undefined}
        to="/work-orders?priority=CRITICAL&view=active"
      />
      <Kpi
        label={t('dashboard.kpiVerify')}
        value={n(c.pendingVerification)}
        icon={ThumbsUp}
        tone="review"
        hint={t('dashboard.kpiVerifyHint')}
        to="/work-orders?view=review"
      />
      <Kpi
        label={t('dashboard.kpiCompleted')}
        value={n(c.completed30d)}
        icon={CheckCheck}
        tone="success"
        hint={periodHint}
        to="/work-orders?view=done"
      />
      <Kpi
        label={t('dashboard.kpiPm')}
        value={data.pmCompliance === null ? '—' : `${data.pmCompliance}%`}
        icon={CalendarCheck2}
        tone="review"
        hint={data.pmCompliance === null ? t('dashboard.kpiPmNone') : t('dashboard.kpiPmHint')}
        to="/maintenance"
      />
      <Kpi
        label={t('dashboard.kpiAssetsDown')}
        value={n(c.assetsDown)}
        icon={PackageX}
        tone="warning"
        alert={
          c.criticalAssetsDown > 0
            ? t('dashboard.criticalDown', { count: c.criticalAssetsDown })
            : undefined
        }
        hint={t('dashboard.kpiAssetsDownHint')}
        to="/assets?status=BROKEN"
      />
      <Kpi
        label={t('dashboard.kpiLowStock')}
        value={n(c.lowStock)}
        icon={Package}
        tone="warning"
        alert={c.lowStock > 0 ? attention : undefined}
        to="/inventory?low=1"
      />
    </ul>
  )
}

/** Today at a glance (organization time zone): one row of small counters. */
function TodayBoard({ data }: { data: DashboardSummary }) {
  const { t } = useTranslation()
  const d = data.today
  const items: Array<{
    label: string
    value: number
    icon: LucideIcon
    alert?: boolean
    to?: string
  }> = [
    { label: t('dashboard.todayNewRequests'), value: d.newRequests, icon: Inbox, to: '/requests' },
    { label: t('dashboard.todayCreated'), value: d.created, icon: PlusCircle },
    {
      label: t('dashboard.todayInProgress'),
      value: d.inProgress,
      icon: Timer,
      to: '/work-orders?status=IN_PROGRESS',
    },
    { label: t('dashboard.todayCompleted'), value: d.completed, icon: CheckCheck },
    {
      label: t('dashboard.todayOverdue'),
      value: d.overdue,
      icon: AlarmClock,
      alert: d.overdue > 0,
      to: '/work-orders?view=overdue',
    },
    {
      label: t('dashboard.todayCritical'),
      value: d.critical,
      icon: AlertTriangle,
      alert: d.critical > 0,
    },
    {
      label: t('dashboard.todayPmDue'),
      value: d.pmDue,
      icon: CalendarClock,
      to: '/work-orders?type=PREVENTIVE&view=active',
    },
    {
      label: t('dashboard.todayFailed'),
      value: d.failedInspections,
      icon: SearchX,
      alert: d.failedInspections > 0,
      to: '/inspections',
    },
  ]
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle className="flex items-center gap-2">
          <CalendarClock className="size-4 text-muted-foreground" aria-hidden />
          {t('dashboard.todayTitle')}
        </PanelTitle>
      </PanelHeader>
      <ul className="stagger grid grid-cols-2 divide-x divide-y sm:grid-cols-4 sm:divide-y-0 xl:grid-cols-8">
        {items.map((i) => {
          const inner = (
            <>
              <i.icon
                className={cn('size-4', i.alert ? 'text-danger-fg' : 'text-muted-foreground')}
                aria-hidden
              />
              <span
                className={cn(
                  'text-2xl font-semibold tracking-tight tabular',
                  i.alert && 'text-danger-fg',
                )}
              >
                {formatNumber(i.value)}
              </span>
              <span className="text-xs text-muted-foreground">{i.label}</span>
            </>
          )
          return (
            <li key={i.label} className="min-w-0">
              {i.to ? (
                <Link to={i.to} className="grid gap-1 px-4 py-3 hover:bg-muted/50">
                  {inner}
                </Link>
              ) : (
                <div className="grid gap-1 px-4 py-3">{inner}</div>
              )}
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

/** Small numbers that frame the big ones. */
function SecondaryStats({ data }: { data: DashboardSummary }) {
  const { t } = useTranslation()
  const c = data.counts
  const stats: Array<{ label: string; value: string; icon: LucideIcon }> = [
    {
      label: t('dashboard.statRestaurants'),
      value: `${formatNumber(c.activeRestaurants)} / ${formatNumber(c.restaurants)}`,
      icon: Building2,
    },
    {
      label: t('dashboard.statPeople'),
      value: t('dashboard.statPeopleValue', { users: c.users, workers: c.activeWorkers }),
      icon: Users,
    },
    { label: t('dashboard.statRequests'), value: formatNumber(c.openRequests), icon: Inbox },
    {
      label: t('dashboard.statMttr'),
      value: data.mttrHours === null ? '—' : t('dashboard.hours', { value: data.mttrHours }),
      icon: Wrench,
    },
    {
      label: t('dashboard.statOnTime'),
      value: data.onTimeRate === null ? '—' : `${data.onTimeRate}%`,
      icon: Gauge,
    },
    {
      label: t('dashboard.statDowntime'),
      value: t('dashboard.hours', { value: data.downtimeHours }),
      icon: PackageX,
    },
    { label: t('dashboard.statFailed'), value: formatNumber(c.failedInspections), icon: SearchX },
    { label: t('dashboard.statCost'), value: formatCurrency(data.cost.total), icon: IndianRupee },
  ]
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border bg-card px-4 py-3 shadow-card sm:grid-cols-4 xl:grid-cols-8">
      {stats.map((s) => (
        <div key={s.label} className="min-w-0">
          <dt className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
            <s.icon className="size-3.5 shrink-0" aria-hidden /> {s.label}
          </dt>
          <dd className="truncate text-sm font-semibold tabular">{s.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Reactive vs preventive vs follow-up work: one 100% bar with every share labelled. */
function MixBar({ mix }: { mix: DashboardSummary['mix'] }) {
  const { t } = useTranslation()
  const total = WORK_ORDER_TYPE.reduce((s, k) => s + mix[k], 0)
  const swatch: Record<WorkOrderType, string> = {
    REACTIVE: 'bg-chart-2',
    PREVENTIVE: 'bg-chart-1',
    INSPECTION_FOLLOWUP: 'bg-chart-3',
  }
  if (total === 0) return <p className="text-13 text-muted-foreground">{t('dashboard.mixEmpty')}</p>
  return (
    <div className="grid gap-3">
      <div className="flex h-3 gap-0.5" aria-hidden>
        {WORK_ORDER_TYPE.filter((k) => mix[k] > 0).map((k) => (
          <span
            key={k}
            className={cn(swatch[k], 'h-full first:rounded-l-full last:rounded-r-full')}
            style={{ width: `${(mix[k] / total) * 100}%`, minWidth: 4 }}
          />
        ))}
      </div>
      <ul className="grid gap-1.5 text-13">
        {WORK_ORDER_TYPE.map((k) => (
          <li key={k} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className={cn('size-2.5 rounded-sm', swatch[k])} aria-hidden />
              {enumLabel(t, 'workOrderType', k)}
            </span>
            <span className="font-medium tabular">
              {formatNumber(mix[k])} · {Math.round((mix[k] / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
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

/** Every restaurant side by side for the period. */
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
      <div className="overflow-x-auto">
        <Table aria-label={t('dashboard.byRestaurant')}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('dashboard.colRestaurant')}</TableHead>
              <TableHead className="text-right">{t('dashboard.colOpen')}</TableHead>
              <TableHead className="text-right">{t('dashboard.colOverdue')}</TableHead>
              <TableHead className="text-right">{t('dashboard.colCritical')}</TableHead>
              <TableHead className="text-right">{t('dashboard.colCompleted')}</TableHead>
              <TableHead className="text-right">{t('dashboard.colAssetsDown')}</TableHead>
              <TableHead className="text-right">{t('dashboard.colPm')}</TableHead>
              <TableHead className="text-right">{t('dashboard.colCost')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link to={`/restaurants/${r.id}`} className="font-medium hover:underline">
                    {r.name}
                  </Link>{' '}
                  <span className="text-13 text-muted-foreground tabular">{r.code}</span>
                </TableCell>
                {cell(r.open)}
                {cell(r.overdue, true)}
                {cell(r.critical, true)}
                {cell(r.completed)}
                {cell(r.assetsDown, true)}
                <TableCell className="text-right tabular">
                  {r.pmCompliance === null ? '—' : `${r.pmCompliance}%`}
                </TableCell>
                <TableCell className="text-right tabular">{formatCurrency(r.cost)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Panel>
  )
}

/** Who has what: open, running and overdue work per technician. */
function WorkloadPanel({ rows }: { rows: DashboardSummary['workload'] }) {
  const { t } = useTranslation()
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle className="flex items-center gap-2">
          <Users className="size-4 text-muted-foreground" aria-hidden />
          {t('dashboard.workload')}
        </PanelTitle>
      </PanelHeader>
      {rows.length === 0 ? (
        <EmptyState compact icon={Users} title={t('dashboard.workloadEmpty')} />
      ) : (
        <PanelBody>
          <BarList
            items={rows.map((r) => ({
              key: r.user.id,
              to: `/work-orders?assignedUserId=${r.user.id}&view=active`,
              value: r.open,
              barClass: r.overdue > 0 ? 'bg-chart-2' : 'bg-chart-1',
              label: (
                <span>
                  <span className="font-medium">{fullName(r.user)}</span>{' '}
                  <span className="text-muted-foreground">
                    {t('dashboard.workloadDetail', {
                      running: r.inProgress,
                      overdue: r.overdue,
                      done: r.completed,
                    })}
                  </span>
                </span>
              ),
            }))}
          />
        </PanelBody>
      )}
    </Panel>
  )
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true">
      <Skeleton className="h-24 w-full" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-64 w-full lg:col-span-2" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  )
}

export function DashboardPage() {
  const { t } = useTranslation()
  const { restaurantId } = useRestaurantScope()
  const [params, setParams] = useSearchParams()
  const filters: Filters = {
    period: (PERIODS as readonly string[]).includes(params.get('period') ?? '')
      ? (params.get('period') as Period)
      : '30',
    priority: (params.get('priority') as Priority | null) ?? undefined,
    type: (params.get('type') as WorkOrderType | null) ?? undefined,
  }
  const setFilter = (key: keyof Filters, value: string | undefined) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }
  const query = useDashboard(restaurantId, filters)
  const user = useCurrentUser()
  const periodHint = t('dashboard.lastDays', { count: Number(filters.period) })

  return (
    <>
      <section className="bg-brand animate-rise relative mb-4 overflow-hidden rounded-2xl px-6 py-6 shadow-[0_12px_32px_-12px_oklch(0.42_0.17_262/0.55)] sm:px-8">
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
          {user.isSuperAdmin ? t('dashboard.titleSuper') : t('dashboard.title')}
        </h1>
        <p className="relative mt-1 text-sm text-white/85">
          {query.data ? t('dashboard.updated', { time: formatTime(query.data.generatedAt) }) : ' '}
        </p>
      </section>

      <div
        className="mb-4 flex flex-wrap items-center gap-2"
        role="group"
        aria-label={t('dashboard.filters')}
      >
        <FilterSelect
          label={t('dashboard.period')}
          value={filters.period}
          onChange={(v) => setFilter('period', v === '30' ? undefined : v)}
          options={PERIODS.map((p) => ({
            value: p,
            label: t('dashboard.lastDays', { count: Number(p) }),
          }))}
        />
        <FilterSelect
          label={t('wo.colPriority')}
          value={filters.priority}
          onChange={(v) => setFilter('priority', v)}
          options={PRIORITY.map((p) => ({ value: p, label: enumLabel(t, 'priority', p) }))}
        />
        <FilterSelect
          label={t('wo.fieldType')}
          value={filters.type}
          onChange={(v) => setFilter('type', v)}
          options={WORK_ORDER_TYPE.map((v) => ({
            value: v,
            label: enumLabel(t, 'workOrderType', v),
          }))}
        />
      </div>

      {query.isPending ? (
        <DashboardSkeleton />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <div className={cn('grid gap-4 transition-opacity', query.isFetching && 'opacity-80')}>
          <TodayBoard data={query.data} />
          <KpiStrip data={query.data} periodHint={periodHint} />
          <SecondaryStats data={query.data} />

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel className="lg:col-span-2">
              <PanelHeader>
                <PanelTitle>{t('dashboard.trend')}</PanelTitle>
              </PanelHeader>
              <PanelBody>
                <TrendChart
                  label={t('dashboard.trendLabel', { period: periodHint })}
                  dates={query.data.trend.map((p) => p.date)}
                  series={[
                    {
                      key: 'created',
                      label: t('dashboard.seriesCreated'),
                      colorClass: 'text-chart-1',
                      swatchClass: 'bg-chart-1',
                      values: query.data.trend.map((p) => p.created),
                    },
                    {
                      key: 'completed',
                      label: t('dashboard.seriesCompleted'),
                      colorClass: 'text-chart-2',
                      swatchClass: 'bg-chart-2',
                      values: query.data.trend.map((p) => p.completed),
                    },
                  ]}
                />
              </PanelBody>
            </Panel>
            <div className="grid content-start gap-4">
              <Panel>
                <PanelHeader>
                  <PanelTitle className="flex items-center gap-2">
                    <IndianRupee className="size-4 text-muted-foreground" aria-hidden />
                    {t('dashboard.cost')}
                  </PanelTitle>
                </PanelHeader>
                <PanelBody>
                  <CostBreakdownView cost={query.data.cost} />
                </PanelBody>
              </Panel>
              <Panel>
                <PanelHeader>
                  <PanelTitle>{t('dashboard.mix')}</PanelTitle>
                </PanelHeader>
                <PanelBody>
                  <MixBar mix={query.data.mix} />
                </PanelBody>
              </Panel>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel>
              <PanelHeader>
                <PanelTitle>{t('dashboard.byPriority')}</PanelTitle>
              </PanelHeader>
              <PanelBody>
                <BarList
                  items={[...PRIORITY].reverse().map((p) => ({
                    key: p,
                    label: <StatusBadge kind="priority" value={p} />,
                    value: query.data.byPriority[p],
                    to: `/work-orders?priority=${p}&view=active`,
                  }))}
                />
              </PanelBody>
            </Panel>
            <Panel>
              <PanelHeader>
                <PanelTitle>{t('dashboard.byStatus')}</PanelTitle>
              </PanelHeader>
              <PanelBody>
                {query.data.byStatus.length === 0 ? (
                  <p className="text-13 text-muted-foreground">{t('dashboard.statusEmpty')}</p>
                ) : (
                  <BarList
                    items={query.data.byStatus.map((s) => ({
                      key: s.status,
                      label: <StatusBadge kind="workOrderStatus" value={s.status} />,
                      value: s.count,
                      to: `/work-orders?status=${s.status}`,
                    }))}
                  />
                )}
              </PanelBody>
            </Panel>
            <WorkloadPanel rows={query.data.workload} />
          </div>

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
          {query.data.restaurants.length > 1 && <RestaurantTable rows={query.data.restaurants} />}
          <ActivityFeed items={query.data.recentActivity} />
        </div>
      )}
    </>
  )
}
