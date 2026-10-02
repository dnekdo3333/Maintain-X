import type { WorkOrderDetail } from '@maintainx/shared'
import { useTranslation } from 'react-i18next'
import { AssignDialog, CompleteDialog, ReasonDialog } from './dialogs'
import type { useWorkOrderActions } from './useWorkOrderActions'

/** Every dialog a work-order screen can open; which one is open lives in `actions.dialog`. */
export function WorkOrderDialogs({
  workOrder: w,
  actions: a,
}: {
  workOrder: WorkOrderDetail
  actions: ReturnType<typeof useWorkOrderActions>
}) {
  const { t } = useTranslation()
  const openFor = (d: NonNullable<typeof a.dialog>) => ({
    open: a.dialog === d,
    onOpenChange: (o: boolean) => a.setDialog(o ? d : null),
  })
  return (
    <>
      {w.actions.assign && (
        <AssignDialog {...openFor('assign')} workOrder={w} onSubmit={a.assign} />
      )}
      <ReasonDialog
        {...openFor('hold')}
        title={t('wo.holdTitle')}
        description={t('wo.holdBody')}
        label={t('wo.holdReason')}
        confirmLabel={t('wo.hold')}
        onSubmit={a.hold}
      />
      {a.dialog === 'complete' && (
        <CompleteDialog {...openFor('complete')} workOrder={w} onSubmit={a.complete} />
      )}
      <ReasonDialog
        {...openFor('close')}
        title={t('wo.closeTitle')}
        description={t('wo.closeBody')}
        label={t('wo.closeNote')}
        confirmLabel={t('wo.close')}
        minLength={0}
        onSubmit={a.close}
      />
      <ReasonDialog
        {...openFor('reopen')}
        title={t('wo.reopenTitle')}
        description={t('wo.reopenBody')}
        label={t('wo.reopenReason')}
        confirmLabel={t('wo.reopen')}
        onSubmit={a.reopen}
      />
    </>
  )
}
