import type { CompleteWorkOrderInput, StepAnswerInput, WorkOrderDetail } from '@maintainx/shared'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/components/ui/toaster'
import { checklistApi } from '@/services/maintenance.service'
import { useApplyWorkOrder, workOrdersApi } from '@/services/work-orders.service'
import { describeError } from '@/utils/errors'

export type WorkOrderDialog = 'assign' | 'hold' | 'complete' | 'close' | 'reopen' | null

/**
 * Runs work-order actions and keeps every screen in sync. Direct actions
 * (start, resume, unassign) show their own errors; dialog actions throw so the
 * dialog can show the message inline.
 */
export function useWorkOrderActions(w: WorkOrderDetail | undefined) {
  const { t } = useTranslation()
  const apply = useApplyWorkOrder()
  const [dialog, setDialog] = useState<WorkOrderDialog>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const id = w?.id ?? ''

  const run = async (key: string, fn: () => Promise<WorkOrderDetail>, success: string) => {
    setBusy(key)
    try {
      await apply(await fn())
      toast.success(success)
    } catch (err) {
      toast.error(describeError(err, t))
    } finally {
      setBusy(null)
    }
  }
  const withApply = async (fn: () => Promise<WorkOrderDetail>, success: string) => {
    await apply(await fn())
    toast.success(success)
  }

  return {
    dialog,
    setDialog,
    busy,
    start: () => run('start', () => workOrdersApi.start(id), t('wo.started')),
    resume: () => run('resume', () => workOrdersApi.resume(id), t('wo.resumed')),
    unassign: () => run('unassign', () => workOrdersApi.unassign(id), t('wo.unassigned')),
    assign: (v: { assignedUserId: string; assignedTeamId: string }) =>
      withApply(() => workOrdersApi.assign(id, v), t('wo.assigned')),
    hold: (reason: string) => withApply(() => workOrdersApi.hold(id, { reason }), t('wo.onHold')),
    complete: (v: CompleteWorkOrderInput) =>
      withApply(() => workOrdersApi.complete(id, v), t('wo.completed')),
    close: (note: string) => withApply(() => workOrdersApi.close(id, { note }), t('wo.closed')),
    reopen: (reason: string) =>
      withApply(() => workOrdersApi.reopen(id, { reason }), t('wo.reopened')),
    message: async (body: string) => apply(await workOrdersApi.message(id, { body })),
    upload: async (files: File[]) => apply(await workOrdersApi.upload(id, files)),
    answer: async (itemId: string, input: StepAnswerInput) =>
      apply(await checklistApi.answer(id, itemId, input)),
  }
}
