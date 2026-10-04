import {
  AlarmClock,
  CalendarCheck2,
  CheckCheck,
  ChevronRight,
  ClipboardCheck,
  ListTodo,
  Megaphone,
  ScanLine,
  Timer,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { Skeleton } from '@/components/ui/skeleton'
import { useCurrentUser } from '@/contexts/AuthContext'
import { useWorkerHome } from '@/services/worker.service'
import { cn } from '@/utils/cn'
import { formatNumber } from '@/utils/format'
import { intlLocale } from '@/utils/format'
import { TaskListSkeleton, WorkerTaskList } from './WorkerTaskList'

function greetingKey(hour: number) {
  if (hour < 12) return 'worker.greetingMorning' as const
  if (hour < 17) return 'worker.greetingAfternoon' as const
  return 'worker.greetingEvening' as const
}

interface Stat {
  label: string
  value: number | undefined
  to: string
  icon: LucideIcon
  /** Tone of the icon chip. */
  tone: 'info' | 'danger' | 'warning' | 'success'
  alert?: boolean
}

const TONE: Record<Stat['tone'], string> = {
  info: 'bg-info-soft text-info-fg',
  danger: 'bg-danger-soft text-danger-fg',
  warning: 'bg-warning-soft text-warning-fg',
  success: 'bg-success-soft text-success-fg',
}

/**
 * Worker home. Phone: a stacked app screen. Desktop: a small dashboard with
 * the task list next to quick actions.
 */
export function WorkerHomePage() {
  const { t } = useTranslation()
  const user = useCurrentUser()
  const query = useWorkerHome()
  const c = query.data?.counts
  const now = new Date()
  const today = new Intl.DateTimeFormat(intlLocale(), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(now)

  const stats: Stat[] = [
    {
      label: t('worker.countToday'),
      value: c?.today,
      to: '/w/tasks',
      icon: ListTodo,
      tone: 'info',
    },
    {
      label: t('worker.countOverdue'),
      value: c?.overdue,
      to: '/w/tasks',
      icon: AlarmClock,
      tone: 'danger',
      alert: (c?.overdue ?? 0) > 0,
    },
    {
      label: t('worker.countInProgress'),
      value: c?.inProgress,
      to: '/w/tasks',
      icon: Timer,
      tone: 'warning',
    },
    {
      label: t('worker.countDone'),
      value: c?.doneThisWeek,
      to: '/w/tasks?view=done',
      icon: CalendarCheck2,
      tone: 'success',
    },
  ]

  const actions: Array<{ to: string; label: string; hint: string; icon: LucideIcon }> = [
    { to: '/w/report', label: t('report.cta'), hint: t('worker.reportHint'), icon: Megaphone },
    { to: '/w/scan', label: t('nav.scan'), hint: t('worker.scanHint'), icon: ScanLine },
    {
      to: '/w/checklists',
      label: t('nav.checklists'),
      hint: t('worker.checklistsHint'),
      icon: ClipboardCheck,
    },
  ]

  return (
    <div className="grid gap-5 p-4 lg:gap-6 lg:p-8">
      {/* Greeting */}
      <section className="bg-brand animate-rise relative overflow-hidden rounded-2xl px-5 py-6 shadow-[0_12px_32px_-12px_oklch(0.42_0.17_262/0.55)] lg:px-8 lg:py-8">
        <span
          aria-hidden
          className="absolute -top-10 -right-10 size-40 rounded-full bg-white/10 blur-2xl"
        />
        <span
          aria-hidden
          className="absolute -bottom-16 left-1/3 size-48 rounded-full bg-white/5"
        />
        <p className="relative text-sm font-medium text-white/85">{today}</p>
        <h1 className="relative mt-1 text-2xl font-semibold tracking-tight lg:text-3xl">
          {t(greetingKey(now.getHours()), { name: user.firstName })}
        </h1>
        <p className="relative mt-1 text-sm text-white/85">
          {c
            ? c.today + c.overdue > 0
              ? t('worker.heroBusy', { count: c.today + c.overdue })
              : t('worker.heroFree')
            : ' '}
        </p>
      </section>

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
      ) : (
        <>
          <ul className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
            {stats.map((s) => (
              <li key={s.label}>
                <Link
                  to={s.to}
                  className={cn(
                    'card-lift flex h-full flex-col gap-3 rounded-xl border bg-card p-4 shadow-card',
                    'focus-visible:outline-2 focus-visible:outline-ring',
                    s.alert && 'border-danger/40',
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        'flex size-9 items-center justify-center rounded-lg',
                        TONE[s.tone],
                      )}
                    >
                      <s.icon className="size-4.5" aria-hidden />
                    </span>
                    {s.alert && (
                      <span className="relative flex size-2.5">
                        <span className="absolute inline-flex size-full animate-ping rounded-full bg-danger opacity-60" />
                        <span className="relative inline-flex size-2.5 rounded-full bg-danger" />
                      </span>
                    )}
                  </span>
                  <span>
                    <span className="block text-3xl leading-none font-semibold tracking-tight tabular">
                      {s.value === undefined ? (
                        <Skeleton className="h-8 w-10" />
                      ) : (
                        formatNumber(s.value)
                      )}
                    </span>
                    <span className="mt-1.5 block text-13 text-muted-foreground">{s.label}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-6">
            <section className="grid content-start gap-3" aria-labelledby="next-up">
              <div className="flex items-baseline justify-between">
                <h2 id="next-up" className="text-base font-semibold">
                  {t('worker.nextUp')}
                </h2>
                {query.data && query.data.next.length > 0 && (
                  <Link to="/w/tasks" className="text-13 font-medium text-primary hover:underline">
                    {t('worker.seeAll')}
                  </Link>
                )}
              </div>
              {query.isPending ? (
                <TaskListSkeleton />
              ) : query.data.next.length === 0 ? (
                <div className="animate-rise rounded-xl border bg-card shadow-card">
                  <EmptyState
                    compact
                    icon={CheckCheck}
                    title={t('worker.allCaughtUp')}
                    description={t('worker.noTasksToday')}
                  />
                </div>
              ) : (
                <WorkerTaskList tasks={query.data.next} />
              )}
            </section>

            <section className="grid content-start gap-3" aria-labelledby="quick-actions">
              <h2 id="quick-actions" className="text-base font-semibold">
                {t('worker.quickActions')}
              </h2>
              <ul className="stagger grid gap-2">
                {actions.map((a) => (
                  <li key={a.to}>
                    <Link
                      to={a.to}
                      className="card-lift flex items-center gap-3 rounded-xl border bg-card p-3.5 shadow-card focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <span className="bg-brand flex size-10 shrink-0 items-center justify-center rounded-lg">
                        <a.icon className="size-5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">{a.label}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {a.hint}
                        </span>
                      </span>
                      <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
    </div>
  )
}
