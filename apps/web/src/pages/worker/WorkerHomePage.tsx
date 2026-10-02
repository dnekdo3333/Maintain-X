import { AlertTriangle, CheckCheck, Megaphone } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { WorkerPageHeader } from '@/components/worker/WorkerPageHeader'
import { useCurrentUser } from '@/contexts/AuthContext'
import { useWorkerHome } from '@/services/worker.service'
import { formatNumber } from '@/utils/format'
import { TaskListSkeleton, WorkerTaskList } from './WorkerTaskList'

function greetingKey(hour: number) {
  if (hour < 12) return 'worker.greetingMorning' as const
  if (hour < 17) return 'worker.greetingAfternoon' as const
  return 'worker.greetingEvening' as const
}

export function WorkerHomePage() {
  const { t } = useTranslation()
  const user = useCurrentUser()
  const query = useWorkerHome()
  const c = query.data?.counts

  const stats = [
    { label: t('worker.countToday'), value: c?.today, to: '/w/tasks' },
    {
      label: t('worker.countOverdue'),
      value: c?.overdue,
      to: '/w/tasks',
      alert: (c?.overdue ?? 0) > 0,
    },
    { label: t('worker.countInProgress'), value: c?.inProgress, to: '/w/tasks' },
    { label: t('worker.countDone'), value: c?.doneThisWeek, to: '/w/tasks?view=done' },
  ]

  return (
    <>
      <WorkerPageHeader title={t(greetingKey(new Date().getHours()), { name: user.firstName })} />
      <div className="grid gap-5 px-4 py-4">
        {query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
        ) : (
          <>
            <ul className="grid grid-cols-2 gap-2">
              {stats.map((s) => (
                <li key={s.label}>
                  <Link
                    to={s.to}
                    className="flex flex-col rounded-lg border px-3 py-2.5 active:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span className="text-xs text-muted-foreground">{s.label}</span>
                    <span className="flex items-center gap-1.5 text-2xl font-semibold tabular">
                      {s.value === undefined ? (
                        <Skeleton className="mt-1 h-7 w-10" />
                      ) : (
                        formatNumber(s.value)
                      )}
                      {s.alert && <AlertTriangle className="size-4 text-danger-fg" aria-hidden />}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>

            <Button asChild variant="secondary" size="xl" className="justify-start">
              <Link to="/w/report">
                <Megaphone aria-hidden /> {t('report.cta')}
              </Link>
            </Button>

            <section className="grid gap-2" aria-labelledby="next-up">
              <div className="flex items-baseline justify-between">
                <h2 id="next-up" className="text-sm font-semibold">
                  {t('worker.nextUp')}
                </h2>
                {query.data && query.data.next.length > 0 && (
                  <Link to="/w/tasks" className="text-13 font-medium text-primary">
                    {t('worker.seeAll')}
                  </Link>
                )}
              </div>
              {query.isPending ? (
                <TaskListSkeleton />
              ) : query.data.next.length === 0 ? (
                <div className="rounded-lg border">
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
          </>
        )}
      </div>
    </>
  )
}
