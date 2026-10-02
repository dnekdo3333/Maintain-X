import { fullName, type WorkOrderDetail } from '@maintainx/shared'
import {
  CheckCircle2,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  UserMinus,
  UserPlus,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { Checklist } from '@/components/checklists/Checklist'
import { checklistProgress } from '@/components/checklists/checklist-utils'
import { Callout } from '@/components/common/Callout'
import { DetailList } from '@/components/common/DetailList'
import { ErrorState } from '@/components/common/ErrorState'
import { PageHeader } from '@/components/common/PageHeader'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/panel'
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { AttachmentGallery, PhotoUploadButton } from '@/components/work-orders/Attachments'
import { HistoryList, MessagesPanel } from '@/components/work-orders/Timeline'
import { WorkOrderDialogs } from '@/components/work-orders/WorkOrderDialogs'
import { WorkOrderParts } from '@/components/work-orders/WorkOrderParts'
import { WorkOrderForm } from '@/components/work-orders/WorkOrderForm'
import { useWorkOrderActions } from '@/components/work-orders/useWorkOrderActions'
import { useWorkOrder } from '@/services/work-orders.service'
import { formatDateTime, formatDuration } from '@/utils/format'
import { enumLabel } from '@/utils/i18n'

export function WorkOrderDetailPage() {
  const { t } = useTranslation()
  const { workOrderId = '' } = useParams()
  const query = useWorkOrder(workOrderId)
  const back = { to: '/work-orders', label: t('wo.title') }

  if (query.isPending) {
    return (
      <div className="grid gap-4" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (query.isError) {
    return (
      <>
        <PageHeader title={t('wo.title')} back={back} />
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </>
    )
  }
  return <Detail w={query.data} back={back} />
}

function Detail({ w, back }: { w: WorkOrderDetail; back: { to: string; label: string } }) {
  const { t } = useTranslation()
  const a = useWorkOrderActions(w)
  const [editing, setEditing] = useState(false)

  const buttons: Array<{
    key: string
    show: boolean
    label: string
    icon: LucideIcon
    onClick: () => void
    primary?: boolean
  }> = [
    {
      key: 'close',
      show: w.actions.close,
      label: t('wo.approveClose'),
      icon: CheckCircle2,
      onClick: () => a.setDialog('close'),
      primary: true,
    },
    {
      key: 'assign',
      show: w.actions.assign,
      label: w.assignedUser || w.assignedTeam ? t('wo.reassign') : t('wo.assign'),
      icon: UserPlus,
      onClick: () => a.setDialog('assign'),
      primary: w.status === 'OPEN',
    },
    { key: 'start', show: w.actions.start, label: t('wo.start'), icon: Play, onClick: a.start },
    { key: 'resume', show: w.actions.resume, label: t('wo.resume'), icon: Play, onClick: a.resume },
    {
      key: 'complete',
      show: w.actions.complete,
      label: t('wo.complete'),
      icon: CheckCircle2,
      onClick: () => a.setDialog('complete'),
    },
    {
      key: 'hold',
      show: w.actions.hold,
      label: t('wo.hold'),
      icon: Pause,
      onClick: () => a.setDialog('hold'),
    },
    {
      key: 'reopen',
      show: w.actions.reopen,
      label: t('wo.reopen'),
      icon: RotateCcw,
      onClick: () => a.setDialog('reopen'),
    },
    {
      key: 'unassign',
      show: w.actions.unassign,
      label: t('wo.unassign'),
      icon: UserMinus,
      onClick: a.unassign,
    },
    {
      key: 'edit',
      show: w.actions.edit,
      label: t('actions.edit'),
      icon: Pencil,
      onClick: () => setEditing(true),
    },
  ]

  const assignee = w.assignedUser
    ? fullName(w.assignedUser)
    : w.assignedTeam
      ? t('wo.teamOption', { name: w.assignedTeam.name })
      : null

  return (
    <>
      <PageHeader
        back={back}
        title={w.title}
        meta={
          <>
            <span className="text-13 text-muted-foreground tabular">{w.code}</span>
            <StatusBadge kind="workOrderStatus" value={w.status} />
            <StatusBadge kind="priority" value={w.priority} />
            <Badge tone="outline">{enumLabel(t, 'workOrderCategory', w.category)}</Badge>
          </>
        }
        actions={
          <>
            {buttons
              .filter((b) => b.show)
              .map((b) => (
                <Button
                  key={b.key}
                  variant={b.primary ? 'default' : 'secondary'}
                  loading={a.busy === b.key}
                  onClick={b.onClick}
                >
                  <b.icon aria-hidden /> {b.label}
                </Button>
              ))}
          </>
        }
      />

      {w.status === 'REVIEW' && w.actions.close && (
        <Callout tone="info" className="mb-4" title={t('wo.reviewTitle')}>
          {t('wo.reviewBody')}
        </Callout>
      )}
      {w.status === 'ON_HOLD' && w.holdReason && (
        <Callout tone="warning" className="mb-4" title={t('wo.onHoldBecause')}>
          {w.holdReason}
        </Callout>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="grid content-start gap-4">
          <Panel>
            <PanelHeader>
              <PanelTitle>{t('wo.details')}</PanelTitle>
            </PanelHeader>
            <PanelBody>
              {w.description && <p className="mb-3 text-sm whitespace-pre-wrap">{w.description}</p>}
              <DetailList
                items={[
                  { label: t('wo.fieldRestaurant'), value: w.restaurant.name },
                  { label: t('wo.fieldLocation'), value: w.location?.name },
                  {
                    label: t('wo.fieldAsset'),
                    value: w.asset && (
                      <Link to={`/assets/${w.asset.id}`} className="text-primary hover:underline">
                        {w.asset.name} · {w.asset.assetCode}
                      </Link>
                    ),
                  },
                  { label: t('wo.fieldAssignee'), value: assignee },
                  {
                    label: t('wo.fromSchedule'),
                    value: w.pmSchedule && (
                      <Link
                        to={`/maintenance/${w.pmSchedule.id}`}
                        className="text-primary hover:underline"
                      >
                        {w.pmSchedule.name}
                      </Link>
                    ),
                    hidden: !w.pmSchedule,
                  },
                  { label: t('wo.fieldDue'), value: w.dueDate && formatDateTime(w.dueDate) },
                  {
                    label: t('wo.fieldEstimate'),
                    value: w.estimatedMinutes && formatDuration(w.estimatedMinutes),
                  },
                  {
                    label: t('wo.timeWorked'),
                    value: (
                      <span className="tabular">
                        {formatDuration(w.minutesWorked)}
                        {w.timerRunning && (
                          <span className="ml-2 text-13 text-warning-fg">
                            {t('wo.timerRunning')}
                          </span>
                        )}
                      </span>
                    ),
                  },
                  {
                    label: t('wo.createdBy'),
                    value: `${fullName(w.createdBy)} · ${formatDateTime(w.createdAt)}`,
                  },
                  {
                    label: t('wo.completedAt'),
                    value: w.completedAt && formatDateTime(w.completedAt),
                    hidden: !w.completedAt,
                  },
                  {
                    label: t('wo.closedBy'),
                    value: w.closedBy && `${fullName(w.closedBy)} · ${formatDateTime(w.closedAt!)}`,
                    hidden: !w.closedBy,
                  },
                  {
                    label: t('wo.reopenCount'),
                    value: w.reopenCount,
                    hidden: w.reopenCount === 0,
                  },
                ]}
              />
              {w.completionNotes && (
                <div className="mt-3 rounded-md bg-muted px-3 py-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t('wo.completionNotes')}
                  </p>
                  <p className="text-sm whitespace-pre-wrap">{w.completionNotes}</p>
                </div>
              )}
            </PanelBody>
          </Panel>

          {w.checklist.length > 0 && (
            <Panel>
              <PanelHeader className="flex items-center justify-between gap-2">
                <PanelTitle>
                  {w.procedure
                    ? t('checklist.titleWithProcedure', { name: w.procedure.name })
                    : t('checklist.title')}
                </PanelTitle>
                <span className="text-13 text-muted-foreground tabular">
                  {t('checklist.progress', {
                    done: checklistProgress(w.checklist).answered,
                    total: w.checklist.length,
                  })}
                </span>
              </PanelHeader>
              <PanelBody>
                <Checklist items={w.checklist} editable={w.actions.checklist} onAnswer={a.answer} />
              </PanelBody>
            </Panel>
          )}

          {(w.parts.length > 0 || w.actions.parts) && (
            <Panel>
              <PanelHeader>
                <PanelTitle>{t('woParts.title')}</PanelTitle>
              </PanelHeader>
              <PanelBody>
                <WorkOrderParts w={w} />
              </PanelBody>
            </Panel>
          )}

          {w.sourceRequest && (
            <Panel>
              <PanelHeader>
                <PanelTitle>{t('wo.fromRequest', { code: w.sourceRequest.code })}</PanelTitle>
              </PanelHeader>
              <PanelBody className="grid gap-3">
                <p className="text-13 text-muted-foreground">
                  {t('wo.reportedBy', { name: fullName(w.sourceRequest.requestedBy) })}
                </p>
                <p className="text-sm whitespace-pre-wrap">{w.sourceRequest.description}</p>
                <AttachmentGallery items={w.sourceRequest.attachments} />
              </PanelBody>
            </Panel>
          )}

          <Panel>
            <PanelHeader className="flex items-center justify-between gap-2">
              <PanelTitle>{t('wo.photos')}</PanelTitle>
              {w.actions.upload && <PhotoUploadButton size="sm" upload={a.upload} />}
            </PanelHeader>
            <PanelBody>
              {w.attachments.length === 0 ? (
                <p className="text-13 text-muted-foreground">{t('wo.noPhotos')}</p>
              ) : (
                <AttachmentGallery items={w.attachments} />
              )}
            </PanelBody>
          </Panel>
        </div>

        <div className="grid content-start gap-4">
          <Panel>
            <PanelHeader>
              <PanelTitle>{t('wo.messages')}</PanelTitle>
            </PanelHeader>
            <PanelBody>
              <MessagesPanel messages={w.messages} canSend={w.actions.message} send={a.message} />
            </PanelBody>
          </Panel>
          <Panel>
            <PanelHeader>
              <PanelTitle>{t('wo.history')}</PanelTitle>
            </PanelHeader>
            <PanelBody>
              <HistoryList events={w.history} />
            </PanelBody>
          </Panel>
        </div>
      </div>

      <WorkOrderDialogs workOrder={w} actions={a} />

      <Sheet open={editing} onOpenChange={setEditing}>
        <SheetContent aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle>{t('wo.editTitle')}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {editing && (
              <WorkOrderForm
                workOrder={w}
                onCancel={() => setEditing(false)}
                onDone={() => setEditing(false)}
              />
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  )
}
