import { WORKER_TASK_VIEWS, type WorkerTaskView } from '@maintainx/shared'
import { CalendarCheck, CheckCheck, History } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { WorkerPageHeader } from '@/components/worker/WorkerPageHeader'
import { useWorkerTasks } from '@/services/worker.service'
import { TaskListSkeleton, WorkerTaskList } from './WorkerTaskList'

function TaskView({ view }: { view: WorkerTaskView }) {
  const { t } = useTranslation()
  const query = useWorkerTasks(view)

  if (query.isPending) return <TaskListSkeleton />
  if (query.isError)
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />

  const tasks = query.data.pages.flatMap((p) => p.data)
  if (tasks.length === 0) {
    const empty = {
      today: { icon: CheckCheck, title: t('worker.allCaughtUp'), body: t('worker.noTasksToday') },
      upcoming: {
        icon: CalendarCheck,
        title: t('worker.emptyUpcoming'),
        body: t('worker.emptyUpcomingBody'),
      },
      done: { icon: History, title: t('worker.emptyDone'), body: undefined },
    }[view]
    return <EmptyState icon={empty.icon} title={empty.title} description={empty.body} />
  }

  return (
    <div className="grid gap-3">
      <WorkerTaskList tasks={tasks} />
      {query.hasNextPage && (
        <Button
          variant="secondary"
          size="lg"
          onClick={() => void query.fetchNextPage()}
          loading={query.isFetchingNextPage}
        >
          {t('worker.loadMore')}
        </Button>
      )}
    </div>
  )
}

export function WorkerTasksPage() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const raw = params.get('view')
  const view: WorkerTaskView = WORKER_TASK_VIEWS.includes(raw as WorkerTaskView)
    ? (raw as WorkerTaskView)
    : 'today'

  const labels: Record<WorkerTaskView, string> = {
    today: t('worker.tabToday'),
    upcoming: t('worker.tabUpcoming'),
    done: t('worker.tabDone'),
  }

  return (
    <>
      <WorkerPageHeader title={t('nav.myTasks')} />
      <Tabs
        value={view}
        onValueChange={(v) => setParams(v === 'today' ? {} : { view: v }, { replace: true })}
        className="px-4 pt-2"
      >
        <TabsList className="gap-6">
          {WORKER_TASK_VIEWS.map((v) => (
            <TabsTrigger key={v} value={v} className="h-11 text-base">
              {labels[v]}
            </TabsTrigger>
          ))}
        </TabsList>
        {WORKER_TASK_VIEWS.map((v) => (
          <TabsContent key={v} value={v} className="pb-4">
            {v === view && <TaskView view={v} />}
          </TabsContent>
        ))}
      </Tabs>
    </>
  )
}
